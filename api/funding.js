// Vercel Serverless Function — combines public funding feeds. Lighter's
// funding-rates feed already supplies 8h-equivalent rates for Lighter and
// reference venues.

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
    const [lighterResult, pacificaResult, edgeXResult] = await Promise.allSettled([
      fetchJson('https://mainnet.zklighter.elliot.ai/api/v1/funding-rates'),
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
    if (hasLighterFeed) {
      for (const row of lighterResult.value?.funding_rates || []) {
        const venue = LIGHTER_VENUES[row.exchange];
        const rate8h = Number(row.rate);
        if (venue && Number.isFinite(rate8h)) {
          addRate(normalizeSymbol(row.symbol), { venue, rate8h, intervalHours: 8 });
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

    const hasAnyFeed = hasLighterFeed || pacificaResult.status === 'fulfilled' || edgeXResult.status === 'fulfilled';
    if (!hasAnyFeed) {
      return res.status(502).json({ error: 'Funding data request failed' });
    }

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ markets, updatedAt: new Date().toISOString() });
  } catch {
    return res.status(502).json({ error: 'Funding data request failed' });
  }
}
