// Vercel Serverless Function — combines two public bulk feeds. Lighter's
// funding-rates feed already supplies 8h-equivalent rates for Lighter and
// reference venues; Aster's rate is normalized with its per-market interval.

const LIGHTER_VENUES = {
  lighter: 'Lighter',
  hyperliquid: 'Hyperliquid',
  binance: 'Binance',
  bybit: 'Bybit',
};

function normalizeSymbol(symbol) {
  return String(symbol || '').replace(/(?:USDT|USD)$/, '');
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Funding source failed: ${response.status}`);
  return response.json();
}

export default async function handler(req, res) {
  try {
    const [lighterResult, asterPremiumResult, asterInfoResult] = await Promise.allSettled([
      fetchJson('https://mainnet.zklighter.elliot.ai/api/v1/funding-rates'),
      fetchJson('https://fapi.asterdex.com/fapi/v1/premiumIndex'),
      fetchJson('https://fapi.asterdex.com/fapi/v1/fundingInfo'),
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

    const markets = [...ratesBySymbol.entries()].flatMap(([symbol, rates]) => {
      if (rates.length < 2) return [];
      const low = rates.reduce((best, rate) => rate.rate8h < best.rate8h ? rate : best);
      const high = rates.reduce((best, rate) => rate.rate8h > best.rate8h ? rate : best);
      const spread8h = high.rate8h - low.rate8h;
      return spread8h > 0 ? [{ symbol, rates, low, high, spread8h }] : [];
    }).sort((a, b) => b.spread8h - a.spread8h);

    if (!hasLighterFeed && !hasAsterFeed) {
      return res.status(502).json({ error: 'Funding data request failed' });
    }

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ markets, updatedAt: new Date().toISOString() });
  } catch {
    return res.status(502).json({ error: 'Funding data request failed' });
  }
}
