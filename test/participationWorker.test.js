import test from 'node:test';
import assert from 'node:assert/strict';
import { dueParticipationDay, participationJobDays, selectParticipationProtocols,
  acquireParticipationLease, renewParticipationLease, releaseParticipationLease,
  participationDayComplete, participationWakeDelay, runParticipationRound } from '../server/participationWorker.js';

const now = new Date('2026-10-07T12:00:00Z');
const protocols = [{ slug: 'arcus', isActive: true }, { slug: 'lighter', isActive: true }, { slug: 'variational', isActive: true }];
const round = (options = {}) => runParticipationRound({ protocols, startDay: '2026-10-06', now,
  completed: async () => false, runBatch: async () => 0, ...options });

test('worker advances trade day only at noon UTC, independent of local timezone', () => {
  assert.equal(dueParticipationDay(new Date('2026-10-07T11:59:59Z')), '2026-10-05');
  assert.equal(dueParticipationDay(now), '2026-10-06');
  assert.equal(dueParticipationDay(new Date('2026-10-07T15:00:00+03:00')), '2026-10-06');
  assert.equal(dueParticipationDay(new Date('2027-01-01T12:00:00Z')), '2026-12-31');
});

test('worker waits for first noon and bounds recovery to three real completed days', () => {
  assert.deepEqual(participationJobDays('2026-10-06', new Date('2026-10-07T11:59:59Z')), []);
  assert.deepEqual(participationJobDays('2026-01-01', now), ['2026-10-04', '2026-10-05', '2026-10-06']);
  assert.throws(() => participationJobDays('2026-02-30', now), /Invalid UTC/);
});

test('worker selection uses central active registry and accepts future integrations', () => {
  const registry = [...protocols, { slug: 'future-dex', isActive: true }, { slug: 'old', isActive: false }];
  assert.deepEqual(selectParticipationProtocols(registry, 'future-dex,arcus').map((row) => row.slug), ['arcus', 'future-dex']);
  assert.throws(() => selectParticipationProtocols(registry, 'old'), /inactive/);
  assert.throws(() => selectParticipationProtocols(registry, ''), /No participation/);
});

test('completed canonical days are skipped without calling protocol API', async () => {
  const result = await round({ completed: async () => true, runBatch: () => { throw new Error('Must not fetch'); } });
  assert.equal(result.skipped, 2);
  assert.equal(result.unavailable[0].slug, 'variational');
});

test('partial days resume as same day and one venue does not monopolize a round', async () => {
  const calls = [];
  const result = await round({ runBatch: async (slug, day) => { calls.push([slug, day]); return 0; } });
  assert.deepEqual(calls, [['arcus', '2026-10-06'], ['lighter', '2026-10-06']]);
  assert.equal(result.partial, 2);
});

test('one failed venue does not stop another and retry cooldown prevents request storms', async () => {
  const cooldowns = new Map();
  let calls = 0;
  const runBatch = async (slug) => { calls++; if (slug === 'arcus') throw new Error('API failure'); return 0; };
  const result = await round({ cooldowns, runBatch });
  assert.equal(result.failed, 1); assert.equal(result.partial, 1);
  const retry = await round({ cooldowns, runBatch });
  assert.equal(retry.skipped, 2); assert.equal(calls, 2);
});

test('unsafe pagination is blocked, not retried continuously or marked complete', async () => {
  const cooldowns = new Map();
  const result = await round({ protocols: protocols.slice(0, 1), cooldowns, runBatch: async () => 2 });
  assert.equal(result.blocked, 1); assert.equal(result.complete, 0);
  assert.ok(cooldowns.get('arcus:2026-10-06') >= now.getTime() + 6 * 3600000);
});

test('only persisted complete DB result marks a job complete', async () => {
  let done = false;
  const result = await round({ protocols: protocols.slice(0, 1), completed: async () => done,
    runBatch: async () => { done = true; return 0; } });
  assert.equal(result.complete, 1); assert.equal(result.partial, 0);
});

test('shutdown cancels remaining batches', async () => {
  const abort = new AbortController();
  let calls = 0;
  await round({ signal: abort.signal, runBatch: async () => { calls++; abort.abort(); return 1; } });
  assert.equal(calls, 1);
});

test('database lease is atomic, owner-scoped and expires for crash recovery', async () => {
  const queries = [];
  const sql = async (strings, ...values) => { queries.push({ text: strings.join('?'), values }); return [{ owner: 'owner' }]; };
  assert.equal(await acquireParticipationLease(sql, 'owner'), true);
  assert.match(queries[0].text, /WHERE participation_worker_leases.expires_at <= NOW\(\)/);
  assert.equal(await renewParticipationLease(sql, 'owner'), true);
  assert.match(queries[1].text, /AND owner = \? AND expires_at > NOW\(\)/);
  await releaseParticipationLease(sql, 'owner');
  assert.match(queries[2].text, /AND owner = \?/);
  assert.equal(await acquireParticipationLease(async () => [], 'other-owner'), false);
  assert.equal(await renewParticipationLease(async () => [], 'old-owner'), false);
});

test('completion query respects exact day, protocol, methodology and active status', async () => {
  const sql = async (strings, ...values) => {
    const query = strings.join('?');
    assert.match(query, /p.is_active = TRUE/); assert.match(query, /d.market_id IS NULL/);
    assert.ok(values.includes('2026-10-06')); assert.ok(values.includes('arcus'));
    return [{ collection_complete: false }];
  };
  assert.equal(await participationDayComplete(sql, 'arcus', '2026-10-06'), false);
});

test('idle worker releases lease and sleeps until next noon instead of keeping Neon awake', () => {
  assert.equal(participationWakeDelay({ skipped: 2 }, new Map(), now), 86400000);
  assert.equal(participationWakeDelay({ partial: 1 }, new Map([['arcus:day', now.getTime() + 60000]]), now), 60000);
  assert.equal(participationWakeDelay(undefined, new Map(), now), 60000);
  assert.equal(participationWakeDelay({ skipped: 2 }, new Map(), new Date('2026-10-07T11:59:00Z')), 60000);
});
