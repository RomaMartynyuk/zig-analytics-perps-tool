import { getDailyResearchFeed } from '../server/researchFeedService.js';
import { runExternalResearch } from '../server/externalResearchService.js';

const requested = process.argv[2]?.toLowerCase();
const feed = await getDailyResearchFeed({ limit: 20, status: 'all' });
const matches = feed.cases.filter((candidate) => candidate.id.toLowerCase() === requested || candidate.protocol.slug.toLowerCase() === requested);
const item = matches[0] || (!requested ? feed.cases[0] : null);
if (!item) throw new Error(`No current Research Case matched "${requested || ''}". Use a current case ID or protocol slug.`);
const result = await runExternalResearch({ caseId: item.id, persist: false });

console.log('EXTERNAL RESEARCH CHECK');
console.log('\nCASE');
console.log(`Protocol: ${item.protocol.name}`);
console.log(`Research Case: ${item.id}`);
console.log(`Signal Family: ${item.family}`);
console.log(`Snapshot: ${item.snapshotDate}`);
console.log('\nWINDOW');
console.log(`Start: ${result.researchWindow.from}`);
console.log(`End: ${result.researchWindow.to}`);
console.log('\nSEARCH PLAN');
result.queries.forEach((query, index) => console.log(`${index + 1}. ${query.query}${query.scope === 'official' ? ' [official-domain constrained]' : ''}${query.status ? ` · ${query.status} · ${query.resultCount} result(s)${query.durationMs == null ? '' : ` · ${query.durationMs}ms`}` : ''}`));
console.log('\nPROVIDER');
console.log(`${result.provider} · ${result.status}`);
console.log('\nRAW RESULTS');
console.log(`${result.summary.resultCount} normalized provider result(s); diagnostic mode did not persist data.`);
console.log('\nFINAL FINDINGS');
if (!result.findings.length) console.log('No strong external context found.');
result.findings.forEach((finding, index) => {
  console.log(`\n#${index + 1}`);
  console.log(`Category: ${finding.category}`);
  console.log(`Date: ${finding.eventDate || finding.publishedAt || 'Unavailable'}`);
  console.log(`Source: ${finding.sourceName}`);
  console.log(`Source Type: ${finding.sourceType}`);
  console.log(`Relevance: ${finding.relevanceScore}`);
  console.log(`Confidence: ${finding.confidence}`);
  console.log(`Summary: ${finding.factualSummary}`);
  console.log(`Why relevant: ${finding.possibleRelevance}`);
});
console.log('\nSUPPRESSED');
if (!result.suppressed.length) console.log('None');
result.suppressed.forEach((entry) => console.log(`${entry.title}: ${entry.reason}`));
if (result.partialErrors.length) {
  console.log('\nPROVIDER FAILURES');
  result.partialErrors.forEach((entry) => console.log(`${entry.query || 'provider'}: ${entry.error}`));
}
