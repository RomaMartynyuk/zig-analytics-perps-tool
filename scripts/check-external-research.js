import { getDailyResearchFeed } from '../server/researchFeedService.js';
import { runExternalResearch } from '../server/externalResearchService.js';

const requested = process.argv[2]?.toLowerCase();
const feed = await getDailyResearchFeed({ limit: 20, status: 'all' });
const item = feed.cases.find((candidate) => candidate.id.toLowerCase() === requested || candidate.protocol.slug.toLowerCase() === requested) || feed.cases[0];
if (!item) throw new Error('No current research case is available');
const result = await runExternalResearch({ caseId: item.id, persist: false });
console.log(JSON.stringify({
  case: { id: item.id, protocol: item.protocol.name, signal: item.headline, snapshot: item.snapshotDate },
  window: result.researchWindow,
  provider: result.provider,
  queries: result.queries,
  rawResults: 'Provider results are normalized in-memory; no production rows were written.',
  normalizedEvents: result.findings.length,
  finalFindings: result.findings.map((finding) => ({ category: finding.category, date: finding.eventDate || finding.publishedAt || 'Date unavailable', source: finding.sourceName, sourceType: finding.sourceType, relevance: finding.relevance, confidence: finding.confidence, title: finding.title, whyRelevant: finding.relevanceExplanation })),
  suppressed: result.suppressed,
  partialErrors: result.partialErrors,
}, null, 2));
