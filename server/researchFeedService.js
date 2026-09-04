import { getSql } from './db.js';
import { getSignals } from './analyticsService.js';
import { getVolumeOiAnalysis } from './analyticsService.js';
import { toValidNumber } from './analyticsMath.js';

export const RESEARCH_STATUSES = new Set(['IGNORED', 'WATCHING', 'RESEARCHING']);
const SEVERITY_WEIGHT = { extreme: 3, high: 2, medium: 1, low: 0 };
const DEFAULT_LIMIT = 5;
const MAX_CASES_PER_PROTOCOL = 2;
const FEED_STATUS_FILTERS = new Set(['active', 'all', 'unreviewed', 'watching', 'researching', 'ignored']);

function normalizeStatusFilter(status) {
  const value = String(status || 'active').toLowerCase();
  if (!FEED_STATUS_FILTERS.has(value)) throw new Error('Invalid research status filter');
  return value;
}

function safeFamily(signal) {
  return String(signal?.family || signal?.type || 'general').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
}

function validSignal(signal) {
  return Boolean(
    signal
    && typeof signal.protocolSlug === 'string'
    && signal.protocolSlug
    && typeof signal.protocolName === 'string'
    && signal.protocolName
    && Number.isFinite(signal.score)
    && typeof signal.snapshotDate === 'string'
    && signal.snapshotDate
  );
}

function orderedSignals(signals) {
  const primaryTypePriority = { share_gap_divergence: 3, high_turnover: 2, low_turnover: 2, cross_metric_rank_mismatch: 1 };
  return signals.slice().sort((left, right) => (
    right.score - left.score
    || (primaryTypePriority[right.type] || 0) - (primaryTypePriority[left.type] || 0)
    || (SEVERITY_WEIGHT[right.severity] || 0) - (SEVERITY_WEIGHT[left.severity] || 0)
    || String(left.type).localeCompare(String(right.type))
  ));
}

export function researchCaseId({ snapshotDate, protocolSlug, family }) {
  return `research:${String(snapshotDate).slice(0, 10)}:${protocolSlug}:${safeFamily({ family })}`;
}

function evidenceFor(signal) {
  const evidence = Array.isArray(signal.evidence) ? signal.evidence.filter((item) => item?.label && item?.formatted) : [];
  if (signal.comparison?.formatted) {
    evidence.push({ key: signal.comparison.type || 'comparison', label: String(signal.comparison.type || 'Peer comparison').replaceAll('_', ' '), value: signal.comparison.value, formatted: signal.comparison.formatted });
  }
  return evidence.slice(0, 4).map((item) => ({ key: item.key || String(item.label).toLowerCase().replace(/[^a-z0-9]+/g, '_'), label: item.label, value: item.value ?? null, formatted: item.formatted }));
}

function deterministicSummary(signal) {
  const primary = signal?.evidence?.[0];
  if ((signal.type === 'high_turnover' || signal.type === 'low_turnover') && primary?.formatted && signal.comparison?.formatted) {
    return `24h Volume/OI is ${primary.formatted} versus a tracked peer median of ${signal.comparison.formatted}.`;
  }
  if (signal.type === 'share_gap_divergence' && Array.isArray(signal.evidence)) {
    const gap = signal.evidence.find((item) => item.label === 'Share Gap');
    if (gap?.formatted) return `The protocol’s tracked Volume Share and OI Share differ by ${gap.formatted}.`;
  }
  return signal.summary || 'A tracked market observation meets Zig’s calibrated research threshold.';
}

function caseSeverity(score) {
  if (score >= 95) return 'extreme';
  if (score >= 84) return 'high';
  if (score >= 70) return 'medium';
  return 'low';
}

function questionsFor(family) {
  if (family === 'turnover_structure') return {
    zigCanCheck: ['Has the Volume/OI relationship persisted across captured snapshots?', 'Is tracked Volume Share increasing at the same time?'],
    externalResearch: ['Did the protocol introduce a market, incentive, or fee change?'],
  };
  if (family === 'oi_heavy_structure') return {
    zigCanCheck: ['Is Open Interest changing faster than daily trading activity?', 'Has the share gap persisted across captured snapshots?'],
    externalResearch: ['Did the protocol announce a new market or incentive campaign?'],
  };
  if (family === 'leadership') return {
    zigCanCheck: ['Which covered metrics make up the leadership position?', 'Has the relative market share changed over the available history?'],
    externalResearch: ['Are there recent product or market-coverage changes to review?'],
  };
  if (family === 'growth' || family.includes('growth')) return {
    zigCanCheck: ['Do Volume, Open Interest, and TVL move together over the available history?', 'Is the change also reflected in tracked market share?'],
    externalResearch: ['Was there an announced incentive, market launch, or fee change?'],
  };
  return {
    zigCanCheck: ['How does this protocol compare with the currently covered peer set?', 'Has the observation persisted across available snapshots?'],
    externalResearch: ['Is there a protocol announcement or market-structure change worth reviewing?'],
  };
}

function caseFromGroup(group, statuses) {
  const [primarySignal, ...relatedSignals] = orderedSignals(group.signals);
  const family = safeFamily(primarySignal);
  const id = researchCaseId({ snapshotDate: primarySignal.snapshotDate, protocolSlug: primarySignal.protocolSlug, family });
  const score = Math.min(100, Math.round(primarySignal.score + Math.min(8, relatedSignals.length * 3)));
  const persisted = statuses.get(id);
  return {
    id,
    protocol: { id: primarySignal.protocolId ?? null, slug: primarySignal.protocolSlug, name: primarySignal.protocolName },
    date: String(primarySignal.snapshotDate).slice(0, 10),
    snapshotDate: String(primarySignal.snapshotDate).slice(0, 10),
    generatedAt: primarySignal.generatedAt || null,
    family,
    primarySignal,
    relatedSignals,
    score,
    severity: caseSeverity(score),
    period: primarySignal.period || 'current',
    headline: primarySignal.title || 'Tracked market observation',
    summary: deterministicSummary(primarySignal),
    evidence: evidenceFor(primarySignal),
    questions: questionsFor(family),
    status: persisted?.status || null,
  };
}

function statusAllows(item, filter) {
  const normalized = normalizeStatusFilter(filter);
  if (normalized === 'active') return item.status !== 'IGNORED';
  if (normalized === 'all') return true;
  if (normalized === 'unreviewed') return item.status == null;
  return item.status === normalized.toUpperCase();
}

function rankCases(cases, limit) {
  const ranked = cases.slice().sort((left, right) => right.score - left.score || left.protocol.slug.localeCompare(right.protocol.slug) || left.family.localeCompare(right.family));
  const selected = []; const deferred = []; const suppressed = []; const counts = new Map();
  for (const item of ranked) {
    const count = counts.get(item.protocol.slug) || 0;
    if (count < MAX_CASES_PER_PROTOCOL) {
      selected.push(item); counts.set(item.protocol.slug, count + 1);
    } else {
      deferred.push(item);
    }
  }
  // Soft diversity: only after every other eligible protocol has had a chance
  // to appear do additional independent cases fill remaining slots.
  const chosen = selected.slice(0, limit);
  if (chosen.length < limit) chosen.push(...deferred.slice(0, limit - chosen.length));
  for (const item of [...selected.slice(limit), ...deferred.slice(Math.max(0, limit - selected.length))]) {
    suppressed.push({ id: item.id, protocol: item.protocol, headline: item.headline, score: item.score, reason: selected.includes(item) ? 'lower_score' : 'protocol_diversity' });
  }
  return { selected: chosen, suppressed };
}

export function buildDailyResearchFeed(signalResult, { statuses = new Map(), limit = DEFAULT_LIMIT, status = 'active', protocolSnapshots = new Map() } = {}) {
  // Signal Engine keeps one primary signal per semantic family in its normal
  // response. Its diagnostic semantic duplicates are already-calibrated
  // supporting observations, so Feed can attach them to the case without
  // recreating any detector or admitting below-threshold candidates.
  const supportingSignals = (signalResult?.diagnostics?.suppressed || []).filter((item) => item?.suppressedBy === 'semantic_duplicate');
  const feedSignals = [...(signalResult?.signals || []), ...supportingSignals];
  const groups = new Map(); const skippedSignals = [];
  for (const signal of feedSignals) {
    if (!validSignal(signal)) { skippedSignals.push({ type: signal?.type || 'unknown', reason: 'malformed_signal' }); continue; }
    const key = `${signal.protocolSlug}:${signal.period || 'current'}:${safeFamily(signal)}`;
    const group = groups.get(key) || { signals: [] }; group.signals.push(signal); groups.set(key, group);
  }
  const allCases = [...groups.values()].map((group) => caseFromGroup(group, statuses));
  const visible = allCases.filter((item) => statusAllows(item, status));
  const normalizedLimit = Math.max(1, Math.min(Number(limit) || DEFAULT_LIMIT, 20));
  const ranked = rankCases(visible, normalizedLimit);
  const cases = ranked.selected.map((item) => ({ ...item, marketSnapshot: protocolSnapshots.get(item.protocol.slug) || null }));
  const ignored = allCases.filter((item) => item.status === 'IGNORED').length;
  return {
    snapshotDate: signalResult?.snapshotDate || null,
    generatedAt: new Date().toISOString(),
    summary: { researchCases: cases.length, high: cases.filter((item) => ['high', 'extreme'].includes(item.severity)).length, medium: cases.filter((item) => item.severity === 'medium').length, ignored },
    coverage: signalResult?.coverage || null,
    history: signalResult?.history || {},
    cases,
    diagnostics: { engineSignals: Array.isArray(signalResult?.signals) ? signalResult.signals.length : 0, supportingSignals: supportingSignals.length, signalsReceived: feedSignals.length, casesGenerated: allCases.length, skippedSignals, suppressedCases: ranked.suppressed },
  };
}

export async function getResearchCaseStatuses(caseIds, sql = getSql()) {
  if (!caseIds.length) return new Map();
  const rows = await sql.query('SELECT research_case_id, status FROM research_case_statuses WHERE research_case_id = ANY($1::text[])', [caseIds]);
  return new Map(rows.map((row) => [row.research_case_id, { status: row.status }]));
}

export async function updateResearchCaseStatus({ caseId, protocolId, snapshotDate, status }, sql = getSql()) {
  if (typeof caseId !== 'string' || !caseId.startsWith('research:')) throw new Error('Invalid research case id');
  if (status != null && !RESEARCH_STATUSES.has(status)) throw new Error('Invalid research status');
  if (!Number.isInteger(Number(protocolId)) || !snapshotDate) throw new Error('Invalid research case reference');
  if (status == null) {
    await sql.query('DELETE FROM research_case_statuses WHERE research_case_id = $1', [caseId]);
    return null;
  }
  await sql.query(`INSERT INTO research_case_statuses (research_case_id, protocol_id, snapshot_date, status)
    VALUES ($1, $2, $3::date, $4)
    ON CONFLICT (research_case_id) DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()`, [caseId, Number(protocolId), String(snapshotDate).slice(0, 10), status]);
  return status;
}

async function getSnapshotDetails(snapshotDate, sql) {
  if (!snapshotDate) return new Map();
  const [rows, analysis] = await Promise.all([
    sql.query(`SELECT p.slug, s.volume_24h, s.open_interest, s.tvl, s.markets_count, s.data_source
      FROM protocols p LEFT JOIN protocol_daily_snapshots s ON s.protocol_id = p.id AND s.snapshot_date = $1::date
      WHERE p.is_active = TRUE ORDER BY p.slug`, [snapshotDate]),
    getVolumeOiAnalysis(sql),
  ]);
  const paired = new Map((analysis.protocols || []).map((item) => [item.slug, item]));
  return new Map(rows.map((row) => {
    const item = paired.get(row.slug);
    return [row.slug, {
      volume24h: toValidNumber(row.volume_24h), openInterest: toValidNumber(row.open_interest), tvl: toValidNumber(row.tvl), marketsCount: toValidNumber(row.markets_count), dataSource: row.data_source || null,
      volumeShare: item?.volumeShare ?? null, oiShare: item?.openInterestShare ?? null, volumeOiRatio: item?.volumeOiRatio ?? null,
    }];
  }));
}

export async function getDailyResearchFeed({ limit = DEFAULT_LIMIT, status = 'active' } = {}, sql = getSql()) {
  const normalizedStatus = normalizeStatusFilter(status);
  const signalResult = await getSignals({ period: 'all', category: 'all', limit: 20, diagnostic: true }, sql);
  const candidateFeed = buildDailyResearchFeed(signalResult, { limit: 20, status: 'all' });
  const ids = candidateFeed.cases.map((item) => item.id);
  const [statuses, protocolSnapshots] = await Promise.all([getResearchCaseStatuses(ids, sql), getSnapshotDetails(signalResult.snapshotDate, sql)]);
  return buildDailyResearchFeed(signalResult, { statuses, limit, status: normalizedStatus, protocolSnapshots });
}
