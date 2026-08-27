function asValidNonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export async function fetchDefiLlamaProtocol(slug) {
  const response = await fetch(`https://api.llama.fi/protocol/${encodeURIComponent(slug)}`);
  if (!response.ok) {
    const error = new Error(`DefiLlama source failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

/** Returns NULL TVL on a missing/malformed upstream response; never invents 0. */
export async function fetchDefiLlamaTvlSnapshot(slug) {
  if (!slug) return { tvl: null, dataSource: null, sourceUpdatedAt: null };

  try {
    const data = await fetchDefiLlamaProtocol(slug);
    const chart = Array.isArray(data?.tvl) ? data.tvl : [];
    const latest = [...chart].reverse().find((point) => asValidNonNegativeNumber(point?.totalLiquidityUSD) != null);
    const tvl = asValidNonNegativeNumber(latest?.totalLiquidityUSD);
    const unixSeconds = Number(latest?.date);

    return {
      tvl,
      dataSource: tvl == null ? null : 'defillama',
      sourceUpdatedAt: Number.isFinite(unixSeconds) ? new Date(unixSeconds * 1000) : null,
    };
  } catch {
    return { tvl: null, dataSource: null, sourceUpdatedAt: null };
  }
}
