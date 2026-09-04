// Arcus mainnet market-data adapter. Kept independent from the Vercel
// handler so the public response contract can be tested without live calls.
export const ARCUS_MAINNET_BASE_URL = 'https://api.arcus.xyz';
export const ARCUS_MARKETS_PATH = '/v1/markets';

function finiteNonNegative(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

/**
 * Normalizes the official GET /v1/markets response.
 *
 * volume24hNotional is USD quote notional. openInterest is base quantity, so
 * it is converted per market using Arcus's co-timestamped markPrice. Only
 * ONLINE PERPETUAL markets enter Zig's protocol-wide metrics.
 */
export function normalizeArcusMarkets(payload) {
  const markets = Array.isArray(payload?.markets) ? payload.markets : [];
  const seenMarketIds = new Set();
  let volume = 0;
  let openInterest = 0;
  let hasVolume = false;
  let hasOpenInterest = false;
  let marketsCount = 0;
  let duplicateMarketIds = 0;
  let invalidMarkets = 0;

  for (const market of markets) {
    if (!market || market.type !== 'PERPETUAL' || market.status !== 'ONLINE') continue;
    const marketId = finiteNonNegative(market.marketId);
    if (!Number.isInteger(marketId)) { invalidMarkets += 1; continue; }
    if (seenMarketIds.has(marketId)) { duplicateMarketIds += 1; continue; }
    seenMarketIds.add(marketId);
    marketsCount += 1;

    const notionalVolume = finiteNonNegative(market.volume24hNotional);
    if (notionalVolume != null) { volume += notionalVolume; hasVolume = true; }

    const baseOpenInterest = finiteNonNegative(market.openInterest);
    const markPrice = finiteNonNegative(market.markPrice);
    if (baseOpenInterest != null && markPrice != null) {
      openInterest += baseOpenInterest * markPrice;
      hasOpenInterest = true;
    }
  }

  return {
    volume: hasVolume ? volume : null,
    openInterest: hasOpenInterest ? openInterest : null,
    marketsCount: marketsCount || null,
    diagnostics: { receivedMarkets: markets.length, activePerpetualMarkets: marketsCount, duplicateMarketIds, invalidMarkets },
  };
}

export async function fetchArcusMarketMetrics(fetchJson) {
  const payload = await fetchJson(`${ARCUS_MAINNET_BASE_URL}${ARCUS_MARKETS_PATH}`);
  return normalizeArcusMarkets(payload);
}
