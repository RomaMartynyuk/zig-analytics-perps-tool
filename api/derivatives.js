// Vercel Serverless Function — aggregate Perp Volume (24h) + Open Interest
// across the tracked-project list.
//
// IMPORTANT — why this looks the way it does:
// DeFiLlama's Derivatives (perp volume) data — both the /overview/derivatives
// endpoint AND the per-protocol /v2/chart/derivatives/protocol/{slug} chart —
// is Pro-only ($300/mo, confirmed against DefiLlama's own pricing docs and
// several independent sources). It is NOT available on the free api.llama.fi
// tier, no matter which URL shape is used. So for volume we go straight to
// each exchange's own public API instead (per the research doc), one small
// adapter per exchange. Open Interest DOES have a free DefiLlama endpoint
// (/overview/open-interest) and is used as-is below, with STRICT exact-name
// matching (not fuzzy substring) to avoid accidentally summing in unrelated
// protocols — an earlier version of this file used loose .includes()
// matching and produced an inflated, meaningless total.
//
// 7d/30d volume: genuinely not available from a single live API call for
// almost any of these exchanges (they mostly expose rolling 24h stats only).
// Getting real 7d/30d requires accumulating our own daily snapshots over
// time — that's Month 2 infra (the WoW snapshot pipeline already in the
// roadmap), not something this endpoint can fake honestly today. Returned
// as null on purpose so the UI shows "NaN" instead of a made-up number.

const TRACKED_OI_NAMES = [
  'hyperliquid', 'aster', 'lighter', 'edgex', 'variational', 'reya',
  'pacifica', 'nado', 'grvt', 'extended', 'decibel', 'hibachi', 'standx',
  'ostium', 'apex protocol', 'apex omni', 'jupiter perpetual exchange',
  'jupiter', 'synfutures', 'gains network', 'gtrade', 'orderly',
  'vest markets', 'vest exchange', 'gmtrade', 'ethereal', 'rise', 'risex',
];

async function fetchJSON(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) return null;
  return res.json();
}

// --- Direct-exchange 24h volume adapters -----------------------------

async function hyperliquidVolume24h() {
  const data = await fetchJSON('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
  });
  const assetCtxs = data?.[1];
  if (!Array.isArray(assetCtxs)) return null;
  return assetCtxs.reduce((sum, ctx) => sum + (Number(ctx.dayNtlVlm) || 0), 0);
}

async function asterVolume24h() {
  const data = await fetchJSON('https://fapi.asterdex.com/fapi/v1/ticker/24hr');
  if (!Array.isArray(data)) return null;
  return data.reduce((sum, t) => sum + (Number(t.quoteVolume) || 0), 0);
}

// Adapter registry — add more exchanges here as they're verified.
// Each entry: [displayName, asyncFn returning a USD number or null]
const VOLUME_ADAPTERS = [
  ['Hyperliquid', hyperliquidVolume24h],
  ['Aster', asterVolume24h],
];

async function aggregateVolume24h() {
  const results = await Promise.allSettled(VOLUME_ADAPTERS.map(([, fn]) => fn()));

  let total = 0;
  const sources = [];
  results.forEach((r, i) => {
    const [name] = VOLUME_ADAPTERS[i];
    if (r.status === 'fulfilled' && typeof r.value === 'number') {
      total += r.value;
      sources.push({ name, ok: true });
    } else {
      sources.push({ name, ok: false });
    }
  });

  const anySucceeded = sources.some((s) => s.ok);
  return { total: anySucceeded ? total : null, sources };
}

// --- Open Interest (free DefiLlama endpoint, strict exact matching) --

async function aggregateOpenInterest() {
  const data = await fetchJSON(
    'https://api.llama.fi/overview/open-interest?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true'
  );
  const protocols = data?.protocols || [];

  const matched = protocols.filter((p) => {
    const candidates = [p.name, p.displayName, p.module]
      .filter(Boolean)
      .map((s) => s.toLowerCase().trim());
    return candidates.some((c) => TRACKED_OI_NAMES.includes(c));
  });

  const valueField = matched[0]?.total24h != null ? 'total24h' : 'openInterestAtEnd';
  const current = matched.reduce((sum, p) => sum + (Number(p[valueField]) || 0), 0);

  return { current: matched.length ? current : null, matchedCount: matched.length };
}

export default async function handler(req, res) {
  try {
    const [volume, openInterest] = await Promise.all([
      aggregateVolume24h(),
      aggregateOpenInterest(),
    ]);

    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');
    return res.status(200).json({
      volume: {
        h24: volume.total,
        h24_change: null, // no prior-24h comparison point yet — see note above
        d7: null,
        d7_change: null,
        d30: null,
        d30_change: null,
      },
      openInterest: {
        current: openInterest.current,
      },
      meta: {
        volumeSources: volume.sources,
        openInterestMatched: openInterest.matchedCount,
        note: '24h volume = direct exchange APIs (Hyperliquid + Aster only so far — see research doc for the rest). 7d/30d need historical snapshots, not implemented yet. Open Interest = DefiLlama /overview/open-interest, free tier, exact-name matched.',
      },
    });
  } catch (err) {
    return res.status(502).json({ error: 'Aggregation failed' });
  }
}
