// Vercel Serverless Function — aggregate Perp Volume (24h) across the 20
// tracked exchanges, via direct per-exchange APIs (per the research doc).
//
// WHY DIRECT EXCHANGE APIs INSTEAD OF DEFILLAMA:
// DeFiLlama's Derivatives data (both /overview/derivatives and the
// per-protocol /v2/chart/derivatives/protocol/{slug} chart) is Pro-only
// ($300/mo) — confirmed against DefiLlama's own pricing docs and several
// independent sources. Not available on the free api.llama.fi tier at all.
//
// CONFIDENCE PER EXCHANGE — only 5 of 20 are wired to a confirmed, verified
// endpoint with a real example response. The rest are left as honest stubs
// (return null) with a comment on exactly what's missing, rather than
// guessing field names or base URLs — silently-wrong data is worse than a
// visible NaN. Fill these in as each is verified against live docs/testing.
//
// Confirmed & wired (returns a real number):
//   Hyperliquid, Aster, Pacifica, Variational, Decibel (best-effort field match)
//
// Stubbed — endpoint exists per docs, but exact volume field/base URL not
// confirmed with a real example response (Lighter, edgeX, Reya, Nado, GRVT,
// Extended, Hibachi, StandX, Hotstuff, QFEX, RISEx):
//   these all have official REST/WS APIs per the research doc, several
//   explicitly mention 24h volume as available — worth verifying next.
//
// Excluded from volume adapters entirely — the research doc itself says
// not to guess an endpoint here without further product identification:
//   TrueNorth (analytics/intelligence layer, not a raw exchange feed)
//   N1 / 01 (chain/ecosystem layer, not one single exchange API)
//   GMTrade (doc: "do not invent a REST endpoint", needs verification)
//   Arcus (doc: "do not assume same architecture as HL/Aster", needs verification)
//
// 7d/30d volume: not available from any of these as a single live call —
// needs our own historical snapshots (Month 2 roadmap infra), returned null.

async function fetchJSON(url, options) {
  try {
    const res = await fetch(url, options);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// --- Confirmed adapters ------------------------------------------------

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

async function pacificaVolume24h() {
  const data = await fetchJSON('https://api.pacifica.fi/api/v1/info/prices');
  const rows = data?.data;
  if (!Array.isArray(rows)) return null;
  return rows.reduce((sum, r) => sum + (Number(r.volume_24h) || 0), 0);
}

async function variationalVolume24h() {
  const data = await fetchJSON(
    'https://omni-client-api.prod.ap-northeast-1.variational.io/metadata/stats'
  );
  const vol = Number(data?.total_volume_24h);
  return Number.isFinite(vol) ? vol : null;
}

async function decibelVolume24h() {
  // Doc confirms the endpoint + "Daily volume" as a field, but not the
  // exact JSON key — try the most likely candidates defensively.
  const data = await fetchJSON('https://api.mainnet.aptoslabs.com/decibel/api/v1/daily_stats');
  const candidate = data?.volume_24h ?? data?.daily_volume ?? data?.volume ?? data?.data?.volume_24h;
  const vol = Number(candidate);
  return Number.isFinite(vol) ? vol : null;
}

// --- Stubbed adapters — endpoint/field not confirmed yet ---------------
// Each returns null on purpose. Comment = what's missing before this can
// be wired for real, per the research doc's own confidence notes.

async function lighterVolume24h() {
  // docs.lighter.xyz/trading/api — markets/prices/trades/candles/funding/OI
  // documented, but "volume" is NOT explicitly listed as an exposed field.
  // Would likely need summing candles rather than a single ticker call.
  return null;
}

async function edgexVolume24h() {
  // github.com/edgex-Tech/edgex-python-sdk — "24h market statistics"
  // explicitly mentioned, but exact REST base URL / field name unconfirmed.
  return null;
}

async function reyaVolume24h() {
  // docs.reya.xyz — 24h volume is a WebSocket-only field in the current
  // docs; no confirmed simple REST snapshot endpoint for it yet.
  return null;
}

async function nadoVolume24h() {
  // docs.nado.xyz — Gateway/WS/Indexer architecture; doc doesn't list a
  // plain "volume" field, only positions/funding/OI explicitly.
  return null;
}

async function grvtVolume24h() {
  // api-docs.grvt.io/market_data_api/#ticker_1 — a REST ticker endpoint
  // exists, but its exact response schema (does it include volume?) and
  // API base domain weren't confirmed against a real example.
  return null;
}

async function extendedVolume24h() {
  // api.docs.extended.exchange — public streams are WS-only per docs
  // (order book, trades, mark price, candles, funding); no confirmed
  // REST 24h-volume snapshot endpoint.
  return null;
}

async function hibachiVolume24h() {
  // docs.hibachi.xyz — REST + WS + SDK exist, but no explicit volume
  // field confirmed in the docs excerpt reviewed.
  return null;
}

async function standxVolume24h() {
  // Base confirmed: https://perps.standx.com — "market overview" is listed
  // as a public capability but the exact path/field for 24h volume wasn't
  // confirmed against a real example response.
  return null;
}

async function hotstuffVolume24h() {
  // docs.hotstuff.trade — "24h volume" is explicitly listed as a documented
  // concept, but base API URL wasn't found/confirmed.
  return null;
}

async function qfexVolume24h() {
  // docs.qfex.com — REST history endpoints include "Taker-volume history",
  // but no confirmed simple current-24h-volume endpoint/base URL.
  return null;
}

async function risexVolume24h() {
  // developer.rise.trade — docs explicitly say the API is "work in
  // progress" with expected breaking changes; not safe to hard-code yet.
  return null;
}

// --- Registry ------------------------------------------------------------

const VOLUME_ADAPTERS = [
  ['Hyperliquid', hyperliquidVolume24h],
  ['Aster', asterVolume24h],
  ['Pacifica', pacificaVolume24h],
  ['Variational', variationalVolume24h],
  ['Decibel', decibelVolume24h],
  ['Lighter', lighterVolume24h],
  ['edgeX', edgexVolume24h],
  ['Reya', reyaVolume24h],
  ['Nado', nadoVolume24h],
  ['GRVT', grvtVolume24h],
  ['Extended', extendedVolume24h],
  ['Hibachi', hibachiVolume24h],
  ['StandX', standxVolume24h],
  ['Hotstuff', hotstuffVolume24h],
  ['QFEX', qfexVolume24h],
  ['RISEx', risexVolume24h],
  // TrueNorth, N1/01, GMTrade, Arcus intentionally excluded — see header.
];

async function aggregateVolume24h() {
  const results = await Promise.allSettled(VOLUME_ADAPTERS.map(([, fn]) => fn()));

  let total = 0;
  const sources = [];
  results.forEach((r, i) => {
    const [name] = VOLUME_ADAPTERS[i];
    const value = r.status === 'fulfilled' ? r.value : null;
    if (typeof value === 'number') {
      total += value;
      sources.push({ name, ok: true, value });
    } else {
      sources.push({ name, ok: false });
    }
  });

  const anySucceeded = sources.some((s) => s.ok);
  return { total: anySucceeded ? total : null, sources };
}

// --- Open Interest (free DefiLlama endpoint, strict exact matching) ------
//
// Maps each of our 20 tracked exchanges to the alias(es) DefiLlama might
// use for its name/displayName/module field. Exact match only (not fuzzy
// substring) — an earlier version used loose .includes() matching and
// produced an inflated, meaningless total by catching unrelated protocols.
// Canonical key = display name used in the ranking UI.

const OI_ALIASES = {
  Hyperliquid: ['hyperliquid'],
  Aster: ['aster'],
  Lighter: ['lighter'],
  edgeX: ['edgex'],
  Variational: ['variational'],
  Reya: ['reya'],
  Pacifica: ['pacifica'],
  Nado: ['nado'],
  Grvt: ['grvt'],
  Extended: ['extended'],
  Decibel: ['decibel'],
  Hibachi: ['hibachi'],
  StandX: ['standx'],
  GMTrade: ['gmtrade'],
  Rise: ['rise', 'risex'],
  QFEX: ['qfex'],
  TrueNorth: ['truenorth'],
  TradeHotStuff: ['hotstuff', 'tradehotstuff'],
  N1: ['n1', '01 exchange', '01exchange'],
  Arcus: ['arcus'],
};

function resolveCanonicalName(protocol) {
  const candidates = [protocol.name, protocol.displayName, protocol.module]
    .filter(Boolean)
    .map((s) => s.toLowerCase().trim());

  for (const [canonical, aliases] of Object.entries(OI_ALIASES)) {
    if (aliases.some((alias) => candidates.includes(alias))) return canonical;
  }
  return null;
}

async function aggregateOpenInterest() {
  const data = await fetchJSON(
    'https://api.llama.fi/overview/open-interest?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true'
  );
  const protocols = data?.protocols || [];

  const valueField = protocols[0]?.total24h != null ? 'total24h' : 'openInterestAtEnd';

  const sources = [];
  let current = 0;
  for (const p of protocols) {
    const canonical = resolveCanonicalName(p);
    if (!canonical) continue;
    const value = Number(p[valueField]) || 0;
    sources.push({ name: canonical, ok: true, value });
    current += value;
  }

  return { current: sources.length ? current : null, matchedCount: sources.length, sources };
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
        h24_change: null,
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
        openInterestSources: openInterest.sources,
        openInterestMatched: openInterest.matchedCount,
        note: '24h volume = 5 confirmed direct exchange APIs (Hyperliquid, Aster, Pacifica, Variational, Decibel); 11 more have adapter slots but are stubbed pending endpoint verification (see comments); TrueNorth/N1/GMTrade/Arcus excluded from volume per research doc (still eligible for OI matching above, since that comes from DefiLlama, not a direct exchange call). 7d/30d volume needs historical snapshots, not implemented yet.',
      },
    });
  } catch (err) {
    return res.status(502).json({ error: 'Aggregation failed' });
  }
}
