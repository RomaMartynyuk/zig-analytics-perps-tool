import { getSql } from './db.js';
import {
  PERIOD_DAYS,
  buildCurrentMarketShare,
  buildGrowthMetrics,
  buildMarketConcentrationHistory,
  buildMarketShareHistory,
  buildMarketShareMovers,
  toValidNumber,
} from './analyticsMath.js';

const METRIC_COLUMNS = { volume: 'volume_24h', open_interest: 'open_interest', tvl: 'tvl' };

function getMetricColumn(metric) {
  const column = METRIC_COLUMNS[metric];
  if (!column) throw new Error('Unsupported metric');
  return column;
}

async function getActiveProtocolCount(sql) {
  const rows = await sql`SELECT COUNT(*)::int AS count FROM protocols WHERE is_active = TRUE`;
  return Number(rows[0]?.count || 0);
}

async function getMetricRows(sql, metric) {
  const column = getMetricColumn(metric);
  return sql.query(`
    SELECT s.snapshot_date, p.slug, p.name, s.${column} AS metric_value, s.data_source
    FROM protocol_daily_snapshots s
    JOIN protocols p ON p.id = s.protocol_id
    WHERE s.${column} IS NOT NULL
    ORDER BY s.snapshot_date ASC, p.slug ASC
  `);
}

export async function getCurrentMarketShare({ metric } = {}, sql = getSql()) {
  const column = getMetricColumn(metric);
  const [latestRows, totalProtocols] = await Promise.all([
    sql`SELECT MAX(snapshot_date) AS snapshot_date, MAX(captured_at) AS captured_at FROM protocol_daily_snapshots`,
    getActiveProtocolCount(sql),
  ]);
  const snapshotDate = latestRows[0]?.snapshot_date || null;
  const capturedAt = latestRows[0]?.captured_at || null;
  const rows = await sql.query(`
    SELECT p.slug, p.name, s.${column} AS metric_value, s.data_source
    FROM protocols p
    LEFT JOIN protocol_daily_snapshots s
      ON s.protocol_id = p.id AND s.snapshot_date = $1::date
    WHERE p.is_active = TRUE
    ORDER BY p.slug ASC
  `, [snapshotDate]);

  return buildCurrentMarketShare(rows, { metric, snapshotDate, capturedAt, totalProtocols });
}

export async function getMarketShare({ metric, period, protocols } = {}, sql = getSql()) {
  if (period === 'current') return getCurrentMarketShare({ metric }, sql);
  return getMarketShareHistory({ metric, period, protocols }, sql);
}

export async function getMarketShareHistory({ metric, period, protocols } = {}, sql = getSql()) {
  // Historical rows remain relevant after a protocol is disabled. Current
  // mode filters by is_active, while this query preserves recorded history.
  const [rows, totalProtocols] = await Promise.all([
    getMetricRows(sql, metric),
    sql`SELECT COUNT(*)::int AS count FROM protocols`,
  ]);
  return { metric, ...buildMarketShareHistory(rows, { period, totalProtocols: Number(totalProtocols[0]?.count || 0), protocols }) };
}

export async function getMarketShareMovers({ metric, period } = {}, sql = getSql()) {
  const history = await getMarketShareHistory({ metric, period }, sql);
  return { metric, ...buildMarketShareMovers(history) };
}

export async function getMarketConcentrationHistory({ metric = 'volume', period } = {}, sql = getSql()) {
  const [rows, totalProtocols] = await Promise.all([getMetricRows(sql, metric), getActiveProtocolCount(sql)]);
  return { metric, ...buildMarketConcentrationHistory(rows, { period, totalProtocols }) };
}

export async function getGrowthMetrics({ metric, period } = {}, sql = getSql()) {
  if (!PERIOD_DAYS[period]) throw new Error('Unsupported period');
  const rows = await getMetricRows(sql, metric);
  return { metric, ...buildGrowthMetrics(rows, { metric, period }) };
}

export async function getVolumeOiAnalysis(sql = getSql()) {
  const latestRows = await sql.query(`
    SELECT s.snapshot_date, p.slug, p.name, s.volume_24h, s.open_interest
    FROM protocol_daily_snapshots s
    JOIN protocols p ON p.id = s.protocol_id
    WHERE p.is_active = TRUE
      AND s.snapshot_date = (SELECT MAX(snapshot_date) FROM protocol_daily_snapshots)
    ORDER BY p.slug ASC
  `);
  const totalProtocols = await getActiveProtocolCount(sql);
  const validVolume = latestRows.filter((row) => toValidNumber(row.volume_24h) != null);
  const validOi = latestRows.filter((row) => toValidNumber(row.open_interest) != null);
  const totalVolume = validVolume.reduce((sum, row) => sum + toValidNumber(row.volume_24h), 0);
  const totalOi = validOi.reduce((sum, row) => sum + toValidNumber(row.open_interest), 0);

  return {
    snapshotDate: latestRows[0]?.snapshot_date || null,
    coverage: {
      totalProtocols,
      volumeProtocols: validVolume.length,
      openInterestProtocols: validOi.length,
    },
    values: latestRows.map((row) => {
      const volume = toValidNumber(row.volume_24h);
      const openInterest = toValidNumber(row.open_interest);
      return {
        protocol: { slug: row.slug, name: row.name },
        volume,
        openInterest,
        volumeOiRatio: volume != null && openInterest != null && openInterest > 0 ? volume / openInterest : null,
        volumeMarketShare: volume != null && totalVolume > 0 ? (volume / totalVolume) * 100 : null,
        openInterestMarketShare: openInterest != null && totalOi > 0 ? (openInterest / totalOi) * 100 : null,
      };
    }),
  };
}
