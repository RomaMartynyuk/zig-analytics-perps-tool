import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCurrentMarketShare,
  buildMarketShareHistory,
  buildMarketShareMovers,
  buildVolumeOiAnalysis,
  toValidNumber,
} from '../server/analyticsMath.js';
import { collectDailyProtocolSnapshots, utcSnapshotDate, validMetric } from '../server/snapshotCollector.js';
import { upsertDailySnapshot } from '../server/snapshotRepository.js';
import { selectTopMarketShareSeries } from '../src/lib/marketShare.js';

function rowsForDays(days, firstValue = 25, lastValue = firstValue) {
  return Array.from({ length: days }, (_, index) => {
    const day = String(index + 1).padStart(2, '0');
    const alpha = index === days - 1 ? lastValue : firstValue;
    return [
      { snapshot_date: `2026-01-${day}`, slug: 'alpha', name: 'Alpha', metric_value: alpha },
      { snapshot_date: `2026-01-${day}`, slug: 'beta', name: 'Beta', metric_value: 100 - alpha },
    ];
  }).flat();
}

function fakeSql({ failProtocolId } = {}) {
  const calls = [];
  async function sql(strings, ...values) {
    const text = strings.raw.reduce((result, part, index) => result + part + (index < values.length ? '$' : ''), '');
    calls.push({ text, values });
    if (text.includes('INSERT INTO protocols')) {
      return [{ id: values[0] === 'alpha' ? 1 : 2, slug: values[0], name: values[1], is_active: true }];
    }
    if (text.includes('INSERT INTO protocol_daily_snapshots')) {
      if (values[0] === failProtocolId) throw new Error('database write failed');
      return [{ id: 1, protocol_id: values[0], snapshot_date: values[1] }];
    }
    return [];
  }
  return { sql, calls };
}

test('market shares use only valid available values and preserve OI coverage', () => {
  const volume = buildMarketShareHistory(rowsForDays(7), { period: '7d', totalProtocols: 3 });
  assert.equal(volume.sufficientHistory, true);
  assert.equal(volume.coverage.validProtocols, 2);
  assert.equal(volume.coverage.totalProtocols, 3);
  assert.equal(volume.values.at(-2).share, 25);

  const oi = buildMarketShareHistory(rowsForDays(7, 20), { period: '7d', totalProtocols: 2 });
  assert.equal(oi.values.at(-2).share, 20);
});

test('current market share excludes NULL protocols and returns coverage, names, rank and snapshot date', () => {
  const current = buildCurrentMarketShare([
    { slug: 'alpha', name: 'Alpha', metric_value: 75, data_source: 'alpha_api' },
    { slug: 'beta', name: 'Beta', metric_value: 25, data_source: 'beta_api' },
    { slug: 'missing', name: 'Missing', metric_value: null, data_source: null },
  ], {
    metric: 'volume',
    snapshotDate: '2026-08-27',
    capturedAt: '2026-08-27T12:00:00.000Z',
    totalProtocols: 3,
  });
  assert.equal(current.snapshotDate, '2026-08-27');
  assert.equal(current.coverage.available, 2);
  assert.equal(current.coverage.total, 3);
  assert.equal(current.coverage.missing, 1);
  assert.equal(current.values[0].protocol.name, 'Alpha');
  assert.equal(current.values[0].rank, 1);
  assert.equal(current.values[0].share + current.values[1].share, 100);
  assert.deepEqual(current.missingProtocols, [{ slug: 'missing', name: 'Missing' }]);
});

test('new protocols participate only in metrics they actually report', () => {
  const volume = buildCurrentMarketShare([
    { slug: 'existing', name: 'Existing', metric_value: 100 },
    { slug: 'new-volume', name: 'New Volume', metric_value: 100 },
    { slug: 'new-oi-only', name: 'New OI Only', metric_value: null },
    { slug: 'new-empty', name: 'New Empty', metric_value: null },
  ], { metric: 'volume', totalProtocols: 4 });
  assert.equal(volume.coverage.available, 2);
  assert.equal(volume.coverage.total, 4);
  assert.equal(volume.values[0].share + volume.values[1].share, 100);
  assert.deepEqual(volume.missingProtocols.map((protocol) => protocol.slug), ['new-oi-only', 'new-empty']);

  const oi = buildCurrentMarketShare([
    { slug: 'existing', name: 'Existing', metric_value: 20 },
    { slug: 'new-volume', name: 'New Volume', metric_value: null },
    { slug: 'new-oi-only', name: 'New OI Only', metric_value: 80 },
    { slug: 'new-empty', name: 'New Empty', metric_value: null },
  ], { metric: 'open_interest', totalProtocols: 4 });
  assert.equal(oi.coverage.available, 2);
  assert.equal(oi.values[0].protocol.slug, 'new-oi-only');
  assert.equal(oi.values[0].share, 80);
});

test('Top N history selection is slug-driven and promotes a new protocol automatically', () => {
  const values = ['a', 'b', 'c', 'd', 'e', 'f'].flatMap((slug, index) => ([
    { date: '2026-08-27', protocol: { slug, name: slug }, share: index + 1 },
    { date: '2026-08-28', protocol: { slug, name: slug }, share: slug === 'f' ? 60 : index + 1 },
  ]));
  const result = selectTopMarketShareSeries(values);
  assert.equal(result.series.length, 5);
  assert.equal(result.series[0].slug, 'f');
  assert.ok(result.series.some((series) => series.slug === 'f'));
});

test('a 30-plus protocol universe preserves dynamic coverage and response shape', () => {
  const rows = Array.from({ length: 33 }, (_, index) => ({
    slug: `protocol-${index}`,
    name: `Protocol ${index}`,
    metric_value: index + 1,
  }));
  const current = buildCurrentMarketShare(rows, { metric: 'volume', totalProtocols: 33 });
  assert.equal(current.coverage.available, 33);
  assert.equal(current.coverage.total, 33);
  assert.equal(current.values.length, 33);
  assert.equal(current.values[0].rank, 1);
  assert.equal(current.values.reduce((sum, value) => sum + value.share, 0).toFixed(6), '100.000000');
});

test('market-share movers return positive and negative percentage-point changes with ranked sections', () => {
  const history = buildMarketShareHistory(rowsForDays(7, 25, 40), { period: '7d', totalProtocols: 2 });
  const movers = buildMarketShareMovers(history);
  const alpha = movers.gainers.find((value) => value.protocol.slug === 'alpha');
  const beta = movers.losers.find((value) => value.protocol.slug === 'beta');
  assert.equal(alpha.startingShare, 25);
  assert.equal(alpha.currentShare, 40);
  assert.equal(alpha.percentagePointChange, 15);
  assert.equal(alpha.rank, 1);
  assert.equal(beta.percentagePointChange, -15);
  assert.equal(beta.rank, 1);
  assert.equal(movers.coverage.currentAvailable, 2);
  assert.equal(movers.coverage.eligible, 2);
});

test('movers exclude protocols missing either the start or current comparison point', () => {
  const rows = rowsForDays(7, 50, 60)
    .filter((row) => !(row.slug === 'alpha' && row.snapshot_date === '2026-01-01'));
  const movers = buildMarketShareMovers(buildMarketShareHistory(rows, { period: '7d', totalProtocols: 2 }));
  assert.equal(movers.values.some((value) => value.protocol.slug === 'alpha'), false);
  assert.equal(movers.coverage.eligible, 1);
  assert.equal(movers.coverage.comparisonUnavailable, 1);
});

test('one malformed historical protocol record does not break the movers result', () => {
  const rows = [
    ...rowsForDays(7, 40, 50),
    { snapshot_date: '2026-01-01', slug: 'broken', name: 'Broken', metric_value: 'invalid' },
    { snapshot_date: '2026-01-07', slug: 'broken', name: 'Broken', metric_value: null },
  ];
  const movers = buildMarketShareMovers(buildMarketShareHistory(rows, { period: '7d', totalProtocols: 3 }));
  assert.equal(movers.gainers[0].protocol.slug, 'alpha');
  assert.equal(movers.values.some((value) => value.protocol.slug === 'broken'), false);
});

test('insufficient history never masquerades as a full 7D series', () => {
  const history = buildMarketShareHistory(rowsForDays(5), { period: '7d', totalProtocols: 2 });
  const movers = buildMarketShareMovers(history);
  assert.equal(history.sufficientHistory, false);
  assert.equal(history.availableDays, 5);
  assert.deepEqual(history.values, []);
  assert.deepEqual(movers.gainers, []);
  assert.deepEqual(movers.losers, []);
});

test('30D and 90D history stay empty until all required daily snapshots exist', () => {
  const rows = rowsForDays(29);
  const thirtyDays = buildMarketShareHistory(rows, { period: '30d', totalProtocols: 2 });
  const ninetyDays = buildMarketShareHistory(rows, { period: '90d', totalProtocols: 2 });
  assert.equal(thirtyDays.sufficientHistory, false);
  assert.equal(thirtyDays.availableDays, 29);
  assert.deepEqual(thirtyDays.values, []);
  assert.equal(ninetyDays.sufficientHistory, false);
  assert.equal(ninetyDays.availableDays, 29);
  assert.deepEqual(ninetyDays.values, []);
});

test('invalid and missing metrics stay NULL rather than becoming zero', () => {
  assert.equal(toValidNumber(null), null);
  assert.equal(validMetric(-1), null);
  assert.equal(validMetric('malformed'), null);
  assert.equal(validMetric(null), null);
});

test('Volume/OI analysis uses all valid metric values for shares and only positive paired values for scatter points', () => {
  const analysis = buildVolumeOiAnalysis([
    { id: 1, slug: 'alpha', name: 'Alpha', volume_24h: 100, open_interest: 20, data_source: 'alpha_api' },
    { id: 2, slug: 'beta', name: 'Beta', volume_24h: 50, open_interest: 100, data_source: 'beta_api' },
    { id: 3, slug: 'volume-only', name: 'Volume Only', volume_24h: 50, open_interest: null },
    { id: 4, slug: 'oi-only', name: 'OI Only', volume_24h: null, open_interest: 80 },
    { id: 5, slug: 'zero-oi', name: 'Zero OI', volume_24h: 20, open_interest: 0 },
    { id: 6, slug: 'invalid', name: 'Invalid', volume_24h: -1, open_interest: 'bad' },
  ], { snapshotDate: '2026-08-27', capturedAt: '2026-08-27T12:00:00.000Z', totalProtocols: 6 });
  const alpha = analysis.protocols.find((protocol) => protocol.slug === 'alpha');
  const beta = analysis.protocols.find((protocol) => protocol.slug === 'beta');
  assert.equal(analysis.snapshotDate, '2026-08-27');
  assert.equal(analysis.coverage.volumeAvailable, 4);
  assert.equal(analysis.coverage.openInterestAvailable, 4);
  assert.equal(analysis.coverage.scatterEligible, 2);
  assert.equal(analysis.coverage.missing, 4);
  assert.equal(alpha.volumeOiRatio, 5);
  assert.equal(alpha.volumeShare, 100 / 220 * 100);
  assert.equal(alpha.openInterestShare, 10);
  assert.equal(beta.volumeShare, 50 / 220 * 100);
  assert.equal(beta.openInterestShare, 50);
  assert.equal(analysis.medianRatio, 2.75);
  assert.equal(analysis.highestRatios[0].slug, 'alpha');
  assert.equal(analysis.lowestRatios[0].slug, 'beta');
  assert.deepEqual(analysis.missingProtocols.map((protocol) => protocol.slug), ['volume-only', 'oi-only', 'zero-oi', 'invalid']);
});

test('Volume/OI analysis automatically admits new valid protocols and isolates malformed records', () => {
  const analysis = buildVolumeOiAnalysis([
    { id: 1, slug: 'existing', name: 'Existing', volume_24h: 10, open_interest: 10 },
    { id: 2, slug: 'new-dex', name: 'New DEX', volume_24h: 90, open_interest: 30 },
    { id: 3, slug: 'broken', name: 'Broken', volume_24h: 'not-a-number', open_interest: 8 },
  ], { snapshotDate: '2026-08-27', totalProtocols: 3 });
  assert.equal(analysis.protocols.length, 2);
  assert.equal(analysis.coverage.scatterEligible, 2);
  assert.equal(analysis.coverage.volumeAvailable, 2);
  assert.equal(analysis.coverage.openInterestAvailable, 3);
  assert.equal(analysis.highestRatios[0].slug, 'new-dex');
  assert.equal(analysis.protocols.reduce((sum, protocol) => sum + protocol.volumeShare, 0), 100);
});

test('UTC snapshot identity is independent from a local timezone', () => {
  assert.equal(utcSnapshotDate(new Date('2026-08-27T23:30:00-05:00')), '2026-08-28');
});

test('daily upsert targets the same protocol/date key on retries', async () => {
  const { sql, calls } = fakeSql();
  const snapshot = {
    protocolId: 1,
    snapshotDate: '2026-08-27',
    capturedAt: new Date('2026-08-27T12:00:00Z'),
    volume24h: null,
    openInterest: 10,
    tvl: null,
    marketsCount: null,
    dataSource: 'alpha_api',
    sourceUpdatedAt: null,
  };
  await upsertDailySnapshot(sql, snapshot);
  await upsertDailySnapshot(sql, snapshot);
  const writes = calls.filter((call) => call.text.includes('INSERT INTO protocol_daily_snapshots'));
  assert.equal(writes.length, 2);
  assert.match(writes[0].text, /ON CONFLICT \(protocol_id, snapshot_date\) DO UPDATE/);
  assert.equal(writes[0].values[1], writes[1].values[1]);
  assert.equal(writes[0].values[0], writes[1].values[0]);
  assert.equal(writes[0].values[3], null);
});

test('one protocol failure does not stop the rest of the daily collector', async () => {
  const { sql, calls } = fakeSql({ failProtocolId: 1 });
  const summary = await collectDailyProtocolSnapshots({
    now: new Date('2026-08-27T12:00:00Z'),
    sql,
    protocols: [
      { slug: 'alpha', name: 'Alpha', metricsKey: 'Alpha', defillamaSlug: 'alpha', isActive: true },
      { slug: 'beta', name: 'Beta', metricsKey: 'Beta', defillamaSlug: 'beta', isActive: true },
    ],
    loadMetrics: async () => [
      { name: 'Alpha', dataSource: 'alpha_api', volume: 10, openInterest: 2 },
      { name: 'Beta', dataSource: 'beta_api', volume: 20, openInterest: 4 },
    ],
    loadTvl: async (slug) => slug === 'alpha'
      ? { tvl: 3, dataSource: 'defillama', sourceUpdatedAt: null }
      : Promise.reject(new Error('upstream unavailable')),
    log: { info() {}, error() {} },
  });
  assert.equal(summary.failed, 1);
  assert.equal(summary.partial, 1);
  assert.equal(calls.filter((call) => call.text.includes('INSERT INTO protocol_daily_snapshots')).length, 2);
});

test('inactive configured protocols are synced but do not receive new daily snapshots', async () => {
  const { sql, calls } = fakeSql();
  const summary = await collectDailyProtocolSnapshots({
    now: new Date('2026-08-27T12:00:00Z'),
    sql,
    protocols: [
      { slug: 'alpha', name: 'Alpha', metricsKey: 'Alpha', defillamaSlug: 'alpha', isActive: true },
      { slug: 'beta', name: 'Beta', metricsKey: 'Beta', defillamaSlug: 'beta', isActive: false },
    ],
    loadMetrics: async () => [{ name: 'Alpha', dataSource: 'alpha_api', volume: 1, openInterest: 1 }],
    loadTvl: async () => ({ tvl: 1, dataSource: 'defillama', sourceUpdatedAt: null }),
    log: { info() {}, error() {} },
  });
  assert.equal(summary.saved, 1);
  assert.equal(calls.filter((call) => call.text.includes('INSERT INTO protocols')).length, 2);
  assert.equal(calls.filter((call) => call.text.includes('INSERT INTO protocol_daily_snapshots')).length, 1);
});
