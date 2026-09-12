import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResearchCaseDetailPayload, buildResearchCurrentMetrics, buildResearchHistory } from '../server/researchCaseDetailService.js';

test('Protocol Research uses metric-specific peer denominators and preserves partial metrics', () => {
  const rows = [
    { slug: 'alpha', name: 'Alpha', volume_24h: 100, open_interest: null, tvl: 30, markets_count: 2, data_source: 'alpha_api' },
    { slug: 'beta', name: 'Beta', volume_24h: 300, open_interest: 150, tvl: 20, markets_count: 3, data_source: 'beta_api' },
    { slug: 'gamma', name: 'Gamma', volume_24h: null, open_interest: 50, tvl: null, markets_count: null, data_source: 'gamma_api' },
  ];
  const detail = buildResearchCurrentMetrics(rows, 'alpha', '2026-09-04', null, 3);
  assert.equal(detail.metrics.volumeShare.value, 25);
  assert.equal(detail.metrics.openInterest.value, null);
  assert.equal(detail.metrics.oiShare.value, null);
  assert.equal(detail.metrics.volumeOiRatio.value, null);
  assert.equal(detail.peerContext.volume.eligible, 2);
  assert.equal(detail.peerContext.openInterest.eligible, 2);
  assert.equal(detail.peerContext.tvl.eligible, 2);
  assert.equal(detail.peerContext.volumeShare.rank, 2);
});

test('Protocol Research history keeps missing metrics missing and supports a new protocol with insufficient history', () => {
  const rows = [
    { id: 1, slug: 'alpha', name: 'Alpha', snapshot_date: '2026-09-01', volume_24h: 100, open_interest: null, tvl: 10, data_source: 'alpha_api' },
    { id: 1, slug: 'alpha', name: 'Alpha', snapshot_date: '2026-09-02', volume_24h: 110, open_interest: null, tvl: 11, data_source: 'alpha_api' },
    { id: 2, slug: 'new-dex', name: 'New DEX', snapshot_date: '2026-09-02', volume_24h: 20, open_interest: 10, tvl: 2, data_source: 'new_api' },
  ];
  const history = buildResearchHistory(rows, 'new-dex', 2);
  assert.equal(history.availability['7d'].available, false);
  assert.equal(history.periods['7d'].protocolMetricDays.volume, 1);
  assert.equal(history.series.openInterest[0].value, 10);
  assert.equal(history.series.tvl[0].value, 2);
});

test('persistable Research Case detail anchors history and peer universe to its original snapshot', () => {
  const caseItem = {
    id: 'research:2026-09-10:alpha:turnover_structure', snapshotDate: '2026-09-10', family: 'turnover_structure', headline: 'High Volume / OI', summary: 'Original observation', score: 91, severity: 'high', period: 'current',
    protocol: { id: 1, slug: 'alpha', name: 'Alpha' }, primarySignal: { id: 's1', metadata: { peerPercentile: .9 } }, relatedSignals: [], evidence: [], questions: { zigCanCheck: [], externalResearch: [] },
  };
  const rows = [
    { id: 1, slug: 'alpha', name: 'Alpha', snapshot_date: '2026-09-10', captured_at: '2026-09-10T12:00:00Z', volume_24h: 100, open_interest: 10, tvl: 20, markets_count: 2, data_source: 'alpha_api' },
    { id: 2, slug: 'beta', name: 'Beta', snapshot_date: '2026-09-10', captured_at: '2026-09-10T12:00:00Z', volume_24h: 50, open_interest: 25, tvl: 10, markets_count: 1, data_source: 'beta_api' },
    { id: 1, slug: 'alpha', name: 'Alpha', snapshot_date: '2026-09-11', captured_at: '2026-09-11T12:00:00Z', volume_24h: 900, open_interest: 300, tvl: 40, markets_count: 3, data_source: 'alpha_api' },
    { id: 3, slug: 'new-dex', name: 'New DEX', snapshot_date: '2026-09-11', captured_at: '2026-09-11T12:00:00Z', volume_24h: 1000, open_interest: 500, tvl: 50, markets_count: 4, data_source: 'new_api' },
  ];
  const detail = buildResearchCaseDetailPayload({ caseItem, feedCases: [caseItem], historicalRows: rows, totalProtocols: 2 });
  assert.equal(detail.snapshot.date, '2026-09-10');
  assert.equal(detail.metrics.volume24h.value, 100);
  assert.equal(detail.peerContext.volume.eligible, 2);
  assert.equal(detail.peerContext.volume.rank, 1);
  assert.ok(detail.history.series.volume.every((point) => point.date <= '2026-09-10'));
});
