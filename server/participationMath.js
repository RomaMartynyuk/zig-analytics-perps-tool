// Participant identities are protocol-scoped accounts/addresses, never people.
export const PARTICIPATION_METHOD = 'maker_taker_half_split_utc_v1';
export const PARTICIPATION_POLICY = Object.freeze({ highCoverage: 0.95, minimumCoverage: 0.8, excessTolerance: 0.02, topPercentileMinimum: 100 });

export function nonNegative(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function utcWindow(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Expected a UTC YYYY-MM-DD date');
  const start = new Date(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== day) throw new Error('Invalid UTC date');
  return { periodStart: start.toISOString(), periodEnd: new Date(start.getTime() + 86400000).toISOString() };
}

export function createAccumulator(state = {}) {
  return { participants: new Map(state.participants || []), markets: new Map((state.markets || []).map(([id, rows]) => [id, new Map(rows)])), seen: new Set(state.seen || []), accepted: state.accepted || 0, rejected: state.rejected || 0, duplicates: state.duplicates || 0 };
}

export function serializeAccumulator(accumulator) {
  return { participants: [...accumulator.participants], markets: [...accumulator.markets].map(([id, rows]) => [id, [...rows]]), seen: [...accumulator.seen], accepted: accumulator.accepted, rejected: accumulator.rejected, duplicates: accumulator.duplicates };
}

/** One matched fill = one economic notional, half attributed to each side.
 * Self-matches contribute the full notional to one account, not two accounts.
 * Caller hashes scoped identities before checkpointing. No identity inference.
 */
export function accumulateTrade(accumulator, trade, window) {
  const volume = nonNegative(trade?.volumeUsd);
  const time = Date.parse(trade?.timestamp);
  if (!trade?.id || !trade.maker || !trade.taker || !trade.marketId || volume === null || volume <= 0 || !Number.isFinite(time) || time < Date.parse(window.periodStart) || time >= Date.parse(window.periodEnd) || trade.finalized === false) {
    accumulator.rejected++;
    return false;
  }
  if (accumulator.seen.has(trade.id)) { accumulator.duplicates++; return false; }
  const market = accumulator.markets.get(trade.marketId) || new Map();
  const additions = new Map();
  for (const participant of [trade.maker, trade.taker]) {
    additions.set(participant, (additions.get(participant) || 0) + volume / 2);
  }
  if ([accumulator.participants, market].some((map) => [...additions].some(([participant, increment]) => !Number.isFinite((map.get(participant) || 0) + increment)))) { accumulator.rejected++; return false; }
  accumulator.seen.add(trade.id);
  for (const map of [accumulator.participants, market]) for (const [participant, increment] of additions) map.set(participant, (map.get(participant) || 0) + increment);
  accumulator.markets.set(trade.marketId, market);
  accumulator.accepted++;
  return true;
}

export function reconciliation({ attributedVolumeUsd, comparableVolumeUsd, exactWindow = false, complete = false, rejected = 0 }) {
  const comparable = nonNegative(comparableVolumeUsd);
  const ratio = exactWindow && comparable !== null && comparable > 0 ? attributedVolumeUsd / comparable : null;
  let qualityState = 'UNAVAILABLE';
  if (ratio !== null) {
    if (ratio > 1 + PARTICIPATION_POLICY.excessTolerance || ratio < PARTICIPATION_POLICY.minimumCoverage) qualityState = 'LOW';
    else if (complete && rejected === 0 && Math.abs(ratio - 1) <= 1e-6) qualityState = 'COMPLETE';
    else if (ratio >= PARTICIPATION_POLICY.highCoverage) qualityState = 'HIGH';
    else qualityState = 'PARTIAL';
  } else if (exactWindow && comparable === 0 && attributedVolumeUsd === 0 && complete && rejected === 0) qualityState = 'COMPLETE';
  const concentrationEligible = complete && rejected === 0 && ['COMPLETE', 'HIGH', 'PARTIAL'].includes(qualityState);
  return { comparableVolumeUsd: exactWindow ? comparable : null, coverageRatio: ratio, qualityState, concentrationEligible, signalEligible: false };
}

export function distributionMetrics(participants) {
  if ([...participants.values()].some((value) => !Number.isFinite(value) || value < 0)) throw new Error('Invalid participant distribution');
  const values = [...participants.values()].filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => b - a);
  const count = values.length;
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total)) throw new Error('Participant total overflow');
  if (!count) return { activeParticipants: 0, attributedVolumeUsd: 0, meanVolumePerParticipant: null, medianVolumePerParticipant: null, p90VolumePerParticipant: null, top1Share: null, top5Share: null, top10Share: null, top1pctShare: null, hhi: null, effectiveParticipants: null };
  const top = (n) => values.slice(0, n).reduce((sum, value) => sum + value, 0) / total * 100;
  const middle = Math.floor(count / 2);
  const hhi = values.reduce((sum, value) => sum + (value / total) ** 2, 0);
  return { activeParticipants: count, attributedVolumeUsd: total, meanVolumePerParticipant: total / count, medianVolumePerParticipant: count % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2, p90VolumePerParticipant: values[count - Math.ceil(count * 0.9)], top1Share: top(1), top5Share: top(5), top10Share: top(10), top1pctShare: count >= PARTICIPATION_POLICY.topPercentileMinimum ? top(Math.ceil(count * 0.01)) : null, hhi, effectiveParticipants: 1 / hhi };
}

export function publishableMetrics(observed, quality, complete) {
  const result = { ...observed };
  // Partial scans cannot establish a population size or a distribution.
  if (!complete) for (const key of Object.keys(result)) result[key] = null;
  if (!quality.concentrationEligible) for (const key of ['top1Share', 'top5Share', 'top10Share', 'top1pctShare', 'hhi', 'effectiveParticipants']) result[key] = null;
  return result;
}
