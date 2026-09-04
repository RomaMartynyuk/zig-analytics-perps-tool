import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCurrentMarketShare,
  buildGrowthMatrix,
  buildMarketShareHistory,
  buildMarketShareMovers,
  buildVolumeOiAnalysis,
  snapshotDateKey,
  toValidNumber,
} from '../server/analyticsMath.js';
import { collectDailyProtocolSnapshots, utcSnapshotDate, validMetric } from '../server/snapshotCollector.js';
import { upsertDailySnapshot } from '../server/snapshotRepository.js';
import { selectTopMarketShareSeries } from '../src/lib/marketShare.js';
import { sortGrowthRows } from '../src/lib/growthMatrix.js';
import { buildSignalHistory, buildSignalsResponse, runSignalEngine } from '../server/signalEngine.js';
import { normalizeArcusMarkets } from '../server/arcusAdapter.js';

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
  assert.equal(alpha.shareGapPp, 100 / 220 * 100 - 10);
  assert.equal(beta.volumeShare, 50 / 220 * 100);
  assert.equal(beta.openInterestShare, 50);
  assert.equal(beta.shareGapPp, 50 / 220 * 100 - 50);
  assert.equal(analysis.medianRatio, 2.75);
  assert.equal(analysis.highestRatios[0].slug, 'alpha');
  assert.equal(analysis.lowestRatios[0].slug, 'beta');
  assert.equal(analysis.largestPositiveGaps[0].slug, 'alpha');
  assert.equal(analysis.largestNegativeGaps[0].slug, 'beta');
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

test('share-gap scatter does not renormalize its paired subset and ranks both directions dynamically', () => {
  const analysis = buildVolumeOiAnalysis([
    { id: 1, slug: 'volume-heavy', name: 'Volume Heavy', volume_24h: 60, open_interest: 10 },
    { id: 2, slug: 'oi-heavy', name: 'OI Heavy', volume_24h: 10, open_interest: 60 },
    { id: 3, slug: 'volume-only', name: 'Volume Only', volume_24h: 30, open_interest: null },
    { id: 4, slug: 'oi-only', name: 'OI Only', volume_24h: null, open_interest: 30 },
    { id: 5, slug: 'broken', name: 'Broken', volume_24h: 'bad', open_interest: -1 },
  ], { snapshotDate: '2026-08-27', totalProtocols: 5 });
  const volumeHeavy = analysis.protocols.find((protocol) => protocol.slug === 'volume-heavy');
  const oiHeavy = analysis.protocols.find((protocol) => protocol.slug === 'oi-heavy');
  assert.equal(analysis.snapshotDate, '2026-08-27');
  assert.equal(analysis.coverage.volumeAvailable, 3);
  assert.equal(analysis.coverage.openInterestAvailable, 3);
  assert.equal(analysis.coverage.scatterEligible, 2);
  assert.equal(volumeHeavy.volumeShare, 60);
  assert.equal(volumeHeavy.openInterestShare, 10);
  assert.equal(volumeHeavy.shareGapPp, 50);
  assert.equal(oiHeavy.volumeShare, 10);
  assert.equal(oiHeavy.openInterestShare, 60);
  assert.equal(oiHeavy.shareGapPp, -50);
  assert.equal(analysis.protocols.reduce((sum, protocol) => sum + protocol.volumeShare, 0), 70);
  assert.equal(analysis.protocols.reduce((sum, protocol) => sum + protocol.openInterestShare, 0), 70);
  assert.equal(analysis.largestPositiveGaps[0].slug, 'volume-heavy');
  assert.equal(analysis.largestNegativeGaps[0].slug, 'oi-heavy');
});

test('Growth Matrix calculates metric-specific growth and Volume-share changes from separate start/end denominators', () => {
  const rows = Array.from({ length: 7 }, (_, index) => {
    const date = `2026-02-${String(index + 1).padStart(2, '0')}`;
    const final = index === 6;
    return [
      { id: 1, slug: 'alpha', name: 'Alpha', snapshot_date: date, volume_24h: final ? 200 : 100, open_interest: final ? 200 : 100, tvl: final ? 75 : 50, data_source: 'alpha_api' },
      { id: 2, slug: 'beta', name: 'Beta', snapshot_date: date, volume_24h: 100, open_interest: 100, tvl: 100, data_source: 'beta_api' },
      { id: 3, slug: 'volume-only', name: 'Volume Only', snapshot_date: date, volume_24h: 100, open_interest: null, tvl: null, data_source: 'volume_api' },
    ];
  }).flat();
  const matrix = buildGrowthMatrix(rows, { period: '7d', totalProtocols: 3 });
  const alpha = matrix.protocols.find((protocol) => protocol.slug === 'alpha');
  const volumeOnly = matrix.protocols.find((protocol) => protocol.slug === 'volume-only');
  assert.equal(matrix.sufficientHistory, true);
  assert.equal(matrix.startDate, '2026-02-01');
  assert.equal(matrix.endDate, '2026-02-07');
  assert.equal(alpha.volume.growthPct, 100);
  assert.equal(alpha.openInterest.growthPct, 100);
  assert.equal(alpha.tvl.growthPct, 50);
  assert.equal(alpha.volumeShare.start, 100 / 300 * 100);
  assert.equal(alpha.volumeShare.current, 200 / 400 * 100);
  assert.equal(alpha.volumeShare.changePp, 200 / 400 * 100 - 100 / 300 * 100);
  assert.equal(volumeOnly.openInterest, null);
  assert.equal(volumeOnly.tvl, null);
  assert.equal(matrix.coverage.volumeComparable, 3);
  assert.equal(matrix.coverage.openInterestComparable, 2);
  assert.equal(matrix.coverage.tvlComparable, 2);
  assert.equal(matrix.coverage.shareComparable, 3);
});

test('Growth Matrix keeps platform history available when a new protocol lacks the selected window', () => {
  const rows = Array.from({ length: 30 }, (_, index) => {
    const date = `2026-03-${String(index + 1).padStart(2, '0')}`;
    const base = [
      { id: 1, slug: 'alpha', name: 'Alpha', snapshot_date: date, volume_24h: 100 + index, open_interest: 200 + index, tvl: 50 + index },
      { id: 2, slug: 'beta', name: 'Beta', snapshot_date: date, volume_24h: 200, open_interest: 300, tvl: 100 },
    ];
    if (index >= 25) base.push({ id: 3, slug: 'new-dex', name: 'New DEX', snapshot_date: date, volume_24h: 40, open_interest: 20, tvl: 10 });
    return base;
  }).flat();
  const matrix = buildGrowthMatrix(rows, { period: '30d', totalProtocols: 3 });
  const alpha = matrix.protocols.find((protocol) => protocol.slug === 'alpha');
  const newDex = matrix.protocols.find((protocol) => protocol.slug === 'new-dex');
  assert.equal(matrix.sufficientHistory, true);
  assert.ok(alpha.volume);
  assert.equal(newDex.volume, null);
  assert.equal(newDex.openInterest, null);
  assert.equal(newDex.tvl, null);
  assert.equal(newDex.volumeShare, null);
});

test('Growth Matrix rejects zero or missing bases and reports insufficient 7D/30D/90D platform history', () => {
  const rows = Array.from({ length: 6 }, (_, index) => ({
    id: 1, slug: 'alpha', name: 'Alpha', snapshot_date: `2026-04-${String(index + 1).padStart(2, '0')}`,
    volume_24h: index === 0 ? 0 : 100, open_interest: null, tvl: null,
  }));
  assert.equal(buildGrowthMatrix(rows, { period: '7d', totalProtocols: 1 }).sufficientHistory, false);
  assert.equal(buildGrowthMatrix(rows, { period: '30d', totalProtocols: 1 }).sufficientHistory, false);
  assert.equal(buildGrowthMatrix(rows, { period: '90d', totalProtocols: 1 }).sufficientHistory, false);
  const fullRows = [...rows, { ...rows.at(-1), snapshot_date: '2026-04-07' }];
  const full = buildGrowthMatrix(fullRows, { period: '7d', totalProtocols: 1 });
  assert.equal(full.protocols[0].volume, null);
});

test('Growth Matrix sorting orders selected metrics and always keeps missing values last', () => {
  const rows = [
    { slug: 'low', name: 'Low', volume: { growthPct: -5 }, volumeShare: { changePp: -1 } },
    { slug: 'missing', name: 'Missing', volume: null, volumeShare: null },
    { slug: 'high', name: 'High', volume: { growthPct: 10 }, volumeShare: { changePp: 3 } },
  ];
  assert.deepEqual(sortGrowthRows(rows, 'volume').map((row) => row.slug), ['high', 'low', 'missing']);
  assert.deepEqual(sortGrowthRows(rows, 'volume', false).map((row) => row.slug), ['low', 'high', 'missing']);
  assert.deepEqual(sortGrowthRows(rows, 'volumeShare').map((row) => row.slug), ['high', 'low', 'missing']);
});

test('Signal Engine produces deterministic current signals and isolates failed detectors', () => {
  const current = { coverage: { total: 6, volumeAvailable: 6, openInterestAvailable: 6 }, protocols: Array.from({ length: 6 }, (_, index) => ({ id: index + 1, slug: `p${index}`, name: `P${index}`, volume24h: 100 + index, openInterest: index === 5 ? 1 : 100, volumeOiRatio: index === 5 ? 105 : 1 + index / 100, volumeShare: 10 + index, openInterestShare: index === 5 ? 1 : 10 + index, shareGapPp: index === 5 ? 14 : 0, volumeRank: index + 1, openInterestRank: index === 5 ? 6 : index + 1 })) };
  const context = { current, snapshotDate: '2026-09-04', growth: {} };
  const first = runSignalEngine(context);
  const second = runSignalEngine(context);
  assert.ok(first.signals.length > 0);
  assert.equal(first.signals[0].id, second.signals[0].id);
  assert.ok(first.signals.every((item) => item.score >= 0 && item.score <= 100));
  const isolated = runSignalEngine(context, { detectors: [() => { throw new Error('broken'); }, () => first.signals] });
  assert.equal(isolated.detectorErrors.length, 1);
  assert.ok(isolated.signals.length > 0);
});

test('Signal Engine discounts a tiny-OI ratio artifact while retaining market-impactful outliers', () => {
  const protocols = [
    { id: 1, slug: 'leader', name: 'Leader', volume24h: 500, openInterest: 500, volumeOiRatio: 1, volumeShare: 50, openInterestShare: 50, shareGapPp: 0, volumeRank: 1, openInterestRank: 1 },
    { id: 2, slug: 'two', name: 'Two', volume24h: 200, openInterest: 100, volumeOiRatio: 2, volumeShare: 20, openInterestShare: 20, shareGapPp: 0, volumeRank: 2, openInterestRank: 2 },
    { id: 3, slug: 'three', name: 'Three', volume24h: 150, openInterest: 50, volumeOiRatio: 3, volumeShare: 15, openInterestShare: 15, shareGapPp: 0, volumeRank: 3, openInterestRank: 3 },
    { id: 4, slug: 'four', name: 'Four', volume24h: 100, openInterest: 25, volumeOiRatio: 4, volumeShare: 10, openInterestShare: 10, shareGapPp: 0, volumeRank: 4, openInterestRank: 4 },
    { id: 5, slug: 'five', name: 'Five', volume24h: 40, openInterest: 8, volumeOiRatio: 5, volumeShare: 4, openInterestShare: 4, shareGapPp: 0, volumeRank: 5, openInterestRank: 5 },
    { id: 6, slug: 'tiny-oi', name: 'Tiny OI', volume24h: 3, openInterest: .03, volumeOiRatio: 100, volumeShare: .3, openInterestShare: .003, shareGapPp: .297, volumeRank: 6, openInterestRank: 6 },
  ];
  const result = runSignalEngine({ current: { coverage: { total: 6, volumeAvailable: 6, openInterestAvailable: 6 }, protocols }, growth: {}, snapshotDate: '2026-09-03' });
  assert.equal(result.signals.some((item) => item.protocolSlug === 'tiny-oi' && item.type === 'high_turnover'), false);
  assert.ok(result.diagnostics.suppressed.some((item) => item.protocolSlug === 'tiny-oi' && item.suppressedBy === 'below_quality_threshold'));
});

test('Signal Engine combines multi-metric leadership into one card', () => {
  const leader = { id: 1, slug: 'leader', name: 'Leader', volume24h: 900, openInterest: 800, volumeOiRatio: 1.1, volumeShare: 60, openInterestShare: 60, shareGapPp: 0, volumeRank: 1, openInterestRank: 1 };
  const protocols = [leader, ...Array.from({ length: 5 }, (_, index) => ({ id: index + 2, slug: `p${index}`, name: `P${index}`, volume24h: 50 - index, openInterest: 50 - index, volumeOiRatio: 1, volumeShare: 8 - index, openInterestShare: 8 - index, shareGapPp: 0, volumeRank: index + 2, openInterestRank: index + 2 }))];
  const result = runSignalEngine({ current: { coverage: { total: 6, volumeAvailable: 6, openInterestAvailable: 6 }, protocols, tvlLeader: { ...leader, value: 700 } }, growth: {}, snapshotDate: '2026-09-03' });
  const leadership = result.signals.filter((item) => item.type === 'market_leadership' && item.protocolSlug === 'leader');
  assert.equal(leadership.length, 1);
  assert.equal(leadership[0].evidence.length, 5);
});

test('Signal Engine keeps share-gap evidence ahead of equivalent turnover evidence for one protocol', () => {
  const protocol = { id: 1, slug: 'alpha', name: 'Alpha' };
  const candidates = [
    { id: 'turnover', type: 'low_turnover', category: 'activity', protocolSlug: 'alpha', protocolName: 'Alpha', protocolId: 1, period: 'current', family: 'oi_heavy_structure', score: 80 },
    { id: 'gap', type: 'share_gap_divergence', category: 'structure', protocolSlug: 'alpha', protocolName: 'Alpha', protocolId: 1, period: 'current', family: 'oi_heavy_structure', score: 80 },
  ];
  const result = runSignalEngine({ current: { coverage: { total: 0 }, protocols: [] }, growth: {}, snapshotDate: '2026-09-03' }, { detectors: [() => candidates] });
  assert.equal(result.signals[0].type, 'share_gap_divergence');
  assert.equal(result.diagnostics.suppressed[0].id, 'turnover');
  assert.equal(protocol.slug, 'alpha');
});

test('Signal Engine does not classify a tied peer group as statistical turnover outliers', () => {
  const protocols = Array.from({ length: 6 }, (_, index) => ({
    id: index + 1, slug: `equal-${index}`, name: `Equal ${index}`,
    volume24h: 100, openInterest: 100, volumeOiRatio: 1,
    volumeShare: 100 / 6, openInterestShare: 100 / 6, shareGapPp: 0,
    volumeRank: index + 1, openInterestRank: index + 1,
  }));
  const result = runSignalEngine({ current: { coverage: { total: 6, volumeAvailable: 6, openInterestAvailable: 6 }, protocols }, growth: {}, snapshotDate: '2026-09-03' });
  assert.equal(result.signals.some((item) => item.type === 'high_turnover' || item.type === 'low_turnover'), false);
});

test('Signal history and response do not fabricate historical periods or include a tiny peer sample', () => {
  const rows = [{ id: 1, slug: 'only', name: 'Only', snapshot_date: '2026-09-04', volume_24h: 10, open_interest: 1, tvl: null }];
  const history = buildSignalHistory(rows);
  assert.equal(history['7d'].available, false);
  const current = { coverage: { total: 1, volumeAvailable: 1, openInterestAvailable: 1 }, protocols: [{ id: 1, slug: 'only', name: 'Only', volume24h: 10, openInterest: 1, volumeOiRatio: 10, volumeShare: 100, openInterestShare: 100, shareGapPp: 0, volumeRank: 1, openInterestRank: 1 }] };
  const response = buildSignalsResponse({ current, rows, totalProtocols: 1, snapshotDate: '2026-09-04' });
  assert.equal(response.history['7d'].available, false);
  assert.equal(response.signals.some((item) => item.type === 'high_turnover'), false);
});

test('UTC snapshot identity is independent from a local timezone', () => {
  assert.equal(utcSnapshotDate(new Date('2026-08-27T23:30:00-05:00')), '2026-08-28');
});

test('analytics normalize PostgreSQL DATE values returned as native Date objects', () => {
  const rows = rowsForDays(7).map((row) => ({ ...row, snapshot_date: new Date(`${row.snapshot_date}T00:00:00.000Z`) }));
  assert.equal(snapshotDateKey(rows[0].snapshot_date), '2026-01-01');
  const history = buildMarketShareHistory(rows, { period: '7d', totalProtocols: 2 });
  assert.equal(history.sufficientHistory, true);
  assert.equal(history.endDate, '2026-01-07');
});

test('Arcus market adapter normalizes USD volume, base OI, and active perpetual market count', () => {
  const payload = { markets: [
    { marketId: 1, type: 'PERPETUAL', status: 'ONLINE', volume24hNotional: '125.5', openInterest: '2.5', markPrice: '100' },
    { marketId: 2, type: 'PERPETUAL', status: 'ONLINE', volume24hNotional: '74.5', openInterest: '4', markPrice: '50' },
    { marketId: 3, type: 'PERPETUAL', status: 'OFFLINE', volume24hNotional: '999', openInterest: '10', markPrice: '10' },
    { marketId: 4, type: 'SPOT', status: 'ONLINE', volume24hNotional: '999', openInterest: '10', markPrice: '10' },
    { marketId: 2, type: 'PERPETUAL', status: 'ONLINE', volume24hNotional: '74.5', openInterest: '4', markPrice: '50' },
  ] };
  const normalized = normalizeArcusMarkets(payload);
  assert.equal(normalized.marketsCount, 2);
  assert.equal(normalized.volume, 200);
  assert.equal(normalized.openInterest, 450);
  assert.equal(normalized.diagnostics.duplicateMarketIds, 1);
});

test('Arcus adapter preserves partial data and rejects malformed market metrics', () => {
  const normalized = normalizeArcusMarkets({ markets: [
    { marketId: 1, type: 'PERPETUAL', status: 'ONLINE', volume24hNotional: '100', openInterest: null, markPrice: '50' },
    { marketId: 2, type: 'PERPETUAL', status: 'ONLINE', volume24hNotional: 'Infinity', openInterest: '-3', markPrice: '10' },
    { marketId: 'not-an-id', type: 'PERPETUAL', status: 'ONLINE', volume24hNotional: '50', openInterest: '1', markPrice: '50' },
  ] });
  assert.equal(normalized.marketsCount, 2);
  assert.equal(normalized.volume, 100);
  assert.equal(normalized.openInterest, null);
  assert.equal(normalized.diagnostics.invalidMarkets, 1);
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
    loadMetrics: async () => [{ name: 'Alpha', dataSource: 'alpha_api', volume: 1, openInterest: 1, marketsCount: 58 }],
    loadTvl: async () => ({ tvl: 1, dataSource: 'defillama', sourceUpdatedAt: null }),
    log: { info() {}, error() {} },
  });
  assert.equal(summary.saved, 1);
  assert.equal(calls.filter((call) => call.text.includes('INSERT INTO protocols')).length, 2);
  const writes = calls.filter((call) => call.text.includes('INSERT INTO protocol_daily_snapshots'));
  assert.equal(writes.length, 1);
  assert.equal(writes[0].values[6], 58);
});
