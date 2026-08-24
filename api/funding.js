// Vercel Serverless Function — combines two public bulk feeds. Lighter's
// funding-rates feed already supplies 8h-equivalent rates for Lighter and
// reference venues; Aster's rate is normalized with its per-market interval.

const LIGHTER_VENUES = {
  lighter: 'Lighter',
  hyperliquid: 'Hyperliquid',
  binance: 'Binance',
  bybit: 'Bybit',
};

const EDGEX_SHARED_SYMBOLS = new Set(['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'HYPE', 'SUI', 'AVAX']);

function normalizeSymbol(symbol) {
  return String(symbol || '').replace(/(?:USDC|USDT|USD)$/, '');
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Funding source failed: ${response.status}`);
  return response.json();
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function fetchEdgeXRates() {
  const metadata = await fetchJson('https://edgex-prod-v2.edgex.exchange/api/v2/public/meta/getMetaData');
  const contracts = metadata?.data?.contractList || [];
  const selectedContracts = contracts.filter((contract) => {
    const symbol = normalizeSymbol(contract.contractName);
    return EDGEX_SHARED_SYMBOLS.has(symbol);
  });

  return mapWithConcurrency(selectedContracts, 3, async (contract) => {
    try {
      const response = await fetchJson(
        `https://edgex-prod-v2.edgex.exchange/api/v2/public/funding/getLatestFundingRate?contractId=${encodeURIComponent(contract.contractId)}`
      );
      const rate = Array.isArray(response?.data) ? response.data[0] : null;
      const intervalMinutes = Number(rate?.fundingRateIntervalMin);
      const fundingRate = Number(rate?.predictedFundingRate ?? rate?.fundingRate);
      if (!Number.isFinite(fundingRate) || !Number.isFinite(intervalMinutes) || intervalMinutes <= 0) return null;
      return {
        symbol: normalizeSymbol(contract.contractName),
        venue: 'edgeX',
        rate8h: fundingRate * (480 / intervalMinutes),
        intervalHours: intervalMinutes / 60,
      };
    } catch {
      return null;
    }
  });
}

export default async function handler(req, res) {
  try {
    const [lighterResult, asterPremiumResult, asterInfoResult, variationalResult, pacificaResult, edgeXResult] = await Promise.allSettled([
      fetchJson('https://mainnet.zklighter.elliot.ai/api/v1/funding-rates'),
      fetchJson('https://fapi.asterdex.com/fapi/v1/premiumIndex'),
      fetchJson('https://fapi.asterdex.com/fapi/v1/fundingInfo'),
      fetchJson('https://omni-client-api.prod.ap-northeast-1.variational.io/metadata/stats'),
      fetchJson('https://api.pacifica.fi/api/v1/info'),
      fetchEdgeXRates(),
    ]);

    const ratesBySymbol = new Map();
    const addRate = (symbol, rate) => {
      if (!symbol || !Number.isFinite(rate.rate8h)) return;
      const rates = ratesBySymbol.get(symbol) || [];
      const duplicateIndex = rates.findIndex((item) => item.venue === rate.venue);
      if (duplicateIndex >= 0) rates[duplicateIndex] = rate;
      else rates.push(rate);
      ratesBySymbol.set(symbol, rates);
    };

    const hasLighterFeed = lighterResult.status === 'fulfilled';
    const hasAsterFeed = asterPremiumResult.status === 'fulfilled' && asterInfoResult.status === 'fulfilled';

    if (hasLighterFeed) {
      for (const row of lighterResult.value?.funding_rates || []) {
        const venue = LIGHTER_VENUES[row.exchange];
        const rate8h = Number(row.rate);
        if (venue && Number.isFinite(rate8h)) {
          addRate(normalizeSymbol(row.symbol), { venue, rate8h, intervalHours: 8 });
        }
      }
    }

    if (hasAsterFeed) {
      const intervalBySymbol = new Map(
        (asterInfoResult.value || []).map((row) => [row.symbol, Number(row.fundingIntervalHours)])
      );
      for (const row of asterPremiumResult.value || []) {
        const intervalHours = intervalBySymbol.get(row.symbol);
        const fundingRate = Number(row.lastFundingRate);
        if (Number.isFinite(fundingRate) && Number.isFinite(intervalHours) && intervalHours > 0) {
          addRate(normalizeSymbol(row.symbol), {
            venue: 'Aster',
            rate8h: fundingRate * (8 / intervalHours),
            intervalHours,
            nextFundingTime: Number(row.nextFundingTime) || null,
          });
        }
      }
    }

    if (variationalResult.status === 'fulfilled') {
      for (const listing of variationalResult.value?.listings || []) {
        const fundingRate = Number(listing.funding_rate);
        const intervalSeconds = Number(listing.funding_interval_s);
        if (Number.isFinite(fundingRate) && Number.isFinite(intervalSeconds) && intervalSeconds > 0) {
          addRate(normalizeSymbol(listing.ticker), {
            venue: 'Variational',
            // Live Omni values are basis points (e.g. "-4.437974" means
            // -4.437974 bps), whereas the other feeds use decimal rates.
            rate8h: (fundingRate / 10_000) * (28_800 / intervalSeconds),
            intervalHours: intervalSeconds / 3600,
          });
        }
      }
    }

    if (pacificaResult.status === 'fulfilled') {
      for (const market of pacificaResult.value?.data || []) {
        const fundingRate = Number(market.next_funding_rate ?? market.funding_rate);
        if (Number.isFinite(fundingRate)) {
          addRate(normalizeSymbol(market.symbol), {
            venue: 'Pacifica',
            rate8h: fundingRate * 8,
            intervalHours: 1,
          });
        }
      }
    }

    if (edgeXResult.status === 'fulfilled') {
      for (const rate of edgeXResult.value) {
        if (rate) addRate(rate.symbol, rate);
      }
    }

    const markets = [...ratesBySymbol.entries()].flatMap(([symbol, rates]) => {
      if (rates.length < 2) return [];
      const low = rates.reduce((best, rate) => rate.rate8h < best.rate8h ? rate : best);
      const high = rates.reduce((best, rate) => rate.rate8h > best.rate8h ? rate : best);
      const spread8h = high.rate8h - low.rate8h;
      return spread8h > 0 ? [{ symbol, rates, low, high, spread8h }] : [];
    }).sort((a, b) => b.spread8h - a.spread8h);

    const hasAnyFeed = hasLighterFeed || hasAsterFeed || variationalResult.status === 'fulfilled'
      || pacificaResult.status === 'fulfilled' || edgeXResult.status === 'fulfilled';
    if (!hasAnyFeed) {
      return res.status(502).json({ error: 'Funding data request failed' });
    }

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ markets, updatedAt: new Date().toISOString() });
  } catch {
    return res.status(502).json({ error: 'Funding data request failed' });
  }
}
