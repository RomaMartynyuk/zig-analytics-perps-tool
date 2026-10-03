const BASE = 'https://tradingapi.bullet.xyz/fapi/v1';

function valid(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

/** Bullet FAPI uses human-readable quoteVolume (USD) and base openInterest.
 * The public premiumIndex supplies the mark for conversion to USD OI. */
export function normalizeBulletMarkets(info, tickers, interests, prices) {
  if (!Array.isArray(info?.symbols) || !Array.isArray(tickers) || !Array.isArray(interests) || !Array.isArray(prices)) return { volume:null, openInterest:null, marketsCount:null };
  const tickersBySymbol = new Map(tickers.map((row) => [row.symbol, row]));
  const oiBySymbol = new Map(interests.map((row) => [row.symbol, row]));
  const pricesBySymbol = new Map(prices.map((row) => [row.symbol, row]));
  const seen = new Set();
  let volume = 0, openInterest = 0, volumeComplete = true, oiComplete = true, marketsCount = 0;
  for (const market of info.symbols) {
    if (market?.status !== 'TRADING' || !String(market.contractType || '').endsWith('Perp') || !market.symbol || seen.has(market.symbol)) continue;
    seen.add(market.symbol);
    marketsCount += 1;
    const quoteVolume = valid(tickersBySymbol.get(market.symbol)?.quoteVolume);
    const baseOi = valid(oiBySymbol.get(market.symbol)?.openInterest);
    const mark = valid(pricesBySymbol.get(market.symbol)?.markPrice);
    if (quoteVolume == null) volumeComplete = false;
    else volume += quoteVolume;
    if (baseOi == null || mark == null) oiComplete = false;
    else openInterest += baseOi * mark;
  }
  return { volume: marketsCount && volumeComplete ? volume : null, openInterest: marketsCount && oiComplete ? openInterest : null, marketsCount: marketsCount || null };
}

export async function fetchBulletMarketMetrics(fetchJson) {
  const [info, tickers, interests, prices] = await Promise.all(['exchangeInfo','ticker/24hr','openInterest','premiumIndex'].map((path) => fetchJson(`${BASE}/${path}`)));
  return normalizeBulletMarkets(info, tickers, interests, prices);
}
