import { PERIOD_DAYS, buildGrowthMatrix, continuousRecentDates, snapshotDateKey, toValidNumber } from './analyticsMath.js';

export const SIGNAL_CONFIG = {
  minPeerSample: 6,
  outlierPercentile: 0.9,
  maxSignals: 8,
  rankGapFloor: 3,
  minSignalScore: 70,
  highSeverityScore: 84,
  extremeSeverityScore: 95,
};

function median(values) {
  const ordered = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!ordered.length) return null;
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function percentile(value, values) {
  const ordered = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!ordered.length || !Number.isFinite(value)) return null;
  // Mid-rank percentiles keep a tied peer group centred in its rank interval.
  // Without this, a flat distribution would put every value at the 100th
  // percentile and incorrectly emit "outlier" signals for all peers.
  const below = ordered.filter((item) => item < value).length;
  const equal = ordered.filter((item) => item === value).length;
  return (below + equal / 2) / ordered.length;
}

function severity(score) {
  if (score >= SIGNAL_CONFIG.extremeSeverityScore) return 'extreme';
  if (score >= SIGNAL_CONFIG.highSeverityScore) return 'high';
  if (score >= SIGNAL_CONFIG.minSignalScore) return 'medium';
  return 'low';
}

function signal({ type, category, protocol, period = 'current', direction = 'neutral', score, title, summary, evidence, comparison, snapshotDate, researchPrompt, related = [], family = null, metadata = null }) {
  const boundedScore = Math.max(0, Math.min(100, Math.round(score)));
  return {
    id: `${type}:${protocol.slug}:${period}:${snapshotDate}`,
    type, category, protocolId: protocol.id, protocolSlug: protocol.slug, protocolName: protocol.name,
    period, direction, severity: severity(boundedScore), score: boundedScore, title, summary,
    evidence, comparison: comparison || null, snapshotDate, generatedAt: new Date().toISOString(), researchPrompt, related, family, metadata,
  };
}

function marketImpactPercentile(protocol, protocols) {
  return percentile(Math.max(protocol.volumeShare || 0, protocol.openInterestShare || 0), protocols.map((item) => Math.max(item.volumeShare || 0, item.openInterestShare || 0))) || 0;
}

function relevanceAdjustedScore(strength, impactPercentile) {
  // A statistical outlier with negligible covered-market impact is still data,
  // but should not outrank a material structural observation.
  return strength * (.45 + .55 * impactPercentile);
}

function formatUsd(value) {
  if (!Number.isFinite(value)) return 'Unavailable';
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  return `$${value.toFixed(0)}`;
}

function currentDetectors(context) {
  const { current, snapshotDate } = context;
  const protocols = current.protocols || [];
  const results = [];
  const ratios = protocols.map((item) => item.volumeOiRatio);
  const gaps = protocols.map((item) => Math.abs(item.shareGapPp));
  if (protocols.length >= SIGNAL_CONFIG.minPeerSample) {
    const ratioMedian = median(ratios);
    for (const protocol of protocols) {
      const p = percentile(protocol.volumeOiRatio, ratios);
      const extreme = Math.max(p, 1 - p);
      if (extreme >= SIGNAL_CONFIG.outlierPercentile) {
        const high = p >= .5;
        const impactPercentile = marketImpactPercentile(protocol, protocols);
        const strength = 60 + 40 * ((extreme - SIGNAL_CONFIG.outlierPercentile) / (1 - SIGNAL_CONFIG.outlierPercentile));
        results.push(signal({ type: high ? 'high_turnover' : 'low_turnover', category: 'activity', protocol, direction: high ? 'high' : 'low', score: relevanceAdjustedScore(strength, impactPercentile), snapshotDate,
          title: high ? 'High Volume / OI' : 'Low Volume / OI',
          summary: high ? '24h Volume/OI is unusually high versus the tracked peer distribution, with meaningful covered-market activity.' : '24h Volume/OI is unusually low versus the tracked peer distribution, with meaningful covered-market activity.',
          evidence: [{ label: 'Volume / OI', value: protocol.volumeOiRatio, formatted: `${protocol.volumeOiRatio.toFixed(2)}x` }],
          comparison: { type: 'market_median', value: ratioMedian, formatted: `${ratioMedian.toFixed(2)}x` },
          researchPrompt: 'Investigate what is driving this relative turnover level.', family: high ? 'turnover_structure' : 'oi_heavy_structure', metadata: { peerPercentile: p, impactPercentile, sampleSize: protocols.length } }));
      }
      const gapPercentile = percentile(Math.abs(protocol.shareGapPp), gaps);
      if (gapPercentile >= SIGNAL_CONFIG.outlierPercentile) {
        const positive = protocol.shareGapPp > 0;
        const impactPercentile = marketImpactPercentile(protocol, protocols);
        const strength = 60 + 40 * ((gapPercentile - SIGNAL_CONFIG.outlierPercentile) / (1 - SIGNAL_CONFIG.outlierPercentile));
        results.push(signal({ type: 'share_gap_divergence', category: 'structure', protocol, direction: positive ? 'high' : 'low', score: relevanceAdjustedScore(strength, impactPercentile), snapshotDate,
          title: positive ? 'Volume Share > OI Share' : 'OI Share > Volume Share',
          summary: positive ? 'Trading activity represents a substantially larger share of the tracked market than Open Interest.' : 'Open Interest represents a substantially larger share of the tracked market than trading activity.',
          evidence: [{ label: 'Volume Share', value: protocol.volumeShare, formatted: `${protocol.volumeShare.toFixed(1)}%` }, { label: 'OI Share', value: protocol.openInterestShare, formatted: `${protocol.openInterestShare.toFixed(1)}%` }, { label: 'Share Gap', value: protocol.shareGapPp, formatted: `${protocol.shareGapPp > 0 ? '+' : ''}${protocol.shareGapPp.toFixed(1)}pp` }],
          researchPrompt: 'Investigate the structural difference between activity share and open-position share.', family: positive ? 'turnover_structure' : 'oi_heavy_structure', metadata: { peerPercentile: gapPercentile, impactPercentile, sampleSize: protocols.length } }));
      }
      const rankGap = protocol.openInterestRank - protocol.volumeRank;
      if (Math.abs(rankGap) >= Math.max(SIGNAL_CONFIG.rankGapFloor, Math.ceil(protocols.length * .25))) {
        const volumeHigher = rankGap > 0;
        const impactPercentile = marketImpactPercentile(protocol, protocols);
        const strength = 50 + 50 * Math.abs(rankGap) / protocols.length;
        results.push(signal({ type: 'cross_metric_rank_mismatch', category: 'structure', protocol, direction: volumeHigher ? 'high' : 'low', score: relevanceAdjustedScore(strength, impactPercentile), snapshotDate,
          title: 'Volume / OI Rank Mismatch', summary: volumeHigher ? 'Protocol ranks substantially higher by trading activity than by Open Interest.' : 'Protocol ranks substantially higher by Open Interest than by trading activity.',
          evidence: [{ label: 'Volume Rank', value: protocol.volumeRank, formatted: `#${protocol.volumeRank}` }, { label: 'OI Rank', value: protocol.openInterestRank, formatted: `#${protocol.openInterestRank}` }], researchPrompt: 'Compare the protocol’s trading activity with its open-position profile.', family: volumeHigher ? 'turnover_structure' : 'oi_heavy_structure', metadata: { impactPercentile, sampleSize: protocols.length } }));
      }
    }
  }
  const leaderEntries = [['Volume', protocols.slice().sort((a, b) => b.volume24h - a.volume24h)[0], 'volume24h', 'volumeShare'], ['Open Interest', protocols.slice().sort((a, b) => b.openInterest - a.openInterest)[0], 'openInterest', 'openInterestShare']];
  if (current.tvlLeader) leaderEntries.push(['TVL', current.tvlLeader, 'value', null]);
  const leadersBySlug = new Map();
  for (const [label, protocol, raw, share] of leaderEntries) {
    if (!protocol) continue;
    const item = leadersBySlug.get(protocol.slug) || { protocol, items: [] };
    item.items.push({ label, raw, share, value: protocol[raw] }); leadersBySlug.set(protocol.slug, item);
  }
  for (const { protocol, items } of leadersBySlug.values()) {
    const maxShare = Math.max(...items.map((item) => item.share ? protocol[item.share] || 0 : 0));
    results.push(signal({ type: 'market_leadership', category: 'market_share', protocol, score: Math.min(100, 76 + items.length * 8 + maxShare * .15), snapshotDate, title: 'Tracked Market Leadership', summary: `${protocol.name} leads ${items.map((item) => item.label).join(' and ')} across the covered market.`, evidence: items.map((item) => ({ label: item.label, value: item.value, formatted: formatUsd(item.value) })).concat(items.filter((item) => item.share).map((item) => ({ label: `${item.label} Share`, value: protocol[item.share], formatted: `${protocol[item.share].toFixed(1)}%` }))), researchPrompt: 'Use this as a reference point when comparing covered market structure.', family: 'leadership' }));
  }
  return results;
}

function historicalDetectors(context) {
  const results = [];
  for (const [period, matrix] of Object.entries(context.growth)) {
    if (!matrix.sufficientHistory) continue;
    for (const protocol of matrix.protocols) {
      if (protocol.openInterest?.growthPct > 30) results.push(signal({ type: 'oi_expansion', category: 'open_interest', protocol, period, direction: 'up', score: Math.min(100, 55 + Math.abs(protocol.openInterest.growthPct) / 2), snapshotDate: matrix.endDate, title: 'Open Interest Expansion', summary: 'Open Interest expanded materially over the selected canonical historical window.', evidence: [{ label: 'OI Growth', value: protocol.openInterest.growthPct, formatted: `+${protocol.openInterest.growthPct.toFixed(1)}%` }], researchPrompt: 'Investigate what changed across open positions during this period.' }));
      if (protocol.volumeShare?.changePp > 0) results.push(signal({ type: 'market_share_gain', category: 'market_share', protocol, period, direction: 'up', score: Math.min(100, 60 + Math.abs(protocol.volumeShare.changePp) * 7), snapshotDate: matrix.endDate, title: 'Volume Share Gain', summary: 'Tracked Volume Share increased over the selected canonical historical window.', evidence: [{ label: 'Share Change', value: protocol.volumeShare.changePp, formatted: `+${protocol.volumeShare.changePp.toFixed(1)}pp` }], researchPrompt: 'Compare raw Volume growth with the covered market’s growth.' }));
      if (protocol.momentum === 'broad_growth' || protocol.momentum === 'broad_contraction') {
        const changes = [protocol.volume?.growthPct, protocol.openInterest?.growthPct, protocol.tvl?.growthPct].filter(Number.isFinite).map(Math.abs).sort((a, b) => a - b);
        // Share change is useful context, but not a third fundamental metric.
        // A broad fundamental signal needs Volume, OI and TVL comparability.
        if (changes.length >= 3) {
          const middle = Math.floor(changes.length / 2);
          const medianChange = changes.length % 2 ? changes[middle] : (changes[middle - 1] + changes[middle]) / 2;
          results.push(signal({ type: protocol.momentum, category: 'growth', protocol, period, direction: protocol.momentum === 'broad_growth' ? 'up' : 'down', score: Math.min(100, 55 + medianChange / 2), snapshotDate: matrix.endDate, title: protocol.momentum === 'broad_growth' ? 'Broad Growth' : 'Broad Contraction', summary: protocol.momentum === 'broad_growth' ? 'Growth is visible across multiple tracked metrics rather than a single metric.' : 'Multiple tracked metrics contracted over the selected historical window.', evidence: [], researchPrompt: 'Inspect the underlying metric changes before drawing conclusions.' }));
        }
      }
    }
  }
  return results;
}

function deterministicOrder(left, right) {
  const structuralPriority = {
    share_gap_divergence: 3,
    high_turnover: 2,
    low_turnover: 2,
    cross_metric_rank_mismatch: 1,
  };
  return right.score - left.score
    || (structuralPriority[right.type] || 0) - (structuralPriority[left.type] || 0)
    || left.protocolSlug.localeCompare(right.protocolSlug)
    || left.type.localeCompare(right.type);
}

function dedupe(signals) {
  const seen = new Set(); const kept = []; const suppressed = [];
  for (const item of signals.slice().sort(deterministicOrder)) {
    const key = item.family ? `${item.protocolSlug}:${item.period}:${item.family}` : null;
    if (key && seen.has(key)) { suppressed.push({ ...item, suppressedBy: 'semantic_duplicate' }); continue; }
    if (key) seen.add(key);
    kept.push(item);
  }
  return { kept, suppressed };
}

export function runSignalEngine(context, { period = 'all', category = 'all', limit = SIGNAL_CONFIG.maxSignals, detectors } = {}) {
  const activeDetectors = detectors || [currentDetectors, historicalDetectors];
  const errors = [];
  const raw = activeDetectors.flatMap((detector) => { try { return detector(context) || []; } catch { errors.push(detector.name || 'detector'); return []; } });
  const filtered = raw.filter((item) => (period === 'all' || item.period === period) && (category === 'all' || item.category === category));
  const belowQuality = filtered.filter((item) => item.score < SIGNAL_CONFIG.minSignalScore).map((item) => ({ ...item, suppressedBy: 'below_quality_threshold' }));
  const { kept, suppressed } = dedupe(filtered.filter((item) => item.score >= SIGNAL_CONFIG.minSignalScore));
  const signals = kept.slice(0, Math.max(1, Math.min(Number(limit) || SIGNAL_CONFIG.maxSignals, 20)));
  return { signals, detectorErrors: errors, diagnostics: { rawCandidates: filtered, suppressed: [...belowQuality, ...suppressed], qualityThreshold: SIGNAL_CONFIG.minSignalScore } };
}

export function buildSignalHistory(rows) {
  return Object.fromEntries(Object.entries(PERIOD_DAYS).map(([period, days]) => {
    const dates = continuousRecentDates(rows.filter((row) => toValidNumber(row.volume_24h) != null), days);
    return [period, { available: dates.length === days, availableDays: dates.length, requiredDays: days }];
  }));
}

export function buildSignalsResponse({ current, rows, totalProtocols, snapshotDate, period, category, limit, includeDiagnostics = false }) {
  const growth = Object.fromEntries(Object.keys(PERIOD_DAYS).map((key) => [key, buildGrowthMatrix(rows, { period: key, totalProtocols })]));
  const history = buildSignalHistory(rows);
  const result = runSignalEngine({ current, growth, snapshotDate }, { period, category, limit });
  const response = { snapshotDate, coverage: { total: current.coverage.total, volumeAvailable: current.coverage.volumeAvailable, oiAvailable: current.coverage.openInterestAvailable, tvlAvailable: rows.filter((row) => snapshotDateKey(row.snapshot_date) === snapshotDateKey(snapshotDate) && toValidNumber(row.tvl) != null).length }, history, signals: result.signals, detectorErrors: result.detectorErrors };
  return includeDiagnostics ? { ...response, diagnostics: result.diagnostics } : response;
}
