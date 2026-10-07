import { getSql } from './db.js';
import { PARTICIPATION_METHOD, PARTICIPATION_POLICY, nonNegative } from './participationMath.js';
import { snapshotDateKey } from './analyticsMath.js';
import { participationUnavailableReason } from './participationCapabilities.js';

const FIELDS = { activeParticipants: 'active_participants', attributedVolumeUsd: 'attributed_volume_usd', comparableVolumeUsd: 'comparable_volume_usd', coverageRatio: 'coverage_ratio', meanVolumePerParticipant: 'mean_volume_per_participant', medianVolumePerParticipant: 'median_volume_per_participant', p90VolumePerParticipant: 'p90_volume_per_participant', top1Share: 'top1_share', top5Share: 'top5_share', top10Share: 'top10_share', top1pctShare: 'top1pct_share', hhi: 'hhi', effectiveParticipants: 'effective_participants' };
const canonicalDay = (value) => {
  const day = snapshotDateKey(value);
  const timestamp = day ? Date.parse(`${day}T00:00:00Z`) : NaN;
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === day ? day : null;
};

export function buildParticipationResponse(protocols, rows, { period = '24h' } = {}) {
  if (!['24h', '7d', '30d'].includes(period)) throw new Error('Participation period must be 24h, 7d or 30d');
  const active = protocols.filter((protocol) => protocol.is_active !== false);
  const eligibleIds = new Set(active.map((protocol) => String(protocol.id)));
  const validRows = rows.filter((row) => row && eligibleIds.has(String(row.protocol_id)) && row.methodology_version === PARTICIPATION_METHOD && row.market_id === null && canonicalDay(row.snapshot_date));
  const dates = [...new Set(validRows.map((row) => snapshotDateKey(row.snapshot_date)))].sort();
  const latest = dates.at(-1) || null;
  const requiredDays = period === '24h' ? 1 : Number.parseInt(period, 10);
  const expected = latest ? Array.from({ length: requiredDays }, (_, i) => new Date(Date.parse(`${latest}T00:00:00Z`) - i * 86400000).toISOString().slice(0, 10)).reverse() : [];
  const availableDays = expected.filter((day) => validRows.some((row) => snapshotDateKey(row.snapshot_date) === day && row.collection_complete === true && nonNegative(row.active_participants) !== null)).length;
  const sufficientHistory = availableDays === requiredDays;
  const serialize = (protocol, row) => {
    const complete = row?.collection_complete === true;
    const output = { id: protocol.id, slug: protocol.slug, name: protocol.name, participantType: row?.participant_type || 'UNKNOWN', snapshotDate: row ? snapshotDateKey(row.snapshot_date) : null, periodStart: row?.period_start || null, periodEnd: row?.period_end || null, capturedAt: row?.captured_at || null, source: row?.source || null, attribution: row?.attribution || null, methodologyVersion: row?.methodology_version || null, qualityState: row?.quality_state || 'UNAVAILABLE', collectionComplete: complete, signalEligible: false, reason: row?.diagnostics?.reason || participationUnavailableReason(protocol.slug) };
    for (const [key, field] of Object.entries(FIELDS)) output[key] = complete ? nonNegative(row?.[field]) : null;
    if (!['COMPLETE', 'HIGH', 'PARTIAL'].includes(output.qualityState) || output.coverageRatio === null || output.coverageRatio < PARTICIPATION_POLICY.minimumCoverage || output.coverageRatio > 1 + PARTICIPATION_POLICY.excessTolerance) for (const key of ['top1Share', 'top5Share', 'top10Share', 'top1pctShare', 'hhi', 'effectiveParticipants']) output[key] = null;
    return output;
  };
  const currentRows = validRows.filter((row) => snapshotDateKey(row.snapshot_date) === latest);
  const values = active.map((protocol) => serialize(protocol, currentRows.find((row) => String(row.protocol_id) === String(protocol.id))))
    .sort((a, b) => a.attributedVolumeUsd === null ? (b.attributedVolumeUsd === null ? a.name.localeCompare(b.name) : 1) : b.attributedVolumeUsd === null ? -1 : b.attributedVolumeUsd - a.attributedVolumeUsd || a.slug.localeCompare(b.slug));
  const dailyHistory = sufficientHistory && period !== '24h' ? expected.map((date) => ({ snapshotDate: date, protocols: active.map((protocol) => serialize(protocol, validRows.find((row) => String(row.protocol_id) === String(protocol.id) && snapshotDateKey(row.snapshot_date) === date))) })) : [];
  return { period, snapshotDate: latest, requiredDays, availableDays, sufficientHistory, windowKind: 'UTC_CALENDAR_DAY', coverage: { total: active.length, participantAvailable: values.filter((row) => row.activeParticipants !== null).length, concentrationAvailable: values.filter((row) => row.hhi !== null).length }, protocols: values, dailyHistory, periodAggregateAvailable: period === '24h', periodAggregateReason: period === '24h' ? null : 'Daily aggregates cannot recover distinct accounts, median or HHI for a multi-day population. Daily observations only; counts are never summed.', methodology: 'Maker/taker half split. Account/address counts are a participation proxy, not unique people or entities. HHI is on a 0–1 scale. Concentration requires comparable same-window volume coverage.' };
}

export async function getParticipationAnalytics({ period = '24h', marketId = null, protocolSlug = null, sql = getSql() } = {}) {
  if (marketId !== null && !/^[a-zA-Z0-9_-]{1,80}$/.test(marketId)) throw new Error('Invalid market scope');
  if (protocolSlug !== null && !/^[a-z0-9-]{1,128}$/.test(protocolSlug)) throw new Error('Invalid protocol scope');
  if (marketId !== null && protocolSlug === null) throw new Error('Market IDs are protocol-local; supply a protocol slug');
  const protocols = await sql`SELECT id, slug, name, is_active FROM protocols WHERE is_active = TRUE AND (${protocolSlug}::text IS NULL OR slug = ${protocolSlug}) ORDER BY name`;
  // One common participant day, never independent per-protocol latest values.
  const rows = await sql`
    SELECT d.*, d.snapshot_date::text AS snapshot_date
    FROM protocol_participation_daily d JOIN protocols p ON p.id = d.protocol_id
    WHERE p.is_active = TRUE AND d.methodology_version = ${PARTICIPATION_METHOD}
      AND (${protocolSlug}::text IS NULL OR p.slug = ${protocolSlug})
      AND d.snapshot_date >= (
        SELECT MAX(d2.snapshot_date) - INTERVAL '29 days' FROM protocol_participation_daily d2
        JOIN protocols p2 ON p2.id = d2.protocol_id
        WHERE p2.is_active = TRUE AND d2.methodology_version = ${PARTICIPATION_METHOD} AND d2.market_id IS NULL
      ) AND (${marketId}::text IS NULL AND d.market_id IS NULL OR d.market_id = ${marketId})
    ORDER BY d.snapshot_date
  `;
  // Reuse the same date/quality contract for a specific market scope.
  const scopedRows = rows.map((row) => ({ ...row, market_id: null, diagnostics: marketId === null ? row.diagnostics : { ...row.diagnostics, reason: `Market-scoped observation (${protocolSlug}/${marketId}); reconciliation quality ${row.quality_state}. Protocol-wide collection note: ${row.diagnostics?.reason || 'Unavailable'}` } }));
  return { ...buildParticipationResponse(protocols, scopedRows, { period }), marketId, protocolSlug };
}
