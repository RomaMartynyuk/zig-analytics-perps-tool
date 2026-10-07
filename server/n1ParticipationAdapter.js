import { createHmac, randomBytes } from 'node:crypto';
import { createAccumulator, serializeAccumulator, accumulateTrade, distributionMetrics, reconciliation, publishableMetrics, PARTICIPATION_METHOD, utcWindow, nonNegative } from './participationMath.js';

const BASE = 'https://api-mainnet.n1.xyz';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function normalizeN1Trade(trade, markets, salt) {
  const market = markets.find((item) => item.marketId === trade?.marketId);
  const validId = (id) => Number.isSafeInteger(id) && id >= 0;
  const price = nonNegative(trade?.price);
  const size = nonNegative(trade?.baseSize);
  if (!market || !validId(trade?.tradeId) || !validId(trade?.makerId) || !validId(trade?.takerId) || price === null || size === null) return null;
  const identity = (id) => createHmac('sha256', salt).update(`01-exchange:ACCOUNT:${id}`).digest('hex');
  // REST Trade doubles are human quote/base units, not order-action integers.
  return { id: `01-exchange:${trade.marketId}:${trade.tradeId}`, marketId: String(trade.marketId), timestamp: trade.time, volumeUsd: price * size, maker: identity(trade.makerId), taker: identity(trade.takerId) };
}

/** Bounded official trade-tape scan. No live APIs are used by rendering code.
 * N1's rolling volume has no documented as-of timestamp: it is NOT a UTC-day
 * denominator. Coverage remains NULL, public concentration gated. Engine
 * physicalTime describes orderbook/RFQ state, not historical-volume as-of.
 */
export async function collectN1Participation({ day, checkpoint = null, maxPages = 100, maxDurationMs = 50000, fetchImpl = fetch, onCheckpoint = async () => {}, requestDelayMs = 150, waitImpl = sleep } = {}) {
  const window = utcWindow(day);
  if (Date.parse(window.periodEnd) > Date.now()) throw new Error('Only completed UTC days can be collected');
  if (checkpoint && (checkpoint.day !== day || checkpoint.methodologyVersion !== PARTICIPATION_METHOD)) throw new Error('Checkpoint window/methodology mismatch');
  const started = Date.now();
  const performance = { apiCalls: 0, retries: 0, pages: 0, elapsedMs: 0 };
  const request = async (path) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      performance.apiCalls++;
      try {
        const response = await fetchImpl(`${BASE}${path}`, { signal: AbortSignal.timeout(12000) });
        if (!response.ok) {
          const error = new Error(`N1 public API HTTP ${response.status}`);
          const retryAfter = response.headers?.get('retry-after');
          error.retryAfterMs = retryAfter && /^\d+$/.test(retryAfter) ? Math.min(Number(retryAfter) * 1000, 15000) : 0;
          if (response.status !== 429 && response.status < 500) throw Object.assign(error, { permanent: true });
          throw error;
        }
        return await response.json();
      } catch (error) {
        if (error.permanent || attempt === 3) throw error;
        performance.retries++;
        await waitImpl(Math.max(error.retryAfterMs || 0, Math.min(500 * 2 ** attempt, 4000)));
      }
    }
  };
  let state = checkpoint;
  if (!state) {
    const info = await request('/info');
    const live = await request('/markets/live');
    const quote = new Map((info.tokens || []).map((token) => [token.tokenId, token]));
    const liveById = new Map((live.markets || []).map((market) => [market.marketId, market]));
    const markets = (info.markets || []).filter((market) => liveById.get(market.marketId)?.perpetuals && ['USDC', 'USD'].includes(quote.get(market.quoteTokenId)?.symbol));
    if (!markets.length) throw new Error('No verified USD/USDC perpetual markets in N1 metadata');
    const volumes = markets.map((market) => nonNegative(liveById.get(market.marketId)?.historical?.volumeQuote24h));
    state = { day, methodologyVersion: PARTICIPATION_METHOD, ...window, salt: randomBytes(32).toString('hex'), markets: markets.map((market) => ({ marketId: market.marketId, name: market.symbol })), cursor: null, complete: false, accumulator: serializeAccumulator(createAccumulator()), officialObservation: { observedAt: new Date().toISOString(), window: 'ROLLING_24H_UNTIMESTAMPED', volumeUsd: volumes.every((value) => value !== null) ? volumes.reduce((sum, value) => sum + value, 0) : null, comparable: false } };
  }
  const accumulator = createAccumulator(state.accumulator);
  const cursors = new Set();
  while (!state.complete && performance.pages < maxPages && Date.now() - started < maxDurationMs) {
    const params = new URLSearchParams({ since: window.periodStart, until: window.periodEnd, pageSize: '255', paginationMode: 'tradeId' });
    if (state.cursor !== null) params.set('startInclusive', String(state.cursor));
    const page = await request(`/trades?${params}`);
    if (!Array.isArray(page.items)) throw new Error('Malformed N1 trade page');
    for (const trade of page.items) {
      // Known non-perpetual markets are intentionally outside the universe.
      if (!state.markets.some((market) => market.marketId === trade?.marketId)) { accumulator.rejected++; continue; }
      const normalized = normalizeN1Trade(trade, state.markets, state.salt);
      if (normalized) accumulateTrade(accumulator, normalized, window);
      else accumulator.rejected++;
    }
    const next = page.nextStartInclusive;
    if (next !== null && next !== undefined && (!Number.isSafeInteger(next) || next < 0 || next === state.cursor || cursors.has(next))) throw new Error('N1 pagination cursor did not progress safely');
    state.cursor = next ?? null;
    if (next !== null && next !== undefined) cursors.add(next);
    state.complete = next === null || next === undefined;
    state.accumulator = serializeAccumulator(accumulator);
    performance.pages++;
    await onCheckpoint(state);
    if (!state.complete && requestDelayMs) await waitImpl(requestDelayMs);
  }
  const observed = distributionMetrics(accumulator.participants);
  const quality = reconciliation({ attributedVolumeUsd: observed.attributedVolumeUsd, comparableVolumeUsd: null, exactWindow: false, complete: state.complete, rejected: accumulator.rejected });
  const populationComplete = state.complete && accumulator.rejected === 0;
  const rows = [{ marketId: null, ...publishableMetrics(observed, quality, populationComplete), ...quality }, ...[...accumulator.markets].map(([marketId, accounts]) => ({ marketId, ...publishableMetrics(distributionMetrics(accounts), quality, populationComplete), ...quality }))];
  performance.elapsedMs = Date.now() - started;
  return { protocolSlug: '01-exchange', snapshotDate: day, ...window, participantType: 'ACCOUNT', attribution: 'MAKER_TAKER_HALF_SPLIT', methodologyVersion: PARTICIPATION_METHOD, source: 'n1_public_trades', sourceType: 'PUBLIC_ACCOUNT_TRADE_DATA', complete: state.complete, rows, observedDiagnostic: observed, officialObservation: state.officialObservation, diagnostics: { accepted: accumulator.accepted, rejected: accumulator.rejected, duplicates: accumulator.duplicates, ...performance }, reason: 'Official rolling-24h volume has no exact as-of window; UTC-day reconciliation unavailable. Concentration and signals suppressed.', checkpoint: state };
}
