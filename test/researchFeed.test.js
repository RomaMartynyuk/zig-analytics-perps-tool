import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDailyResearchFeed, researchCaseId } from '../server/researchFeedService.js';

function signal(overrides = {}) {
  return {
    id: 'signal', type: 'high_turnover', family: 'turnover_structure', category: 'activity',
    protocolId: 1, protocolSlug: 'alpha', protocolName: 'Alpha', snapshotDate: '2026-09-03',
    generatedAt: '2026-09-03T12:00:00.000Z', period: 'current', score: 82, severity: 'high',
    title: 'High Volume / OI', summary: 'Observed.', evidence: [{ label: 'Volume / OI', value: 4.8, formatted: '4.8x' }], comparison: { type: 'market_median', value: 1.9, formatted: '1.9x' },
    ...overrides,
  };
}
function result(signals) { return { snapshotDate: '2026-09-03', coverage: { total: 20 }, history: {}, signals }; }

test('Daily Research Feed groups the same protocol and family while keeping unrelated families separate', () => {
  const grouped = signal({ id: 'one', score: 88 });
  const related = signal({ id: 'two', score: 76, type: 'cross_metric_rank_mismatch', title: 'Rank mismatch' });
  const independent = signal({ id: 'three', family: 'growth', type: 'market_share_gain', title: 'Volume Share Gain', score: 83 });
  const otherProtocol = signal({ id: 'four', protocolId: 2, protocolSlug: 'beta', protocolName: 'Beta', score: 85 });
  const feed = buildDailyResearchFeed(result([grouped, related, independent, otherProtocol]), { limit: 5 });
  assert.equal(feed.cases.length, 3);
  const alphaTurnover = feed.cases.find((item) => item.protocol.slug === 'alpha' && item.family === 'turnover_structure');
  assert.equal(alphaTurnover.primarySignal.id, 'one');
  assert.equal(alphaTurnover.relatedSignals[0].id, 'two');
  assert.equal(feed.cases.filter((item) => item.protocol.slug === 'alpha').length, 2);
});

test('Daily Research Feed uses a semantic duplicate as supporting evidence without admitting weak candidates', () => {
  const primary = signal({ id: 'gap', type: 'share_gap_divergence', family: 'oi_heavy_structure', score: 81 });
  const support = signal({ id: 'turnover', type: 'low_turnover', family: 'oi_heavy_structure', score: 81, suppressedBy: 'semantic_duplicate' });
  const weak = signal({ id: 'weak', protocolSlug: 'weak', protocolName: 'Weak', score: 60, suppressedBy: 'below_quality_threshold' });
  const feed = buildDailyResearchFeed({ ...result([primary]), diagnostics: { suppressed: [support, weak] } });
  assert.equal(feed.cases.length, 1);
  assert.equal(feed.cases[0].primarySignal.id, 'gap');
  assert.equal(feed.cases[0].relatedSignals[0].id, 'turnover');
  assert.equal(feed.diagnostics.supportingSignals, 1);
});

test('Research Case IDs are deterministic by snapshot, protocol, and family', () => {
  const value = { snapshotDate: '2026-09-03', protocolSlug: 'alpha', family: 'turnover_structure' };
  assert.equal(researchCaseId(value), researchCaseId(value));
  assert.notEqual(researchCaseId(value), researchCaseId({ ...value, snapshotDate: '2026-09-04' }));
  assert.notEqual(researchCaseId(value), researchCaseId({ ...value, protocolSlug: 'beta' }));
});

test('Daily Research Feed ranks calibrated strength first and caps corroboration bonuses', () => {
  const extreme = signal({ id: 'extreme', protocolSlug: 'strong', protocolName: 'Strong', score: 96, severity: 'extreme' });
  const mediocre = [0, 1, 2].map((index) => signal({ id: `m${index}`, protocolSlug: 'medium', protocolName: 'Medium', score: 75, family: 'turnover_structure', type: `future_${index}` }));
  const feed = buildDailyResearchFeed(result([extreme, ...mediocre]), { limit: 5 });
  assert.equal(feed.cases[0].protocol.slug, 'strong');
  assert.equal(feed.cases.find((item) => item.protocol.slug === 'medium').score, 81);
});

test('Daily Research Feed applies soft protocol diversity and safely accepts a new unknown detector', () => {
  const alpha = ['turnover_structure', 'growth', 'leadership'].map((family, index) => signal({ id: `a${index}`, family, type: `type_${index}`, score: 95 - index }));
  const beta = signal({ id: 'b', protocolId: 2, protocolSlug: 'beta', protocolName: 'Beta', type: 'future_new_detector', family: null, score: 92 });
  const gamma = signal({ id: 'c', protocolId: 3, protocolSlug: 'gamma', protocolName: 'Gamma', score: 91 });
  const feed = buildDailyResearchFeed(result([...alpha, beta, gamma]), { limit: 4 });
  assert.ok(feed.cases.some((item) => item.protocol.slug === 'beta'));
  assert.ok(feed.cases.some((item) => item.protocol.slug === 'gamma'));
  assert.ok(feed.cases.filter((item) => item.protocol.slug === 'alpha').length <= 2);
  assert.equal(feed.cases.find((item) => item.protocol.slug === 'beta').headline, 'High Volume / OI');
});

test('Daily Research Feed preserves persisted status and hides ignored cases in the default view', () => {
  const primary = signal(); const id = researchCaseId({ snapshotDate: primary.snapshotDate, protocolSlug: primary.protocolSlug, family: primary.family });
  const statuses = new Map([[id, { status: 'WATCHING' }]]);
  assert.equal(buildDailyResearchFeed(result([primary]), { statuses }).cases[0].status, 'WATCHING');
  statuses.set(id, { status: 'IGNORED' });
  assert.equal(buildDailyResearchFeed(result([primary]), { statuses }).cases.length, 0);
  assert.equal(buildDailyResearchFeed(result([primary]), { statuses, status: 'all' }).cases[0].status, 'IGNORED');
});

test('Daily Research Feed produces no fabricated cases and skips malformed signals', () => {
  const empty = buildDailyResearchFeed(result([]));
  assert.deepEqual(empty.cases, []);
  const malformed = buildDailyResearchFeed(result([{ type: 'future_new_detector' }]));
  assert.deepEqual(malformed.cases, []);
  assert.equal(malformed.diagnostics.skippedSignals[0].reason, 'malformed_signal');
});
