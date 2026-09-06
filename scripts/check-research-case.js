import { getDailyResearchFeed } from '../server/researchFeedService.js';
import { getResearchCaseDetail } from '../server/researchCaseDetailService.js';

const requested = process.argv[2]?.toLowerCase();
const feed = await getDailyResearchFeed({ limit: 20, status: 'all' });
const item = feed.cases.find((candidate) => candidate.id.toLowerCase() === requested || candidate.protocol.slug.toLowerCase() === requested) || feed.cases[0];
if (!item) throw new Error('No current research case is available');
const detail = await getResearchCaseDetail(item.id);
if (!detail) throw new Error('Current research case could not be reconstructed');
console.log(JSON.stringify({
  case: { id: detail.case.id, protocol: detail.protocol.name, headline: detail.case.headline, score: detail.case.score, severity: detail.case.severity, snapshot: detail.snapshot.date },
  whyFlagged: detail.case.evidence,
  currentMetrics: detail.metrics,
  peerContext: detail.peerContext,
  history: detail.history.availability,
  relatedSignals: detail.relatedSignals.map((signal) => ({ type: signal.type, score: signal.score })),
  questions: detail.case.questions,
  sources: detail.sources,
}, null, 2));
