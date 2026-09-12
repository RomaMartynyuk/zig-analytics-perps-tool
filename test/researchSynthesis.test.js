import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResearchSynthesis, getResearchSynthesisState, synthesisInputFingerprint } from '../server/researchSynthesisService.js';

function persistedCase(overrides = {}) {
  return {
    caseSource: 'PERSISTED', casePayloadVersion: 1,
    case: { id: 'research:2026-09-10:alpha:turnover_structure', family: 'turnover_structure', period: 'current', primarySignal: { id: 'signal:alpha:turnover' }, evidence: [{ key: 'volume_oi', label: 'Volume / OI', value: 18.19, formatted: '18.19x' }, { key: 'market_median', label: 'Peer median', value: 3.11, formatted: '3.11x' }] },
    protocol: { id: 1, slug: 'alpha', name: 'Alpha' }, snapshot: { date: '2026-09-10' },
    metrics: { volumeOiRatio: { value: 18.19 }, openInterest: { value: 10 }, tvl: { value: 20 } },
    peerContext: { volumeOiRatio: { value: 18.19, median: 3.11, rank: 1, eligible: 12 } },
    coverage: { total: 20, volumeAvailable: 14, oiAvailable: 12 },
    history: { availability: { '7d': { available: true } }, series: { volumeOiRatio: [{ date: '2026-09-04', value: 18 }, { date: '2026-09-05', value: 18.1 }, { date: '2026-09-10', value: 18.19 }] } },
    ...overrides,
  };
}

function externalRun(overrides = {}) { return { id: '9', status: 'COMPLETED', findings: [{ id: 'f1', category: 'TRADING_CAMPAIGN', confidence: 'HIGH', sourceType: 'OFFICIAL_PROTOCOL', title: 'Alpha trading campaign', factualSummary: 'Alpha announced a trading campaign.', url: 'https://alpha.example/campaign', publishedAt: '2026-09-08T12:00:00Z' }], ...overrides }; }

test('synthesis extracts provenance-linked Zig and external facts', () => {
  const result = buildResearchSynthesis(persistedCase(), externalRun(), '2026-09-10T13:00:00Z');
  assert.ok(result.confirmedFacts.length >= 3);
  assert.ok(result.confirmedFacts.every((item) => item.sourceType === 'ZIG_DATA' && item.sourceReference));
  assert.equal(result.externalFacts[0].sourceType, 'EXTERNAL_OFFICIAL');
  assert.equal(result.externalFacts[0].relation, 'BEFORE_CASE');
  assert.equal(result.externalFacts[0].distanceDays, -2);
});

test('turnover campaign creates only a conditional evidence-linked hypothesis', () => {
  const result = buildResearchSynthesis(persistedCase(), externalRun());
  assert.equal(result.hypotheses[0].id, 'INCENTIVE_ACTIVITY');
  assert.equal(result.hypotheses[0].status, 'WEAK');
  assert.ok(result.hypotheses[0].supportingEvidenceIds.includes('external:f1'));
  assert.ok(result.hypotheses[0].contradictingEvidenceIds.length > 0);
  assert.doesNotMatch(JSON.stringify({ hypotheses: result.hypotheses, conclusion: result.conclusion }), /\bcaused|\bproved|because of|responsible for|resulted in/i);
});

test('no external run and failed external research still produce valid Zig-only synthesis', () => {
  const absent = buildResearchSynthesis(persistedCase(), null);
  const failed = buildResearchSynthesis(persistedCase(), { id: '10', status: 'FAILED', findings: [] });
  assert.deepEqual(absent.hypotheses, []);
  assert.equal(absent.externalFacts.length, 0);
  assert.ok(absent.evidenceGaps.some((item) => item.code === 'NO_EXTERNAL_EVENT'));
  assert.ok(failed.evidenceGaps.some((item) => item.code === 'EXTERNAL_CONTEXT_UNAVAILABLE'));
});

test('irrelevant external category and unknown signal family do not force hypotheses', () => {
  const unrelated = externalRun({ findings: [{ ...externalRun().findings[0], category: 'PARTNERSHIP' }] });
  assert.deepEqual(buildResearchSynthesis(persistedCase(), unrelated).hypotheses, []);
  const future = persistedCase({ case: { ...persistedCase().case, family: 'future_new_family' } });
  const result = buildResearchSynthesis(future, externalRun());
  assert.deepEqual(result.hypotheses, []);
  assert.ok(result.confirmedFacts.length > 0);
  assert.ok(result.nextChecks.length > 0);
});

test('missing metrics and insufficient history become explicit gaps without fake facts', () => {
  const detail = persistedCase({ metrics: { volumeOiRatio: { value: 2 }, openInterest: { value: null }, tvl: { value: null } }, history: { availability: { '7d': { available: false, availableDays: 5, requiredDays: 7 } }, series: { volumeOiRatio: [] } } });
  const result = buildResearchSynthesis(detail, null);
  assert.ok(result.evidenceGaps.some((item) => item.code === 'MISSING_OI'));
  assert.ok(result.evidenceGaps.some((item) => item.code === 'MISSING_TVL'));
  assert.ok(result.evidenceGaps.some((item) => item.code === 'INSUFFICIENT_HISTORY'));
  assert.ok(result.nextChecks.every((item) => !/tvl/i.test(item.text)));
});

test('synthesis requires persisted Case input and fingerprints external revisions', () => {
  assert.throws(() => buildResearchSynthesis({ ...persistedCase(), caseSource: 'CURRENT_RECONSTRUCTION' }), /persisted/);
  const a = synthesisInputFingerprint(persistedCase().case.id, 1, 'run-a');
  const same = synthesisInputFingerprint(persistedCase().case.id, 1, 'run-a');
  const b = synthesisInputFingerprint(persistedCase().case.id, 1, 'run-b');
  assert.equal(a, same);
  assert.notEqual(a, b);
});

test('workflow status does not alter factual synthesis output', () => {
  const watching = buildResearchSynthesis(persistedCase({ status: 'WATCHING' }), null, '2026-09-10T13:00:00Z');
  const researching = buildResearchSynthesis(persistedCase({ status: 'RESEARCHING' }), null, '2026-09-10T13:00:00Z');
  assert.deepEqual(watching, researching);
});

test('persisted synthesis becomes stale only when retained external evidence changes', async () => {
  const synthesisRow = {
    id: 4,
    synthesis_payload: { caseId: persistedCase().case.id, synthesisVersion: 'v1' },
    input_fingerprint: 'fingerprint',
    created_at: '2026-09-10T13:00:00.000Z',
    external_research_run_id: 8,
  };
  const externalRow = {
    id: 9, case_id: persistedCase().case.id, protocol_slug: 'alpha', provider: 'tavily', status: 'COMPLETED',
    research_version: 'v3', window_start: '2026-09-03', window_end: '2026-09-10', window_key: '2026-09-03:2026-09-10',
    queries_json: [], summary_json: {}, created_at: '2026-09-10T12:00:00.000Z', completed_at: '2026-09-10T12:00:01.000Z',
  };
  const sql = { query: async (text) => {
    if (text.includes('research_case_syntheses')) return [synthesisRow];
    if (text.includes('external_research_runs')) return [externalRow];
    if (text.includes('external_research_findings')) return [];
    throw new Error(`Unexpected query: ${text}`);
  } };
  const state = await getResearchSynthesisState(persistedCase().case.id, sql);
  assert.equal(state.stale, true);
  assert.equal(state.latestExternalRunId, '9');
  assert.equal(state.latest.externalResearchRunId, '8');
});
