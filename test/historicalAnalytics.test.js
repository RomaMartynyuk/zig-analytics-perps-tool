import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMarketShareHistory,
  buildMarketShareMovers,
  toValidNumber,
} from '../server/analyticsMath.js';
import { collectDailyProtocolSnapshots, utcSnapshotDate, validMetric } from '../server/snapshotCollector.js';
import { upsertDailySnapshot } from '../server/snapshotRepository.js';

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

test('market-share movers return percentage-point changes and ranks', () => {
  const history = buildMarketShareHistory(rowsForDays(7, 25, 40), { period: '7d', totalProtocols: 2 });
  const movers = buildMarketShareMovers(history);
  const alpha = movers.values.find((value) => value.protocol.slug === 'alpha');
  assert.equal(alpha.startingShare, 25);
  assert.equal(alpha.currentShare, 40);
  assert.equal(alpha.percentagePointChange, 15);
  assert.equal(alpha.rank, 2);
});

test('insufficient history never masquerades as a full 7D series', () => {
  const history = buildMarketShareHistory(rowsForDays(5), { period: '7d', totalProtocols: 2 });
  assert.equal(history.sufficientHistory, false);
  assert.equal(history.availableDays, 5);
  assert.deepEqual(history.values, []);
});

test('invalid and missing metrics stay NULL rather than becoming zero', () => {
  assert.equal(toValidNumber(null), null);
  assert.equal(validMetric(-1), null);
  assert.equal(validMetric('malformed'), null);
  assert.equal(validMetric(null), null);
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
