import { ARCUS_MAINNET_BASE_URL, ARCUS_MARKETS_PATH } from './arcusAdapter.js';
import { accumulateTrade, createAccumulator, serializeAccumulator, nonNegative } from './participationMath.js';
import { tapeState, scopedIdentity, publicRequester, tapeResult } from './participationTape.js';

export function normalizeArcusTrade(trade, market, salt) {
  const address = (value) => typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value);
  const price = nonNegative(trade?.price), size = nonNegative(trade?.size);
  if (trade?.marketId !== market.id || typeof trade.tradeId !== 'string' || !trade.tradeId || !address(trade.makerAddress) || !address(trade.takerAddress) || !Number.isSafeInteger(trade.timestamp) || price === null || size === null) return null;
  // Public fills use human USD price, base size, and epoch MICROseconds.
  // Address casing is not an economic distinction; no entity inference.
  return { id: `arcus:${market.id}:${trade.tradeId}`, marketId: String(market.id), timestamp: new Date(Math.floor(trade.timestamp / 1000)).toISOString(), volumeUsd: price * size, maker: scopedIdentity('arcus', 'ADDRESS', trade.makerAddress.toLowerCase(), salt), taker: scopedIdentity('arcus', 'ADDRESS', trade.takerAddress.toLowerCase(), salt) };
}

export function arcusDailyVolume(payload, market, startMicros) {
  const bars = payload?.candles?.filter((bar) => bar.marketId === market.id && bar.timeframe === '1d' && bar.openTime === startMicros && bar.isFinal === true) || [];
  // Live API includes the next open candle even at an exclusive upper bound.
  // Require ONE exact finalized bar, never convert base volume using OHLC.
  return bars.length === 1 ? nonNegative(bars[0].notionalVolume) : null;
}

export async function collectArcusParticipation({ day, checkpoint = null, maxPages = 100, maxDurationMs = 50000, onCheckpoint = async () => {}, ...options } = {}) {
  const state = tapeState('arcus', day, checkpoint), started = Date.now();
  const performance = { apiCalls: 0, retries: 0, pages: 0 };
  const request = publicRequester(ARCUS_MAINNET_BASE_URL, { ...options, requestDelayMs: Math.max(state.requestDelayMs ?? options.requestDelayMs ?? 1000, options.fetchImpl ? 0 : 1000) }, performance);
  const start = Date.parse(state.periodStart) * 1000, end = Date.parse(state.periodEnd) * 1000;
  if (!state.markets) {
    const payload = await request(ARCUS_MARKETS_PATH);
    if (!Array.isArray(payload.markets)) throw new Error('Malformed Arcus market catalog');
    state.markets = payload.markets.filter((market) => market.type === 'PERPETUAL' && market.quoteAsset === 'USD' && Number.isSafeInteger(market.marketId) && (!market.addedTimestamp || market.addedTimestamp * 1000 < Date.parse(state.periodEnd))).map((market) => ({ id: market.marketId, name: market.marketDisplayName }));
    if (!state.markets.length || new Set(state.markets.map((market) => market.id)).size !== state.markets.length) throw new Error('Missing/duplicate Arcus perpetual market catalog');
    state.marketIndex = 0; state.to = end - 1; state.marketVolumes = {};
  }
  const accumulator = createAccumulator(state.accumulator);
  while (!state.complete && !state.blockedReason && performance.pages < maxPages && Date.now() - started < maxDurationMs) {
    const market = state.markets[state.marketIndex];
    if (state.tradeMarketComplete) {
      const candles = await request(`/v1/candles?${new URLSearchParams({ market: market.name, timeframe: '1d', from: String(start), to: String(end) })}`);
      state.marketVolumes[String(market.id)] = arcusDailyVolume(candles, market, start);
      state.marketIndex++; state.to = end - 1; state.tradeMarketComplete = false;
      state.complete = state.marketIndex === state.markets.length;
    } else {
      const page = await request(`/v1/trades?${new URLSearchParams({ market: market.name, limit: '1000', from: String(start), to: String(state.to) })}`);
      if (!Array.isArray(page.trades) || page.trades.length > 1000) throw new Error('Malformed Arcus trade page');
      for (const trade of page.trades) {
        if (!Number.isSafeInteger(trade.timestamp) || trade.timestamp < start || trade.timestamp > state.to) throw new Error('Arcus page violates frozen microsecond bounds');
        const normalized = normalizeArcusTrade(trade, market, state.salt);
        if (normalized) accumulateTrade(accumulator, normalized, state); else accumulator.rejected++;
      }
      if (page.trades.length < 1000) state.tradeMarketComplete = true;
      else {
        const oldest = Math.min(...page.trades.map((trade) => trade.timestamp));
        if (!Number.isSafeInteger(oldest) || oldest < start || oldest >= state.to) state.blockedReason = 'Arcus timestamp pagination cannot advance without risking a boundary gap. Full population unavailable.';
        else {
          state.to = oldest; // inclusive overlap: deduplicated by market/tradeId
          // Strictly decreasing upper bounds make earlier IDs unreachable.
          // Retain the overlapping microsecond only, not a whole day's tape.
          accumulator.seen = new Set(page.trades.filter((trade) => trade.timestamp === oldest).map((trade) => `arcus:${market.id}:${trade.tradeId}`));
        }
      }
    }
    performance.pages++;
    state.accumulator = serializeAccumulator(accumulator);
    state.requestDelayMs = performance.effectiveRequestDelayMs;
    await onCheckpoint(state);
  }
  return tapeResult(state, accumulator, { participantType: 'ADDRESS', source: 'arcus_public_trades+arcus_daily_candles', performance, started, marketVolumes: state.marketVolumes, reason: 'Full public matched-fill tape; finalized UTC-day USD notional candles independently reconcile each market. Missing candles keep protocol coverage unavailable; addresses are not people.' });
}
