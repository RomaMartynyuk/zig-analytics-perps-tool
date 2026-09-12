import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersistedCaseRecord, getPersistedResearchCase, persistResearchCases, RESEARCH_CASE_PAYLOAD_VERSION, validResearchCaseId } from '../server/researchCasePersistence.js';

function detail(overrides = {}) {
  return {
    case: { id: 'research:2026-09-10:alpha:turnover_structure', snapshotDate: '2026-09-10', family: 'turnover_structure', headline: 'High Volume / OI', score: 91, severity: 'high', period: 'current', status: 'WATCHING', primarySignal: { id: 's1', evidence: [{ value: 18.19 }] }, evidence: [{ value: 18.19 }] },
    protocol: { id: 1, slug: 'alpha', name: 'Alpha' }, snapshot: { date: '2026-09-10', capturedAt: '2026-09-10T12:00:00Z' },
    metrics: { volumeOiRatio: { value: 18.19 } }, peerContext: { volumeOiRatio: { median: 3.11, rank: 1, eligible: 14 } }, coverage: { total: 20, volumeAvailable: 14 }, history: { periods: { '7d': { endDate: '2026-09-10' } }, series: { volume: [{ date: '2026-09-10', value: 10 }] } }, relatedSignals: [], otherSignals: [],
    ...overrides,
  };
}

test('Research Case record preserves precision and excludes mutable status', () => {
  const record = createPersistedCaseRecord(detail());
  assert.equal(record.payloadVersion, RESEARCH_CASE_PAYLOAD_VERSION);
  assert.equal(record.payload.metrics.volumeOiRatio.value, 18.19);
  assert.equal(record.payload.peerContext.volumeOiRatio.median, 3.11);
  assert.equal(Object.hasOwn(record.payload.case, 'status'), false);
});

test('Research Case payload rejects malformed identity and non-finite JSON values', () => {
  assert.throws(() => createPersistedCaseRecord(detail({ metrics: { volumeOiRatio: { value: Infinity } } })), /non-finite/);
  assert.throws(() => createPersistedCaseRecord(detail({ case: { id: 'bad' } })), /Invalid Research Case/);
});

test('batch persistence uses conflict-safe immutable insert and isolates malformed cases', async () => {
  const calls = [];
  const sql = { query: async (query, values) => { calls.push({ query, values }); return []; } };
  const result = await persistResearchCases([detail(), detail({ case: { id: 'bad' } })], sql);
  assert.equal(result.valid, 1);
  assert.equal(result.rejected.length, 1);
  assert.match(calls[0].query, /ON CONFLICT \(id\) DO NOTHING/);
  assert.equal(JSON.parse(calls[0].values[0]).length, 1);
});

test('persisted Case wins and mutable status is overlaid without changing evidence', async () => {
  const stored = createPersistedCaseRecord(detail()).payload;
  const simulatedNewCurrent = { score: 70, ratio: 7.2, median: 2.8, rank: 3, eligible: 20, snapshotDate: '2026-09-15' };
  const sql = { query: async () => [{ case_payload: stored, payload_version: 1, snapshot_date: new Date('2026-09-10T00:00:00Z'), status: 'RESEARCHING' }] };
  const reopened = await getPersistedResearchCase(stored.case.id, sql);
  assert.equal(reopened.case.score, 91);
  assert.equal(reopened.metrics.volumeOiRatio.value, 18.19);
  assert.equal(reopened.peerContext.volumeOiRatio.median, 3.11);
  assert.equal(reopened.peerContext.volumeOiRatio.eligible, 14);
  assert.equal(reopened.snapshot.date, '2026-09-10');
  assert.equal(reopened.case.status, 'RESEARCHING');
  assert.notEqual(reopened.case.score, simulatedNewCurrent.score);
  assert.notEqual(reopened.metrics.volumeOiRatio.value, simulatedNewCurrent.ratio);
  assert.notEqual(reopened.peerContext.volumeOiRatio.median, simulatedNewCurrent.median);
  assert.notEqual(reopened.peerContext.volumeOiRatio.rank, simulatedNewCurrent.rank);
  assert.notEqual(reopened.peerContext.volumeOiRatio.eligible, simulatedNewCurrent.eligible);
  assert.notEqual(reopened.snapshot.date, simulatedNewCurrent.snapshotDate);
});

test('Research Case IDs and date representations remain stable', () => {
  assert.equal(validResearchCaseId('research:2026-09-10:new-dex:growth'), true);
  const fromDate = createPersistedCaseRecord(detail({ snapshot: { date: new Date('2026-09-10T00:00:00Z') } }));
  const fromIso = createPersistedCaseRecord(detail({ snapshot: { date: '2026-09-10T23:59:59Z' } }));
  assert.equal(fromDate.snapshotDate, '2026-09-10');
  assert.equal(fromIso.snapshotDate, '2026-09-10');
});
