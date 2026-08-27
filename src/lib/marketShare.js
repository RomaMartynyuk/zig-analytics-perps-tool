const SERIES_PALETTE = ['#285c43', '#4d769f', '#b36d3f', '#8f4d5a', '#7a6cbd', '#3f8a82', '#aa7d2e'];

export function getProtocolColor(slug) {
  let hash = 0;
  for (const character of String(slug || 'unknown')) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return SERIES_PALETTE[Math.abs(hash) % SERIES_PALETTE.length];
}

/** Selects an always-dynamic Top N based on the latest historical date. */
export function selectTopMarketShareSeries(values, limit = 5) {
  const safeValues = Array.isArray(values)
    ? values.filter((value) => value?.date && value?.protocol?.slug && Number.isFinite(value?.share))
    : [];
  const dates = [...new Set(safeValues.map((value) => value.date))].sort();
  const latestDate = dates.at(-1);
  const topSlugs = safeValues
    .filter((value) => value.date === latestDate)
    .sort((a, b) => b.share - a.share)
    .slice(0, limit)
    .map((value) => value.protocol.slug);

  return {
    dates,
    series: topSlugs.map((slug) => ({
      slug,
      color: getProtocolColor(slug),
      points: dates.map((date) => safeValues.find((value) => value.date === date && value.protocol.slug === slug)).filter(Boolean),
    })),
  };
}
