import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SOURCE_TYPES,
  classifyExternalSource,
  createExternalResearchProvider,
  executeExternalResearchPlan,
  externalResearchRunStatus,
  generateExternalQueries,
  getLatestExternalResearch,
  normalizeExternalResults,
  researchWindow,
  safeExternalUrl,
} from '../server/externalResearchService.js';

const context = {
  protocol: { id: 1, slug: 'alpha', name: 'Alpha' },
  case: { id: 'research:2026-09-04:alpha:turnover_structure', snapshotDate: '2026-09-04', period: 'current', family: 'turnover_structure' },
  window: researchWindow('2026-09-04', 'current', '7d'),
};
const metadata = { website: 'https://alpha.example', partners: ['https://partner.example'] };

test('external research anchors default windows to canonical UTC snapshot date and case period', () => {
  assert.deepEqual(context.window, { key: '7d', from: '2026-08-28', to: '2026-09-05', lookbackDays: 7 });
  assert.deepEqual(researchWindow('2026-09-04', 'current', 'default'), { key: 'default', from: '2026-08-28', to: '2026-09-05', lookbackDays: 7 });
  assert.deepEqual(researchWindow('2026-09-04', '7d', 'default'), { key: 'default', from: '2026-08-21', to: '2026-09-05', lookbackDays: 14 });
  assert.deepEqual(researchWindow('2026-09-04', '30d', 'default'), { key: 'default', from: '2026-07-31', to: '2026-09-05', lookbackDays: 35 });
  assert.deepEqual(researchWindow('2026-09-04', '90d', 'default'), { key: 'default', from: '2026-05-27', to: '2026-09-05', lookbackDays: 100 });
  assert.ok(generateExternalQueries(context).some((item) => item.topic === 'trading competition'));
  const unknown = generateExternalQueries({ ...context, case: { ...context.case, family: 'future_family' } });
  assert.equal(unknown[0].topic, 'announcement');
});

test('official, temporally aligned evidence ranks above secondary and old evidence is excluded', () => {
  const normalized = normalizeExternalResults([
    { title: 'Alpha launches trading competition', url: 'https://alpha.example/posts/campaign', sourceUrl: 'https://alpha.example/posts/campaign', sourceName: 'Alpha', publishedAt: '2026-09-02', summary: 'Alpha trading competition', topic: 'trading competition', category: 'TRADING_CAMPAIGN' },
    { title: 'Alpha campaign coverage', url: 'https://coindesk.com/alpha-campaign', sourceName: 'CoinDesk', publishedAt: '2026-08-31', summary: 'Alpha campaign', topic: 'trading competition', category: 'TRADING_CAMPAIGN' },
    { title: 'Alpha old release', url: 'https://alpha.example/posts/old', sourceUrl: 'https://alpha.example/posts/old', sourceName: 'Alpha', publishedAt: '2026-05-01', summary: 'Alpha old release', topic: 'product update', category: 'PRODUCT_UPDATE' },
  ], context, metadata);
  assert.equal(normalized.findings.length, 2);
  assert.equal(normalized.findings[0].sourceType, SOURCE_TYPES.OFFICIAL_PROTOCOL);
  assert.equal(normalized.findings[0].confidence, 'HIGH');
  assert.ok(normalized.findings[0].relevance > normalized.findings[1].relevance);
  assert.ok(normalized.suppressed.some((item) => item.reason === 'outside_research_window'));
  assert.doesNotMatch(normalized.findings[0].possibleRelevance, /caused|proved|because of/i);
});

test('duplicate coverage merges into one event with supporting sources', () => {
  const normalized = normalizeExternalResults([
    { title: 'Alpha launches new markets', url: 'https://alpha.example/posts/markets', sourceUrl: 'https://alpha.example/posts/markets', sourceName: 'Alpha', publishedAt: '2026-09-03', summary: 'Alpha launches new markets', topic: 'new markets', category: 'NEW_MARKET' },
    { title: 'Alpha launches new markets', url: 'https://coindesk.com/alpha-markets', sourceName: 'CoinDesk', publishedAt: '2026-09-03', summary: 'Coverage of Alpha launches new markets', topic: 'new markets', category: 'NEW_MARKET' },
  ], context, metadata);
  assert.equal(normalized.findings.length, 1);
  assert.equal(normalized.findings[0].supportingSources.length, 1);
  assert.ok(normalized.suppressed.some((item) => item.reason === 'duplicate_event'));
});

test('irrelevant or malformed results do not break valid normalized events', () => {
  const normalized = normalizeExternalResults([
    { title: '', url: 'javascript:alert(1)', publishedAt: '2026-09-03', topic: 'product update' },
    { title: 'Alpha product update announced', url: 'https://unknown.example/update', publishedAt: '2026-09-03', summary: '', topic: 'product update', category: 'PRODUCT_UPDATE' },
  ], context, metadata);
  assert.equal(normalized.findings.length, 1);
  assert.equal(normalized.findings[0].causalClaim, false);
  assert.ok(normalized.suppressed.some((item) => item.reason === 'malformed_result'));
});

test('source classification uses central metadata and never treats a name mention as official', () => {
  const sourceMetadata = { website: 'https://alpha.example', docs: 'https://docs.alpha.example', xHandle: '@alpha', partners: ['https://partner.example'], governance: ['https://gov.alpha.example'] };
  assert.equal(classifyExternalSource({ url: 'https://alpha.example/blog' }, sourceMetadata), SOURCE_TYPES.OFFICIAL_PROTOCOL);
  assert.equal(classifyExternalSource({ url: 'https://x.com/alpha/status/1' }, sourceMetadata), SOURCE_TYPES.OFFICIAL_PROTOCOL);
  assert.equal(classifyExternalSource({ url: 'https://partner.example/news' }, sourceMetadata), SOURCE_TYPES.OFFICIAL_PARTNER);
  assert.equal(classifyExternalSource({ url: 'https://gov.alpha.example/proposal' }, sourceMetadata), SOURCE_TYPES.GOVERNANCE);
  assert.equal(classifyExternalSource({ url: 'https://coindesk.com/alpha' }, sourceMetadata), SOURCE_TYPES.MEDIA);
  assert.equal(classifyExternalSource({ url: 'https://random.example/alpha-official' }, sourceMetadata), SOURCE_TYPES.OTHER);
});

test('unsafe provider URLs are rejected without affecting valid results', () => {
  for (const url of ['file:///etc/passwd', 'data:text/plain,test', 'http://localhost/a', 'http://127.0.0.1/a', 'http://10.0.0.1/a', 'http://[::1]/a']) assert.equal(safeExternalUrl(url), null);
  assert.equal(safeExternalUrl('https://alpha.example/news')?.hostname, 'alpha.example');
});

test('market-share plans add at most one dynamic competitor query', () => {
  const queries = generateExternalQueries({ ...context, case: { ...context.case, family: 'market_share_gain' }, competitors: [{ slug: 'beta', name: 'Beta' }] }, metadata);
  assert.equal(queries.filter((item) => item.scope === 'competitor').length, 1);
  assert.ok(queries.length <= 7);
  assert.match(queries.at(-1).query, /Beta/);
  assert.equal(queries[0].topic, 'product update');
});

test('a new protocol and unknown signal family receive a generic plan automatically', () => {
  const queries = generateExternalQueries({ ...context, protocol: { id: 99, slug: 'new-dex', name: 'New DEX' }, case: { ...context.case, family: 'SOME_FUTURE_FAMILY' } });
  assert.ok(queries.length >= 5);
  assert.ok(queries.every((item) => item.query.includes('New DEX')));
});

test('run status distinguishes zero results, partial failure, and provider outage', async () => {
  assert.equal(externalResearchRunStatus(6, 0), 'COMPLETED');
  assert.equal(externalResearchRunStatus(4, 2), 'PARTIAL');
  assert.equal(externalResearchRunStatus(0, 6), 'FAILED');
  const noResults = await executeExternalResearchPlan({ queryRows: [{ query: 'Alpha update', topic: 'product update', scope: 'web' }], provider: { name: 'mock', configured: true, search: async () => [] }, context, metadata });
  assert.equal(noResults.status, 'COMPLETED');
  assert.deepEqual(noResults.findings, []);
});

test('partial provider failure preserves successful normalized findings', async () => {
  const queryRows = [{ query: 'good', topic: 'product update', scope: 'web' }, { query: 'bad', topic: 'product update', scope: 'web' }];
  const provider = { name: 'mock', configured: true, search: async (query) => { if (query === 'bad') throw new Error('timeout'); return [{ title: 'Alpha product update announced Sep 3', url: 'https://alpha.example/update', publishedAt: '2026-09-03', summary: 'Alpha announced a product update on Sep 3.' }]; } };
  const result = await executeExternalResearchPlan({ queryRows, provider, context, metadata });
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.findings.length, 1);
  assert.equal(result.partialErrors.length, 1);
});

test('complete provider outage is FAILED and does not fabricate findings', async () => {
  const result = await executeExternalResearchPlan({ queryRows: [{ query: 'a', topic: 'announcement', scope: 'web' }], provider: { name: 'mock', configured: true, search: async () => { throw new Error('offline'); } }, context, metadata });
  assert.equal(result.status, 'FAILED');
  assert.deepEqual(result.findings, []);
});

test('Tavily provider sends canonical date bounds and key only in authorization header', async () => {
  let request;
  const provider = createExternalResearchProvider({ tavilyKey: 'secret-test-key', fetchImpl: async (url, options) => { request = { url, options }; return { ok: true, json: async () => ({ results: [] }), headers: new Headers() }; } });
  await provider.search('Alpha update', { from: '2026-08-28', to: '2026-09-05', includeDomains: ['alpha.example'], limit: 5 });
  const body = JSON.parse(request.options.body);
  assert.equal(request.options.headers.Authorization, 'Bearer secret-test-key');
  assert.doesNotMatch(request.options.body, /secret-test-key/);
  assert.equal(body.start_date, '2026-08-28');
  assert.equal(body.end_date, '2026-09-05');
  assert.deepEqual(body.include_domains, ['alpha.example']);
});

test('cache lookup is scoped by case, window, research version, and cacheable status', async () => {
  const calls = [];
  const sql = { query: async (query, values) => { calls.push({ query, values }); return []; } };
  const result = await getLatestExternalResearch(context.case.id, sql, { windowKey: 'default', researchVersion: 'v2', cacheableOnly: true });
  assert.equal(result, null);
  assert.match(calls[0].query, /window_key/);
  assert.match(calls[0].query, /research_version/);
  assert.match(calls[0].query, /COMPLETED.*PARTIAL/);
  assert.deepEqual(calls[0].values, [context.case.id, 'default', 'v2']);
});
