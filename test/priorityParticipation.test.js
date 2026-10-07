import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeArcusTrade, arcusDailyVolume, collectArcusParticipation } from '../server/arcusParticipationAdapter.js';
import { normalizeLighterTrade, lighterDailyVolume, collectLighterParticipation } from '../server/lighterParticipationAdapter.js';
import { collectParticipation } from '../server/participationCollector.js';
import { buildParticipationResponse, getParticipationAnalytics } from '../server/participationService.js';
import { publicRequester } from '../server/participationTape.js';

const day = '2026-10-06';
const start = Date.parse(`${day}T00:00:00Z`);
const address = (n) => `0x${n.toString(16).padStart(40, '0')}`;
const market = { id: 1, name: 'BTC-USD' };
const arcusTrade = (id = '1', timestamp = start * 1000 + 1000000) => ({ marketId: 1, tradeId: id, price: '50000', size: '0.01', timestamp, makerAddress: address(10), takerAddress: address(11) });
const arcusCatalog = { markets: [{ marketId: 1, marketDisplayName: 'BTC-USD', quoteAsset: 'USD', type: 'PERPETUAL' }, { marketId: 2, type: 'SPOT', quoteAsset: 'USD' }] };
const bar = (notionalVolume = '500') => ({ marketId: 1, timeframe: '1d', openTime: start * 1000, notionalVolume, isFinal: true });
const response = (payload) => ({ ok: true, json: async () => payload });

test('Arcus uses human USD/base units, microsecond time and case-insensitive address identities', () => {
  const raw = arcusTrade();
  const result = normalizeArcusTrade(raw, market, 'salt');
  assert.equal(result.volumeUsd, 500);
  assert.equal(result.timestamp, `${day}T00:00:01.000Z`);
  assert.equal(result.maker, normalizeArcusTrade({ ...raw, makerAddress: raw.makerAddress.toUpperCase().replace('0X', '0x') }, market, 'salt').maker);
  assert.equal(normalizeArcusTrade({ ...raw, makerAddress: 'invalid' }, market, 'salt'), null);
  assert.equal(normalizeArcusTrade({ ...raw, price: '-1' }, market, 'salt'), null);
});

test('Arcus daily denominator selects only exact finalized notional candle, not base volume or next day', () => {
  assert.equal(arcusDailyVolume({ candles: [bar(), { ...bar('999'), openTime: start * 1000 + 86400000000, isFinal: false }] }, market, start * 1000), 500);
  assert.equal(arcusDailyVolume({ candles: [{ ...bar(), isFinal: false }] }, market, start * 1000), null);
  assert.equal(arcusDailyVolume({ candles: [bar(), bar()] }, market, start * 1000), null);
  assert.equal(arcusDailyVolume({ candles: [{ ...bar(), notionalVolume: undefined, volume: '500' }] }, market, start * 1000), null);
});

test('Arcus resumes separate trade/candle stages, excludes spot and publishes reconciled concentration', async () => {
  const fetchImpl = async (url) => response(url.endsWith('/v1/markets') ? arcusCatalog : url.includes('/v1/trades?') ? { trades: [arcusTrade()] } : { candles: [bar()] });
  const partial = await collectArcusParticipation({ day, maxPages: 1, fetchImpl, requestDelayMs: 0 });
  assert.equal(partial.complete, false);
  assert.equal(partial.rows[0].activeParticipants, null);
  assert.equal(partial.checkpoint.markets.length, 1);
  const full = await collectArcusParticipation({ day, checkpoint: partial.checkpoint, maxPages: 2, fetchImpl, requestDelayMs: 0 });
  assert.equal(full.complete, true);
  assert.equal(full.rows[0].coverageRatio, 1);
  assert.equal(full.rows[0].hhi, 0.5);
  assert.equal(full.rows[0].activeParticipants, 2);
  assert.equal(full.rows[0].top1Share, 50);
  assert.equal(full.rows[0].signalEligible, false);
  assert.equal(full.rows[1].coverageRatio, 1);
  assert.equal(full.participantType, 'ADDRESS');
});

test('Arcus inclusive page boundary deduplicates trades; timestamp saturation never skips fills', async () => {
  const fullPage = Array.from({ length: 1000 }, (_, i) => arcusTrade(String(i), start * 1000 + 2000000 - i));
  let page = 0;
  const fetchImpl = async (url) => response(url.endsWith('/v1/markets') ? arcusCatalog : url.includes('/v1/candles?') ? { candles: [bar('500000')] } : { trades: page++ === 0 ? fullPage : [fullPage.at(-1)] });
  const full = await collectArcusParticipation({ day, maxPages: 5, fetchImpl, requestDelayMs: 0 });
  assert.equal(full.diagnostics.accepted, 1000);
  assert.equal(full.diagnostics.duplicates, 1);
  assert.equal(full.rows[0].coverageRatio, 1);
  const saturatedFetch = async (url) => response(url.endsWith('/v1/markets') ? arcusCatalog : { trades: Array.from({ length: 1000 }, (_, i) => arcusTrade(String(i), start * 1000 + 1000000)) });
  const saturated = await collectArcusParticipation({ day, maxPages: 4, fetchImpl: saturatedFetch, requestDelayMs: 0 });
  assert.equal(saturated.complete, false);
  assert.match(saturated.reason, /boundary gap/);
  assert.equal(saturated.rows[0].hhi, null);
});

test('missing or mismatched Arcus daily denominator never becomes a fabricated coverage value', async () => {
  for (const candles of [[], [bar('5000')]]) {
    const result = await collectArcusParticipation({ day, maxPages: 5, requestDelayMs: 0, fetchImpl: async (url) => response(url.endsWith('/v1/markets') ? arcusCatalog : url.includes('/v1/trades?') ? { trades: [arcusTrade()] } : { candles }) });
    assert.equal(result.rows[0].hhi, null);
    assert.equal(result.rows[0].activeParticipants, 2);
    assert.equal(result.rows[0].qualityState, candles.length ? 'LOW' : 'UNAVAILABLE');
  }
});

test('a missing Arcus market candle blocks protocol-wide reconciliation but not a validated market scope', async () => {
  const catalog = { markets: [...arcusCatalog.markets, { marketId: 3, marketDisplayName: 'EMPTY-USD', quoteAsset: 'USD', type: 'PERPETUAL' }] };
  const result = await collectArcusParticipation({ day, requestDelayMs: 0, maxPages: 10, fetchImpl: async (url) => response(url.endsWith('/v1/markets') ? catalog : url.includes('market=EMPTY-USD') ? (url.includes('/trades?') ? { trades: [] } : { candles: [] }) : url.includes('/trades?') ? { trades: [arcusTrade()] } : { candles: [bar()] }) });
  assert.equal(result.complete, true);
  assert.equal(result.rows[0].activeParticipants, 2);
  assert.equal(result.rows[0].coverageRatio, null);
  assert.equal(result.rows[0].hhi, null);
  assert.equal(result.rows.find((row) => row.marketId === '1').hhi, 0.5);
});

test('Arcus precise retryAfterMs and adaptive pacing survive a checkpoint', async () => {
  let attempts = 0;
  const waits = [];
  const result = await collectArcusParticipation({ day, requestDelayMs: 0, maxPages: 5, waitImpl: async (delay) => waits.push(delay), fetchImpl: async (url) => {
    if (url.endsWith('/v1/markets')) return response(arcusCatalog);
    if (url.includes('/candles?')) return response({ candles: [bar()] });
    if (!attempts++) return { ok: false, status: 429, headers: { get: () => null }, json: async () => ({ retryAfterMs: 2500 }) };
    return response({ trades: [arcusTrade()] });
  } });
  assert.equal(result.complete, true);
  assert.ok(waits.includes(2500));
  assert.equal(result.diagnostics.retryStatuses['429'], 1);
  assert.equal(result.checkpoint.requestDelayMs, 1000);
});

const lighterTrade = (changes = {}) => ({ market_id: 1, market_kind: 'perps', trade_id_str: '90071992547409999', usd_amount: '500', timestamp: start + 1000, ask_account_id: 0, bid_account_id: 20, is_maker_ask: true, type: 'trade', ...changes });
const lighterCatalog = { code: 200, order_books: [{ market_id: 1, market_type: 'perp', symbol: 'BTC' }, { market_id: 2000, market_type: 'spot', symbol: 'LIT' }] };

test('Lighter preserves string trade IDs, account zero, USD amount and maker direction; invalid/spot excluded', () => {
  const normalized = normalizeLighterTrade(lighterTrade(), [market], 'salt');
  assert.equal(normalized.volumeUsd, 500);
  assert.match(normalized.id, /90071992547409999$/);
  assert.equal(normalized.maker, normalizeLighterTrade(lighterTrade({ is_maker_ask: false }), [market], 'salt').taker);
  for (const changes of [{ market_kind: 'spot' }, { ask_account_id: Number.MAX_SAFE_INTEGER + 1 }, { usd_amount: '-1' }, { timestamp: Number.MAX_SAFE_INTEGER }, { type: 'unknown' }]) assert.equal(normalizeLighterTrade(lighterTrade(changes), [market], 'salt'), null);
  assert.equal(lighterDailyVolume({ c: [{ t: start, V: 500, v: 100000 }] }, start), 500);
  assert.equal(lighterDailyVolume({ c: [{ t: start + 86400000, V: 500 }] }, start), null);
});

test('Lighter frozen upper bound, cursor resume, lower-day cutoff and daily quote denominator', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.endsWith('/orderBooks')) return response(lighterCatalog);
    if (url.includes('/candles?')) return response({ code: 200, c: [{ t: start, V: 500 }] });
    return response(url.includes('cursor=older') ? { code: 200, trades: [lighterTrade({ timestamp: start - 1, trade_id_str: '2' })], next_cursor: 'unused' } : { code: 200, trades: [lighterTrade()], next_cursor: 'older' });
  };
  const partial = await collectLighterParticipation({ day, maxPages: 1, fetchImpl, requestDelayMs: 0 });
  assert.equal(partial.complete, false);
  assert.equal(partial.rows[0].activeParticipants, null);
  const full = await collectLighterParticipation({ day, checkpoint: partial.checkpoint, maxPages: 5, fetchImpl, requestDelayMs: 0 });
  assert.equal(full.rows[0].coverageRatio, 1);
  assert.equal(full.rows[0].hhi, 0.5);
  assert.equal(full.diagnostics.accepted, 1);
  assert.ok(urls.some((url) => url.includes(`from=${start + 86400000 - 1}`)));
  assert.ok(urls.some((url) => url.includes('market_type=perp')));
  assert.ok(urls.some((url) => url.includes('set_timestamp_to_end=false')));
  assert.equal(full.participantType, 'ACCOUNT');
});

test('Lighter rejects invalid historical bounds and stagnant cursor without publishing partial population', async () => {
  const fetchImpl = async (url) => response(url.endsWith('/orderBooks') ? lighterCatalog : { code: 200, trades: [lighterTrade()], next_cursor: 'stuck' });
  const result = await collectLighterParticipation({ day, maxPages: 4, requestDelayMs: 0, fetchImpl });
  assert.equal(result.complete, false);
  assert.equal(result.rows[0].hhi, null);
  assert.match(result.reason, /cursor/);
  await assert.rejects(collectLighterParticipation({ day, requestDelayMs: 0, fetchImpl: async (url) => response(url.endsWith('/orderBooks') ? lighterCatalog : { code: 200, trades: [lighterTrade({ timestamp: start + 86400000 })] }) }), /bounds/);
});

test('Variational remains explicitly unavailable, not inferred from aggregate volume; failure isolation preserved', async () => {
  const protocols = [{ slug: 'arcus', isActive: true }, { slug: 'lighter', isActive: true }, { slug: 'variational', isActive: true }];
  const summary = await collectParticipation({ protocols, adapters: { arcus: async () => { throw new Error('API down'); }, lighter: async () => ({ complete: true }) } });
  assert.equal(summary.failed.length, 1);
  assert.equal(summary.saved.length, 1);
  assert.match(summary.unavailableReasons.variational, /No public global execution tape/);
  const data = buildParticipationResponse([{ id: 1, slug: 'variational', name: 'Variational' }], []);
  assert.equal(data.protocols[0].activeParticipants, null);
  assert.match(data.protocols[0].reason, /aggregate market stats only/);
});

test('Lighter documented 405 rate-limit backs off for firewall cooldown, not a tight retry loop', async () => {
  let calls = 0;
  const waits = [];
  const fetchImpl = async (url) => {
    if (url.endsWith('/orderBooks')) return response(lighterCatalog);
    if (url.includes('/candles?')) return response({ code: 200, c: [{ t: start, V: 500 }] });
    if (calls++ === 0) return { ok: false, status: 405, headers: { get: () => null } };
    return response({ code: 200, trades: [lighterTrade()] });
  };
  const result = await collectLighterParticipation({ day, maxPages: 5, maxDurationMs: 120000, fetchImpl, requestDelayMs: 0, waitImpl: async (delay) => waits.push(delay) });
  assert.equal(result.complete, true);
  assert.equal(result.diagnostics.retries, 1);
  assert.ok(waits.includes(60000));
  assert.equal(result.diagnostics.accepted, 1);
});

test('public request budget prevents a retry/cooldown beyond the bounded run', async () => {
  const stats = { apiCalls: 0, retries: 0 };
  const request = publicRequester('https://example.invalid', { requestDelayMs: 0, deadline: Date.now() - 1, fetchImpl: async () => { throw new Error('must not run'); } }, stats);
  await assert.rejects(request('/trades'), /budget/);
  assert.equal(stats.apiCalls, 0);
});

test('long provider cooldown is never shortened to make extra requests', async () => {
  const stats = { apiCalls: 0, retries: 0 };
  const request = publicRequester('https://example.invalid', { requestDelayMs: 0, fetchImpl: async () => ({ ok: false, status: 429, headers: { get: () => '120' } }), waitImpl: async () => { throw new Error('must not wait/retry early'); } }, stats);
  await assert.rejects(request('/trades'), /120s cooldown/);
  assert.equal(stats.apiCalls, 1);
  assert.equal(stats.retries, 0);
});

test('numeric market IDs require an explicit protocol scope; never compare unrelated same-ID markets', async () => {
  const sql = async () => [];
  await assert.rejects(getParticipationAnalytics({ marketId: '1', sql }), /protocol-local/);
  const response = await getParticipationAnalytics({ marketId: '1', protocolSlug: 'arcus', sql });
  assert.equal(response.protocolSlug, 'arcus');
  assert.equal(response.marketId, '1');
  assert.equal(response.coverage.total, 0);
  await assert.rejects(getParticipationAnalytics({ protocolSlug: 'bad slug', sql }), /Invalid protocol/);
});
