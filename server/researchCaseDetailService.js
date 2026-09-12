import { getSql } from './db.js';
import { buildGrowthMatrix, buildMarketShareHistory, buildVolumeOiAnalysis, continuousRecentDates, median, percentileMidRank, snapshotDateKey, toValidNumber } from './analyticsMath.js';
import { getDailyResearchFeed } from './researchFeedService.js';
import { getPersistedResearchCase, validResearchCaseId } from './researchCasePersistence.js';

const PERIODS = ['7d', '30d', '90d'];

function metricContext(value, values) {
  const valid = values.filter(Number.isFinite).sort((a, b) => b - a);
  if (!Number.isFinite(value)) return { value: null, rank: null, eligible: valid.length, median: median(valid), percentile: null };
  return { value, rank: valid.findIndex((item) => item === value) + 1 || null, eligible: valid.length, median: median(valid), percentile: percentileMidRank(value, valid) };
}

export function buildResearchCurrentMetrics(rows, protocolSlug, snapshotDate, capturedAt, totalProtocols) {
  const normalized = rows.map((row) => ({ ...row, volume_24h: toValidNumber(row.volume_24h), open_interest: toValidNumber(row.open_interest), tvl: toValidNumber(row.tvl), markets_count: toValidNumber(row.markets_count) }));
  const selected = normalized.find((row) => row.slug === protocolSlug) || null;
  if (!selected) return { snapshot: { date: snapshotDate, capturedAt }, metrics: null, peerContext: {} };
  const volumeOi = buildVolumeOiAnalysis(normalized, { snapshotDate, capturedAt, totalProtocols });
  const volumeValues = normalized.map((row) => row.volume_24h).filter(Number.isFinite);
  const oiValues = normalized.map((row) => row.open_interest).filter(Number.isFinite);
  const tvlValues = normalized.map((row) => row.tvl).filter(Number.isFinite);
  const marketsValues = normalized.map((row) => row.markets_count).filter(Number.isFinite);
  const ratioValues = (volumeOi.protocols || []).map((row) => row.volumeOiRatio).filter(Number.isFinite);
  const volumeValue = selected.volume_24h;
  const oiValue = selected.open_interest;
  const totalVolume = volumeValues.reduce((sum, value) => sum + value, 0);
  const totalOi = oiValues.reduce((sum, value) => sum + value, 0);
  const volumeShare = volumeValue != null && totalVolume > 0 ? volumeValue / totalVolume * 100 : null;
  const oiShare = oiValue != null && totalOi > 0 ? oiValue / totalOi * 100 : null;
  const ratio = volumeValue != null && oiValue != null && oiValue > 0 && volumeValue > 0 ? volumeValue / oiValue : null;
  const metrics = {
    volume24h: { value: volumeValue, source: selected.data_source || null },
    openInterest: { value: oiValue, source: selected.data_source || null },
    tvl: { value: selected.tvl, source: selected.data_source || null },
    marketsCount: { value: selected.markets_count, source: selected.data_source || null },
    volumeShare: { value: volumeShare }, oiShare: { value: oiShare },
    volumeOiRatio: { value: ratio }, shareGapPp: { value: volumeShare != null && oiShare != null ? volumeShare - oiShare : null },
  };
  return {
    snapshot: { date: snapshotDate, capturedAt }, metrics,
    coverage: { total: totalProtocols, volumeAvailable: volumeValues.length, oiAvailable: oiValues.length, tvlAvailable: tvlValues.length, volumeOiAvailable: ratioValues.length },
    peerContext: {
      volume: metricContext(volumeValue, volumeValues), openInterest: metricContext(oiValue, oiValues), tvl: metricContext(selected.tvl, tvlValues),
      marketsCount: metricContext(selected.markets_count, marketsValues), volumeOiRatio: metricContext(ratio, ratioValues),
      volumeShare: metricContext(volumeShare, normalized.filter((row) => row.volume_24h != null && totalVolume > 0).map((row) => row.volume_24h / totalVolume * 100)),
      oiShare: metricContext(oiShare, normalized.filter((row) => row.open_interest != null && totalOi > 0).map((row) => row.open_interest / totalOi * 100)),
    },
  };
}

function protocolSeries(rows, slug, field) {
  return rows.filter((row) => row.slug === slug).map((row) => ({ date: snapshotDateKey(row.snapshot_date), value: toValidNumber(row[field]) })).filter((row) => row.date).sort((a, b) => a.date.localeCompare(b.date));
}

export function buildResearchHistory(rows, slug, totalProtocols) {
  const history = {};
  const shareRows = rows.map((row) => ({ snapshot_date: row.snapshot_date, slug: row.slug, name: row.name, metric_value: row.volume_24h, data_source: row.data_source }));
  for (const period of PERIODS) {
    const growth = buildGrowthMatrix(rows, { period, totalProtocols });
    const protocol = growth.protocols.find((item) => item.slug === slug) || null;
    const share = buildMarketShareHistory(shareRows, { period, totalProtocols, protocols: [slug] });
    const selectedShare = share.values.filter((item) => item.protocol.slug === slug);
    history[period] = {
      available: growth.sufficientHistory,
      availableDays: growth.availableDays,
      requiredDays: growth.requiredDays,
      startDate: growth.startDate, endDate: growth.endDate,
      protocol: protocol ? { volume: protocol.volume, openInterest: protocol.openInterest, tvl: protocol.tvl, volumeShare: protocol.volumeShare } : null,
      volumeShareSeries: selectedShare,
      protocolMetricDays: {
        volume: continuousRecentDates(rows.filter((row) => row.slug === slug && toValidNumber(row.volume_24h) != null), growth.requiredDays).length,
        openInterest: continuousRecentDates(rows.filter((row) => row.slug === slug && toValidNumber(row.open_interest) != null), growth.requiredDays).length,
        tvl: continuousRecentDates(rows.filter((row) => row.slug === slug && toValidNumber(row.tvl) != null), growth.requiredDays).length,
      },
    };
  }
  return { availability: Object.fromEntries(PERIODS.map((period) => [period, { available: history[period].available, availableDays: history[period].availableDays, requiredDays: history[period].requiredDays }])), periods: history, series: {
    volume: protocolSeries(rows, slug, 'volume_24h'), openInterest: protocolSeries(rows, slug, 'open_interest'), tvl: protocolSeries(rows, slug, 'tvl'),
    volumeOiRatio: rows.filter((row) => row.slug === slug).map((row) => { const volume = toValidNumber(row.volume_24h); const oi = toValidNumber(row.open_interest); return { date: snapshotDateKey(row.snapshot_date), value: volume != null && oi != null && volume > 0 && oi > 0 ? volume / oi : null }; }).filter((row) => row.date).sort((a, b) => a.date.localeCompare(b.date)),
  } };
}

function methodologyFor(caseItem, peerContext) {
  const family = caseItem.family;
  if (family === 'turnover_structure' || family === 'oi_heavy_structure') return { formula: 'Volume / OI = normalized 24h Volume ÷ normalized Open Interest', peerComparison: `${peerContext.volumeOiRatio?.eligible || 0} active protocols with valid Volume and OI`, outlierPercentile: caseItem.primarySignal.metadata?.peerPercentile == null ? null : caseItem.primarySignal.metadata.peerPercentile * 100 };
  if (family.includes('share')) return { formula: 'Volume Share = protocol Volume ÷ total valid tracked Volume for the same snapshot date', peerComparison: `${peerContext.volume?.eligible || 0} active protocols with valid Volume`, outlierPercentile: null };
  return { formula: 'Uses Zig’s normalized canonical daily snapshot metrics.', peerComparison: null, outlierPercentile: null };
}

function filteredQuestions(caseItem, metrics) {
  const unavailable = { oi: metrics?.openInterest?.value == null, tvl: metrics?.tvl?.value == null, share: metrics?.volumeShare?.value == null || metrics?.oiShare?.value == null };
  const keep = (question) => !((unavailable.oi && /oi|open interest/i.test(question)) || (unavailable.tvl && /tvl/i.test(question)) || (unavailable.share && /share/i.test(question)));
  return { zigCanCheck: (caseItem.questions?.zigCanCheck || []).filter(keep), externalResearch: caseItem.questions?.externalResearch || [] };
}

function researchPeersFor(caseItem, rows) {
  if (!(caseItem.family === 'leadership' || caseItem.family.includes('market_share'))) return [];
  return rows
    .map((row) => ({ id: row.id, slug: row.slug, name: row.name, value: toValidNumber(row.volume_24h) }))
    .filter((row) => row.slug !== caseItem.protocol.slug && row.value != null)
    .sort((left, right) => right.value - left.value || left.slug.localeCompare(right.slug))
    .slice(0, 2)
    .map(({ id, slug, name }) => ({ id, slug, name }));
}

export function buildResearchCaseDetailPayload({ caseItem, feedCases, historicalRows, totalProtocols }) {
  const caseDate = snapshotDateKey(caseItem.snapshotDate);
  const anchoredRows = historicalRows.filter((row) => {
    const date = snapshotDateKey(row.snapshot_date);
    return date && date <= caseDate;
  });
  const currentRows = anchoredRows.filter((row) => snapshotDateKey(row.snapshot_date) === caseDate);
  const capturedAt = currentRows.map((row) => row.captured_at).filter(Boolean).sort().at(-1) || null;
  const current = buildResearchCurrentMetrics(currentRows, caseItem.protocol.slug, caseDate, capturedAt, totalProtocols);
  const history = buildResearchHistory(anchoredRows, caseItem.protocol.slug, totalProtocols);
  const otherSignals = feedCases.filter((item) => item.protocol.slug === caseItem.protocol.slug && item.id !== caseItem.id);
  return { case: { ...caseItem, questions: filteredQuestions(caseItem, current.metrics) }, protocol: caseItem.protocol, snapshot: current.snapshot, metrics: current.metrics, peerContext: current.peerContext, coverage: current.coverage, history, relatedSignals: caseItem.relatedSignals, otherSignals, researchPeers: researchPeersFor(caseItem, currentRows), methodology: methodologyFor(caseItem, current.peerContext), sources: [...new Set([current.metrics?.volume24h?.source, current.metrics?.openInterest?.source, current.metrics?.tvl?.source, current.metrics?.marketsCount?.source].filter(Boolean))], caseSource: 'CURRENT_RECONSTRUCTION', casePayloadVersion: null };
}

export async function getResearchCaseDetail(caseId, sql = getSql()) {
  if (!validResearchCaseId(caseId)) return { unavailable: true, reason: 'INVALID_CASE_ID', caseId };
  const persisted = await getPersistedResearchCase(caseId, sql);
  if (persisted) return persisted;
  const feed = await getDailyResearchFeed({ limit: 20, status: 'all' }, sql);
  const caseItem = feed.cases.find((item) => item.id === caseId);
  if (!caseItem) return { unavailable: true, reason: 'HISTORICAL_CASE_UNAVAILABLE', caseId, snapshotDate: caseId.split(':')[1] || null };
  // Feed persistence may have stored the case during this request. Persisted
  // evidence wins even on the first open.
  const newlyPersisted = await getPersistedResearchCase(caseId, sql);
  if (newlyPersisted) return newlyPersisted;
  const [totalRows, historicalRows] = await Promise.all([
    sql`SELECT COUNT(*)::int AS count FROM protocols WHERE is_active = TRUE`,
    sql.query(`SELECT p.id, p.slug, p.name, s.snapshot_date, s.captured_at, s.volume_24h, s.open_interest, s.tvl, s.markets_count, s.data_source FROM protocols p JOIN protocol_daily_snapshots s ON s.protocol_id = p.id WHERE p.is_active = TRUE ORDER BY s.snapshot_date ASC, p.slug ASC`),
  ]);
  return buildResearchCaseDetailPayload({ caseItem, feedCases: feed.cases, historicalRows, totalProtocols: Number(totalRows[0]?.count || 0) });
}
