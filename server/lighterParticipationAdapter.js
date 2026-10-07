import { accumulateTrade, createAccumulator, serializeAccumulator, nonNegative } from './participationMath.js';
import { tapeState, scopedIdentity, publicRequester, tapeResult } from './participationTape.js';

const BASE = 'https://mainnet.zklighter.elliot.ai';
export function normalizeLighterTrade(trade, markets, salt) {
  const account = (value) => Number.isSafeInteger(value) && value >= 0;
  const id = trade?.trade_id_str ?? trade?.trade_id;
  const volume = nonNegative(trade?.usd_amount);
  if (trade?.market_kind !== 'perps' || !markets.some((market) => market.id === trade.market_id) || !['trade', 'liquidation', 'deleverage', 'market-settlement'].includes(trade.type) || !account(trade.ask_account_id) || !account(trade.bid_account_id) || !(typeof id === 'string' ? /^\d+$/.test(id) : account(id)) || !Number.isSafeInteger(trade.timestamp) || trade.timestamp < 0 || trade.timestamp > 8640000000000000 || volume === null || typeof trade.is_maker_ask !== 'boolean') return null;
  const ask = scopedIdentity('lighter', 'ACCOUNT', trade.ask_account_id, salt), bid = scopedIdentity('lighter', 'ACCOUNT', trade.bid_account_id, salt);
  return { id: `lighter:${trade.market_id}:${id}`, marketId: String(trade.market_id), timestamp: new Date(trade.timestamp).toISOString(), volumeUsd: volume, maker: trade.is_maker_ask ? ask : bid, taker: trade.is_maker_ask ? bid : ask };
}

export function lighterDailyVolume(payload, startMs) {
  const bars = Array.isArray(payload?.c) ? payload.c.filter((bar) => bar.t === startMs) : [];
  return bars.length === 1 ? nonNegative(bars[0].V) : null;
}

export async function collectLighterParticipation({ day, checkpoint = null, maxPages = 100, maxDurationMs = 50000, onCheckpoint = async () => {}, ...options } = {}) {
  const state = tapeState('lighter', day, checkpoint), started = Date.now();
  const performance = { apiCalls: 0, retries: 0, pages: 0 };
  // Official standard tier: 60 unweighted requests/minute; 405 is ALSO a
  // rate-limit response. Reserve headroom and respect the 60s firewall cooldown.
  // Faster overrides are permitted only for injected fixture transports.
  const request = publicRequester(BASE, { ...options, requestDelayMs: Math.max(state.requestDelayMs ?? options.requestDelayMs ?? 1500, options.fetchImpl ? 0 : 1500), rateLimitStatuses: [429, 405], rateLimitCooldownMs: 60000, deadline: started + maxDurationMs }, performance);
  const start = Date.parse(state.periodStart), end = Date.parse(state.periodEnd);
  if (!state.markets) {
    const payload = await request('/api/v1/orderBooks');
    if (!Array.isArray(payload.order_books)) throw new Error('Malformed Lighter market catalog');
    state.markets = payload.order_books.filter((market) => market.market_type === 'perp' && Number.isSafeInteger(market.market_id) && (!market.created_at || Number(market.created_at) < end)).map((market) => ({ id: market.market_id, name: market.symbol }));
    if (!state.markets.length || new Set(state.markets.map((market) => market.id)).size !== state.markets.length) throw new Error('Missing/duplicate Lighter perpetual market catalog');
    state.cursor = null; state.tapeComplete = false; state.candleIndex = 0; state.marketVolumes = {};
  }
  const accumulator = createAccumulator(state.accumulator);
  while (!state.complete && !state.blockedReason && performance.pages < maxPages && Date.now() - started < maxDurationMs) {
    if (!state.tapeComplete) {
      const params = new URLSearchParams({ market_type: 'perp', sort_by: 'timestamp', sort_dir: 'desc', from: String(end - 1), limit: '100', type: 'all', aggregate: 'false' });
      if (state.cursor) params.set('cursor', state.cursor);
      const payload = await request(`/api/v1/trades?${params}`);
      if (!Array.isArray(payload.trades) || payload.trades.length > 100) throw new Error('Malformed Lighter trade page');
      const acceptedBeforePage = accumulator.accepted;
      let crossedStart = false, previousTime = state.lastTradeTimestamp ?? end - 1;
      for (const trade of payload.trades) {
        if (!Number.isSafeInteger(trade.timestamp) || trade.timestamp > previousTime || trade.timestamp >= end) throw new Error('Lighter historical page violates descending frozen-window bounds');
        previousTime = trade.timestamp;
        if (trade.timestamp < start) { crossedStart = true; continue; }
        const normalized = normalizeLighterTrade(trade, state.markets, state.salt);
        if (normalized) accumulateTrade(accumulator, normalized, state); else accumulator.rejected++;
      }
      if (payload.trades.length) {
        // Keep dedup IDs only for the overlapping last millisecond. Descending
        // bounds reject older cursor cycles that would revisit newer rows.
        const boundaryIds = payload.trades.filter((trade) => trade.timestamp === previousTime).map((trade) => `lighter:${trade.market_id}:${trade.trade_id_str ?? trade.trade_id}`);
        accumulator.seen = new Set([...(state.lastTradeTimestamp === previousTime ? accumulator.seen : []), ...boundaryIds]);
        state.lastTradeTimestamp = previousTime;
      }
      const next = payload.next_cursor;
      if (crossedStart || !payload.trades.length || !next) state.tapeComplete = true;
      else if (typeof next !== 'string' || next === state.cursor || (state.cursorTrail || []).includes(next) || accumulator.accepted === acceptedBeforePage) state.blockedReason = 'Lighter pagination cursor did not advance to new usable executions; incomplete population.';
      else { state.cursor = next; state.cursorTrail = [...(state.cursorTrail || []), next].slice(-64); }
    } else {
      const market = state.markets[state.candleIndex];
      const payload = await request(`/api/v1/candles?${new URLSearchParams({ market_id: String(market.id), resolution: '1d', start_timestamp: String(start / 1000), end_timestamp: String(end / 1000 - 1), count_back: '1', set_timestamp_to_end: 'false' })}`);
      state.marketVolumes[String(market.id)] = lighterDailyVolume(payload, start);
      state.candleIndex++;
      state.complete = state.candleIndex === state.markets.length;
    }
    performance.pages++;
    state.accumulator = serializeAccumulator(accumulator);
    state.requestDelayMs = performance.effectiveRequestDelayMs;
    await onCheckpoint(state);
  }
  return tapeResult(state, accumulator, { participantType: 'ACCOUNT', source: 'lighter_public_trades+lighter_daily_candles', performance, started, marketVolumes: state.marketVolumes, reason: 'Perpetual-only public matched executions, including documented trade types. Exact daily quote-volume candles; missing bars or incomplete traversal suppress concentration. Account IDs include subaccounts and pools, not people. Global history can require many bounded batches.' });
}
