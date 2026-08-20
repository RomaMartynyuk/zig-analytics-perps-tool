// Vercel Serverless Function — proxies + aggregates DefiLlama's derivatives
// (perp volume) and open-interest overview endpoints, server-side (same
// CORS reasoning as /api/tvl.js).
//
// DefiLlama's derivatives "module" naming doesn't always match the
// "defillama_slug" we use for TVL (/protocol/{slug}) — volume/OI adapters
// are listed separately from TVL adapters, so coverage here is a SUBSET of
// the full tracked-project list. We match case-insensitively on name OR
// module against our own project names to catch as many as reasonably
// possible, and report how many matched so the UI can be honest about it.
//
// GET /api/derivatives -> { volume: {...}, openInterest: {...}, matched, total }

// Keep this self-contained (no cross-import of src/data/projects.json) so
// the function bundles cleanly regardless of Vercel's module resolution.
const TRACKED_NAMES = [
  'qfex', 'txflow', 'truenorth', 'bulktrade', 'arcus', 'perpl', 'rise', 'risex',
  'treadfi', 'tread.fi', 'variational', 'hotstuff', 'tradehotstuff', 'meridian',
  'ethereal', 'pacifica', 'nado', 'hibachi', 'gmtrade', '01 exchange', 'n1',
  'standx', 'ostium', 'hyperliquid', 'apex protocol', 'apex omni', 'lighter',
  'aster', 'edgex', 'grvt', 'extended', 'ondo finance', 'ondo', 'antarctic',
  'vest markets', 'vest exchange', 'jupiter', 'reya', 'sunperp', 'sun',
  'synfutures', 'gains network', 'phoenix', 'sosovalue', 'upscale',
  'orderly', 'decibel',
];

function isTracked(protocol) {
  const candidates = [protocol.name, protocol.displayName, protocol.module]
    .filter(Boolean)
    .map((s) => s.toLowerCase().trim());
  return TRACKED_NAMES.some((tracked) =>
    candidates.some((c) => c === tracked || c.includes(tracked) || tracked.includes(c))
  );
}

async function fetchOverview(type) {
  const res = await fetch(
    `https://api.llama.fi/overview/${type}?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`
  );
  if (!res.ok) return null;
  return res.json();
}

function sumField(protocols, field) {
  return protocols.reduce((sum, p) => sum + (Number(p[field]) || 0), 0);
}

function pctChange(current, previous) {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

export default async function handler(req, res) {
  try {
    const [derivatives, openInterest] = await Promise.all([
      fetchOverview('derivatives'),
      fetchOverview('open-interest'),
    ]);

    const volProtocols = (derivatives?.protocols || []).filter(isTracked);
    const oiProtocols = (openInterest?.protocols || []).filter(isTracked);

    const total24h = sumField(volProtocols, 'total24h');
    const total48hto24h = sumField(volProtocols, 'total48hto24h');
    const total7d = sumField(volProtocols, 'total7d');
    const total14dto7d = sumField(volProtocols, 'total14dto7d');
    const total30d = sumField(volProtocols, 'total30d');
    const total60dto30d = sumField(volProtocols, 'total60dto30d');

    // Open interest is a point-in-time snapshot, not a period total — use
    // whichever current-value field the endpoint actually returns.
    const oiCurrent = sumField(
      oiProtocols,
      oiProtocols[0]?.total24h != null ? 'total24h' : 'openInterestAtEnd'
    );

    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    return res.status(200).json({
      volume: {
        h24: total24h,
        h24_change: pctChange(total24h, total48hto24h),
        d7: total7d,
        d7_change: pctChange(total7d, total14dto7d),
        d30: total30d,
        d30_change: pctChange(total30d, total60dto30d),
      },
      openInterest: {
        current: oiCurrent,
      },
      matched: { volume: volProtocols.length, openInterest: oiProtocols.length },
    });
  } catch (err) {
    return res.status(502).json({ error: 'Upstream fetch failed' });
  }
}
