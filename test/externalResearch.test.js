import test from 'node:test';
import assert from 'node:assert/strict';
import { generateExternalQueries, normalizeExternalResults, researchWindow } from '../server/externalResearchService.js';

const context = {
  protocol: { id: 1, slug: 'alpha', name: 'Alpha' },
  case: { id: 'research:2026-09-04:alpha:turnover_structure', snapshotDate: '2026-09-04', period: 'current', family: 'turnover_structure' },
  window: researchWindow('2026-09-04', 'current', '7d'),
};
const metadata = { website: 'https://alpha.example', partners: ['https://partner.example'] };

test('external research anchors a current case to canonical UTC snapshot date', () => {
  assert.deepEqual(context.window, { key: '7d', from: '2026-08-28', to: '2026-09-05' });
  assert.ok(generateExternalQueries(context).some((item) => item.topic === 'trading competition'));
  const unknown = generateExternalQueries({ ...context, case: { ...context.case, family: 'future_family' } });
  assert.equal(unknown[0].topic, 'product update');
});

test('official, temporally aligned evidence ranks above secondary and old evidence is excluded', () => {
  const normalized = normalizeExternalResults([
    { title: 'Alpha launches trading competition', url: 'https://alpha.example/posts/campaign', sourceUrl: 'https://alpha.example/posts/campaign', sourceName: 'Alpha', publishedAt: '2026-09-02', summary: 'Alpha trading competition', topic: 'trading competition', category: 'TRADING_CAMPAIGN' },
    { title: 'Alpha campaign coverage', url: 'https://coindesk.com/alpha-campaign', sourceName: 'CoinDesk', publishedAt: '2026-08-31', summary: 'Alpha campaign', topic: 'trading competition', category: 'TRADING_CAMPAIGN' },
    { title: 'Alpha old release', url: 'https://alpha.example/posts/old', sourceUrl: 'https://alpha.example/posts/old', sourceName: 'Alpha', publishedAt: '2026-05-01', summary: 'Alpha old release', topic: 'product update', category: 'PRODUCT_UPDATE' },
  ], context, metadata);
  assert.equal(normalized.findings.length, 2);
  assert.equal(normalized.findings[0].sourceType, 'official');
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
