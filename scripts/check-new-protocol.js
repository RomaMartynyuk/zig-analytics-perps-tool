import { fetchPerplMarketMetrics } from '../server/perplAdapter.js';
import { fetchN1MarketMetrics } from '../server/n1Adapter.js';
import { fetchBulletMarketMetrics } from '../server/bulletAdapter.js';

const protocol = process.argv[2]?.toLowerCase();
const integrations = {
  perpl: { fetcher:fetchPerplMarketMetrics, source:'perpl_api', requests:1 },
  n1: { fetcher:fetchN1MarketMetrics, source:'n1_nord_api', requests:2 },
  bullet: { fetcher:fetchBulletMarketMetrics, source:'bullet_api', requests:4 },
};
const integration = integrations[protocol];
if (!integration) { console.error('Usage: node scripts/check-new-protocol.js perpl|n1|bullet'); process.exit(2); }

const started=Date.now();
async function fetchJson(url) {
  const response=await fetch(url,{signal:AbortSignal.timeout(12000)});
  if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);
  return response.json();
}
try {
  const metrics=await integration.fetcher(fetchJson);
  console.log('PROTOCOL API CHECK');
  console.log(`Protocol: ${protocol}`);
  console.log('Classification: INDEPENDENT_DEX');
  console.log('Parent protocol: N/A');
  console.log('Mainnet: yes');
  console.log(`REST: public; ${integration.requests} bulk request${integration.requests===1?'':'s'}`);
  console.log('WebSocket: documented');
  console.log('Authentication: not required for market reads');
  console.log(`Eligible perp markets: ${metrics.marketsCount ?? 'unavailable'}`);
  console.log(`24h Volume USD: ${metrics.volume ?? 'unavailable'}`);
  console.log(`Open Interest USD: ${metrics.openInterest ?? 'unavailable'}`);
  console.log('TVL: unavailable from this adapter (DeFiLlama mapping handled separately)');
  console.log(`Provenance: ${integration.source}`);
  console.log(`Aggregate eligibility: Volume=${metrics.volume!=null}; OI=${metrics.openInterest!=null}; TVL=false`);
  console.log(`Warnings: ${metrics.volume==null||metrics.openInterest==null?'At least one metric or market is incomplete; incomplete aggregate is NULL.':'none'}`);
  console.log(`Snapshot time: ${new Date().toISOString()}`);
  console.log(`Duration: ${Date.now()-started}ms`);
} catch(error) {
  console.error(`PROTOCOL API CHECK ${protocol}: ${error.message}`);
  process.exitCode=1;
}
