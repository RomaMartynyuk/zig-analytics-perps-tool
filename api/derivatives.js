// Vercel Serverless Function — aggregate Perp Volume (24h) and Open
// Interest across tracked exchanges, from direct exchange APIs only
// (DefiLlama dropped entirely — see prior comments in project history).
//
// ============================================================================
// CACHING — why and how
// ============================================================================
// Data refreshes hourly by design, so every request re-hitting 10+ exchange
// APIs would be wasteful and impolite. This uses a module-scope in-memory
// cache with a TTL: as long as a Vercel serverless instance stays "warm"
// (reused across consecutive requests, which Vercel does under normal
// traffic), repeated requests within the TTL window are served from memory
// with zero upstream calls. On a cold start, the cache is empty again and
// the next request pays the cost of a fresh fetch.
//
// LIMITATION — be upfront about this: this is NOT a durable, cross-instance
// cache. Multiple concurrent Vercel instances (different regions, or a
// fresh cold start after inactivity) each have their own independent copy
// of this in-memory cache. For a personal-scale dashboard this is a
// reasonable, zero-setup tradeoff. If guaranteed hourly refresh + a single
// shared cache across all instances is needed later, that requires an
// external store (Vercel KV / Upstash Redis both have a free tier) plus a
// Vercel Cron Job to drive the hourly refresh — happy to wire that up if
// wanted, but it requires creating that account, which can't be done here.
//
// PER-SOURCE STALE-ON-FAILURE — each exchange has its own cache entry.
// If an exchange's fetch fails on a given refresh cycle, its cache entry is
// left untouched (keeps showing the last successful value) rather than
// wiping it to null — a transient failure on one exchange never blanks out
// its row in the ranking, and never drags down the whole aggregate.
//
// ============================================================================
// NETWORK HELPERS — timeout, retry-with-backoff on 429, bounded concurrency
// ============================================================================

const CACHE_TTL_MS = 75 * 60 * 1000; // 75 min — middle of the requested 60-90 min window

async function fetchWithRetry(url, options = {}, { timeoutMs = 8000, retries = 2 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);

      if (res.status === 429 && attempt < retries) {
        const backoffMs = 500 * Math.pow(2, attempt); // 500ms, 1000ms, ...
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      clearTimeout(timer);
      if (attempt === retries) return null;
      // network error / timeout — brief pause, then retry
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  return null;
}

// Runs `fn` over `items` with at most `limit` in flight at once — used for
// the per-symbol fan-outs (Hibachi, edgeX, QFEX) so we don't fire 50+
// concurrent requests at a small exchange's API in one burst.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ============================================================================
// PREVIOUSLY CONFIRMED ADAPTERS (unchanged) — real example response checked
// against official docs for each: Hyperliquid, Aster, Pacifica, Variational,
// Decibel. See project history for the verification notes.
// ============================================================================

async function hyperliquidData() {
  const data = await fetchWithRetry('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
  });
  const assetCtxs = data?.[1];
  if (!Array.isArray(assetCtxs)) return { volume: null, openInterest: null };

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
  const data = await fetchWithRetry('https://fapi.asterdex.com/fapi/v1/ticker/24hr');
  if (!Array.isArray(data)) return { volume: null, openInterest: null };
  const volume = data.reduce((sum, t) => sum + (Number(t.quoteVolume) || 0), 0);
  return { volume, openInterest: null }; // no bulk OI endpoint on Binance-fork APIs
}

async function pacificaData() {
  const data = await fetchWithRetry('https://api.pacifica.fi/api/v1/info/prices');
  const rows = data?.data;
  if (!Array.isArray(rows)) return { volume: null, openInterest: null };

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
  const data = await fetchWithRetry(
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
  const data = await fetchWithRetry('https://api.mainnet.aptoslabs.com/decibel/api/v1/daily_stats');
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

// ============================================================================
// NEW ADAPTERS — lower confidence tier, built from docs description without
// a confirmed real example response (per explicit instruction to accept
// this risk). Each comment states: endpoint, fields summed, risk level, and
// exact fallback behavior if a field is missing or a request 429s.
// ============================================================================

// --- 1. StandX — RISK: LOW ------------------------------------------------
// GET https://perps.standx.com/api/query_market_overview
// The `summary` object is claimed to already contain exchange-wide totals —
// no per-symbol summing needed:
//   volume_quote_24h      -> 24h volume (USD notional)
//   open_interest_notional -> OI (USD notional, already dollar-denominated)
// Risk is LOW because this is a single bulk call with pre-aggregated
// totals — the main risk is just the exact field names being slightly off,
// not an architectural/units problem.
// Fallback: missing/renamed field, non-200, timeout, or exhausted 429
// retries -> both values null; the per-source cache then keeps whatever
// was last successfully fetched (see aggregator below), not overwritten.
async function standxData() {
  const data = await fetchWithRetry('https://perps.standx.com/api/query_market_overview');
  const summary = data?.summary ?? data?.data?.summary ?? data;
  const volume = Number(summary?.volume_quote_24h);
  const oi = Number(summary?.open_interest_notional);
  return {
    volume: Number.isFinite(volume) ? volume : null,
    openInterest: Number.isFinite(oi) ? oi : null,
  };
}

// --- 2. Nado — RISK: LOW ---------------------------------------------------
// GET https://archive.prod.nado.xyz/v2/contracts?edge=true
// Single call returns an array of perp contracts. Summed across all:
//   quote_volume     -> contributes to 24h volume
//   open_interest_usd -> contributes to OI (already USD, no price
//                        multiplication needed per the field name)
// Risk is LOW: one bulk endpoint, straightforward summing, no fan-out.
// Fallback: non-array response (wrong shape, error page, etc.) -> both
// values null for this refresh cycle; per-source cache preserves the prior
// good value instead of blanking the row.
async function nadoData() {
  const data = await fetchWithRetry('https://archive.prod.nado.xyz/v2/contracts?edge=true');
  const contracts = Array.isArray(data) ? data : data?.contracts ?? data?.data;
  if (!Array.isArray(contracts)) return { volume: null, openInterest: null };

  let volume = 0;
  let oi = 0;
  let any = false;
  for (const c of contracts) {
    const v = Number(c.quote_volume);
    const o = Number(c.open_interest_usd);
    if (Number.isFinite(v)) { volume += v; any = true; }
    if (Number.isFinite(o)) { oi += o; any = true; }
  }
  return any ? { volume, openInterest: oi } : { volume: null, openInterest: null };
}

// --- 3. Hibachi — RISK: MEDIUM ---------------------------------------------
// Base: https://data-api.hibachi.xyz
//   1. GET /market/exchange-info               -> list of symbols
//   2. per symbol, concurrency-limited to 6:
//      GET /market/data/stats?symbol=X          -> volume24h (per-symbol)
//      GET /market/data/open-interest?symbol=X  -> totalQuantity
// Then both are summed across all symbols.
//
// RISK IS MEDIUM FOR TWO SEPARATE REASONS:
//  (a) fan-out cost — 2 calls per symbol, mitigated with concurrency
//      limit 6 + retry/backoff on 429, but still more surface area to fail
//      than a single bulk call.
//  (b) UNIT SAFETY on OI specifically — "totalQuantity" strongly suggests
//      base-asset units (e.g. BTC contracts), not USD notional. Summing
//      raw quantities across different assets (BTC + ETH + SOL...) would
//      produce a meaningless number. To avoid that, this only adds a
//      symbol's OI into the total if a price field (tried: markPrice,
//      lastPrice, price, indexPrice — whichever the stats response
//      actually has) is ALSO present for that symbol, multiplying
//      quantity × price first. Symbols missing a resolvable price are
//      skipped for OI (partial coverage) rather than silently mixing units.
// Fallback: exchange-info failure -> nothing to iterate -> both null.
// Individual symbol failures are skipped, not fatal to the whole adapter
// (partial coverage rather than an all-or-nothing failure).
async function hibachiData() {
  const info = await fetchWithRetry('https://data-api.hibachi.xyz/market/exchange-info');
  const symbols = (info?.symbols ?? info?.data?.symbols ?? [])
    .map((s) => (typeof s === 'string' ? s : s?.symbol))
    .filter(Boolean);
  if (!symbols.length) return { volume: null, openInterest: null };

  const perSymbol = await mapWithConcurrency(symbols, 6, async (symbol) => {
    const [stats, oiData] = await Promise.all([
      fetchWithRetry(`https://data-api.hibachi.xyz/market/data/stats?symbol=${encodeURIComponent(symbol)}`),
      fetchWithRetry(
        `https://data-api.hibachi.xyz/market/data/open-interest?symbol=${encodeURIComponent(symbol)}`
      ),
    ]);

    const vol = Number(stats?.volume24h ?? stats?.data?.volume24h);
    const qty = Number(oiData?.totalQuantity ?? oiData?.data?.totalQuantity);
    const price = Number(
      stats?.markPrice ?? stats?.lastPrice ?? stats?.price ?? stats?.indexPrice ?? stats?.data?.markPrice
    );

    return {
      volume: Number.isFinite(vol) ? vol : null,
      oiUsd: Number.isFinite(qty) && Number.isFinite(price) ? qty * price : null,
    };
  });

  let volume = 0;
  let oi = 0;
  let anyVol = false;
  let anyOi = false;
  for (const r of perSymbol) {
    if (r.volume != null) { volume += r.volume; anyVol = true; }
    if (r.oiUsd != null) { oi += r.oiUsd; anyOi = true; }
  }
  return {
    volume: anyVol ? volume : null,
    openInterest: anyOi ? oi : null,
  };
}

// --- 4. edgeX — RISK: MEDIUM -------------------------------------------
// Base (confirmed via official Python SDK example): https://edgex-prod-v2.edgex.exchange
//   1. GET /api/v2/public/meta/getMetaData -> contractList (contractId per market)
//      (path is a best-effort guess following the /api/v2/public/{cat}/{method}
//      convention seen in the ticker path below — not confirmed 1:1 against docs)
//   2. GET /api/v2/public/quote/getTicker  -> per official docs this has
//      value/size (volume) and openInterest fields
//
// Tries the ticker call with NO contractId first, hoping it returns all
// markets at once. If that comes back empty/non-array, falls back to
// calling it once per contractId (bounded concurrency 6) using the
// contract list from metadata — this matches the fallback strategy
// requested. RISK IS MEDIUM: the SDK's own example calls
// get_24_hour_quote() WITH a specific contract id, which hints the bulk
// no-param call may not actually work — the per-contract fallback path is
// therefore the one most likely to be load-bearing in practice.
// Fallback: metadata failure -> nothing to iterate -> both null. Ticker
// failures (bulk or per-contract) -> null for that contract, skipped.
async function edgexData() {
  const bulkTicker = await fetchWithRetry('https://edgex-prod-v2.edgex.exchange/api/v2/public/quote/getTicker');
  const bulkList = bulkTicker?.data ?? bulkTicker?.tickers;

  if (Array.isArray(bulkList) && bulkList.length > 0) {
    return sumEdgexTickers(bulkList);
  }

  // Bulk call didn't return a usable list — fall back to per-contract.
  const meta = await fetchWithRetry('https://edgex-prod-v2.edgex.exchange/api/v2/public/meta/getMetaData');
  const contracts = meta?.data?.contractList ?? meta?.contractList;
  if (!Array.isArray(contracts) || contracts.length === 0) {
    return { volume: null, openInterest: null };
  }

  const contractIds = contracts.map((c) => c.contractId ?? c.id).filter(Boolean);
  const perContract = await mapWithConcurrency(contractIds, 6, async (contractId) => {
    const ticker = await fetchWithRetry(
      `https://edgex-prod-v2.edgex.exchange/api/v2/public/quote/getTicker?contractId=${encodeURIComponent(contractId)}`
    );
    const row = Array.isArray(ticker?.data) ? ticker.data[0] : ticker?.data ?? ticker;
    return row ?? null;
  });

  return sumEdgexTickers(perContract.filter(Boolean));
}

function sumEdgexTickers(rows) {
  let volume = 0;
  let oi = 0;
  let anyVol = false;
  let anyOi = false;
  for (const t of rows) {
    const v = Number(t.value ?? t.size);
    const o = Number(t.openInterest);
    if (Number.isFinite(v)) { volume += v; anyVol = true; }
    if (Number.isFinite(o)) { oi += o; anyOi = true; }
  }
  return {
    volume: anyVol ? volume : null,
    openInterest: anyOi ? oi : null,
  };
}

// --- 5. QFEX — RISK: HIGH ---------------------------------------------
// No convenient bulk totals endpoint exists per available docs. Path used:
//   1. GET https://api.qfex.com/refdata          -> list of symbols
//   2. per symbol: GET https://api.qfex.com/candles/{symbol}
//      -> usdVolume (per-candle volume), startingOpenInterest
//
// RISK IS HIGH for several stacked reasons:
//  - the candles endpoint's exact query contract (interval/limit/time
//    range params) isn't confirmed — this calls it with no extra params
//    and hopes the response is either a single latest candle or an array
//    ordered so the LAST entry is most recent;
//  - "startingOpenInterest" is OI at the START of whatever candle period
//    is returned, not necessarily the current/ending OI — this is used as
//    a rough proxy only, and is very likely to under/over-state real
//    current OI depending on how stale the returned candle is;
//  - summing usdVolume only makes sense if each symbol's candle actually
//    represents a comparable ~24h window, which isn't confirmed either.
// Given all of that, treat QFEX's numbers as the least trustworthy of the
// five — if this turns out too noisy in practice, the intended fix is to
// simply stop calling this adapter (comment it out of the registry below),
// not to keep guessing at the query params.
// Fallback: refdata failure -> nothing to iterate -> both null. Per-symbol
// candle failures are skipped individually (partial coverage).
async function qfexData() {
  const refdata = await fetchWithRetry('https://api.qfex.com/refdata');
  const symbols = (refdata?.symbols ?? refdata?.data ?? [])
    .map((s) => (typeof s === 'string' ? s : s?.symbol))
    .filter(Boolean);
  if (!symbols.length) return { volume: null, openInterest: null };

  const perSymbol = await mapWithConcurrency(symbols, 6, async (symbol) => {
    const data = await fetchWithRetry(`https://api.qfex.com/candles/${encodeURIComponent(symbol)}`);
    const candle = Array.isArray(data) ? data[data.length - 1] : data;
    const vol = Number(candle?.usdVolume);
    const oi = Number(candle?.startingOpenInterest);
    return {
      volume: Number.isFinite(vol) ? vol : null,
      oi: Number.isFinite(oi) ? oi : null,
    };
  });

  let volume = 0;
  let oi = 0;
  let anyVol = false;
  let anyOi = false;
  for (const r of perSymbol) {
    if (r.volume != null) { volume += r.volume; anyVol = true; }
    if (r.oi != null) { oi += r.oi; anyOi = true; }
  }
  return {
    volume: anyVol ? volume : null,
    openInterest: anyOi ? oi : null,
  };
}

// ============================================================================
// STUBBED — endpoint/field genuinely not researched at all yet (unchanged)
// ============================================================================

async function lighterData() { return { volume: null, openInterest: null }; }
async function reyaData() { return { volume: null, openInterest: null }; }
async function grvtData() { return { volume: null, openInterest: null }; } // per-instrument only, see project history
async function extendedData() { return { volume: null, openInterest: null }; }
async function hotstuffData() { return { volume: null, openInterest: null }; }
async function qfexOldStub() { return { volume: null, openInterest: null }; } // superseded by qfexData above
async function risexData() { return { volume: null, openInterest: null }; }

// ============================================================================
// REGISTRY
// ============================================================================

const ADAPTERS = [
  ['Hyperliquid', hyperliquidData],
  ['Aster', asterData],
  ['Pacifica', pacificaData],
  ['Variational', variationalData],
  ['Decibel', decibelData],
  ['StandX', standxData],
  ['Nado', nadoData],
  ['Hibachi', hibachiData],
  ['edgeX', edgexData],
  ['QFEX', qfexData],
  ['Lighter', lighterData],
  ['Reya', reyaData],
  ['GRVT', grvtData],
  ['Extended', extendedData],
  ['Hotstuff', hotstuffData],
  ['RISEx', risexData],
  // TrueNorth, N1/01, GMTrade, Arcus intentionally excluded — no safe
  // endpoint identified for any of them, per research doc's own caution.
];

// ============================================================================
// CACHE + AGGREGATION
// ============================================================================

// Per-source cache: { [name]: { volume, openInterest, updatedAt } }
// Survives across requests within a warm instance only — see header note.
const sourceCache = {};
let lastRefreshAt = 0;

async function refreshAllSources() {
  const results = await Promise.allSettled(ADAPTERS.map(([, fn]) => fn()));

  results.forEach((r, i) => {
    const [name] = ADAPTERS[i];
    const value = r.status === 'fulfilled' ? r.value : { volume: null, openInterest: null };

    const hasVolume = typeof value.volume === 'number';
    const hasOI = typeof value.openInterest === 'number';

    if (!hasVolume && !hasOI) {
      // Total miss this cycle — leave sourceCache[name] exactly as it was
      // (stale-but-valid, or simply absent if it has never succeeded).
      if (r.status === 'rejected') {
        console.error(`[derivatives] ${name} threw:`, r.reason?.message || r.reason);
      }
      return;
    }

    const prev = sourceCache[name] || {};
    sourceCache[name] = {
      // Only overwrite each field if this cycle actually produced a
      // number for it — a source that gives volume but not OI this round
      // shouldn't blank out an OI value it successfully reported before.
      volume: hasVolume ? value.volume : prev.volume ?? null,
      openInterest: hasOI ? value.openInterest : prev.openInterest ?? null,
      updatedAt: Date.now(),
    };
  });

  lastRefreshAt = Date.now();
}

async function getAggregate() {
  const isStale = Date.now() - lastRefreshAt > CACHE_TTL_MS;
  if (isStale) {
    await refreshAllSources();
  }

  let volumeTotal = 0;
  let oiTotal = 0;
  const volumeSources = [];
  const openInterestSources = [];

  for (const [name] of ADAPTERS) {
    const entry = sourceCache[name];
    if (entry?.volume != null) {
      volumeTotal += entry.volume;
      volumeSources.push({ name, ok: true, value: entry.volume });
    } else {
      volumeSources.push({ name, ok: false });
    }
    if (entry?.openInterest != null) {
      oiTotal += entry.openInterest;
      openInterestSources.push({ name, ok: true, value: entry.openInterest });
    } else {
      openInterestSources.push({ name, ok: false });
    }
  }

  const anyVolume = volumeSources.some((s) => s.ok);
  const anyOI = openInterestSources.some((s) => s.ok);

  return {
    volume: anyVolume ? volumeTotal : null,
    openInterest: anyOI ? oiTotal : null,
    volumeSources,
    openInterestSources,
    cacheAgeMs: Date.now() - lastRefreshAt,
  };
}

export default async function handler(req, res) {
  try {
    const agg = await getAggregate();

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
        cacheAgeMs: agg.cacheAgeMs,
        note: '10 exchanges registered: 5 previously confirmed with a real example response (Hyperliquid, Aster, Pacifica, Variational, Decibel), 5 newly added from docs description without a live-tested example (StandX/Nado low risk, Hibachi/edgeX medium risk, QFEX high risk — see per-adapter comments). Refreshed at most once per 75 min per warm instance; a source that fails on a given cycle keeps showing its last successful value instead of going blank. TrueNorth/N1/GMTrade/Arcus excluded — no safe endpoint identified. 7d/30d volume needs historical snapshots, not implemented yet.',
      },
    });
  } catch (err) {
    return res.status(502).json({ error: 'Aggregation failed' });
  }
}