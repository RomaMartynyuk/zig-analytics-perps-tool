// Pure server-side analytics calculations, also used by unit tests.
export const PERIOD_DAYS = { '7d': 7, '30d': 30, '90d': 90 };

export function toValidNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

// PostgreSQL clients can return a DATE either as `YYYY-MM-DD` or as a native
// Date. Keep the canonical analytics day independent from that driver detail.
export function snapshotDateKey(value) {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function previousUtcDay(day) {
  const date = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function continuousRecentDates(rows, requiredDays) {
  const dates = [...new Set(rows.map((row) => snapshotDateKey(row.snapshot_date)).filter(Boolean))].sort();
  const selected = [];
  let current = dates.at(-1);
  const available = new Set(dates);

  while (current && available.has(current) && selected.length < requiredDays) {
    selected.unshift(current);
    current = previousUtcDay(current);
  }

  return selected;
}

function coverage(totalProtocols, available) {
  return {
    available,
    total: totalProtocols,
    missing: Math.max(totalProtocols - available, 0),
    // Keep these aliases while existing server callers migrate to the clearer shape.
    totalProtocols,
    validProtocols: available,
  };
}

export function buildCurrentMarketShare(rows, { metric, snapshotDate, capturedAt, totalProtocols }) {
  const validRows = rows
    .map((row) => ({ ...row, metric_value: toValidNumber(row.metric_value) }))
    .filter((row) => row.metric_value != null);
  const total = validRows.reduce((sum, row) => sum + row.metric_value, 0);
  const values = validRows
    .sort((a, b) => b.metric_value - a.metric_value)
    .map((row, index) => ({
      rank: index + 1,
      protocol: { slug: row.slug, name: row.name },
      value: row.metric_value,
      share: total > 0 ? (row.metric_value / total) * 100 : null,
      dataSource: row.data_source || null,
    }));
  const missingProtocols = rows
    .filter((row) => toValidNumber(row.metric_value) == null)
    .map((row) => ({ slug: row.slug, name: row.name }));

  return {
    metric,
    requestedPeriod: 'current',
    snapshotDate: snapshotDate || null,
    capturedAt: capturedAt || null,
    coverage: coverage(totalProtocols, validRows.length),
    missingProtocols,
    values,
  };
}

export function buildVolumeOiAnalysis(rows, { snapshotDate, capturedAt, totalProtocols }) {
  const normalized = rows.map((row) => ({
    ...row,
    volume: toValidNumber(row.volume_24h),
    openInterest: toValidNumber(row.open_interest),
  }));
  const volumeRows = normalized.filter((row) => row.volume != null);
  const oiRows = normalized.filter((row) => row.openInterest != null);
  const totalVolume = volumeRows.reduce((sum, row) => sum + row.volume, 0);
  const totalOi = oiRows.reduce((sum, row) => sum + row.openInterest, 0);
  const volumeRanks = new Map(volumeRows.slice().sort((a, b) => b.volume - a.volume).map((row, index) => [row.slug, index + 1]));
  const oiRanks = new Map(oiRows.slice().sort((a, b) => b.openInterest - a.openInterest).map((row, index) => [row.slug, index + 1]));
  const eligible = normalized.filter((row) => row.volume != null && row.openInterest != null && row.volume > 0 && row.openInterest > 0)
    .map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      volume24h: row.volume,
      openInterest: row.openInterest,
      volumeOiRatio: row.volume / row.openInterest,
      volumeShare: totalVolume > 0 ? (row.volume / totalVolume) * 100 : null,
      openInterestShare: totalOi > 0 ? (row.openInterest / totalOi) * 100 : null,
      shareGapPp: totalVolume > 0 && totalOi > 0
        ? (row.volume / totalVolume) * 100 - (row.openInterest / totalOi) * 100
        : null,
      volumeRank: volumeRanks.get(row.slug) || null,
      openInterestRank: oiRanks.get(row.slug) || null,
      dataSource: row.data_source || null,
    }));
  const ratios = eligible.map((row) => row.volumeOiRatio).sort((a, b) => a - b);
  const middle = Math.floor(ratios.length / 2);
  const medianRatio = ratios.length
    ? (ratios.length % 2 ? ratios[middle] : (ratios[middle - 1] + ratios[middle]) / 2)
    : null;
  const rankedHigh = eligible.slice().sort((a, b) => b.volumeOiRatio - a.volumeOiRatio)
    .slice(0, 5).map((row, index) => ({ ...row, ratioRank: index + 1 }));
  const rankedLow = eligible.slice().sort((a, b) => a.volumeOiRatio - b.volumeOiRatio)
    .slice(0, 5).map((row, index) => ({ ...row, ratioRank: index + 1 }));
  const largestPositiveGaps = eligible.filter((row) => row.shareGapPp > 0)
    .sort((a, b) => b.shareGapPp - a.shareGapPp)
    .slice(0, 5).map((row, index) => ({ ...row, gapRank: index + 1 }));
  const largestNegativeGaps = eligible.filter((row) => row.shareGapPp < 0)
    .sort((a, b) => a.shareGapPp - b.shareGapPp)
    .slice(0, 5).map((row, index) => ({ ...row, gapRank: index + 1 }));
  const missingProtocols = normalized.filter((row) => !(row.volume != null && row.openInterest != null && row.volume > 0 && row.openInterest > 0))
    .map((row) => ({ slug: row.slug, name: row.name }));

  return {
    snapshotDate: snapshotDate || null,
    capturedAt: capturedAt || null,
    coverage: {
      total: totalProtocols,
      volumeAvailable: volumeRows.length,
      openInterestAvailable: oiRows.length,
      scatterEligible: eligible.length,
      eligible: eligible.length,
      missing: Math.max(totalProtocols - eligible.length, 0),
    },
    medianRatio,
    protocols: eligible,
    highestRatios: rankedHigh,
    lowestRatios: rankedLow,
    largestPositiveGaps,
    largestNegativeGaps,
    missingProtocols,
  };
}

export function buildMarketShareHistory(rows, { period, totalProtocols, protocols } = {}) {
  const requiredDays = PERIOD_DAYS[period];
  if (!requiredDays) throw new Error('Unsupported period');
  const dates = continuousRecentDates(rows, requiredDays);
  const sufficientHistory = dates.length === requiredDays;
  const allowedProtocols = protocols?.length ? new Set(protocols) : null;
  const latestDate = dates.at(-1) || null;
  const latestAvailable = latestDate
    ? rows.filter((row) => snapshotDateKey(row.snapshot_date) === latestDate && toValidNumber(row.metric_value) != null).length
    : 0;

  if (!sufficientHistory) {
    return {
      requestedPeriod: period,
      requiredDays,
      availableDays: dates.length,
      sufficientHistory: false,
      startDate: dates[0] || null,
      endDate: latestDate,
      coverage: coverage(totalProtocols, latestAvailable),
      values: [],
    };
  }

  const values = [];
  let latestCoverage = coverage(totalProtocols, 0);
  for (const date of dates) {
    const dayRows = rows.filter((row) => snapshotDateKey(row.snapshot_date) === date)
      .map((row) => ({ ...row, metric_value: toValidNumber(row.metric_value) }))
      .filter((row) => row.metric_value != null);
    const total = dayRows.reduce((sum, row) => sum + row.metric_value, 0);
    const dailyCoverage = coverage(totalProtocols, dayRows.length);
    if (date === dates.at(-1)) latestCoverage = dailyCoverage;

    for (const row of dayRows) {
      if (allowedProtocols && !allowedProtocols.has(row.slug)) continue;
      values.push({
        date,
        protocol: { slug: row.slug, name: row.name },
        value: row.metric_value,
        share: total > 0 ? (row.metric_value / total) * 100 : null,
        dataSource: row.data_source || null,
        coverage: dailyCoverage,
      });
    }
  }

  return {
    requestedPeriod: period,
    requiredDays,
    availableDays: dates.length,
    sufficientHistory: true,
    startDate: dates[0],
    endDate: latestDate,
    coverage: latestCoverage,
    values,
  };
}

export function buildMarketShareMovers(history) {
  if (!history.sufficientHistory) {
    return {
      ...history,
      coverage: { ...history.coverage, currentAvailable: history.coverage.available, eligible: 0 },
      gainers: [],
      losers: [],
      values: [],
    };
  }

  const byProtocol = new Map();
  for (const value of history.values) {
    const key = value.protocol.slug;
    const points = byProtocol.get(key) || [];
    points.push(value);
    byProtocol.set(key, points);
  }
  const values = [...byProtocol.values()].map((points) => {
    const start = points.find((point) => point.date === history.startDate);
    const current = points.find((point) => point.date === history.endDate);
    if (!start || !current) return null;
    return {
      protocol: current.protocol,
      startingShare: start.share,
      currentShare: current.share,
      percentagePointChange: current.share - start.share,
      startValue: start.value,
      currentValue: current.value,
      startDataSource: start.dataSource || null,
      currentDataSource: current.dataSource || null,
    };
  }).filter(Boolean);
  const gainers = values.filter((value) => value.percentagePointChange > 0)
    .sort((a, b) => b.percentagePointChange - a.percentagePointChange)
    .slice(0, 5)
    .map((value, index) => ({ ...value, rank: index + 1 }));
  const losers = values.filter((value) => value.percentagePointChange < 0)
    .sort((a, b) => a.percentagePointChange - b.percentagePointChange)
    .slice(0, 5)
    .map((value, index) => ({ ...value, rank: index + 1 }));

  return {
    ...history,
    coverage: {
      ...history.coverage,
      currentAvailable: history.coverage.available,
      eligible: values.length,
      comparisonUnavailable: Math.max(history.coverage.available - values.length, 0),
    },
    gainers,
    losers,
    values,
  };
}

export function buildMarketConcentrationHistory(rows, { period, totalProtocols }) {
  const history = buildMarketShareHistory(rows, { period, totalProtocols });
  if (!history.sufficientHistory) return { ...history, values: [] };

  const values = [...new Set(history.values.map((value) => value.date))].map((date) => {
    const ranked = history.values.filter((value) => value.date === date)
      .sort((a, b) => b.share - a.share);
    return {
      date,
      top1Share: ranked.slice(0, 1).reduce((sum, value) => sum + value.share, 0),
      top3Share: ranked.slice(0, 3).reduce((sum, value) => sum + value.share, 0),
      top5Share: ranked.slice(0, 5).reduce((sum, value) => sum + value.share, 0),
      coverage: ranked[0]?.coverage || coverage(totalProtocols, 0),
    };
  });

  return { ...history, values };
}

export function buildGrowthMetrics(rows, { period, metric }) {
  const requiredDays = PERIOD_DAYS[period];
  if (!requiredDays) throw new Error('Unsupported period');
  const grouped = new Map();
  for (const row of rows) {
    const value = toValidNumber(row.metric_value);
    if (value == null) continue;
    const points = grouped.get(row.slug) || [];
    points.push({ ...row, date: snapshotDateKey(row.snapshot_date), metric_value: value });
    grouped.set(row.slug, points);
  }

  const values = [];
  for (const [slug, points] of grouped) {
    const ordered = points.sort((a, b) => a.date.localeCompare(b.date));
    const latest = ordered.at(-1);
    const required = metric === 'volume' ? requiredDays * 2 : requiredDays + 1;
    if (ordered.length < required) continue;

    if (metric === 'volume') {
      const latestWindow = ordered.slice(-requiredDays);
      const previousWindow = ordered.slice(-requiredDays * 2, -requiredDays);
      const latestAverageDailyVolume = latestWindow.reduce((sum, point) => sum + point.metric_value, 0) / requiredDays;
      const previousAverageDailyVolume = previousWindow.reduce((sum, point) => sum + point.metric_value, 0) / requiredDays;
      values.push({
        protocol: { slug, name: latest.name },
        latestAverageDailyVolume,
        previousAverageDailyVolume,
        percentageChange: previousAverageDailyVolume > 0
          ? ((latestAverageDailyVolume - previousAverageDailyVolume) / previousAverageDailyVolume) * 100
          : null,
      });
    } else {
      const periodAgo = ordered.at(-(requiredDays + 1));
      values.push({
        protocol: { slug, name: latest.name },
        latest: latest.metric_value,
        periodAgo: periodAgo.metric_value,
        percentageChange: periodAgo.metric_value > 0
          ? ((latest.metric_value - periodAgo.metric_value) / periodAgo.metric_value) * 100
          : null,
      });
    }
  }

  return {
    requestedPeriod: period,
    requiredDays,
    methodology: metric === 'volume'
      ? 'Average rolling 24h volume over the latest N observations versus the previous N observations.'
      : 'Latest point-in-time value versus the value N daily observations earlier.',
    values,
  };
}

function metricGrowth(startRow, endRow, field) {
  const start = toValidNumber(startRow?.[field]);
  const current = toValidNumber(endRow?.[field]);
  if (start == null || current == null || start <= 0) return null;
  return {
    start,
    current,
    growthPct: ((current / start) - 1) * 100,
    startDataSource: startRow.data_source || null,
    currentDataSource: endRow.data_source || null,
  };
}

function findSnapshot(rows, date) {
  return rows.find((row) => snapshotDateKey(row.snapshot_date) === date) || null;
}

/**
 * Builds a same-window, per-metric comparison. Platform sufficiency follows
 * the Volume window used by market-share movers, while each cell remains
 * independently nullable when a protocol lacks either endpoint.
 */
export function buildGrowthMatrix(rows, { period, totalProtocols }) {
  const requiredDays = PERIOD_DAYS[period];
  if (!requiredDays) throw new Error('Unsupported period');
  const volumeDates = rows.filter((row) => toValidNumber(row.volume_24h) != null);
  const dates = continuousRecentDates(volumeDates, requiredDays);
  const sufficientHistory = dates.length === requiredDays;
  const endDate = dates.at(-1) || null;
  const startDate = sufficientHistory ? dates[0] : null;
  const protocolRows = new Map();
  for (const row of rows) {
    if (!row?.slug) continue;
    const existing = protocolRows.get(row.slug) || { id: row.id, slug: row.slug, name: row.name, rows: [] };
    if (row.snapshot_date) existing.rows.push(row);
    protocolRows.set(row.slug, existing);
  }

  if (!sufficientHistory) {
    return {
      period,
      requiredDays,
      availableDays: dates.length,
      sufficientHistory: false,
      startDate: null,
      endDate,
      coverage: { total: totalProtocols, volumeComparable: 0, openInterestComparable: 0, tvlComparable: 0, shareComparable: 0 },
      protocols: [],
    };
  }

  const startSnapshots = rows.filter((row) => snapshotDateKey(row.snapshot_date) === startDate);
  const endSnapshots = rows.filter((row) => snapshotDateKey(row.snapshot_date) === endDate);
  const startVolume = startSnapshots.map((row) => toValidNumber(row.volume_24h)).filter((value) => value != null);
  const endVolume = endSnapshots.map((row) => toValidNumber(row.volume_24h)).filter((value) => value != null);
  const startVolumeTotal = startVolume.reduce((sum, value) => sum + value, 0);
  const endVolumeTotal = endVolume.reduce((sum, value) => sum + value, 0);

  const protocols = [...protocolRows.values()].map((protocol) => {
    const start = findSnapshot(protocol.rows, startDate);
    const end = findSnapshot(protocol.rows, endDate);
    const volume = metricGrowth(start, end, 'volume_24h');
    const openInterest = metricGrowth(start, end, 'open_interest');
    const tvl = metricGrowth(start, end, 'tvl');
    const startVolumeValue = toValidNumber(start?.volume_24h);
    const endVolumeValue = toValidNumber(end?.volume_24h);
    const volumeShare = startVolumeValue != null && endVolumeValue != null && startVolumeTotal > 0 && endVolumeTotal > 0
      ? {
        start: (startVolumeValue / startVolumeTotal) * 100,
        current: (endVolumeValue / endVolumeTotal) * 100,
        changePp: (endVolumeValue / endVolumeTotal) * 100 - (startVolumeValue / startVolumeTotal) * 100,
        startDataSource: start?.data_source || null,
        currentDataSource: end?.data_source || null,
      }
      : null;
    const changes = [volume?.growthPct, openInterest?.growthPct, tvl?.growthPct, volumeShare?.changePp].filter(Number.isFinite);
    const positives = changes.filter((value) => value > 0).length;
    const negatives = changes.filter((value) => value < 0).length;
    const momentum = changes.length < 3 ? null : positives >= 3 ? 'broad_growth' : negatives >= 3 ? 'broad_contraction' : 'mixed';
    return { id: protocol.id, slug: protocol.slug, name: protocol.name, volume, openInterest, tvl, volumeShare, momentum };
  });
  const coverage = {
    total: totalProtocols,
    volumeComparable: protocols.filter((protocol) => protocol.volume).length,
    openInterestComparable: protocols.filter((protocol) => protocol.openInterest).length,
    tvlComparable: protocols.filter((protocol) => protocol.tvl).length,
    shareComparable: protocols.filter((protocol) => protocol.volumeShare).length,
  };
  return { period, requiredDays, availableDays: dates.length, sufficientHistory: true, startDate, endDate, coverage, protocols };
}
