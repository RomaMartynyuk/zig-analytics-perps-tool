import { getSql } from './db.js';
import {
  PERIOD_DAYS,
  buildCurrentMarketShare,
  buildVolumeOiAnalysis,
  buildGrowthMetrics,
  buildGrowthMatrix,
  buildMarketConcentrationHistory,
  buildMarketShareHistory,
  buildMarketShareMovers,
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

async function getMetricRows(sql, metric, { activeOnly = false } = {}) {
  const column = getMetricColumn(metric);
  return sql.query(`
    SELECT s.snapshot_date, p.slug, p.name, s.${column} AS metric_value, s.data_source
    FROM protocol_daily_snapshots s
    JOIN protocols p ON p.id = s.protocol_id
    WHERE s.${column} IS NOT NULL${activeOnly ? ' AND p.is_active = TRUE' : ''}
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
  const [rows, totalProtocols] = await Promise.all([
    getMetricRows(sql, metric, { activeOnly: true }),
    getActiveProtocolCount(sql),
  ]);
  const history = { metric, ...buildMarketShareHistory(rows, { period, totalProtocols }) };
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

export async function getGrowthMatrix({ period } = {}, sql = getSql()) {
  const [rows, totalProtocols] = await Promise.all([
    sql.query(`
      SELECT p.id, p.slug, p.name, s.snapshot_date, s.volume_24h, s.open_interest, s.tvl, s.data_source
      FROM protocols p
      LEFT JOIN protocol_daily_snapshots s ON s.protocol_id = p.id
      WHERE p.is_active = TRUE
      ORDER BY s.snapshot_date ASC NULLS FIRST, p.slug ASC
    `),
    getActiveProtocolCount(sql),
  ]);
  return buildGrowthMatrix(rows, { period, totalProtocols });
}

export async function getVolumeOiAnalysis(sql = getSql()) {
  const [latestSnapshot, totalProtocols] = await Promise.all([
    sql`SELECT MAX(snapshot_date) AS snapshot_date, MAX(captured_at) AS captured_at FROM protocol_daily_snapshots`,
    getActiveProtocolCount(sql),
  ]);
  const snapshotDate = latestSnapshot[0]?.snapshot_date || null;
  const capturedAt = latestSnapshot[0]?.captured_at || null;
  const rows = await sql.query(`
    SELECT p.id, p.slug, p.name, s.volume_24h, s.open_interest, s.data_source
    FROM protocols p
    LEFT JOIN protocol_daily_snapshots s
      ON s.protocol_id = p.id AND s.snapshot_date = $1::date
    WHERE p.is_active = TRUE
    ORDER BY p.slug ASC
  `, [snapshotDate]);
  return buildVolumeOiAnalysis(rows, { snapshotDate, capturedAt, totalProtocols });
}
