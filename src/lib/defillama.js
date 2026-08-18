// Fetches TVL through our own /api/tvl serverless proxy (see /api/tvl.js) —
// calling api.llama.fi directly from the browser hits a CORS block, since
// DefiLlama's API doesn't send an Access-Control-Allow-Origin header for
// client-side requests. The proxy runs server-side on Vercel, so CORS
// doesn't apply there.
async function fetchViaProxy(slug) {
  const res = await fetch(`/api/tvl?slug=${encodeURIComponent(slug)}`);
  if (!res.ok) return null;
  return res.json();
}

/**
 * Fetches current + historical TVL for a single protocol slug.
 * Returns null (never throws) if the protocol isn't indexed on DeFiLlama —
 * the UI treats that as "track manually" rather than an error state.
 *
 * @param {string} slug - DefiLlama protocol slug, e.g. "variational"
 * @returns {Promise<{ tvl: number, change_1d: number, change_7d: number, chart: number[] } | null>}
 */
export async function fetchProtocolTVL(slug) {
  if (!slug) return null;

  try {
    const data = await fetchViaProxy(slug);
    if (!data) return null;

    const chart = data?.tvl;
    if (!Array.isArray(chart) || chart.length === 0) return null;

    const latest = chart[chart.length - 1]?.totalLiquidityUSD ?? null;
    const dayAgo = chart[chart.length - 2]?.totalLiquidityUSD ?? null;
    const weekAgo = chart[chart.length - 8]?.totalLiquidityUSD ?? null;

    if (latest == null) return null;

    return {
      tvl: latest,
      change_1d: dayAgo ? ((latest - dayAgo) / dayAgo) * 100 : null,
      change_7d: weekAgo ? ((latest - weekAgo) / weekAgo) * 100 : null,
      // last 30 points for sparkline use
      chart: chart.slice(-30).map((p) => p.totalLiquidityUSD),
    };
  } catch (err) {
    // Network error, CORS issue, or malformed response — treat as "not available"
    return null;
  }
}

/**
 * Fetches TVL data for a batch of projects in parallel.
 * Each project keeps its original config merged with fetched data (or null on miss).
 *
 * @param {Array<object>} projects - entries from projects.json
 * @returns {Promise<Array<object>>}
 */
export async function fetchAllProjectsTVL(projects) {
  const results = await Promise.all(
    projects.map(async (project) => {
      const tvlData = await fetchProtocolTVL(project.defillama_slug);
      return {
        ...project,
        tvlData, // null means "not indexed / track manually"
      };
    })
  );
  return results;
}
