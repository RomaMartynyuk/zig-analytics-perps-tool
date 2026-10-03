const BASE = 'https://api-mainnet.n1.xyz';

function valid(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

/** Nord /markets/live publishes human-readable quote 24h volume and base OI.
 * /info supplies the authoritative market universe; live values are already
 * decimal-scaled (unlike signed action integers). */
export function normalizeN1Markets(info, live) {
  if (!Array.isArray(info?.markets) || !Array.isArray(live?.markets)) return { volume:null, openInterest:null, marketsCount:null };
  const liveById = new Map(live.markets.filter((row) => Number.isInteger(row?.marketId)).map((row) => [row.marketId, row]));
  const seen = new Set();
  let volume = 0, openInterest = 0, volumeComplete = true, oiComplete = true, marketsCount = 0;
  for (const market of info.markets) {
    if (!Number.isInteger(market?.marketId) || seen.has(market.marketId) || market.regime !== 'normal') continue;
    seen.add(market.marketId);
    const row = liveById.get(market.marketId);
    if (!row || row.frozen === true || !row.perpetuals) continue;
    marketsCount += 1;
    const quoteVolume = valid(row.historical?.volumeQuote24h);
    const baseOi = valid(row.perpetuals.openInterest);
    const mark = valid(row.perpetuals.markPrice);
    if (quoteVolume == null) volumeComplete = false;
    else volume += quoteVolume;
    if (baseOi == null || mark == null) oiComplete = false;
    else openInterest += baseOi * mark;
  }
  return { volume: marketsCount && volumeComplete ? volume : null, openInterest: marketsCount && oiComplete ? openInterest : null, marketsCount: marketsCount || null };
}

export async function fetchN1MarketMetrics(fetchJson) {
  const [info, live] = await Promise.all([fetchJson(`${BASE}/info`), fetchJson(`${BASE}/markets/live`)]);
  return normalizeN1Markets(info, live);
}
