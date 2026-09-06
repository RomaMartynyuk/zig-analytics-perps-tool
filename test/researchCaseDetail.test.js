import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResearchCurrentMetrics, buildResearchHistory } from '../server/researchCaseDetailService.js';

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
