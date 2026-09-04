import { getSignals, getVolumeOiAnalysis } from '../server/analyticsService.js';

function percentile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
}

function groupCount(items, key) {
  return Object.fromEntries(items.reduce((map, item) => map.set(item[key], (map.get(item[key]) || 0) + 1), new Map()));
}

const [data, current] = await Promise.all([
  getSignals({ period: 'all', category: 'all', limit: 20, diagnostic: true }),
  getVolumeOiAnalysis(),
]);
const ratios = current.protocols.map((item) => item.volumeOiRatio);
const gaps = current.protocols.map((item) => Math.abs(item.shareGapPp));
const printSignal = (item) => ({ protocol: item.protocolName, type: item.type, score: item.score, severity: item.severity, raw: item.evidence.map((entry) => `${entry.label}: ${entry.formatted}`).join(' · '), baseline: item.comparison?.formatted || null, reason: item.suppressedBy || null });

console.log(JSON.stringify({
  canonicalSnapshot: { date: data.snapshotDate, activeProtocols: data.coverage.total },
  coverage: { volume: `${data.coverage.volumeAvailable}/${data.coverage.total}`, openInterest: `${data.coverage.oiAvailable}/${data.coverage.total}`, tvl: `${data.coverage.tvlAvailable}/${data.coverage.total}` },
  peerSamples: { volumeOi: current.coverage.scatterEligible, shareGap: current.coverage.scatterEligible, rankMismatch: current.coverage.scatterEligible },
  peerStatistics: { volumeOi: { min: Math.min(...ratios), median: percentile(ratios, .5), p75: percentile(ratios, .75), p90: percentile(ratios, .9), max: Math.max(...ratios) }, absoluteShareGapPp: { median: percentile(gaps, .5), p75: percentile(gaps, .75), p90: percentile(gaps, .9), max: Math.max(...gaps) } },
  historicalAvailability: data.history,
  candidates: {
    raw: data.diagnostics.rawCandidates.length,
    byType: groupCount(data.diagnostics.rawCandidates, 'type'),
    scoreDistribution: {
      min: Math.min(...data.diagnostics.rawCandidates.map((item) => item.score)),
      median: percentile(data.diagnostics.rawCandidates.map((item) => item.score), .5),
      p90: percentile(data.diagnostics.rawCandidates.map((item) => item.score), .9),
      max: Math.max(...data.diagnostics.rawCandidates.map((item) => item.score)),
    },
    qualityThreshold: data.diagnostics.qualityThreshold,
  },
  detectedSignals: data.signals.map(printSignal),
  suppressedCandidates: data.diagnostics.suppressed.sort((left, right) => right.score - left.score).slice(0, 8).map(printSignal),
}, null, 2));
