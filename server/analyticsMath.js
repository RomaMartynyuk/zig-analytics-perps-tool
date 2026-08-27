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

export function buildMarketShareHistory(rows, { period, totalProtocols, protocols } = {}) {
  const requiredDays = PERIOD_DAYS[period];
  if (!requiredDays) throw new Error('Unsupported period');
  const dates = continuousRecentDates(rows, requiredDays);
  const sufficientHistory = dates.length === requiredDays;
  const allowedProtocols = protocols?.length ? new Set(protocols) : null;

  if (!sufficientHistory) {
    return {
      requestedPeriod: period,
      requiredDays,
      availableDays: dates.length,
      sufficientHistory: false,
      coverage: { totalProtocols, validProtocols: 0 },
      values: [],
    };
  }

  const values = [];
  let latestCoverage = { totalProtocols, validProtocols: 0 };
  for (const date of dates) {
    const dayRows = rows.filter((row) => dateKey(row.snapshot_date) === date)
      .map((row) => ({ ...row, metric_value: toValidNumber(row.metric_value) }))
      .filter((row) => row.metric_value != null);
    const total = dayRows.reduce((sum, row) => sum + row.metric_value, 0);
    const coverage = { totalProtocols, validProtocols: dayRows.length };
    if (date === dates.at(-1)) latestCoverage = coverage;

    for (const row of dayRows) {
      if (allowedProtocols && !allowedProtocols.has(row.slug)) continue;
      values.push({
        date,
        protocol: { slug: row.slug, name: row.name },
        value: row.metric_value,
        share: total > 0 ? (row.metric_value / total) * 100 : null,
        coverage,
      });
    }
  }

  return { requestedPeriod: period, requiredDays, availableDays: dates.length, sufficientHistory: true, coverage: latestCoverage, values };
}

export function buildMarketShareMovers(history) {
  if (!history.sufficientHistory) {
    return { ...history, values: [] };
  }

  const byProtocol = new Map();
  for (const value of history.values) {
    const key = value.protocol.slug;
    const points = byProtocol.get(key) || [];
    points.push(value);
    byProtocol.set(key, points);
  }
  const values = [...byProtocol.values()]
    .filter((points) => points.length === history.requiredDays)
    .map((points) => {
      const start = points[0];
      const current = points.at(-1);
      return {
        protocol: current.protocol,
        startingShare: start.share,
        currentShare: current.share,
        percentagePointChange: current.share - start.share,
      };
    })
    .sort((a, b) => b.currentShare - a.currentShare)
    .map((value, index) => ({ ...value, rank: index + 1 }));

  return { ...history, values };
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
      coverage: ranked[0]?.coverage || { totalProtocols, validProtocols: 0 },
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
