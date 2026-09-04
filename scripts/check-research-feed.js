import { getDailyResearchFeed } from '../server/researchFeedService.js';

const data = await getDailyResearchFeed({ limit: 5, status: 'all' });
const caseView = (item) => ({
  protocol: item.protocol.name,
  family: item.family,
  headline: item.headline,
  primarySignal: item.primarySignal.type,
  relatedSignals: item.relatedSignals.map((signal) => signal.type),
  score: item.score,
  severity: item.severity,
  evidence: item.evidence.map((evidence) => `${evidence.label}: ${evidence.formatted}`),
  status: item.status,
});

console.log(JSON.stringify({
  canonicalSnapshot: data.snapshotDate,
  coverage: data.coverage,
  history: data.history,
  engineSignals: data.diagnostics.engineSignals,
  supportingSignals: data.diagnostics.supportingSignals,
  signalsReceived: data.diagnostics.signalsReceived,
  casesGenerated: data.diagnostics.casesGenerated,
  casesDisplayed: data.cases.length,
  finalFeed: data.cases.map(caseView),
  suppressedCases: data.diagnostics.suppressedCases.map((item) => ({ protocol: item.protocol.name, headline: item.headline, score: item.score, reason: item.reason })),
  skippedSignals: data.diagnostics.skippedSignals,
}, null, 2));
