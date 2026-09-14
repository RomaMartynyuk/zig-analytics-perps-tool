import { getSql } from './db.js';
import { PERIOD_DAYS, buildGrowthMatrix, buildVolumeOiAnalysis, median, snapshotDateKey, toValidNumber } from './analyticsMath.js';
import { SIGNAL_CONFIG, SIGNAL_ENGINE_VERSION, runSignalEngine } from './signalEngine.js';
import { getPersistedResearchCase, validResearchCaseId } from './researchCasePersistence.js';

const MODES = { evaluationMode: 'RETROSPECTIVE', engineVersion: SIGNAL_ENGINE_VERSION };
const utcShift = (day, delta) => { const date = new Date(`${day}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + delta); return date.toISOString().slice(0, 10); };
const seriesKey = (slug, family) => `${slug}:${family}`;

function targetRow(rows, slug, date) { return rows.find((row) => row.slug === slug && snapshotDateKey(row.snapshot_date) === date); }
function evaluability(family, row, current, growth, casePeriod) {
  if (!row) return ['NOT_EVALUABLE', 'NO_SNAPSHOT'];
  const volume = toValidNumber(row.volume_24h); const oi = toValidNumber(row.open_interest); const tvl = toValidNumber(row.tvl);
  if (['turnover_structure', 'oi_heavy_structure'].includes(family)) {
    if (!(volume > 0) || !(oi > 0)) return ['NOT_EVALUABLE', 'MISSING_METRIC'];
    if ((current.protocols || []).length < SIGNAL_CONFIG.minPeerSample) return ['NOT_EVALUABLE', 'INSUFFICIENT_PEERS'];
  }
  if (family === 'leadership' && volume == null && oi == null && tvl == null) return ['NOT_EVALUABLE', 'MISSING_METRIC'];
  if (family.includes('market_share') || family.includes('growth')) {
    const matrix = growth[casePeriod]; const protocol = matrix?.protocols?.find((item) => item.slug === row.slug);
    if (!matrix?.sufficientHistory) return ['NOT_EVALUABLE', 'INSUFFICIENT_HISTORY'];
    if (!protocol?.volume) return ['NOT_EVALUABLE', 'MISSING_METRIC'];
  }
  return ['ABSENT', null];
}

export function evaluateSignalObservation({ rows, protocol, family, casePeriod = 'current', snapshotDate, totalProtocols }) {
  const date = snapshotDateKey(snapshotDate); const bounded = rows.filter((row) => snapshotDateKey(row.snapshot_date) <= date);
  const crossSection = bounded.filter((row) => snapshotDateKey(row.snapshot_date) === date);
  const current = buildVolumeOiAnalysis(crossSection, { snapshotDate: date, capturedAt: null, totalProtocols });
  const tvlLeader = crossSection.map((row) => ({ row, value: toValidNumber(row.tvl) })).filter((item) => item.value != null).sort((a, b) => b.value - a.value)[0];
  if (tvlLeader) current.tvlLeader = { id: tvlLeader.row.id, slug: tvlLeader.row.slug, name: tvlLeader.row.name, value: tvlLeader.value };
  const growth = Object.fromEntries(Object.keys(PERIOD_DAYS).map((period) => [period, buildGrowthMatrix(bounded, { period, totalProtocols })]));
  const result = runSignalEngine({ current, growth, snapshotDate: date }, { period: 'all', category: 'all', limit: 20 });
  const match = result.signals.find((item) => item.protocolSlug === protocol.slug && (item.family || item.type) === family);
  let [state, reason] = evaluability(family, targetRow(crossSection, protocol.slug, date), current, growth, casePeriod);
  if (match) { state = 'PRESENT'; reason = null; }
  const peer = match?.metadata || {}; const evidence = match?.evidence || [];
  return { observationId: `signalObservation:${date}:${protocol.slug}:${family}:${SIGNAL_ENGINE_VERSION}`, snapshotDate: date, protocolId: protocol.id, protocolSlug: protocol.slug, seriesKey: seriesKey(protocol.slug, family), signalFamily: family, signalType: match?.type || null, state, notEvaluableReason: reason, score: match?.score ?? null, severity: match?.severity ?? null, evidence, comparison: match?.comparison || null, peerContext: { eligible: peer.sampleSize ?? current.protocols?.length ?? 0, percentile: peer.peerPercentile ?? null }, coverage: current.coverage, ...MODES };
}

export function summarizeSignalObservations(observations) {
  const present = observations.filter((item) => item.state === 'PRESENT'); const absent = observations.filter((item) => item.state === 'ABSENT'); const notEval = observations.filter((item) => item.state === 'NOT_EVALUABLE');
  const scores = present.map((item) => item.score).filter(Number.isFinite); const strongest = present.slice().sort((a, b) => b.score - a.score || a.snapshotDate.localeCompare(b.snapshotDate))[0] || null;
  return { presentObservations: present.length, absentObservations: absent.length, notEvaluableObservations: notEval.length, evaluableObservations: present.length + absent.length, presenceRate: present.length + absent.length ? present.length / (present.length + absent.length) * 100 : null, firstObserved: present[0]?.snapshotDate || null, latestObserved: present.at(-1)?.snapshotDate || null, strongestObservation: strongest, maxScore: scores.length ? Math.max(...scores) : null, medianScore: scores.length ? median(scores) : null };
}

function rowToObservation(row) { return { ...row.evidence_payload, cacheId: String(row.id), createdAt: row.created_at }; }
async function persistObservations(observations, sql) {
  if (!observations.length) return;
  await sql.query(`INSERT INTO signal_observations (snapshot_date, protocol_id, protocol_slug, series_key, signal_family, signal_type, state, not_evaluable_reason, score, severity, evidence_json, comparison_json, peer_context_json, coverage_json, engine_version, evaluation_mode)
    SELECT x.snapshot_date, x.protocol_id, x.protocol_slug, x.series_key, x.signal_family, x.signal_type, x.state, x.reason, x.score, x.severity, x.evidence, x.comparison, x.peer_context, x.coverage, x.engine_version, x.evaluation_mode
    FROM jsonb_to_recordset($1::jsonb) AS x(snapshot_date date, protocol_id bigint, protocol_slug text, series_key text, signal_family text, signal_type text, state text, reason text, score numeric, severity text, evidence jsonb, comparison jsonb, peer_context jsonb, coverage jsonb, engine_version text, evaluation_mode text)
    ON CONFLICT (snapshot_date, protocol_id, series_key, engine_version, evaluation_mode) DO NOTHING`, [JSON.stringify(observations.map((o) => ({ snapshot_date:o.snapshotDate, protocol_id:o.protocolId, protocol_slug:o.protocolSlug, series_key:o.seriesKey, signal_family:o.signalFamily, signal_type:o.signalType, state:o.state, reason:o.notEvaluableReason, score:o.score, severity:o.severity, evidence:o, comparison:o.comparison, peer_context:o.peerContext, coverage:o.coverage, engine_version:o.engineVersion, evaluation_mode:o.evaluationMode })))]);
}

export async function getSignalHistory({ caseId, period = '7d', anchorDate: anchorOverride = null, startDate: startOverride = null }, sql = getSql()) {
  if (!validResearchCaseId(caseId) || !PERIOD_DAYS[period]) throw new Error('Invalid Signal History request');
  const detail = await getPersistedResearchCase(caseId, sql); if (!detail) throw new Error('Signal History requires a persisted Research Case');
  const anchorDate = snapshotDateKey(anchorOverride || detail.snapshot.date); const days = PERIOD_DAYS[period]; const startDate = snapshotDateKey(startOverride) || utcShift(anchorDate, -(days - 1)); if (startDate > anchorDate) throw new Error('Invalid Signal History range'); const loadStart = utcShift(startDate, -90); const family = detail.case.family; const key = seriesKey(detail.protocol.slug, family);
  const started = Date.now();
  const [rows, cached] = await Promise.all([
    sql.query(`SELECT p.id, p.slug, p.name, s.snapshot_date::text AS snapshot_date, s.volume_24h, s.open_interest, s.tvl, s.data_source FROM protocol_daily_snapshots s JOIN protocols p ON p.id=s.protocol_id WHERE s.snapshot_date BETWEEN $1::date AND $2::date AND (p.is_active=TRUE OR p.id=$3) ORDER BY s.snapshot_date,p.slug`, [loadStart, anchorDate, detail.protocol.id]),
    sql.query(`SELECT id, evidence_json AS evidence_payload, created_at FROM signal_observations WHERE protocol_id=$1 AND series_key=$2 AND engine_version=$3 AND evaluation_mode='RETROSPECTIVE' AND snapshot_date BETWEEN $4::date AND $5::date ORDER BY snapshot_date`, [detail.protocol.id, key, SIGNAL_ENGINE_VERSION, startDate, anchorDate]),
  ]);
  const cachedByDate = new Map(cached.map((row) => [snapshotDateKey(row.evidence_payload.snapshotDate), rowToObservation(row)]));
  const dates = [...new Set(rows.map((row) => snapshotDateKey(row.snapshot_date)).filter((date) => date >= startDate && date <= anchorDate))].sort();
  const evaluated = dates.filter((date) => !cachedByDate.has(date)).map((date) => evaluateSignalObservation({ rows, protocol: detail.protocol, family, casePeriod: detail.case.period, snapshotDate: date, totalProtocols: new Set(rows.filter((r) => snapshotDateKey(r.snapshot_date) === date).map((r) => r.slug)).size }));
  await persistObservations(evaluated, sql); evaluated.forEach((item) => cachedByDate.set(item.snapshotDate, item));
  const observations = dates.map((date) => cachedByDate.get(date)).filter(Boolean); const summary = summarizeSignalObservations(observations);
  const requestedCalendarDays = Math.round((Date.parse(`${anchorDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000) + 1;
  return { protocol: detail.protocol, series: { key, signalFamily: family, primarySignalType: detail.case.primarySignal?.type || null }, period, anchorDate, startDate, evaluationMode:'RETROSPECTIVE', engineVersion:SIGNAL_ENGINE_VERSION, availability:{ requestedCalendarDays, canonicalSnapshots:dates.length, evaluableSnapshots:summary.evaluableObservations, notEvaluableSnapshots:summary.notEvaluableObservations, missingCalendarDays:Math.max(requestedCalendarDays-dates.length,0) }, observations, summary, cache:{ existingObservations:cached.length, newlyEvaluated:evaluated.length, persisted:evaluated.length, durationMs:Date.now()-started, dbQueries:3 } };
}
