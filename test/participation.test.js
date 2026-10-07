import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccumulator, accumulateTrade, distributionMetrics, reconciliation, publishableMetrics, utcWindow, PARTICIPATION_METHOD, serializeAccumulator } from '../server/participationMath.js';
import { collectN1Participation, normalizeN1Trade } from '../server/n1ParticipationAdapter.js';
import { collectParticipation } from '../server/participationCollector.js';
import { buildParticipationResponse } from '../server/participationService.js';
import { saveParticipation } from '../server/participationRepository.js';

const window = utcWindow('2026-10-06');
const trade = (id, maker = 'a', taker = 'b', volumeUsd = 100, marketId = '0') => ({ id, maker, taker, volumeUsd, marketId, timestamp: '2026-10-06T12:00:00Z' });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('half-split preserves single-sided volume and unique scoped participants', () => {
  const accumulator = createAccumulator();
  accumulateTrade(accumulator, trade('one'), window);
  accumulateTrade(accumulator, trade('two', 'a', 'c', 200), window);
  const stats = distributionMetrics(accumulator.participants);
  assert.equal(stats.activeParticipants, 3);
  close(stats.attributedVolumeUsd, 300);
  close(stats.meanVolumePerParticipant, 100);
  close(stats.medianVolumePerParticipant, 100);
  close(stats.top1Share, 50);
  close(stats.top5Share, 100);
  close(stats.top10Share, 100);
  close(stats.hhi, (150 / 300) ** 2 + (50 / 300) ** 2 + (100 / 300) ** 2);
  close(stats.effectiveParticipants, 1 / stats.hhi);
  assert.equal(stats.top1pctShare, null);
});

test('self-match, duplicates and resumable retry do not double count', () => {
  let accumulator = createAccumulator();
  accumulateTrade(accumulator, trade('one', 'a', 'a'), window);
  accumulator = createAccumulator(serializeAccumulator(accumulator));
  accumulateTrade(accumulator, trade('one', 'a', 'a'), window);
  assert.equal(accumulator.duplicates, 1);
  assert.equal(accumulator.participants.size, 1);
  assert.equal(distributionMetrics(accumulator.participants).attributedVolumeUsd, 100);
});

test('UTC boundaries are half-open; malformed, negative, zero and unfinalized fills excluded', () => {
  const accumulator = createAccumulator();
  for (const entry of [{ ...trade('bad'), volumeUsd: NaN }, trade('negative', 'a', 'b', -1), trade('zero', 'a', 'b', 0), { ...trade('unfinal'), finalized: false }, { ...trade('end'), timestamp: window.periodEnd }, { ...trade('before'), timestamp: '2026-10-05T23:59:59Z' }]) assert.equal(accumulateTrade(accumulator, entry, window), false);
  assert.equal(accumulateTrade(accumulator, { ...trade('start'), timestamp: window.periodStart }, window), true);
  assert.throws(() => utcWindow('2026-02-30'));
});

test('market-level and protocol-wide distinct populations cannot be summed', () => {
  const accumulator = createAccumulator();
  accumulateTrade(accumulator, trade('one'), window);
  accumulateTrade(accumulator, trade('two', 'a', 'c', 100, '1'), window);
  assert.equal(accumulator.participants.size, 3);
  assert.equal([...accumulator.markets.values()].reduce((sum, map) => sum + map.size, 0), 4);
});

test('HHI equal accounts, concentrated distribution and top percentile sample guards', () => {
  const equal = distributionMetrics(new Map(Array.from({ length: 100 }, (_, i) => [String(i), 1])));
  close(equal.hhi, 0.01);
  close(equal.effectiveParticipants, 100);
  close(equal.top1pctShare, 1);
  close(distributionMetrics(new Map([['only', 100]])).hhi, 1);
});

test('coverage thresholds, mismatch and low coverage suppress concentration and signals', () => {
  const observed = distributionMetrics(new Map([['a', 50], ['b', 50]]));
  const good = reconciliation({ attributedVolumeUsd: 100, comparableVolumeUsd: 100, exactWindow: true, complete: true });
  assert.equal(good.qualityState, 'COMPLETE');
  assert.equal(good.concentrationEligible, true);
  assert.equal(good.signalEligible, false);
  const eighty = reconciliation({ attributedVolumeUsd: 80, comparableVolumeUsd: 100, exactWindow: true, complete: true });
  assert.equal(eighty.qualityState, 'PARTIAL');
  for (const quality of [reconciliation({ attributedVolumeUsd: 12, comparableVolumeUsd: 100, exactWindow: true, complete: true }), reconciliation({ attributedVolumeUsd: 200, comparableVolumeUsd: 100, exactWindow: true, complete: true }), reconciliation({ attributedVolumeUsd: 100, comparableVolumeUsd: 100, exactWindow: false, complete: true })]) {
    assert.equal(publishableMetrics(observed, quality, true).hhi, null);
    assert.equal(quality.signalEligible, false);
  }
  assert.equal(reconciliation({ attributedVolumeUsd: 100, comparableVolumeUsd: 100, exactWindow: false }).coverageRatio, null);
  assert.equal(publishableMetrics(observed, good, false).activeParticipants, null);
});

const markets = [{ marketId: 0, name: 'BTCUSD' }];
const raw = (id = 1) => ({ tradeId: id, marketId: 0, makerId: 0, takerId: 10, price: 50000, baseSize: 0.01, time: '2026-10-06T12:00:00Z' });
test('N1 human quote units and account 0 are valid; hashes are protocol-scoped', () => {
  const normalized = normalizeN1Trade(raw(), markets, 'salt');
  assert.equal(normalized.volumeUsd, 500);
  assert.notEqual(normalized.maker, normalized.taker);
  assert.equal(normalized.maker.length, 64);
  assert.equal(normalizeN1Trade({ ...raw(), makerId: '0' }, markets, 'salt'), null);
  assert.equal(normalizeN1Trade({ ...raw(), tradeId: Number.MAX_SAFE_INTEGER + 1 }, markets, 'salt'), null);
});

const fakeFetch = (pages) => async (url) => ({ ok: true, json: async () => url.endsWith('/info') ? { markets: [{ marketId: 0, quoteTokenId: 0, symbol: 'BTCUSD' }], tokens: [{ tokenId: 0, symbol: 'USDC' }] } : url.endsWith('/markets/live') ? { markets: [{ marketId: 0, perpetuals: {}, historical: { volumeQuote24h: 1000 } }] } : pages.shift() });
test('N1 bounded pagination resumes same window, deduplicates overlap and suppresses unmatched denominator', async () => {
  let checkpoint;
  const first = await collectN1Participation({ day: '2026-10-06', maxPages: 1, fetchImpl: fakeFetch([{ items: [raw(2)], nextStartInclusive: 1 }]), requestDelayMs: 0, onCheckpoint: async (state) => { checkpoint = structuredClone(state); } });
  assert.equal(first.complete, false);
  assert.equal(first.rows[0].activeParticipants, null);
  const second = await collectN1Participation({ day: '2026-10-06', checkpoint, fetchImpl: fakeFetch([{ items: [raw(2), raw(1)], nextStartInclusive: null }]), requestDelayMs: 0 });
  assert.equal(second.complete, true);
  assert.equal(second.diagnostics.duplicates, 1);
  assert.equal(second.rows[0].attributedVolumeUsd, 1000);
  assert.equal(second.rows[0].coverageRatio, null);
  assert.equal(second.rows[0].hhi, null);
});

test('pagination failure cannot publish full population; retryable API failure isolated', async () => {
  const summary = await collectParticipation({ protocols: [{ slug: 'broken', isActive: true }, { slug: 'fine', isActive: true }, { slug: 'missing', isActive: true }], adapters: { broken: async () => { throw new Error('Provider unavailable'); }, fine: async () => ({ complete: true }) } });
  assert.equal(summary.failed.length, 1);
  assert.equal(summary.saved.length, 1);
  assert.deepEqual(summary.unavailable, ['missing']);
  await assert.rejects(collectN1Participation({ day: '2026-10-06', fetchImpl: fakeFetch([{ items: [raw()], nextStartInclusive: 1 }, { items: [raw()], nextStartInclusive: 1 }]), requestDelayMs: 0 }), /cursor/);
});

test('participant response is dynamic, missing is NULL, active policy and no fake multi-day totals', () => {
  const protocols = [{ id: 1, slug: 'n1', name: 'N1' }, { id: 2, slug: 'new', name: 'New' }, { id: 3, slug: 'disabled', name: 'Disabled', is_active: false }];
  const rows = [{ protocol_id: 1, market_id: null, snapshot_date: '2026-10-06', methodology_version: PARTICIPATION_METHOD, collection_complete: true, active_participants: '411', attributed_volume_usd: '1000', quality_state: 'UNAVAILABLE' }];
  const response = buildParticipationResponse(protocols, rows);
  assert.equal(response.coverage.total, 2);
  assert.equal(response.coverage.participantAvailable, 1);
  assert.equal(response.protocols[1].activeParticipants, null);
  assert.equal(response.protocols[0].hhi, null);
  for (const period of ['7d', '30d']) {
    const historical = buildParticipationResponse(protocols, rows, { period });
    assert.equal(historical.availableDays, 1);
    assert.equal(historical.sufficientHistory, false);
    assert.deepEqual(historical.dailyHistory, []);
    assert.equal(historical.periodAggregateAvailable, false);
  }
});

test('different account identifiers remain different; no human/entity clustering', () => {
  const accumulator = createAccumulator();
  accumulateTrade(accumulator, trade('one', 'contract-wallet', 'smart-account'), window);
  accumulateTrade(accumulator, trade('two', 'entity-account-1', 'entity-account-2'), window);
  assert.equal(accumulator.participants.size, 4);
});

test('Neon DATE objects, dynamic 50+ coverage and daily history are canonical UTC', () => {
  const protocols = Array.from({ length: 51 }, (_, i) => ({ id: i + 1, slug: `protocol-${i}`, name: `Protocol ${i}` }));
  const rows = Array.from({ length: 7 }, (_, i) => ({ protocol_id: 1, market_id: null, snapshot_date: new Date(`2026-10-${String(i + 1).padStart(2, '0')}T00:00:00Z`), methodology_version: PARTICIPATION_METHOD, collection_complete: true, active_participants: 2, attributed_volume_usd: 100 }));
  const response = buildParticipationResponse(protocols, rows, { period: '7d' });
  assert.equal(response.snapshotDate, '2026-10-07');
  assert.equal(response.coverage.total, 51);
  assert.equal(response.sufficientHistory, true);
  assert.equal(response.dailyHistory.length, 7);
  assert.equal(response.periodAggregateAvailable, false);
  assert.equal(response.protocols.at(-1).activeParticipants, null);
});

test('aggregate upsert includes nullable market identity and no raw participant data', async () => {
  const calls = [];
  const sql = async (strings, ...values) => { calls.push({ query: strings.join('?'), values }); return []; };
  const row = { marketId: null, ...distributionMetrics(new Map([['private-account', 10]])), ...reconciliation({ attributedVolumeUsd: 10 }) };
  await saveParticipation(sql, 1, { snapshotDate: '2026-10-06', ...window, participantType: 'ACCOUNT', rows: [row], diagnostics: {}, source: 'test', sourceType: 'PUBLIC', attribution: 'MAKER_TAKER_HALF_SPLIT', methodologyVersion: PARTICIPATION_METHOD, complete: true });
  assert.match(calls[0].query, /ON CONFLICT/);
  assert.match(calls[0].query, /COALESCE\(market_id/);
  assert.equal(JSON.stringify(calls).includes('private-account'), false);
});

test('retry/backoff honors 429 without duplicate attribution', async () => {
  let calls = 0;
  const delays = [];
  const success = fakeFetch([{ items: [raw()], nextStartInclusive: null }]);
  const fetchImpl = async (url) => {
    calls++;
    if (calls === 3) return { ok: false, status: 429, headers: { get: () => '2' } };
    return success(url);
  };
  const result = await collectN1Participation({ day: '2026-10-06', fetchImpl, waitImpl: async (ms) => delays.push(ms), requestDelayMs: 0 });
  assert.equal(result.diagnostics.retries, 1);
  assert.equal(result.diagnostics.accepted, 1);
  assert.deepEqual(delays, [2000]);
});

test('invalid distribution cannot silently become zero participation', () => {
  assert.throws(() => distributionMetrics(new Map([['a', Infinity]])), /Invalid/);
  assert.throws(() => distributionMetrics(new Map([['a', Number.MAX_VALUE], ['b', Number.MAX_VALUE]])), /overflow/);
});

test('malformed date or metric isolates one row without hiding valid protocols', () => {
  const protocols = [{ id: 1, slug: 'valid', name: 'Valid' }, { id: 2, slug: 'invalid', name: 'Invalid' }];
  const common = { market_id: null, methodology_version: PARTICIPATION_METHOD, collection_complete: true };
  const response = buildParticipationResponse(protocols, [{ ...common, protocol_id: 1, snapshot_date: '2026-10-06', active_participants: 2, attributed_volume_usd: 100 }, { ...common, protocol_id: 2, snapshot_date: '2026-99-99', active_participants: 9 }, { ...common, protocol_id: 2, snapshot_date: '2026-10-06', active_participants: -1, attributed_volume_usd: 'malformed' }]);
  assert.equal(response.snapshotDate, '2026-10-06');
  assert.equal(response.coverage.participantAvailable, 1);
  assert.equal(response.protocols[1].activeParticipants, null);
});
