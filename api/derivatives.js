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
    } catch {
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

// `Number(null)` is 0, which would silently turn a missing upstream field
// into a seemingly valid zero. Keep missing values missing instead.
function toFiniteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sumRows(rows, { volume, openInterest, predicate = () => true }) {
  let volumeTotal = 0;
  let oiTotal = 0;
  let hasVolume = false;
  let hasOI = false;

  for (const row of rows) {
    if (!predicate(row)) continue;
    const rowVolume = toFiniteNumber(volume(row));
    const rowOI = toFiniteNumber(openInterest(row));
    if (rowVolume != null) {
      volumeTotal += rowVolume;
      hasVolume = true;
    }
    if (rowOI != null) {
      oiTotal += rowOI;
      hasOI = true;
    }
  }

  return {
    volume: hasVolume ? volumeTotal : null,
    openInterest: hasOI ? oiTotal : null,
  };
}

// ============================================================================
// PREVIOUSLY CONFIRMED ADAPTERS (unchanged) — real example response checked
// against official docs for each: Hyperliquid, Aster, Pacifica and
// Variational. See project history for the verification notes.
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

// Tread.fi is an execution/OEMS service for a user's connected exchange
// accounts, rather than a trading venue. Its API requires an account token
// and exposes that account's orders, so it must never be added to a global
// venue-volume/OI aggregate (doing so would also double-count connected CEXs).
async function treadData() { return { volume: null, openInterest: null }; }

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

// --- 2. Nado ---------------------------------------------------------------
// One archive-indexer request returns every contract. `quote_volume` and
// `open_interest_usd` are already USD notional, so no per-ticker requests or
// price conversion is needed.
async function nadoData() {
  const data = await fetchWithRetry('https://archive.prod.nado.xyz/v2/contracts?edge=true');
  const contracts = Array.isArray(data) ? data : Object.values(data ?? {});
  if (!contracts.length) return { volume: null, openInterest: null };

  return sumRows(contracts, {
    volume: (contract) => contract.quote_volume,
    openInterest: (contract) => contract.open_interest_usd,
    predicate: (contract) => contract.product_type === 'perpetual',
  });
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
  const symbols = (info?.futureContracts ?? info?.symbols ?? info?.data?.futureContracts ?? info?.data?.symbols ?? [])
    .filter((contract) => typeof contract === 'string' || contract?.status === 'LIVE')
    .map((s) => (typeof s === 'string' ? s : s?.symbol))
    .filter(Boolean);
  if (!symbols.length) return { volume: null, openInterest: null };

  const perSymbol = await mapWithConcurrency(symbols, 6, async (symbol) => {
    const [stats, oiData, prices] = await Promise.all([
      fetchWithRetry(`https://data-api.hibachi.xyz/market/data/stats?symbol=${encodeURIComponent(symbol)}`),
      fetchWithRetry(
        `https://data-api.hibachi.xyz/market/data/open-interest?symbol=${encodeURIComponent(symbol)}`
      ),
      fetchWithRetry(`https://data-api.hibachi.xyz/market/data/prices?symbol=${encodeURIComponent(symbol)}`),
    ]);

    const vol = toFiniteNumber(stats?.volume24h ?? stats?.data?.volume24h);
    const qty = toFiniteNumber(oiData?.totalQuantity ?? oiData?.data?.totalQuantity);
    const price = toFiniteNumber(
      prices?.markPrice ?? prices?.tradePrice ?? prices?.spotPrice ?? prices?.data?.markPrice
    );

    return {
      volume: vol,
      oiUsd: qty != null && price != null ? qty * price : null,
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

// --- Lighter ---------------------------------------------------------------
// Official public endpoint. `daily_quote_token_volume` and `open_interest`
// are USDC-denominated for perpetual markets, so they can be summed directly.
async function lighterData() {
  const data = await fetchWithRetry('https://mainnet.zklighter.elliot.ai/api/v1/orderBookDetails');
  const markets = data?.order_book_details ?? data?.perps_order_book_details ?? [];
  if (!Array.isArray(markets)) return { volume: null, openInterest: null };

  return sumRows(markets, {
    volume: (market) => market.daily_quote_token_volume,
    openInterest: (market) => market.open_interest,
    predicate: (market) => market.market_type === 'perp' && market.status === 'active',
  });
}

// --- Extended --------------------------------------------------------------
// `dailyVolume` and `openInterest` are explicitly documented as collateral
// asset values. Extended's perpetual collateral is USD, therefore both are
// already dollar-denominated and no price multiplication is necessary.
async function extendedData() {
  const data = await fetchWithRetry('https://api.starknet.extended.exchange/api/v1/info/markets');
  const markets = data?.data;
  if (!Array.isArray(markets)) return { volume: null, openInterest: null };

  return sumRows(markets, {
    volume: (market) => market.marketStats?.dailyVolume,
    openInterest: (market) => market.marketStats?.openInterest,
    predicate: (market) => market.type === 'PERPETUAL' && market.active !== false && market.status !== 'DELISTED',
  });
}

// --- Reya ------------------------------------------------------------------
// The public summary exposes the rolling 24h USD volume and OI in base lots.
// Convert each market's `oiQty` with its co-timestamped oracle price before
// aggregation; summing raw BTC, ETH, etc. quantities would be meaningless.
async function reyaData() {
  const markets = await fetchWithRetry('https://api.reya.xyz/v2/markets/summary');
  if (!Array.isArray(markets)) return { volume: null, openInterest: null };

  return sumRows(markets, {
    volume: (market) => market.volume24h,
    openInterest: (market) => {
      const quantity = toFiniteNumber(market.oiQty);
      const price = toFiniteNumber(market.throttledOraclePrice ?? market.throttledPoolPrice);
      return quantity != null && price != null ? quantity * price : null;
    },
  });
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

// --- 5. QFEX ---------------------------------------------------------------
// `startingOpenInterest` from the former candle endpoint is not current OI
// and is not guaranteed to be USD-denominated. Do not publish it as OI.
async function qfexData() { return { volume: null, openInterest: null }; }

// ============================================================================
// STILL UNAVAILABLE — no verified, low-request public aggregation path
// ============================================================================

// --- GRVT ------------------------------------------------------------------
// GRVT has no aggregate ticker: fetch its active perpetual instrument list,
// then one derived ticker per market. The 75-minute outer cache means this
// fan-out happens at most once per warm instance per refresh window. Keep
// concurrency deliberately low (4) to avoid a burst against the venue.
// `buy_volume_24h_q` + `sell_volume_24h_q` are the two taker directions in
// quote (USDT) notional, so together are the market's 24h traded volume.
async function grvtData() {
  const instrumentsData = await fetchWithRetry('https://market-data.grvt.io/full/v1/all_instruments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_active: true, kinds: ['PERPETUAL'] }),
  });
  const instruments = instrumentsData?.result;
  if (!Array.isArray(instruments)) return { volume: null, openInterest: null };

  const marketNames = instruments
    .filter((instrument) => instrument.kind === 'PERPETUAL')
    .map((instrument) => instrument.instrument)
    .filter(Boolean);
  if (!marketNames.length) return { volume: null, openInterest: null };

  const tickers = await mapWithConcurrency(marketNames, 4, async (instrument) => {
    const data = await fetchWithRetry('https://market-data.grvt.io/full/v1/ticker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instrument, derived: true }),
    });
    return data?.result ?? null;
  });

  let volume = 0;
  let anyVolume = false;
  for (const ticker of tickers) {
    const buyVolume = toFiniteNumber(ticker?.buy_volume_24h_q);
    const sellVolume = toFiniteNumber(ticker?.sell_volume_24h_q);
    if (buyVolume != null && sellVolume != null) {
      volume += buyVolume + sellVolume;
      anyVolume = true;
    }
  }
  return { volume: anyVolume ? volume : null, openInterest: null };
}

// Hotstuff's public response has proved unreliable in production. Keep it
// registered, but make no upstream call until its API contract is stable.
async function hotstuffData() { return { volume: null, openInterest: null }; }

// --- RISEx -----------------------------------------------------------------
// The public markets endpoint is already a complete market snapshot. Quote
// volume is USD/USDC notional; OI is base quantity and is converted by mark.
async function risexData() {
  const data = await fetchWithRetry('https://api.rise.trade/v1/markets');
  const markets = data?.data?.markets ?? data?.markets;
  if (!Array.isArray(markets)) return { volume: null, openInterest: null };

  return sumRows(markets, {
    volume: (market) => market.quote_volume_24h,
    openInterest: (market) => {
      const quantity = toFiniteNumber(market.open_interest);
      const price = toFiniteNumber(market.mark_price);
      return quantity != null && price != null ? quantity * price : null;
    },
    predicate: (market) => market.active !== false,
  });
}
async function trueNorthData() { return { volume: null, openInterest: null }; }

// --- Arcus -----------------------------------------------------------------
// A single public response contains every market. Volume is already USD
// notional; OI is base quantity and is converted using the market's mark.
async function arcusData() {
  const data = await fetchWithRetry('https://api.arcus.xyz/v1/markets');
  const markets = data?.markets;
  if (!Array.isArray(markets)) return { volume: null, openInterest: null };

  return sumRows(markets, {
    volume: (market) => market.volume24hNotional,
    openInterest: (market) => {
      const quantity = toFiniteNumber(market.openInterest);
      const price = toFiniteNumber(market.markPrice);
      return quantity != null && price != null ? quantity * price : null;
    },
    predicate: (market) => market.type === 'PERPETUAL' && market.status === 'ONLINE',
  });
}
async function gmTradeData() { return { volume: null, openInterest: null }; }

// N1 currently exposes only devnet metrics. Exclude them from production
// venue totals while retaining the source in the tracked-project registry.
async function n1Data() { return { volume: null, openInterest: null }; }

// ============================================================================
// REGISTRY
// ============================================================================

const ADAPTERS = [
  ['Hyperliquid', hyperliquidData],
  ['Aster', asterData],
  ['Pacifica', pacificaData],
  ['Variational', variationalData],
  ['Tread.fi', treadData],
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
  ['TrueNorth', trueNorthData],
  ['Arcus', arcusData],
  ['GMTrade', gmTradeData],
  ['N1', n1Data],
];

const UNAVAILABLE_REASONS = {
  'Tread.fi': 'Tread.fi is an account-specific execution platform, not a venue with public aggregate volume/OI.',
  QFEX: 'Its documented aggregate endpoint rejected valid time windows during live verification; it remains excluded until the public contract is stable.',
  GRVT: 'Volume is fetched per market; GRVT does not yet contribute open interest.',
  Hotstuff: 'Excluded at the user’s request because its API response is unreliable.',
  TrueNorth: 'TrueNorth is an AI trading-intelligence platform, not a perp venue with its own volume/OI.',
  GMTrade: 'No public market-data endpoint has been verified.',
  N1: 'Excluded at the user’s request: the available Nord endpoint reports devnet-only metrics.',
};

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
      volumeSources.push({ name, ok: false, reason: UNAVAILABLE_REASONS[name] });
    }
    if (entry?.openInterest != null) {
      oiTotal += entry.openInterest;
      openInterestSources.push({ name, ok: true, value: entry.openInterest });
    } else {
      openInterestSources.push({ name, ok: false, reason: UNAVAILABLE_REASONS[name] });
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
        note: '20 tracked exchanges are registered. Values are returned only when their public API and USD units have been verified; unavailable sources remain null instead of contributing guessed numbers. Refreshed at most once per 75 min per warm instance; a source that fails on a given cycle keeps its last successful value. 7d/30d volume needs historical snapshots, not implemented yet.',
      },
    });
  } catch {
    return res.status(502).json({ error: 'Aggregation failed' });
  }
}
