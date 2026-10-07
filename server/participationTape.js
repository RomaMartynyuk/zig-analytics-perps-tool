import { createHmac, randomBytes } from 'node:crypto';
import { createAccumulator, serializeAccumulator, distributionMetrics, reconciliation, publishableMetrics, PARTICIPATION_METHOD, utcWindow } from './participationMath.js';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const scopedIdentity = (slug, type, value, salt) => createHmac('sha256', salt).update(`${slug}:${type}:${value}`).digest('hex');

export function tapeState(slug, day, checkpoint) {
  const window = utcWindow(day);
  if (Date.parse(window.periodEnd) > Date.now()) throw new Error('Only completed UTC days can be collected');
  if (checkpoint && (checkpoint.protocolSlug !== slug || checkpoint.day !== day || checkpoint.methodologyVersion !== PARTICIPATION_METHOD)) throw new Error('Checkpoint protocol/window/methodology mismatch');
  return checkpoint || { protocolSlug: slug, day, ...window, methodologyVersion: PARTICIPATION_METHOD, salt: randomBytes(32).toString('hex'), complete: false, accumulator: serializeAccumulator(createAccumulator()) };
}

export function publicRequester(base, { fetchImpl = fetch, waitImpl = sleep, requestDelayMs = 200, rateLimitStatuses = [429], rateLimitCooldownMs = 0, deadline = Infinity } = {}, performance) {
  let previous = 0;
  let intervalMs = requestDelayMs;
  performance.effectiveRequestDelayMs = intervalMs;
  return async (path) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      if (Date.now() >= deadline) throw new Error('Collection budget reached before request retry; checkpoint preserved');
      const delay = intervalMs - (Date.now() - previous);
      if (delay > 0) await waitImpl(delay);
      previous = Date.now();
      performance.apiCalls++;
      try {
        const response = await fetchImpl(`${base}${path}`, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) {
          const error = new Error(`Public trade API HTTP ${response.status}`);
          error.status = response.status;
          error.permanent = response.status < 500 && !rateLimitStatuses.includes(response.status);
          if (rateLimitStatuses.includes(response.status)) {
            intervalMs = Math.min(Math.max(intervalMs * 2, 1000), 10000);
            performance.effectiveRequestDelayMs = intervalMs;
          }
          const retry = response.headers?.get('retry-after');
          if (retry && /^\d+$/.test(retry) && Number(retry) > 60) {
            error.permanent = true;
            error.message = `Public API requires ${retry}s cooldown; automatic retries stopped and checkpoint preserved`;
          }
          error.retryAfterMs = Math.max(rateLimitStatuses.includes(response.status) ? rateLimitCooldownMs : 0, retry && /^\d+$/.test(retry) ? Math.min(Number(retry) * 1000, 60000) : 0);
          if (rateLimitStatuses.includes(response.status) && response.json) {
            const body = await response.json().catch(() => ({}));
            const cooldown = body?.retryAfterMs;
            if (Number.isFinite(cooldown) && cooldown > 60000) { error.permanent = true; error.message = 'Public API requests a longer cooldown; automatic retries stopped and checkpoint preserved'; }
            else if (Number.isFinite(cooldown) && cooldown >= 0) error.retryAfterMs = Math.max(error.retryAfterMs, cooldown);
          }
          throw error;
        }
        const payload = await response.json();
        if (payload.code !== undefined && payload.code !== 200) throw Object.assign(new Error(`Public trade API code ${payload.code}`), { permanent: true });
        return payload;
      } catch (error) {
        if (error.permanent || attempt === 3) throw error;
        performance.retries++;
        performance.retryStatuses ||= {};
        const status = String(error.status || 'NETWORK');
        performance.retryStatuses[status] = (performance.retryStatuses[status] || 0) + 1;
        const backoff = Math.max(error.retryAfterMs || 0, intervalMs, 750 * 2 ** attempt);
        if (Date.now() + backoff >= deadline) throw new Error('Collection budget reached during API cooldown; checkpoint preserved');
        await waitImpl(backoff);
      }
    }
  };
}

export function tapeResult(state, accumulator, { participantType, source, performance, started, marketVolumes = {}, reason }) {
  const observed = distributionMetrics(accumulator.participants);
  const completePopulation = state.complete && !accumulator.rejected;
  // Protocol denominator is valid only if EVERY frozen eligible market has
  // independently available same-day volume. Never infer a missing bar as 0.
  const values = state.markets.map((market) => marketVolumes[String(market.id)]);
  const denominator = values.every((value) => Number.isFinite(value) && value >= 0) ? values.reduce((a, b) => a + b, 0) : null;
  const quality = reconciliation({ attributedVolumeUsd: observed.attributedVolumeUsd, comparableVolumeUsd: denominator, exactWindow: denominator !== null, complete: state.complete, rejected: accumulator.rejected });
  const rows = [{ marketId: null, ...publishableMetrics(observed, quality, completePopulation), ...quality }];
  for (const [marketId, accounts] of accumulator.markets) {
    const metrics = distributionMetrics(accounts);
    const volume = marketVolumes[marketId] ?? null;
    const marketQuality = reconciliation({ attributedVolumeUsd: metrics.attributedVolumeUsd, comparableVolumeUsd: volume, exactWindow: volume !== null, complete: state.complete, rejected: accumulator.rejected });
    rows.push({ marketId, ...publishableMetrics(metrics, marketQuality, completePopulation), ...marketQuality });
  }
  state.accumulator = serializeAccumulator(accumulator);
  performance.elapsedMs = Date.now() - started;
  const statusReason = state.blockedReason || (!state.complete ? 'Collection is incomplete. Resume the frozen UTC-day checkpoint; population and concentration remain unavailable.' : accumulator.rejected ? 'Some source executions were unusable; full population and concentration are suppressed.' : denominator === null ? 'One or more exact daily notional candles are unavailable; protocol concentration is suppressed.' : !quality.concentrationEligible ? 'Trade-volume reconciliation is outside the accepted coverage range; concentration is suppressed.' : 'Complete tape reconciled against exact-day official notional candles.');
  return { protocolSlug: state.protocolSlug, snapshotDate: state.day, periodStart: state.periodStart, periodEnd: state.periodEnd, participantType, attribution: 'MAKER_TAKER_HALF_SPLIT', methodologyVersion: PARTICIPATION_METHOD, source, sourceType: participantType === 'ADDRESS' ? 'PUBLIC_ADDRESS_TRADE_DATA' : 'PUBLIC_ACCOUNT_TRADE_DATA', complete: state.complete, rows, observedDiagnostic: observed, officialObservation: { window: 'UTC_CALENDAR_DAY', comparable: denominator !== null, volumeUsd: denominator, marketsWithDenominator: values.filter((value) => value !== null && value !== undefined).length, markets: values.length }, diagnostics: { accepted: accumulator.accepted, rejected: accumulator.rejected, duplicates: accumulator.duplicates, ...performance }, reason: `${statusReason} ${reason}`, checkpoint: state };
}
