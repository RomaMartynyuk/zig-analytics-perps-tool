// Pure server-side analytics calculations, also used by unit tests.
export const PERIOD_DAYS = { '7d': 7, '30d': 30, '90d': 90 };

export function toValidNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function dateKey(value) {
  return String(value).slice(0, 10);
}

function previousUtcDay(day) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function continuousRecentDates(rows, requiredDays) {
  const dates = [...new Set(rows.map((row) => dateKey(row.snapshot_date)))].sort();
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
      missing: Math.max(totalProtocols - eligible.length, 0),
    },
    medianRatio,
    protocols: eligible,
    highestRatios: rankedHigh,
    lowestRatios: rankedLow,
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
    ? rows.filter((row) => dateKey(row.snapshot_date) === latestDate && toValidNumber(row.metric_value) != null).length
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
    const dayRows = rows.filter((row) => dateKey(row.snapshot_date) === date)
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
    points.push({ ...row, date: dateKey(row.snapshot_date), metric_value: value });
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
