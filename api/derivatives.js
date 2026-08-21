// Vercel Serverless Function — aggregate Perp Volume (24h) AND Open
// Interest across the tracked exchanges, entirely from direct exchange
// APIs. DefiLlama is no longer used for anything here (its Derivatives
// volume data is Pro-only, and to keep one consistent data source instead
// of mixing providers, Open Interest was moved off DefiLlama too — even
// though its free /overview/open-interest endpoint technically worked).
//
// CONFIDENCE — same 5 exchanges confirmed with a real example response as
// before now also feed Open Interest, wherever that exchange's API exposes
// it in the same call:
//
//   Hyperliquid  — volume + OI (OI computed as units × markPx per asset,
//                  since the API reports OI in base-asset units, not USD)
//   Pacifica     — volume + OI (same assumption: open_interest is in
//                  base-asset units, multiplied by mark price)
//   Variational  — volume + OI (API's own docs example treats open_interest
//                  as already USD-denominated — used directly, no conversion)
//   Decibel      — volume + OI, best-effort field-name matching (doc
//                  mentions both exist in daily_stats but not exact keys)
//   Aster        — volume only. Binance-fork APIs expose OI per-symbol only
//                  (/fapi/v1/openInterest?symbol=X), not in the bulk 24hr
//                  ticker call — would need one request per symbol (~dozens
//                  of calls). Skipped for now rather than fan out that many
//                  requests inside a single serverless invocation.
//
// The other 11 tracked exchanges still have volume-only stub adapters from
// before (unchanged) — they return { volume: null, openInterest: null }
// until their endpoints are verified. TrueNorth, N1/01, GMTrade, and Arcus
// remain excluded entirely per the research doc's own caution against
// guessing an endpoint for those.
//
// 7d/30d volume: still not available from a single live call anywhere —
// needs historical snapshots (Month 2 roadmap infra), returned null.

async function fetchJSON(url, options) {
  try {
    const res = await fetch(url, options);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

const EMPTY = { volume: null, openInterest: null };

// --- Confirmed adapters — each returns { volume, openInterest } --------

async function hyperliquidData() {
  const data = await fetchJSON('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
  });
  const assetCtxs = data?.[1];
  if (!Array.isArray(assetCtxs)) return EMPTY;

  let volume = 0;
  let oi = 0;
  for (const ctx of assetCtxs) {
    volume += Number(ctx.dayNtlVlm) || 0;
    const units = Number(ctx.openInterest) || 0;
    const mark = Number(ctx.markPx) || 0;
    oi += units * mark;
  }
  return { volume, openInterest: oi };
}

async function asterData() {
  const data = await fetchJSON('https://fapi.asterdex.com/fapi/v1/ticker/24hr');
  if (!Array.isArray(data)) return EMPTY;
  const volume = data.reduce((sum, t) => sum + (Number(t.quoteVolume) || 0), 0);
  return { volume, openInterest: null }; // see header note on why OI is skipped
}

async function pacificaData() {
  const data = await fetchJSON('https://api.pacifica.fi/api/v1/info/prices');
  const rows = data?.data;
  if (!Array.isArray(rows)) return EMPTY;

  let volume = 0;
  let oi = 0;
  for (const r of rows) {
    volume += Number(r.volume_24h) || 0;
    const units = Number(r.open_interest) || 0;
    const mark = Number(r.mark) || 0;
    oi += units * mark;
  }
  return { volume, openInterest: oi };
}

async function variationalData() {
  const data = await fetchJSON(
    'https://omni-client-api.prod.ap-northeast-1.variational.io/metadata/stats'
  );
  const volume = Number(data?.total_volume_24h);
  const oi = Number(data?.open_interest);
  return {
    volume: Number.isFinite(volume) ? volume : null,
    openInterest: Number.isFinite(oi) ? oi : null,
  };
}

async function decibelData() {
  const data = await fetchJSON('https://api.mainnet.aptoslabs.com/decibel/api/v1/daily_stats');
  const volCandidate = data?.volume_24h ?? data?.daily_volume ?? data?.volume ?? data?.data?.volume_24h;
  const oiCandidate =
    data?.open_interest ?? data?.openInterest ?? data?.data?.open_interest ?? data?.data?.openInterest;
  const volume = Number(volCandidate);
  const oi = Number(oiCandidate);
  return {
    volume: Number.isFinite(volume) ? volume : null,
    openInterest: Number.isFinite(oi) ? oi : null,
  };
}

// --- Stubbed adapters — unchanged from the volume-only pass ------------
// Each returns EMPTY on purpose. See prior comments for what's missing
// before these can be wired for real.

async function lighterData() { return EMPTY; }
async function edgexData() { return EMPTY; }
async function reyaData() { return EMPTY; }
async function nadoData() { return EMPTY; }
async function grvtData() { return EMPTY; }
async function extendedData() { return EMPTY; }
async function hibachiData() { return EMPTY; }
async function standxData() { return EMPTY; }
async function hotstuffData() { return EMPTY; }
async function qfexData() { return EMPTY; }
async function risexData() { return EMPTY; }

// --- Registry ------------------------------------------------------------

const ADAPTERS = [
  ['Hyperliquid', hyperliquidData],
  ['Aster', asterData],
  ['Pacifica', pacificaData],
  ['Variational', variationalData],
  ['Decibel', decibelData],
  ['Lighter', lighterData],
  ['edgeX', edgexData],
  ['Reya', reyaData],
  ['Nado', nadoData],
  ['GRVT', grvtData],
  ['Extended', extendedData],
  ['Hibachi', hibachiData],
  ['StandX', standxData],
  ['Hotstuff', hotstuffData],
  ['QFEX', qfexData],
  ['RISEx', risexData],
  // TrueNorth, N1/01, GMTrade, Arcus intentionally excluded — see header.
];

async function aggregateAll() {
  const results = await Promise.allSettled(ADAPTERS.map(([, fn]) => fn()));

  let volumeTotal = 0;
  let oiTotal = 0;
  const volumeSources = [];
  const openInterestSources = [];

  results.forEach((r, i) => {
    const [name] = ADAPTERS[i];
    const { volume, openInterest } = r.status === 'fulfilled' ? r.value : EMPTY;

    if (typeof volume === 'number') {
      volumeTotal += volume;
      volumeSources.push({ name, ok: true, value: volume });
    } else {
      volumeSources.push({ name, ok: false });
    }

    if (typeof openInterest === 'number') {
      oiTotal += openInterest;
      openInterestSources.push({ name, ok: true, value: openInterest });
    } else {
      openInterestSources.push({ name, ok: false });
    }
  });

  const anyVolume = volumeSources.some((s) => s.ok);
  const anyOI = openInterestSources.some((s) => s.ok);

  return {
    volume: anyVolume ? volumeTotal : null,
    openInterest: anyOI ? oiTotal : null,
    volumeSources,
    openInterestSources,
  };
}

export default async function handler(req, res) {
  try {
    const agg = await aggregateAll();

    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');
    return res.status(200).json({
      volume: {
        h24: agg.volume,
        h24_change: null,
        d7: null,
        d7_change: null,
        d30: null,
        d30_change: null,
      },
      openInterest: {
        current: agg.openInterest,
      },
      meta: {
        volumeSources: agg.volumeSources,
        openInterestSources: agg.openInterestSources,
        note: 'Volume + OI both come from direct exchange APIs now (DefiLlama dropped entirely). 5 of 16 registered exchanges are fully confirmed (Hyperliquid, Pacifica, Variational, Decibel give both volume+OI; Aster gives volume only — no bulk OI endpoint). 11 more are stubbed pending endpoint verification. TrueNorth/N1/GMTrade/Arcus excluded per research doc. 7d/30d volume needs historical snapshots, not implemented yet.',
      },
    });
  } catch (err) {
    return res.status(502).json({ error: 'Aggregation failed' });
  }
}