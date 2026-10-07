# Participation & concentration — implementation and source audit

Audit date: 2026-10-07. This is an observed account/address footprint, **not a count of people or entities**. One entity can operate several accounts; smart accounts, pools, bots and account abstractions are not classified or clustered. No wallet anomaly detector, address-type classifier, raw-identity explorer or entity resolution is introduced.

## Release status — important limitation

The initial bounded N1 reference collector, daily storage, API and Canvas module are implemented. N1 full UTC-day trade traversal passed, but **independent same-window official-volume reconciliation did not pass**: N1 documents rolling 24h volume without its exact as-of time, not a historical UTC-calendar-day denominator. Its `comparableVolumeUsd`, `coverageRatio`, public Top shares, HHI and effective participant count remain NULL. The subsequent user-prioritized Arcus/Lighter work adds independent exact-day candle reconciliation; see the priority integration section below. Do not interpret N1's dataset as validated concentration.

N1 was selected for public global cursor pagination, explicit maker/taker account IDs, human-readable quote/base amounts, and manageable throughput. Its unresolved denominator makes it unsuitable for claiming full concentration coverage today. Do not use its orderbook/RFQ `physicalTime` as historical-volume as-of; official OpenAPI describes those as separate live state fields. Do not divide yesterday's trade sum by today's rolling headline volume. A numerically plausible ratio would still be an invalid reconciliation.

## Capability matrix

The runtime universe comes exclusively from `src/data/projects.json` and the synced `protocols` table. This audit table is documentation, not another runtime protocol list. “Unverified” means unavailable to this implementation, not proof that no such source exists. No on-chain event source/contract ABI was sufficiently verified to enable RPC reconstruction.

Source classes: B = PUBLIC_TRADE_API_WITH_ACCOUNT; D = ACCOUNT_DATA_AVAILABLE_BUT_VOLUME_ATTRIBUTION_LIMITED; E = PARTICIPANT_DATA_UNAVAILABLE. No A (verified on-chain events) or C (validated aggregated participation API) is used.

| Protocol | Execution model / scope | Class / official trade source | Participant ID | Per-trade volume | Historical capability | V1 |
|---|---|---|---|---|---|---|
| QFEX | Account-based perpetual venue | D · [public trades](https://docs.qfex.com/api-reference/rest/public/public-trades) | Public/opt-in account ID only | Public account trade amounts | Symbol/time-range subset, not proven full venue population | Unavailable: public subset cannot establish full concentration |
| TrueNorth | Research/intelligence product, inactive | E · [docs](https://docs.truenorth.xyz/) | Not verified as independent execution venue | Unavailable | Unavailable | Excluded by active policy |
| Arcus | Perpetual orderbook, matched fills | B · [public trades](https://docs.arcus.xyz/api-reference/public/get-recent-public-trades) | makerAddress/takerAddress, ADDRESS; no subaccount separation in this schema | Human base size × quote price | Microsecond from/to, newest first, max 1,000; safe inclusive boundary dedup | Adapter implemented; exact finalized UTC-day notional candles gate concentration |
| Rise | Perpetual matched orders | B · [trades channel](https://developer.rise.trade/reference/trades-channel) | Maker/taker addresses | Price × base size | Public stream; complete REST trade-history retention/paging and block time/finality still to validate | Candidate only |
| Variational | RFQ perpetual venue | E · [API](https://docs.variational.io/technical-documentation/api) | No global attributed trade tape verified | Public aggregate stats only | Account export is not a global historical tape | Unavailable |
| TradeHotStuff | Account/address matched venue | B · [trades](https://docs.hotstuff.trade/api-reference/info/global/trades) | maker/taker addresses in official schema | Public print price/size | Latest max 50; full historical traversal not verified | Unavailable: no proven full-day retention; existing API reliability restriction preserved |
| Pacifica | Account/subaccount orderbook | D · [recent trades](https://docs.pacifica.fi/api-documentation/api/rest-api/markets/get-recent-trades) | Public prints omit identity; account history requires a known account | USD price × token amount | Recent market tape; account history does not enumerate the population | Unavailable |
| Nado | Perpetual orderbook + AMM matching | B · [archive matches](https://docs.nado.xyz/developer-resources/api/archive-indexer/matches) | bytes32 sender includes address + subaccount, SUBACCOUNT | Match base/quote x18 fields | Optional product/subaccount filters, submission-index paging; two match views/AMM semantics need dedup/reconciliation | Candidate only |
| Hibachi | Account-based perpetual venue | D · [official API collection](https://www.postman.com/hibachi-xyz/hibachi-public/collection/kjruxq4/hibachi-api) | Account identity available privately; global public identity tape not verified | Market prints/stats | Global participant retention not verified | Unavailable |
| GMTrade | Solana perpetual venue; event semantics unverified | E · [official docs](https://docs.gmtrade.xyz/) | No validated participant tape or verified event schema | No validated attributed source | Unverified | Unavailable |
| N1 | CLOB/RFQ perpetual venue | B · [REST](https://docs.n1.xyz/developers/api/rest), [OpenAPI](https://api-mainnet.n1.xyz/openapi.json) | makerId/takerId, ACCOUNT; uint31 trading account, not wallet/person | Human `price * baseSize`, USDC quote nominal USD | Global `/trades`, RFC3339 since/until, tradeId cursor, page size 255 | Participation supported; concentration gated by NULL reconciliation |
| StandX | Account-based perpetual venue | D · [HTTP API](https://docs.standx.com/standx-api/perps-http) | Public market prints omit identity; account fills require JWT | Public quote_qty | Recent prints vs private account history | Unavailable |
| Hyperliquid | Perpetual orderbook; parent venue incl. relevant HIP-3 scope | B · [public WS trades](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions) | `users: [buyer, seller]`, ADDRESS | Human px × sz | Forward stream; recent snapshot is not full history; arbitrary-user fills are not global enumeration | Candidate: durable forward worker/archive required; never sum HIP-3 children into parent twice |
| Lighter | Account-based orderbook, perps vs spot | B · [trades](https://apidocs.lighter.xyz/reference/trades) | ask_account_id/bid_account_id incl. subaccounts/pools; account IDs, not people | Explicit usd_amount | Frozen upper timestamp, opaque cursor, max 100, all documented execution types | Adapter implemented; exact daily quote candles; full-day scan and reconciliation still required |
| Aster | Perpetual account orderbook | D · [official API](https://github.com/asterdex/api-docs) | Market prints anonymous; account fills authenticated | Price × qty | Public recent/aggregate trades do not identify both accounts | Unavailable |
| edgeX | Account-based orderbook | B · [official WS schema](https://github.com/edgex-org/edgex-gitbook/blob/main/api/websocket-api.md) | takerAccountId/makerAccountId in LatestTrades | Explicit value/price/size | Stream verified in schema; full replay/history not validated | Candidate only |
| Grvt | Account/subaccount orderbook | D · [market API](https://api-docs.grvt.io/market_data_api/) | Global tape identity not validated; private account trade history exists | Public print notional/size | Historical public prices are not a participant population | Unavailable; docs access also limited during audit |
| Extended | Starknet account orderbook | D · [official API](https://api.docs.extended.exchange/) | Public prints do not establish a global account population; account history private | Quote price × quantity | Public stream / private historical fills | Unavailable; no verified event ABI scan enabled |
| Reya | Settled perpetual executions; account venue | B · [official execution schema](https://github.com/Reya-Labs/reya-api-specs/blob/main/trading-schemas.json) | takerAccountId; maker optional for legacy/ADL/MARKET_CLOSE, ACCOUNT | Human price × qty (rUSD quote context) | Public market execution pagination | Candidate: explicit one-sided execution types and quote-denomination/coverage reconciliation needed |
| Perpl | Perpetual orderbook on Monad | D · [REST](https://docs.perpl.xyz/resources/for-developers/api/rest), [WS](https://docs.perpl.xyz/resources/for-developers/api/websocket) | Public Trade has at,p,s,sd only; account history authenticated | Public price/size; collateral USD-equivalence caveat | Candles public; attributed account tape private | Unavailable |
| Bullet | Perpetual orderbook, FAPI surface | D · [official API](https://tradingapi.bullet.xyz/docs/) | Public FAPI prints anonymous; userTrades authenticated | Human quote/base amounts | Public tape/candles vs private account trades | Unavailable |
| Tread.fi | Execution frontend, inactive | E · Existing registry [integration audit](protocol-integrations-7.5.md) | No independently validated venue population | Parent execution volume must not be duplicated | Unavailable as independent venue | Excluded by active policy |

## Methodology table

| Dimension | Implemented methodology |
|---|---|
| Identity | `protocol slug : ACCOUNT : numeric ID`, HMAC with a random per-run salt for private temporary checkpoints; no cross-protocol joins |
| Notional | N1 human quote price × human base size; **no action integer decimal scaling**. USDC nominal USD; peg risk remains |
| Attribution | MAKER_TAKER_HALF_SPLIT: one economic fill, half to maker and half to taker. A self-match contributes once to one distinct account |
| Dedup | Stable protocol + market + trade ID; unsafe numeric IDs rejected; retries never reattribute an already seen fill |
| Window | Completed UTC calendar day `[00:00, next 00:00)`; source inclusive query boundaries are locally filtered half-open |
| Mean / median / p90 | Sum of attributed volume / positive-volume accounts; exact in-memory median; p90 nearest rank |
| Top shares | Sum largest 1/5/10 accounts / attributed total ×100; Top1% only with ≥100 accounts |
| HHI | Sum of squared participant shares, internal 0–1; effective count =1/HHI |
| Coverage | Attributed total / independently comparable official SAME-window volume, **never** incompatible live rolling volume |
| Quality | COMPLETE exact full traversal/zero rejects/reconciled total; HIGH ≥95%; PARTIAL ≥80%; LOW <80% or >102%; UNAVAILABLE without a compatible denominator |
| Publication | Incomplete or malformed populations have NULL distribution metrics. Unknown/low reconciliation suppresses Top shares/HHI/effective count. Signals always false in V1 |
| Multi-day | Stored daily observations only. Distinct counts are not summed; medians/HHI cannot be reconstructed for a union of days from daily aggregates |
| Finality | Source is N1 public historical execution tape, not an unfinalized RPC head. Chain confirmation guarantees independently unverified and not claimed. Explicit unfinalized normalized fills rejected |

## Real data — measured, not fixture data

UTC window: **2026-10-06T00:00:00Z → 2026-10-07T00:00:00Z**. Two independent reads returned the same 13,405 trades, zero rejected/duplicate records, 411 accounts and $1,754,330.854735198 attributed volume.

| Metric | N1 observed full-tape diagnostic | Public/persisted |
|---|---:|---:|
| Attributed volume | $1,754,330.854735198 | $1,754,330.85473520 |
| Active trading accounts | 411 | 411 |
| Mean/account | $4,268.444902032112 | $4,268.44490203 |
| Median/account | $513.9594 | $513.95940000 |
| p90/account | $5,996.3063545 | $5,996.30635450 |
| Top1 | 18.1221913948% | NULL — reconciliation unavailable |
| Top5 | 49.4682043507% | NULL |
| Top10 | 59.9705259680% | NULL |
| Top1% (5 of 411 accounts) | 49.4682043507% | NULL |
| HHI | 0.068024276275 | NULL |
| Effective count | 14.7006341671 | NULL |
| Market aggregates | 35 traded perpetual markets | 35; no invented zero-trade market populations |

These diagnostic concentration values describe the retrieved tape only, not a verified protocol-wide estimate, and are intentionally not persisted or rendered as validated concentration. No raw IDs or account ranking is published.

Manual arithmetic check: three official BTC fills at2026-10-06T11:59:37.628075Z were `86220 × 0.00005 = $4.311`, `86225 × 0.00005 = $4.31125`, and `86225 × 0.00004 = $3.449`. Each had two distinct account IDs; the attributed halves were respectively$2.1555, $2.155625 and$1.7245 per side. No account identifiers were printed. This required one additional public API call outside the full-collection benchmarks.

### Reconciliation table

| Attributed UTC-day volume | Official volume observed | Official window | Coverage | Verdict |
|---:|---:|---|---|---|
| $1,754,330.854735198 | $2,252,349.381996071 (08:52:22Z) / $2,248,794.601742291 (08:57:09Z) | Untimestamped rolling24h; different from Oct6 calendar day | NULL | **NOT COMPARABLE**; do not calculate a ratio |

Public response verified from Neon: `snapshotDate=2026-10-06`, participant availability **1/20**, reconciled concentration **0/20**. Counts are queried dynamically, not encoded in the implementation. PostgreSQL DATE is explicitly cast to text so driver/local timezone cannot shift the canonical date. Existing headline snapshot coverage is Volume16/20, OI14/20, TVL14/20; that is a different dataset, not participant coverage.

## Storage, collection and operations

Migration009 adds `protocol_participation_daily`, FK to `protocols`, financial `NUMERIC(38,8)`, nullable concentration/coverage, exact window timestamps, source/method/quality, immutable identity unique index `(protocol_id,snapshot_date,COALESCE(market_id,''),methodology_version)`. A retry upserts the same protocol/market/day/version; an incomplete retry cannot overwrite a complete record. Raw trades, identifiers, salts and unreconciled diagnostic HHI are absent from permanent storage.

This runs as a **separate bounded CLI stage**, not inside the ordinary Volume/OI daily collector. First scan:55 calls,53 pages,110.6s. Second persisted scan:55 calls,53 pages,77.3s. RPC calls:0. This is too expensive to add to the existing serverless snapshot function. There are still **12 Vercel functions**, unchanged; the module extends the existing concentration endpoint.

```sh
npm run db:migrate
npm run check:participation -- n1
# Same frozen UTC day resumes automatically after the default 100-page/50s budget:
npm run check:participation -- n1 --persist
# Explicit completed day, with a larger bounded diagnostic budget:
npm run check:participation -- n1 --day=2026-10-06 --persist --max-pages=1000 --budget-ms=600000
```

No new credentials: use existing `.env.local` / `DATABASE_URL`. API scans need no signing key. Default day is yesterday in UTC. Past days are scanned only from real retained trades, never copied from today's data. No bulk backfill performed.

Configure an external scheduled worker at12:00UTC to invoke the persisted command and retry partial runs for the same `--day`; **this worker schedule is not provisioned by this change**. Existing Vercel Cron is unmodified. Default batches respect 150ms minimum inter-page pacing, four attempts with exponential backoff, request timeouts, page/time budgets, safe monotonic cursors. Per-protocol errors are isolated and do not stop other adapters or ordinary snapshots. On full completion private salted account hashes/cursors are deleted; aborted checkpoints live locally in a mode0700 temp directory, mode0600 files, expire after48h idle, atomic writes. They are not anonymous against a filesystem attacker (salt + small account-ID space); protect host access. There is no durable Vercel `/tmp` guarantee; schedule the CLI on a persistent worker host. Concurrent same-protocol/day workers are not supported; use one scheduler instance.

API:

```text
/api/analytics/concentration?view=participation&period=24h
/api/analytics/concentration?view=participation&period=7d
/api/analytics/concentration?view=participation&period=30d
/api/analytics/concentration?view=participation&period=24h&protocol=arcus&marketId=1
```

Response includes period/window/snapshot, active dynamic registry, per-metric NULLs, account type, quality/provenance/method, footprint vs concentration coverage, actual daily history progress. Current cross-section uses one common participant snapshot date (not stale per-protocol fallback). Market scope is optional but requires a protocol slug: numeric market IDs are venue-local, not cross-venue asset identity. No frontend external API fetching.

7d/30d expose daily records only when that many actual usable consecutive days exist. At present1/7 and1/30. Whole-period population and concentration remain explicitly unavailable even then. Future true period concentration requires a separately approved retained account-volume layer, not summing daily statistics.

Signals / Feed / Research Cases / Lifecycle / Watchlist / Timeline remain unchanged; no unvalidated concentration evidence enters them. Future signal integration must require stable compatible methods, high coverage and enough actual history. No causal claims or accusations are generated.

## Next correctness milestone

For N1, obtain an official historical daily notional endpoint/candle aggregate with explicit UTC bounds, or a documented exact rolling-volume as-of contract and re-version the methodology. N1 remains participation-only. The prioritized Arcus/Lighter adapters now have independent exact-day notional candles, but each run must pass full traversal and actual coverage gates before its public concentration becomes available. Reya/Nado remain candidates, not validated substitutes. Unknown coverage is never replaced by a plausible-looking ratio.

## Priority integrations — Arcus, Lighter, Variational (2026-10-07)

New files: `server/participationTape.js`, `server/arcusParticipationAdapter.js`, `server/lighterParticipationAdapter.js`, `server/participationCapabilities.js`, `test/priorityParticipation.test.js`. Extended the existing collector, service, diagnostic worker, README and this report. No protocol API for Home/Points/Funding was rewritten and no additional function, schema or external provider was introduced.

### Arcus

Official [public trade schema](https://docs.arcus.xyz/api-reference/public/get-recent-public-trades.md) explicitly defines one maker/taker pairing per row, human USD `price`, base `size`, checksummed addresses and microsecond timestamp. Collect all frozen USD perpetual markets, excluding spot and markets created after the day. Addresses are lowercased before protocol-scoped HMAC hashing; they are addresses, not subaccounts or people.

Inclusive newest-first pagination reuses the oldest microsecond, deduplicates overlaps, and stops as incomplete if the boundary cannot advance (including a saturated 1,000-row microsecond). Never decrement past an unresolved timestamp. Frozen bounds are validated on every page. Dedup checkpoint storage retains only the overlapping boundary, not the day's full tape.

Official [daily candles](https://docs.arcus.xyz/api-reference/public/get-ohlcv-candles.md) have `notionalVolume` explicitly in USD. Only the exact UTC-day `openTime`, `timeframe=1d`, and `isFinal=true` bar is eligible; observed next-day open candles are ignored. Never convert base candle volume via OHLC. Missing/duplicate bars are NULL, not zero. Protocol reconciliation requires every frozen market's denominator; per-market rows also retain their own independent reconciliation. Concentration is gated by the established coverage policy; high coverage is not a claim of perfect agreement.

### Lighter

Official [trades](https://apidocs.lighter.xyz/reference/trades.md) provide `usd_amount`, string trade IDs, account IDs (including subaccounts/public pools), maker direction, and millisecond time. The adapter requests global `market_type=perp`, `aggregate=false`, all documented execution types, descending timestamp with a frozen `from=end-1` upper bound and opaque cursor. Stop at the lower UTC-day bound. Invalid identities/types/bounds suppress population publication. Catalog and snapshots remain dynamic.

Official [candles](https://apidocs.lighter.xyz/reference/candles.md) define `V` as quote-token volume, distinct from base `v`. Request exact completed UTC days with `set_timestamp_to_end=false`, and require a matching day-open millisecond timestamp. Missing bars or omitted `V` remain NULL. Full source traversal and actual candle reconciliation are required before publishing concentration.

The current [rate-limit documentation](https://apidocs.lighter.xyz/docs/rate-limits.md) specifies 60 standard requests/minute and explicitly classifies both HTTP429 and HTTP405 as rate limits, with a 60-second firewall cooldown. Production collection now uses at least 1,500ms request spacing (about 40/minute), honors cooldowns and freezes/resumes the same day. Initial faster diagnostics received HTTP405; the checkpoint was preserved and a slower 20-page continuation succeeded without retries. Do not run parallel workers on the same IP. A full daily tape may require hours; do not interpret a successful small batch as a full-day dataset.

The official [historical bulk export](https://apidocs.lighter.xyz/reference/export_historicaltrades.md) currently requires a one-time 100 LIT transfer and updates at20:00UTC. **No payment, wallet action, account change or paid-export request was made.** It is not integrated. A Builder account is an official alternative for more practical read throughput, but requesting/authenticating it requires separate setup. No credentials were invented or additional access silently acquired.

### Variational

Current official [API docs](https://docs.variational.io/technical-documentation/api.md) expose aggregate `/metadata/stats`, not participant identity/volume distribution. [Trade and Transfer History](https://docs.variational.io/technical-documentation/trade-and-transfer-history.md) is a user's portfolio CSV export (up to10,000 rows), not global enumeration. Therefore no defensible global participant count, Top shares or HHI can be produced. The collector and API now explicitly explain this limitation; no substitute count is inferred from Volume/OI/TVL, deposits, referral groups or private sample accounts. An official global attributed execution export or complete aggregated account-volume distribution with exact window/coverage is still needed.

### Bounded worker commands

```sh
npm run check:participation -- arcus --persist --max-pages=1000 --budget-ms=600000 --max-runs=10
npm run check:participation -- lighter --persist --max-pages=1000 --budget-ms=600000 --max-runs=100
npm run check:participation -- variational
```

`--max-runs` defaults to1 and is capped at100. Every batch uses the same day chosen once at process start; it stops on completion, unsupported source, failure or unsafe pagination. No unlimited loop or serverless daily-job expansion. Schedule one dedicated worker on a persistent host; normal Vercel market snapshots remain unaffected. To resume a previous day, pass its explicit `--day=YYYY-MM-DD` within checkpoint retention. A partial scan persists NULL public metrics, never partial population totals disguised as daily metrics.

### Checks

138 tests passed (including15 new priority-source tests), targeted lint and Node syntax checks passed. Production frontend build passed using the unchanged locked dependencies in the existing non-iCloud temporary workspace; the original workspace build stalled on dataless dependencies and was stopped. No frontend source changed during this priority integration. Real official REST pages, daily candles and checkpoint continuation were tested. Full-day publication status is reported separately from these plumbing checks. No deployment performed.

Retries are adaptive: a rate-limit response increases pacing, and the slower cadence is retained in the frozen-day checkpoint across batches. Arcus's precise JSON `retryAfterMs` is honored in addition to the header. A provider cooldown greater than60s stops automatic retries rather than shortening the requested wait. Only overlap-boundary dedup IDs are retained; earlier source pages are made unreachable by validated decreasing timestamps/cursors. This avoids storing a day's entire ID tape in each checkpoint.

Early real reconciliation diagnostics for2026-10-06: Arcus BTC attributed$266,617,978.03765905 vs finalized candle$269,782,146.45848715 (98.8271%); ETH$31,541,514.74973516 vs$31,591,214.973401926 (99.8427%). These are HIGH coverage under the established policy, **not exact agreement**, and were measured from completed individual market scans while the protocol scan was still running. Some OFFLINE markets (F/BAC/CCL) have no candle for the day; no historical zero is inferred from their current zero rolling volume. Without all required denominators the protocol-wide concentration remains NULL, even if individual market rows can be validated.

Lighter real diagnostic batches traversed36,500 executions with zero rejections/duplicates. The final slower20-page continuation made20 requests, zero retries, in28.8s and persisted NULL public daily metrics because traversal was incomplete. Counts/HHI from the partial observed diagnostic distribution are intentionally not presented as daily protocol metrics. Independent full-day Lighter reconciliation has **not yet passed**; the adapter's plumbing is implemented, not a claim of a validated daily concentration release.

### Completed Arcus real day and current release coverage

The full2026-10-06 UTC day completed: **713,865 accepted executions, zero rejected records, 3,725 deduplicated overlaps, 4,760 observed trading addresses, $492,926,320.07194555 attributed volume**. Mean$103,555.94959495; median$5,907.73035833; p90$95,993.89822939. All67 frozen markets were traversed;61 had an exact finalized candle. The permanent dataset contains one protocol row plus60 traded-market rows. No raw identifiers were stored.

Protocol Top shares/HHI remain NULL because six required market denominators are unavailable. Do not use today's inactive-market rolling zero as yesterday's official daily zero. Market-level concentration passed the policy gates for60 traded markets:42 HIGH,14 COMPLETE,4 PARTIAL. These classes preserve the measured coverage difference; PARTIAL is not relabeled as complete. All signal eligibility remains false.

Example verified public API: `protocol=arcus&marketId=1` reports BTC coverage98.82713943%,2,153 observed addresses, HHI0.042772559765, Top5=39.5350675501%. It is one explicitly scoped market, **not the protocol-wide distribution**. Protocol-local IDs now require the protocol query parameter to avoid comparing unrelated same-ID markets across venues.

Actual current common-day response: participant footprint **2/20** (N1 and Arcus); protocol-wide concentration **0/20**. Arcus complete; Lighter incomplete with public metrics NULL; Variational explicitly unsupported pending a suitable official source. Coverage is queried from Neon/registry, not hardcoded. Arcus's last bounded batch made123 calls with zero retries in488.5s; adaptive4s pacing avoided the earlier429s. Total scan across the resumed batches took considerably longer and should run on a dedicated worker, not Vercel's ordinary metrics cron.

Still required: finish the full Lighter tape on a properly provisioned worker/read-access tier; obtain Variational's global attributed data; resolve Arcus's six missing denominators before publishing protocol-wide concentration. No production deployment or worker scheduler was provisioned by this change.

## Implementation and verification

Created: `server/participationMath.js`, `server/n1ParticipationAdapter.js`, `server/participationCollector.js`, `server/participationRepository.js`, `server/participationService.js`, `migrations/009_participation_analytics.sql`, `scripts/check-participation.js`, `src/hooks/useParticipationData.js`, `src/components/ParticipationConcentration.jsx`, `test/participation.test.js`, and this report.

Modified: the existing `api/analytics/concentration.js` handler, `src/components/AnalyticsPage.jsx`, scoped `src/App.css`, `package.json` (diagnostic command only), README, and generated tracked `dist` assets. No extra Vercel function or dependency version was added.

Checks actually run:

- Full test suite: **123 passed, zero failed**, including 16 focused participant tests for attribution, duplicate/resume behavior, reconciliation, NULLs, invalid/overflow values, UTC dates, dynamic populations, retries, fault isolation, and private aggregate upsert.
- Targeted lint of new/changed implementation files passed. `git diff --check` passed. The existing whole-project lint command fails on vendor files under `node_modules`; this unrelated lint configuration was not changed.
- Production build passed using a fresh install of the existing lockfile in a temporary non-iCloud workspace (2,246 modules). Later builds in the original workspace were blocked by iCloud `dataless` dependency files reading as empty. No dependency upgrades or source changes were used to bypass that environmental problem.
- Existing real-data diagnostics passed: Signals, Research Feed, Signal History, Signal Lifecycle (`--all`), Watchlist, and Research Timeline (Lighter).
- Migration 009 applied to configured Neon. Real collection persisted 36 protocol/market rows; verification found zero duplicate scope/day/version records. Public concentration values remained NULL.
- Local preview inspected with real Neon responses at desktop 1440×960 and mobile 390×844. Desktop document width matched viewport; mobile document width was 390px with scrolling confined to the table. N1 details showed the exact UTC interval and unavailable concentration. Keyboard selection of 30D showed **1 of 30** actual observations; 7D showed **1 of 7**. No synthetic history or other-page redesign was introduced.

No deployment performed. Automatic external-worker scheduling and independent same-window volume reconciliation remain required before claiming a fully validated concentration release.

### Dedicated worker follow-up

The scheduler implementation is now available in `scripts/participation-worker.js`, with a persistent checkpoint directory, migration010 singleton lease, bounded retry/fairness, noon UTC timing, completed-day skipping and graceful shutdown. See [worker setup](participation-worker.md). This supersedes the earlier need to write a scheduler, **not** the requirement to provision and enable it on a chosen host. It does not resolve missing Arcus denominators or Variational source availability and does not claim a completed Lighter full-day calibration.
