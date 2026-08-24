// Vercel Serverless Function — one bulk Hyperliquid request compares predicted
// funding for the same markets across Hyperliquid, Binance and Bybit.
// Rates are normalized to an 8-hour basis before reaching the client.

const VENUES = {
  HlPerp: 'Hyperliquid',
  BinPerp: 'Binance',
  BybitPerp: 'Bybit',
};

export default async function handler(req, res) {
  try {
    const upstream = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'predictedFundings' }),
    });
    if (!upstream.ok) return res.status(upstream.status).json({ error: 'Funding data request failed' });

    const payload = await upstream.json();
    if (!Array.isArray(payload)) return res.status(502).json({ error: 'Invalid funding data response' });

    const markets = payload.flatMap(([symbol, venueRates]) => {
      const rates = (Array.isArray(venueRates) ? venueRates : []).flatMap(([venueId, rate]) => {
        const intervalHours = Number(rate?.fundingIntervalHours);
        const fundingRate = Number(rate?.fundingRate);
        if (!VENUES[venueId] || !Number.isFinite(fundingRate) || !Number.isFinite(intervalHours) || intervalHours <= 0) {
          return [];
        }

        return [{
          venue: VENUES[venueId],
          rate8h: fundingRate * (8 / intervalHours),
          intervalHours,
          nextFundingTime: Number(rate?.nextFundingTime) || null,
        }];
      });

      if (rates.length < 2) return [];
      const low = rates.reduce((best, rate) => rate.rate8h < best.rate8h ? rate : best);
      const high = rates.reduce((best, rate) => rate.rate8h > best.rate8h ? rate : best);
      return [{ symbol, rates, low, high, spread8h: high.rate8h - low.rate8h }];
    }).filter((market) => market.spread8h > 0).sort((a, b) => b.spread8h - a.spread8h);

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ markets, updatedAt: new Date().toISOString() });
  } catch {
    return res.status(502).json({ error: 'Funding data request failed' });
  }
}
