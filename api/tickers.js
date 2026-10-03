// Vercel Serverless Function — one batched CoinGecko request for the six
// tokens shown in the dashboard's Last Perps Tickers card.

const TICKERS = [
  { name: 'Hyperliquid', ticker: 'HYPE', coinId: 'hyperliquid' },
  { name: 'Lighter', ticker: 'LIT', coinId: 'lighter' },
  { name: 'edgeX', ticker: 'EDGE', coinId: 'edgex' },
  { name: 'Aster', ticker: 'ASTER', coinId: 'aster-2' },
  { name: 'Backpack', ticker: 'BP', coinId: 'backpack' },
  { name: 'GRVT', ticker: 'GRVT', coinId: 'grvt' },
];

export function normalizeTickers(prices) {
  return TICKERS.flatMap(({ name, ticker, coinId }) => {
    const quote = prices?.[coinId];
    const price = quote?.usd == null ? null : Number(quote.usd);
    const change = quote?.usd_24h_change == null ? null : Number(quote.usd_24h_change);
    if (!Number.isFinite(price) || price <= 0) return [];
    return [{ name, ticker, price, change: Number.isFinite(change) ? change : null }];
  }).sort((a, b) => b.price - a.price);
}

export default async function handler(req, res) {
  const ids = TICKERS.map((token) => token.coinId).join(',');
  const url = new URL('https://api.coingecko.com/api/v3/simple/price');
  url.searchParams.set('ids', ids);
  url.searchParams.set('vs_currencies', 'usd');
  url.searchParams.set('include_24hr_change', 'true');

  try {
    const headers = {};
    if (process.env.COINGECKO_DEMO_API_KEY) {
      headers['x-cg-demo-api-key'] = process.env.COINGECKO_DEMO_API_KEY;
    }
    const upstream = await fetch(url, { headers });
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: 'CoinGecko ticker request failed' });
    }

    const prices = await upstream.json();
    const tickers = normalizeTickers(prices);

    // CoinGecko receives one batched call per edge refresh, not per visitor.
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ tickers });
  } catch {
    return res.status(502).json({ error: 'CoinGecko ticker request failed' });
  }
}
