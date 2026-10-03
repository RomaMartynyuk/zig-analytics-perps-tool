import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTickers } from '../api/tickers.js';
import { calculateLighterRobinhood } from '../src/lib/pointsCalculator.js';
import { getUtcWeeklySnapshotWindow } from '../src/lib/pointsSnapshots.js';
import projects from '../src/data/projects.json' with { type: 'json' };

test('LIT price remains available to Robinhood calculator when 24h change is missing', () => {
  const result = normalizeTickers({ lighter: { usd: 3.49 } });
  assert.equal(result.find((ticker) => ticker.ticker === 'LIT')?.price, 3.49);
});

test('Arcus weekly boundary is always Wednesday 19:00 UTC', () => {
  const arcus = projects.find((project) => project.name === 'Arcus');
  const cases = [
    ['2026-10-07T18:59:59Z', '2026-09-30T19:00:00.000Z', '2026-10-07T19:00:00.000Z'],
    ['2026-10-07T19:00:00Z', '2026-10-07T19:00:00.000Z', '2026-10-14T19:00:00.000Z'],
    ['2026-10-07T19:00:01Z', '2026-10-07T19:00:00.000Z', '2026-10-14T19:00:00.000Z'],
    ['2026-10-08T12:00:00Z', '2026-10-07T19:00:00.000Z', '2026-10-14T19:00:00.000Z'],
    ['2026-10-13T23:00:00Z', '2026-10-07T19:00:00.000Z', '2026-10-14T19:00:00.000Z'],
    ['2026-12-31T12:00:00Z', '2026-12-30T19:00:00.000Z', '2027-01-06T19:00:00.000Z'],
    ['2026-03-29T12:00:00Z', '2026-03-25T19:00:00.000Z', '2026-04-01T19:00:00.000Z'],
    ['2026-10-25T12:00:00Z', '2026-10-21T19:00:00.000Z', '2026-10-28T19:00:00.000Z'],
  ];
  for (const [now, previous, next] of cases) {
    const window = getUtcWeeklySnapshotWindow(arcus, new Date(now));
    assert.equal(window.previous.toISOString(), previous);
    assert.equal(window.next.toISOString(), next);
    assert.equal(window.remainingMs, new Date(next).getTime() - new Date(now).getTime());
  }
});

test('Robinhood formula keeps its configured economics and rejects unavailable inputs', () => {
  const calculation = calculateLighterRobinhood({ litPrice: 3.49, weeks: 12, personalPoints: '100' });
  assert.equal(calculation.campaignValue, 38_390_000);
  assert.equal(calculation.pointPrice, 38_390_000 / (65_000 * 12));
  assert.ok(Math.abs(calculation.personalAllocation - 100 * calculation.pointPrice) < 1e-9);
  assert.equal(calculateLighterRobinhood({ litPrice: null, weeks: 12 }).pointPrice, null);
  assert.equal(calculateLighterRobinhood({ litPrice: 3.49, weeks: 0 }).pointPrice, null);
  assert.equal(calculateLighterRobinhood({ litPrice: 3.49, weeks: 12, personalPoints: '-1' }).personalAllocation, null);
  assert.equal(calculateLighterRobinhood({ litPrice: 3.49, weeks: 12, personalPoints: '' }).personalAllocation, null);
  assert.equal(calculateLighterRobinhood({ litPrice: 1e308, weeks: 12 }).pointPrice, null);
  assert.equal(calculateLighterRobinhood({ litPrice: 3.49, weeks: 12, personalPoints: '1e308' }).personalAllocation, null);
});
