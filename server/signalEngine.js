import { PERIOD_DAYS, buildGrowthMatrix, continuousRecentDates, snapshotDateKey, toValidNumber } from './analyticsMath.js';

export const SIGNAL_CONFIG = {
  minPeerSample: 5,
  outlierPercentile: 0.85,
  maxSignals: 8,
  rankGapFloor: 3,
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
  return ordered.filter((item) => item <= value).length / ordered.length;
}

function severity(score) {
  if (score >= 92) return 'extreme';
  if (score >= 78) return 'high';
  if (score >= 62) return 'medium';
  return 'low';
}

function signal({ type, category, protocol, period = 'current', direction = 'neutral', score, title, summary, evidence, comparison, snapshotDate, researchPrompt, related = [] }) {
  const boundedScore = Math.max(0, Math.min(100, Math.round(score)));
  return {
    id: `${type}:${protocol.slug}:${period}:${snapshotDate}`,
    type, category, protocolId: protocol.id, protocolSlug: protocol.slug, protocolName: protocol.name,
    period, direction, severity: severity(boundedScore), score: boundedScore, title, summary,
    evidence, comparison: comparison || null, snapshotDate, generatedAt: new Date().toISOString(), researchPrompt, related,
  };
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
        results.push(signal({ type: high ? 'high_turnover' : 'low_turnover', category: 'activity', protocol, direction: high ? 'high' : 'low', score: extreme * 100, snapshotDate,
          title: high ? 'High Volume / OI' : 'Low Volume / OI',
          summary: high ? '24h trading volume is high relative to current Open Interest compared with tracked peers.' : '24h trading volume is low relative to current Open Interest compared with tracked peers.',
          evidence: [{ label: 'Volume / OI', value: protocol.volumeOiRatio, formatted: `${protocol.volumeOiRatio.toFixed(2)}x` }],
          comparison: { type: 'market_median', value: ratioMedian, formatted: `${ratioMedian.toFixed(2)}x` },
          researchPrompt: 'Investigate what is driving this relative turnover level.' }));
      }
      const gapPercentile = percentile(Math.abs(protocol.shareGapPp), gaps);
      if (gapPercentile >= SIGNAL_CONFIG.outlierPercentile) {
        const positive = protocol.shareGapPp > 0;
        results.push(signal({ type: 'share_gap_divergence', category: 'structure', protocol, direction: positive ? 'high' : 'low', score: gapPercentile * 100, snapshotDate,
          title: positive ? 'Volume Share > OI Share' : 'OI Share > Volume Share',
          summary: positive ? 'Trading activity represents a substantially larger share of the tracked market than Open Interest.' : 'Open Interest represents a substantially larger share of the tracked market than trading activity.',
          evidence: [{ label: 'Volume Share', value: protocol.volumeShare, formatted: `${protocol.volumeShare.toFixed(1)}%` }, { label: 'OI Share', value: protocol.openInterestShare, formatted: `${protocol.openInterestShare.toFixed(1)}%` }, { label: 'Share Gap', value: protocol.shareGapPp, formatted: `${protocol.shareGapPp > 0 ? '+' : ''}${protocol.shareGapPp.toFixed(1)}pp` }],
          researchPrompt: 'Investigate the structural difference between activity share and open-position share.' }));
      }
      const rankGap = protocol.openInterestRank - protocol.volumeRank;
      if (Math.abs(rankGap) >= Math.max(SIGNAL_CONFIG.rankGapFloor, Math.ceil(protocols.length * .25))) {
        const volumeHigher = rankGap > 0;
        results.push(signal({ type: 'cross_metric_rank_mismatch', category: 'structure', protocol, direction: volumeHigher ? 'high' : 'low', score: Math.min(100, 60 + Math.abs(rankGap) / protocols.length * 100), snapshotDate,
          title: 'Volume / OI Rank Mismatch', summary: volumeHigher ? 'Protocol ranks substantially higher by trading activity than by Open Interest.' : 'Protocol ranks substantially higher by Open Interest than by trading activity.',
          evidence: [{ label: 'Volume Rank', value: protocol.volumeRank, formatted: `#${protocol.volumeRank}` }, { label: 'OI Rank', value: protocol.openInterestRank, formatted: `#${protocol.openInterestRank}` }], researchPrompt: 'Compare the protocol’s trading activity with its open-position profile.' }));
      }
    }
  }
  for (const field of [['volume24h', 'volumeShare', 'Volume'], ['openInterest', 'openInterestShare', 'Open Interest']]) {
    const [raw, share, label] = field;
    const leader = protocols.slice().sort((a, b) => b[raw] - a[raw])[0];
    if (leader) results.push(signal({ type: `market_leader_${raw}`, category: 'market_share', protocol: leader, score: 70 + Math.min(25, leader[share]), snapshotDate, title: `Tracked ${label} Leader`, summary: `${leader.name} currently represents the largest tracked ${label} position.`, evidence: [{ label, value: leader[raw], formatted: formatUsd(leader[raw]) }, { label: 'Tracked Share', value: leader[share], formatted: `${leader[share].toFixed(1)}%` }], researchPrompt: 'Use this as a reference point when comparing market structure.' }));
  }
  if (current.tvlLeader) {
    const protocol = current.tvlLeader;
    results.push(signal({ type: 'market_leader_tvl', category: 'market_share', protocol, score: 70, snapshotDate, title: 'Tracked TVL Leader', summary: `${protocol.name} currently has the largest tracked TVL.`, evidence: [{ label: 'TVL', value: protocol.value, formatted: formatUsd(protocol.value) }], researchPrompt: 'Use this as a reference point when comparing tracked liquidity.' }));
  }
  return results;
}

function historicalDetectors(context) {
  const results = [];
  for (const [period, matrix] of Object.entries(context.growth)) {
    if (!matrix.sufficientHistory) continue;
    for (const protocol of matrix.protocols) {
      if (protocol.openInterest?.growthPct > 0) results.push(signal({ type: 'oi_expansion', category: 'open_interest', protocol, period, direction: 'up', score: Math.min(100, 55 + Math.abs(protocol.openInterest.growthPct) / 2), snapshotDate: matrix.endDate, title: 'Open Interest Expansion', summary: 'Open Interest expanded over the selected canonical historical window.', evidence: [{ label: 'OI Growth', value: protocol.openInterest.growthPct, formatted: `+${protocol.openInterest.growthPct.toFixed(1)}%` }], researchPrompt: 'Investigate what changed across open positions during this period.' }));
      if (protocol.volumeShare?.changePp > 0) results.push(signal({ type: 'market_share_gain', category: 'market_share', protocol, period, direction: 'up', score: Math.min(100, 55 + Math.abs(protocol.volumeShare.changePp) * 8), snapshotDate: matrix.endDate, title: 'Volume Share Gain', summary: 'Tracked Volume Share increased over the selected canonical historical window.', evidence: [{ label: 'Share Change', value: protocol.volumeShare.changePp, formatted: `+${protocol.volumeShare.changePp.toFixed(1)}pp` }], researchPrompt: 'Compare raw Volume growth with the covered market’s growth.' }));
      if (protocol.momentum === 'broad_growth' || protocol.momentum === 'broad_contraction') results.push(signal({ type: protocol.momentum, category: 'growth', protocol, period, direction: protocol.momentum === 'broad_growth' ? 'up' : 'down', score: 72, snapshotDate: matrix.endDate, title: protocol.momentum === 'broad_growth' ? 'Broad Growth' : 'Broad Contraction', summary: protocol.momentum === 'broad_growth' ? 'Growth is visible across multiple tracked metrics rather than a single metric.' : 'Multiple tracked metrics contracted over the selected historical window.', evidence: [], researchPrompt: 'Inspect the underlying metric changes before drawing conclusions.' }));
    }
  }
  return results;
}

function dedupe(signals) {
  const seen = new Set();
  return signals.sort((a, b) => b.score - a.score).filter((item) => {
    const key = `${item.protocolSlug}:${item.period}`;
    if (seen.has(key) && ['high_turnover', 'low_turnover', 'share_gap_divergence', 'cross_metric_rank_mismatch'].includes(item.type)) return false;
    seen.add(key);
    return true;
  });
}

export function runSignalEngine(context, { period = 'all', category = 'all', limit = SIGNAL_CONFIG.maxSignals, detectors } = {}) {
  const activeDetectors = detectors || [currentDetectors, historicalDetectors];
  const errors = [];
  const raw = activeDetectors.flatMap((detector) => { try { return detector(context) || []; } catch { errors.push(detector.name || 'detector'); return []; } });
  const signals = dedupe(raw).filter((item) => (period === 'all' || item.period === period) && (category === 'all' || item.category === category)).slice(0, Math.max(1, Math.min(Number(limit) || SIGNAL_CONFIG.maxSignals, 20)));
  return { signals, detectorErrors: errors };
}

export function buildSignalHistory(rows) {
  return Object.fromEntries(Object.entries(PERIOD_DAYS).map(([period, days]) => {
    const dates = continuousRecentDates(rows.filter((row) => toValidNumber(row.volume_24h) != null), days);
    return [period, { available: dates.length === days, availableDays: dates.length, requiredDays: days }];
  }));
}

export function buildSignalsResponse({ current, rows, totalProtocols, snapshotDate, period, category, limit }) {
  const growth = Object.fromEntries(Object.keys(PERIOD_DAYS).map((key) => [key, buildGrowthMatrix(rows, { period: key, totalProtocols })]));
  const history = buildSignalHistory(rows);
  const { signals, detectorErrors } = runSignalEngine({ current, growth, snapshotDate }, { period, category, limit });
  return { snapshotDate, coverage: { total: current.coverage.total, volumeAvailable: current.coverage.volumeAvailable, oiAvailable: current.coverage.openInterestAvailable, tvlAvailable: rows.filter((row) => snapshotDateKey(row.snapshot_date) === snapshotDateKey(snapshotDate) && toValidNumber(row.tvl) != null).length }, history, signals, detectorErrors };
}
