import { createHash } from 'node:crypto';
import { getSql } from './db.js';
import { getLatestExternalResearch } from './externalResearchService.js';
import { getResearchCaseDetail } from './researchCaseDetailService.js';
import { getPersistedResearchCase, validResearchCaseId } from './researchCasePersistence.js';

export const RESEARCH_SYNTHESIS_VERSION = 'v1';
const FORBIDDEN_CAUSAL_LANGUAGE = /\b(caused|proved|because of|responsible for|resulted in)\b/i;

const FAMILY_RULES = Object.freeze({
  turnover_structure: {
    categories: {
      TRADING_CAMPAIGN: ['INCENTIVE_ACTIVITY', 'Recent trading incentives may be relevant to the elevated trading-activity pattern.'],
      INCENTIVE_PROGRAM: ['INCENTIVE_ACTIVITY', 'Recent incentives may be relevant to the elevated trading-activity pattern.'],
      POINTS_UPDATE: ['INCENTIVE_ACTIVITY', 'A recent points update may be relevant to the elevated trading-activity pattern.'],
      FEE_CHANGE: ['FEE_ACTIVITY', 'A recent fee change may be relevant to the observed trading-activity pattern.'],
      NEW_MARKET: ['MARKET_EXPANSION', 'Recent market expansion may be relevant to the observed trading activity.'],
      LIQUIDITY_PROGRAM: ['LIQUIDITY_ACTIVITY', 'A recent liquidity program may be relevant to the observed trading activity.'],
    },
    zigChecks: ['Check whether Volume/OI was elevated before the external event.', 'Check whether Volume and Volume Share moved together after the event.', 'Check whether the pattern persisted across canonical daily snapshots.'],
    externalChecks: ['Verify the exact event start and end dates.', 'Identify whether the event applied to all markets or selected markets.'],
  },
  oi_heavy_structure: {
    categories: {
      LIQUIDITY_PROGRAM: ['LIQUIDITY_EXPANSION', 'Recent liquidity changes may be relevant to the comparatively high Open Interest structure.'],
      INCENTIVE_PROGRAM: ['LIQUIDITY_EXPANSION', 'Recent incentives may be relevant to the comparatively high Open Interest structure.'],
      NEW_COLLATERAL: ['COLLATERAL_EXPANSION', 'A collateral update may be relevant to the comparatively high Open Interest structure.'],
      MARGIN_UPDATE: ['MARGIN_STRUCTURE', 'A margin update may be relevant to the comparatively high Open Interest structure.'],
      INTEGRATION: ['INSTITUTIONAL_ACCESS', 'A recent integration may be relevant to the observed Open Interest structure.'],
    },
    zigChecks: ['Check whether Open Interest changed faster than 24h Volume.', 'Check whether the OI-heavy structure persisted across canonical snapshots.'],
    externalChecks: ['Verify collateral, leverage, or liquidity-program terms.', 'Identify whether market-maker or institutional access changed.'],
  },
  market_share: {
    categories: {
      PRODUCT_UPDATE: ['PRODUCT_EXPANSION', 'A recent product update may be relevant to the observed tracked market-share movement.'],
      NEW_MARKET: ['MARKET_EXPANSION', 'Recent market expansion may be relevant to the observed tracked market-share movement.'],
      TRADING_CAMPAIGN: ['INCENTIVE_ACTIVITY', 'A recent trading campaign may be relevant to the observed tracked market-share movement.'],
      INTEGRATION: ['PRODUCT_EXPANSION', 'A recent integration may be relevant to the observed tracked market-share movement.'],
      COMPETITOR_EVENT: ['COMPETITOR_CONTEXT', 'A competitor event may be relevant context for the observed relative share movement.'],
      OUTAGE_INCIDENT: ['MARKET_DISRUPTION', 'A market disruption may be relevant context for the observed relative share movement.'],
    },
    zigChecks: ['Separate protocol Volume growth from changes in the tracked-market denominator.', 'Check whether share movement persisted across canonical snapshots.'],
    externalChecks: ['Verify product, market, or competitor-event timing.', 'Identify whether distribution or market coverage changed.'],
  },
  growth: {
    categories: {
      NEW_MARKET: ['MARKET_EXPANSION', 'Recent market expansion may be relevant to the observed growth pattern.'],
      PRODUCT_UPDATE: ['PRODUCT_EXPANSION', 'A recent product update may be relevant to the observed growth pattern.'],
      INCENTIVE_PROGRAM: ['INCENTIVE_ACTIVITY', 'Recent incentives may be relevant to the observed growth pattern.'],
      LIQUIDITY_PROGRAM: ['LIQUIDITY_EXPANSION', 'A recent liquidity program may be relevant to the observed growth pattern.'],
      INTEGRATION: ['PRODUCT_EXPANSION', 'A recent integration may be relevant to the observed growth pattern.'],
      PARTNERSHIP: ['DISTRIBUTION_EXPANSION', 'A recent partnership may be relevant to the observed growth pattern.'],
    },
    zigChecks: ['Check whether growth is visible across Volume, Open Interest, and TVL.', 'Check whether tracked Volume Share moved in the same direction.'],
    externalChecks: ['Verify event scope and effective date.', 'Identify whether growth was concentrated in specific markets.'],
  },
  leadership: {
    categories: {},
    zigChecks: ['Compare leadership across Volume, Open Interest, TVL, and market breadth.', 'Check whether leadership persisted across available canonical history.'],
    externalChecks: ['Investigate distribution, liquidity depth, market breadth, and integrations.'],
  },
  generic: { categories: {}, zigChecks: ['Compare the observation with its persisted peer context.', 'Check whether the pattern persisted across available canonical history.'], externalChecks: ['Review relevant protocol announcements and market-structure changes.'] },
});

function familyGroup(value) {
  const family = String(value || '').toLowerCase();
  if (family.includes('turnover')) return 'turnover_structure';
  if (family.includes('oi_heavy')) return 'oi_heavy_structure';
  if (family.includes('market_share') || family.includes('share_gain') || family.includes('share_loss')) return 'market_share';
  if (family.includes('growth')) return 'growth';
  if (family.includes('leadership')) return 'leadership';
  return 'generic';
}

function sourceTypeForExternal(type) {
  if (type === 'OFFICIAL_PROTOCOL') return 'EXTERNAL_OFFICIAL';
  if (['OFFICIAL_PARTNER', 'GOVERNANCE'].includes(type)) return 'EXTERNAL_PARTNER';
  return 'EXTERNAL_MEDIA';
}

function temporalRelation(eventDate, caseDate) {
  if (!eventDate) return { relation: 'UNKNOWN', distanceDays: null };
  const distanceDays = Math.round((Date.parse(`${String(eventDate).slice(0, 10)}T00:00:00Z`) - Date.parse(`${caseDate}T00:00:00Z`)) / 86_400_000);
  return { relation: distanceDays < 0 ? 'BEFORE_CASE' : distanceDays > 0 ? 'AFTER_CASE' : 'SAME_DAY', distanceDays };
}

function zigFacts(detail) {
  const signalRef = detail.case.primarySignal?.id || detail.case.id;
  const facts = (detail.case.evidence || []).filter((item) => item?.label && item?.formatted).map((item) => ({ id: `zig:${item.key || item.label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`, text: `${item.label} was ${item.formatted}.`, sourceType: 'ZIG_DATA', sourceReference: signalRef, metricKey: item.key || null, value: item.value ?? null }));
  const group = familyGroup(detail.case.family);
  const peerMetric = group === 'market_share' ? ['volumeShare', 'Volume Share'] : ['turnover_structure', 'oi_heavy_structure'].includes(group) ? ['volumeOiRatio', 'Volume/OI'] : null;
  const context = peerMetric ? detail.peerContext?.[peerMetric[0]] : null;
  if (context?.rank && context?.eligible) facts.push({ id: `zig:${peerMetric[0]}_rank`, text: `${peerMetric[1]} ranked #${context.rank} of ${context.eligible} eligible tracked protocols.`, sourceType: 'ZIG_DATA', sourceReference: `peerContext.${peerMetric[0]}`, metricKey: `${peerMetric[0]}.rank`, value: context.rank });
  return facts;
}

function externalFacts(run, caseDate) {
  if (!run || !['COMPLETED', 'PARTIAL'].includes(run.status)) return [];
  return (run.findings || []).filter((item) => ['HIGH', 'MEDIUM'].includes(item.confidence)).map((item) => {
    const timing = temporalRelation(item.eventDate || item.publishedAt, caseDate);
    return { id: `external:${item.id || createHash('sha1').update(item.url).digest('hex').slice(0, 12)}`, text: item.factualSummary || item.summary || item.title, title: item.title, category: item.category, sourceType: sourceTypeForExternal(item.sourceType), sourceReference: item.id || item.url, sourceUrl: item.url, confidence: item.confidence, eventDate: item.eventDate || item.publishedAt || null, ...timing };
  });
}

function preEventContradiction(detail, fact) {
  if (familyGroup(detail.case.family) !== 'turnover_structure' || fact.relation !== 'BEFORE_CASE' || fact.distanceDays == null) return null;
  const eventDate = String(fact.eventDate || '').slice(0, 10) || null;
  const points = detail.history?.series?.volumeOiRatio || [];
  const current = detail.metrics?.volumeOiRatio?.value;
  const before = eventDate ? points.filter((point) => point.date < eventDate && Number.isFinite(point.value)) : [];
  if (!Number.isFinite(current) || before.length < 2 || Math.max(...before.map((point) => point.value)) < current * .9) return null;
  return { id: `zig:pre_event_turnover:${fact.id}`, text: 'Volume/OI was already near the Case level before the external event.', sourceType: 'ZIG_DATA', sourceReference: 'history.series.volumeOiRatio' };
}

function conclusionFor(facts, extFacts, hypotheses, externalState) {
  const signal = facts[0]?.text || 'Zig confirms the persisted market observation.';
  if (!extFacts.length) return { confidence: 'EVIDENCE_LIMITED', summary: `${signal} External context is not available, so the current evidence does not support an explanatory hypothesis.` };
  const contradicted = hypotheses.some((item) => item.contradictingEvidenceIds.length);
  return { confidence: contradicted ? 'EVIDENCE_MIXED' : hypotheses.length ? 'EVIDENCE_MIXED' : 'EVIDENCE_LIMITED', summary: `${signal} Retained external evidence provides relevant context${hypotheses.length ? ', but it does not establish an explanation for the observed pattern' : ''}.${externalState === 'PARTIAL' ? ' External source coverage was partial.' : ''}` };
}

export function buildResearchSynthesis(detail, externalRun = null, generatedAt = new Date().toISOString()) {
  if (detail?.caseSource !== 'PERSISTED') throw new Error('Research Synthesis requires a persisted Research Case');
  const confirmedFacts = zigFacts(detail);
  const extFacts = externalFacts(externalRun, detail.snapshot.date);
  const rule = FAMILY_RULES[familyGroup(detail.case.family)] || FAMILY_RULES.generic;
  const hypotheses = [];
  for (const fact of extFacts) {
    const mapping = rule.categories[fact.category];
    if (!mapping) continue;
    const [id, text] = mapping;
    const contradiction = preEventContradiction(detail, fact);
    if (contradiction && !confirmedFacts.some((item) => item.id === contradiction.id)) confirmedFacts.push(contradiction);
    const existing = hypotheses.find((item) => item.id === id);
    if (existing) {
      existing.supportingEvidenceIds.push(fact.id);
      if (contradiction) existing.contradictingEvidenceIds.push(contradiction.id);
      existing.confidence = existing.contradictingEvidenceIds.length ? 'LOW' : existing.supportingEvidenceIds.length >= 3 && extFacts.some((item) => item.id === fact.id && item.sourceType === 'EXTERNAL_OFFICIAL') ? 'HIGH' : 'MEDIUM';
      existing.status = existing.contradictingEvidenceIds.length ? 'WEAK' : 'PLAUSIBLE';
      continue;
    }
    const supports = [confirmedFacts[0]?.id, fact.id].filter(Boolean);
    hypotheses.push({ id, text, supportingEvidenceIds: supports, contradictingEvidenceIds: contradiction ? [contradiction.id] : [], confidence: contradiction ? 'LOW' : fact.sourceType === 'EXTERNAL_OFFICIAL' && extFacts.length > 1 ? 'HIGH' : fact.sourceType === 'EXTERNAL_OFFICIAL' ? 'MEDIUM' : 'LOW', status: contradiction ? 'WEAK' : 'PLAUSIBLE', whatWouldStrengthen: ['A matching metric change beginning after the event and persisting across daily snapshots.'], whatWouldWeaken: ['Evidence that the observed pattern was already present before the event.'] });
  }
  const gaps = [];
  if (!externalRun) gaps.push({ code: 'NO_EXTERNAL_EVENT', detail: 'External context has not been researched for this Case.' });
  else if (externalRun.status === 'FAILED') gaps.push({ code: 'EXTERNAL_CONTEXT_UNAVAILABLE', detail: 'The attached External Research run failed.' });
  else if (!extFacts.length) gaps.push({ code: 'NO_EXTERNAL_EVENT', detail: 'No retained HIGH/MEDIUM external finding is available.' });
  if (detail.metrics?.openInterest?.value == null) gaps.push({ code: 'MISSING_OI', detail: 'Open Interest was unavailable at the Case snapshot.' });
  if (detail.metrics?.tvl?.value == null) gaps.push({ code: 'MISSING_TVL', detail: 'TVL was unavailable at the Case snapshot.' });
  const period = ['7d', '30d', '90d'].includes(detail.case.period) ? detail.case.period : '7d';
  if (!detail.history?.availability?.[period]?.available) gaps.push({ code: 'INSUFFICIENT_HISTORY', detail: `${period.toUpperCase()} canonical history was incomplete at the Case snapshot.` });
  gaps.push({ code: 'NO_MARKET_LEVEL_DATA', detail: 'The Case does not contain market-level contribution data.' });
  const unknowns = gaps.map((gap) => ({ id: `unknown:${gap.code.toLowerCase()}`, text: ({ NO_EXTERNAL_EVENT: 'We do not know whether a relevant external event occurred near the Case snapshot.', EXTERNAL_CONTEXT_UNAVAILABLE: 'External context could not be verified for this synthesis.', MISSING_OI: 'We do not know the Case-date Open Interest value.', MISSING_TVL: 'We do not know the Case-date TVL value.', INSUFFICIENT_HISTORY: 'We do not have enough anchored history to characterize the full requested period.', NO_MARKET_LEVEL_DATA: 'We do not know which individual markets contributed most to the observation.' })[gap.code] }));
  let applicableZigChecks = rule.zigChecks.filter((text) => detail.metrics?.tvl?.value != null || !/tvl/i.test(text));
  if (!extFacts.length && familyGroup(detail.case.family) === 'turnover_structure') applicableZigChecks = ['Review anchored Volume/OI history for persistence and possible inflection dates.', 'Check whether Volume and Volume Share moved together across the Case window.'];
  const nextChecks = [...applicableZigChecks.map((text, index) => ({ id: `zig-check:${index + 1}`, scope: 'ZIG_CAN_CHECK', text })), ...rule.externalChecks.map((text, index) => ({ id: `external-check:${index + 1}`, scope: 'EXTERNAL_RESEARCH_NEEDED', text }))];
  const conclusion = conclusionFor(confirmedFacts, extFacts, hypotheses, externalRun?.status);
  const synthesis = { caseId: detail.case.id, synthesisVersion: RESEARCH_SYNTHESIS_VERSION, generatedAt, caseSnapshotDate: detail.snapshot.date, externalResearchRunId: externalRun?.id || null, confirmedFacts, externalFacts: extFacts, hypotheses, unknowns, evidenceGaps: gaps, nextChecks, conclusion };
  const prose = JSON.stringify({ hypotheses, conclusion });
  if (FORBIDDEN_CAUSAL_LANGUAGE.test(prose)) throw new Error('Research Synthesis contains prohibited causal language');
  if ([...confirmedFacts, ...extFacts].some((fact) => !fact.sourceType || !fact.sourceReference)) throw new Error('Research Synthesis contains an orphan fact');
  return synthesis;
}

export function synthesisInputFingerprint(caseId, casePayloadVersion, externalRunId, synthesisVersion = RESEARCH_SYNTHESIS_VERSION) {
  return createHash('sha256').update(JSON.stringify({ caseId, casePayloadVersion, externalRunId: externalRunId || null, synthesisVersion })).digest('hex');
}

function rowToSynthesis(row) { return { ...row.synthesis_payload, id: String(row.id), inputFingerprint: row.input_fingerprint, createdAt: row.created_at, externalResearchRunId: row.external_research_run_id == null ? null : String(row.external_research_run_id) }; }

export async function getResearchSynthesisState(caseId, sql = getSql()) {
  if (!validResearchCaseId(caseId)) throw new Error('Invalid research case id');
  try {
    const [rows, external] = await Promise.all([
      sql.query('SELECT * FROM research_case_syntheses WHERE case_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1', [caseId]),
      getLatestExternalResearch(caseId, sql, { cacheableOnly: true }),
    ]);
    const latest = rows[0] ? rowToSynthesis(rows[0]) : null;
    const latestExternalRunId = external?.id || null;
    return { latest, stale: Boolean(latest && String(latest.externalResearchRunId || '') !== String(latestExternalRunId || '')), latestExternalRunId };
  } catch (error) { if (/does not exist|undefined table|relation/i.test(error.message || '')) return { latest: null, stale: false, latestExternalRunId: null }; throw error; }
}

export async function buildAndPersistResearchSynthesis({ caseId }, sql = getSql()) {
  if (!validResearchCaseId(caseId)) throw new Error('Invalid research case id');
  let detail = await getPersistedResearchCase(caseId, sql);
  if (!detail) { await getResearchCaseDetail(caseId, sql); detail = await getPersistedResearchCase(caseId, sql); }
  if (!detail) throw new Error('Research Synthesis requires a persisted Research Case');
  const external = await getLatestExternalResearch(caseId, sql, { cacheableOnly: true });
  const fingerprint = synthesisInputFingerprint(caseId, detail.casePayloadVersion, external?.id);
  const synthesis = buildResearchSynthesis(detail, external);
  await sql.query(`INSERT INTO research_case_syntheses (case_id, synthesis_version, external_research_run_id, input_fingerprint, synthesis_payload)
    VALUES ($1, $2, $3, $4, $5::jsonb) ON CONFLICT (case_id, synthesis_version, input_fingerprint) DO NOTHING`, [caseId, RESEARCH_SYNTHESIS_VERSION, external?.id || null, fingerprint, JSON.stringify(synthesis)]);
  const rows = await sql.query('SELECT * FROM research_case_syntheses WHERE case_id = $1 AND synthesis_version = $2 AND input_fingerprint = $3 LIMIT 1', [caseId, RESEARCH_SYNTHESIS_VERSION, fingerprint]);
  return { synthesis: rowToSynthesis(rows[0]), stale: false };
}
