import { fetchArcusMarketMetrics } from '../server/arcusAdapter.js';

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Arcus returned HTTP ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

const metrics = await fetchArcusMarketMetrics(fetchJson);
console.log(JSON.stringify({
  network: 'Arcus mainnet',
  endpoint: 'https://api.arcus.xyz/v1/markets',
  marketsCount: metrics.marketsCount,
  volume24hUsd: metrics.volume,
  openInterestUsd: metrics.openInterest,
  diagnostics: metrics.diagnostics,
  source: 'arcus_api',
}, null, 2));
