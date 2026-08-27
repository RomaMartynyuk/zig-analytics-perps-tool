import { getNormalizedDerivativesMetrics } from '../api/derivatives.js';
import { getSql } from './db.js';
import { getConfiguredProtocols } from './protocolRegistry.js';
import { upsertDailySnapshot, syncProtocols } from './snapshotRepository.js';
import { fetchDefiLlamaTvlSnapshot } from './tvl.js';

function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  }
  return Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker)).then(() => results);
}

export function utcSnapshotDate(date) {
  return date.toISOString().slice(0, 10);
}

export function validMetric(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function resolveDataSource(metrics, tvlSnapshot) {
  const sources = new Set();
  if (metrics && (metrics.volume != null || metrics.openInterest != null)) sources.add(metrics.dataSource);
  if (tvlSnapshot.tvl != null) sources.add(tvlSnapshot.dataSource);
  return sources.size ? [...sources].join('+') : null;
}

/**
 * Stores one canonical UTC-day row per configured protocol. Dependencies are
 * injectable so the collection and failure semantics can be unit-tested.
 */
export async function collectDailyProtocolSnapshots({
  now = new Date(),
  sql = getSql(),
  protocols = getConfiguredProtocols(),
  loadMetrics = () => getNormalizedDerivativesMetrics({ fresh: true }),
  loadTvl = fetchDefiLlamaTvlSnapshot,
  log = console,
} = {}) {
  const snapshotDate = utcSnapshotDate(now);
  const activeProtocols = protocols.filter((protocol) => protocol.isActive);
  const [databaseProtocols, metricRows] = await Promise.all([
    syncProtocols(sql, protocols),
    loadMetrics(),
  ]);
  const metricsByName = new Map(metricRows.map((metric) => [metric.name, metric]));
  const tvlRows = await mapWithConcurrency(activeProtocols, 4, async (protocol) => {
    try {
      return { slug: protocol.slug, value: await loadTvl(protocol.defillamaSlug) };
    } catch (error) {
      log.error?.(`[snapshots] ${protocol.name} TVL fetch failed: ${String(error?.message || error)}`);
      return { slug: protocol.slug, value: { tvl: null, dataSource: null, sourceUpdatedAt: null } };
    }
  });
  const tvlBySlug = new Map(tvlRows.map((row) => [row.slug, row.value]));
  const summary = { snapshotDate, saved: 0, partial: 0, failed: 0, failures: [] };

  await mapWithConcurrency(activeProtocols, 4, async (protocol) => {
    const databaseProtocol = databaseProtocols.get(protocol.slug);
    const metrics = metricsByName.get(protocol.metricsKey) || null;
    const tvlSnapshot = tvlBySlug.get(protocol.slug) || { tvl: null, dataSource: null, sourceUpdatedAt: null };
    const volume24h = validMetric(metrics?.volume);
    const openInterest = validMetric(metrics?.openInterest);
    const tvl = validMetric(tvlSnapshot.tvl);

    try {
      await upsertDailySnapshot(sql, {
        protocolId: databaseProtocol.id,
        snapshotDate,
        capturedAt: now,
        volume24h,
        openInterest,
        tvl,
        marketsCount: null,
        dataSource: resolveDataSource(metrics, { ...tvlSnapshot, tvl }),
        sourceUpdatedAt: tvlSnapshot.sourceUpdatedAt || null,
      });

      if (volume24h == null || openInterest == null || tvl == null) summary.partial += 1;
      else summary.saved += 1;
      log.info?.(`[snapshots] ${protocol.name} upserted for ${snapshotDate}`);
    } catch (error) {
      summary.failed += 1;
      summary.failures.push({ slug: protocol.slug, message: String(error?.message || error) });
      log.error?.(`[snapshots] ${protocol.name} failed: ${String(error?.message || error)}`);
    }
  });

  log.info?.(`[snapshots] ${snapshotDate}: ${summary.saved} saved, ${summary.partial} partial, ${summary.failed} failed`);
  return summary;
}
