# ZigAnalytics

Analytics dashboard for tracking points-farming / DeFi / perp-DEX projects.
Built for @herzig_crypto — matches the approved homepage mockup, with real
live data for TVL, Perp Volume (24h), and Open Interest across 20 tracked
exchanges.

> **New to this repo?** Read `PROJECT_CONTEXT.md` first — it's a dense,
> single-file summary of the whole project (architecture decisions, current
> data confidence per exchange, known limitations) meant to bring a fresh
> chat session up to speed without re-reading history.

## Run locally

Requires Node.js 18+ (check with `node -v`).

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`.

**Important:** `npm run dev` / `npm run preview` alone won't run the
`/api/*` serverless functions — Vite's dev server doesn't execute them.
Every live-data card will show `NaN` locally unless you either deploy to
Vercel, or run `npx vercel dev` (needs a free Vercel account + `vercel
login`, then it serves both frontend and `/api` correctly).

## What's built

**Homepage (Dashboard)** — matches the approved mockup 1:1: stat cards
(Perp Volume 24h, Next Snapshot, Best Ticker 24h, Open Interest), live Perps Volume Graph,
Perp Volume / Open Interest rankings, recurring Upcoming Snapshots, Last News
placeholder, Last Perps Tickers. All list cards scroll internally with a
custom thin scrollbar once content overflows.

**Sidebar navigation** — fully functional and animated (framer-motion
`layoutId` spring animation on the active indicator, fade transition on
content). Two sections have real content:

- **Dashboard** — stat cards + Perp Volume/OI rankings and Last Perps Tickers
  are **real, live data**. The ticker card uses one batched CoinGecko request
  for HYPE, LIT, EDGE, ASTER, BP and GRVT, ordered by live USD price. Perps
  Volume Graph visualizes the live 24h distribution across the top exchanges;
  Last News is still a placeholder. Upcoming Snapshots are
  configured per project in `src/data/projects.json`.
- **Projects** — live TVL from DeFiLlama for all 20 tracked projects.
- **Predictions** — Point Value Lab shows projects with a live points campaign
  or configured snapshot. Every card has a user-controlled price-per-point
  estimate (`FDV ÷ total points`) and a reserved PolyMarket forecast field.
  Its Lighter Robinhood campaign card uses the live LIT price and the separate
  formula `11M LIT value ÷ (65,000 × selected weeks)`.
- **Analytics** — an intentionally empty, varied-card canvas ready for future
  research modules.

News, Calendar, Community and Settings are intentionally hidden from the
sidebar until their content is ready.

### Prediction defaults

Set the initial sliders for each standard campaign directly in its project
object in `src/data/projects.json`:

```json
"prediction_defaults": {
  "points_millions": 1000,
  "fdv_millions": 100,
  "user_allocation_percent": 10
}
```

`points_millions` and `fdv_millions` are in millions;
`user_allocation_percent` is the share of the project's FDV allocated to
users. The user forecast is `(FDV × user allocation) ÷ total points`.
Lighter uses its dedicated Robinhood formula and does not use these fields.

## Data sources — what's real, what's not

### TVL (Projects page) — DeFiLlama, free tier
`/protocol/{slug}` is free and CORS-blocked from the browser, so it's
proxied through `api/tvl.js`. **DeFiLlama's Derivatives data (volume/OI)
is Pro-only ($300/mo)** — its endpoint returns HTTP 402 without a plan.
The public Perps page blocks server-side HTML parsing with HTTP 403, so it
is not a reliable fallback. TVL is the one thing DeFiLlama still provides.

### Perp Volume (24h) + Open Interest (Dashboard) — direct exchange APIs
Proxied through `api/derivatives.js`; all 20 tracked exchanges are registered.
Numbers are included only after the public API and USD units were verified.

| Status | Exchanges | Notes |
|---|---|---|
| **Live baseline** | Hyperliquid, edgeX, Aster, Pacifica, Variational, StandX | Volume for all 6; OI for all except Aster. |
| **Verified adapters** | Hibachi, Lighter, Extended, Reya, Nado, RISEx, Arcus | Volume + OI. Nado and Arcus return USD volume directly; Hibachi/Reya/RISEx/Arcus convert base OI to USD per market; Lighter/Extended return USD/USDC notionals directly. |
| **Controlled per-market adapter** | GRVT | Volume only: active perpetual instruments plus a derived ticker per market, concurrency limited to 4 and refreshed at most every 75 minutes per warm instance. |
| **Intentionally unavailable** | Hotstuff, N1, QFEX, Tread.fi | Hotstuff and N1 are excluded at the user's request. QFEX's aggregate endpoint failed live contract validation; Tread.fi is an account-specific execution platform, not an independent venue. |
| **Awaiting a verified public API** | GMTrade | Returns `null` with a diagnostic reason in API metadata. TrueNorth is an AI data platform, not a perp venue, so it is intentionally excluded. |

Volume and OI are tracked **independently per exchange** — a source can
report one without the other.

### Arcus mainnet adapter

Arcus is collected server-side from the public mainnet endpoint
`GET https://api.arcus.xyz/v1/markets`; no API key or trading functionality is
used. The response is filtered to unique `marketId` records where
`type = PERPETUAL` and `status = ONLINE`, across all Arcus perpetual asset
categories. `volume24hNotional` is summed directly as USD quote notional.
`openInterest` is base quantity, so Zig converts each valid market by its
co-timestamped `markPrice` before summing to USD. `markets_count` is the number
of those unique active perpetual markets. Missing or malformed source fields
remain `NULL`, never zero. TVL remains independently sourced from DeFiLlama;
combined daily snapshots use `arcus_api+defillama` when both sources report.

Run `npm run check:arcus` for a read-only live mainnet diagnostic. It does not
write to Neon or access private account data.

The Dashboard's legacy 7d/30d fields remain `null`; no exchange exposes those
as one live call. Historical calculations now come from the separate daily
snapshot API after enough real observations have accumulated.

### Caching (api/derivatives.js)
Module-scope in-memory cache, ~75 min TTL. **Not a durable cross-instance
cache** — different Vercel instances / cold starts each get their own
copy. Fine for a personal-scale dashboard; if a guaranteed shared cache is
ever needed, that's Vercel KV/Upstash (free tier exists) + a Cron job.

If one exchange fails on a refresh cycle, its last successful value is
kept (not wiped to null) — a single flaky source never blanks its row or
drags down the total.

## Slug verification (TVL, `projects.json`)

All 20 tracked projects have a `defillama_slug` field:

Confirmed live on DefiLlama: Arcus, Rise (`risex`), Variational, Pacifica,
Nado, Hibachi, GMTrade, StandX (`standx-perps`), Hyperliquid, Lighter,
Aster, edgeX, Grvt, Extended, Reya.

Not indexed on DefiLlama (shows `NaN` on the Projects page — this is the
graceful-fallback working correctly, not a bug): QFEX, TrueNorth,
TradeHotStuff, N1 (N1 is a chain powering 01.xyz, not a single protocol —
intentionally `null`).

## Project logos

`public/logos/{defillama_slug}.png` — **manually uploaded**, all 20
present. An earlier attempt used DefiLlama's icon CDN
(`icons.llamao.fi/icons/protocols/{slug}.png`) but coverage was
inconsistent for these newer/niche projects, so local files replaced it.
`ProjectIcon.jsx` falls back to a colored letter if a file is ever
missing.

**Note:** exchange display names in `api/derivatives.js`'s adapter
registry don't always match `projects.json`'s `name` field exactly
(`GRVT`/`Grvt`, `Hotstuff`/`TradeHotStuff`, `RISEx`/`Rise`) —
`src/lib/projectLogos.js` has a `NAME_ALIASES` map bridging these. Keep it
in sync if you add a new exchange with a similarly mismatched name.

## Configuring weekly points snapshots

Add `points_snapshot` to the relevant project in
`src/data/projects.json`. `weekday` is required and must be an English weekday:
`monday`, `tuesday`, `wednesday`, `thursday`, `friday`, `saturday`, or
`sunday`. `time` defaults to `00:00`, and `timezone` defaults to `UTC`.

```json
{
  "name": "Example Exchange",
  "points_status": "live",
  "points_snapshot": {
    "weekday": "wednesday",
    "time": "14:00",
    "timezone": "UTC"
  }
}
```

Every project with `points_snapshot` appears in the card — this field is the
source of truth that its points campaign is active. To remove a finished campaign
from the card, delete its `points_snapshot`. At the configured weekly time, the
row displays `Points Day` for 24 hours; then it automatically begins counting
down to the following week.

## Project structure

```
api/
  tvl.js               ← DeFiLlama TVL proxy (CORS workaround)
  derivatives.js         ← Perp Volume + OI aggregation across 20 exchange adapters

src/
  data/
    projects.json          ← 20 tracked projects (tier, category, slug, points status)
  hooks/
    useProjectsData.js        ← TVL for the Projects page
    useDerivativesData.js       ← volume/OI for the Dashboard
  lib/
    pointsSnapshots.js       ← recurring weekly points-snapshot countdown logic
    defillama.js             ← client for /api/tvl
    format.js                   ← number/percent formatting
    icons.js                      ← accent color cycling (fallback icon backgrounds)
    projectLogos.js                ← resolves project name → /logos/{slug}.png
  components/
    Header.jsx, Sidebar.jsx, StatCard.jsx, ChartCard.jsx, RankingList.jsx,
    NewsCard.jsx, ProjectIcon.jsx, ProjectsPage.jsx, ComingSoon.jsx, Footer.jsx
  App.jsx                 ← assembles the Dashboard, sidebar routing

public/
  avatar.jpg              ← real profile photo, links to x.com/herzig_crypto
  logo.png                  ← project logo (Header, next to "Zig Analytics")
  logos/{slug}.png            ← 20 real project logos
```

## Design system

- Font: **Fredoka** (Google Fonts) — matches the approved mockup's rounded look
- Palette (`src/styles/tokens.css`): warm cream background `#E6E0D3`, white
  cards `#FEFCF8`, near-black sidebar `#18181C`, semantic green `#3FB56B`
  / red `#E45B4E`
- Project icons: real logo if available (`public/logos/`), else a colored
  circle with the first letter, cycling through 5 accent colors

## Deploy (Vercel, free tier)

```bash
git add .
git commit -m "your message"
git push
```

Vercel auto-deploys from the connected GitHub repo. Framework preset:
**Vite** (auto-detected), default build settings (`npm run build`, output
`dist`). `/api/*.js` files are picked up automatically as Serverless
Functions — no extra config needed.

## Historical analytics (Neon PostgreSQL)

Zig stores exactly one canonical snapshot per configured protocol per UTC day.
The collector runs at **12:00 UTC** through Vercel Cron and uses the existing
normalized direct-exchange adapters plus DefiLlama TVL. It never backfills or
manufactures past values: history begins with the first successful Zig run.
Unavailable metrics are stored as `NULL`, never `0`.

### One-time setup

1. Create a Neon Postgres project, then copy its pooled connection string from
   **Neon Console → Connect**.
2. In **Vercel → Project → Settings → Environment Variables**, add:
   - `DATABASE_URL` — the Neon connection string, for Production and Preview.
   - `CRON_SECRET` — a random secret of at least 16 characters, for Production.
3. Pull the variables locally with `npx vercel env pull .env.local`, then run:

   ```bash
   npm run db:migrate
   npm run snapshots:collect
   ```

   Alternatively, provide `DATABASE_URL` directly in your shell for either
   command. Never commit `.env.local`.
4. Deploy. [`vercel.json`](vercel.json) registers `GET /api/cron/daily-snapshots`
   on `0 12 * * *`. Vercel sends `Authorization: Bearer $CRON_SECRET`
   automatically; the route rejects every other caller.

Verify the first row in Neon SQL Editor:

```sql
SELECT p.slug, p.name, s.snapshot_date, s.volume_24h, s.open_interest, s.tvl, s.data_source
FROM protocol_daily_snapshots s
JOIN protocols p ON p.id = s.protocol_id
ORDER BY s.snapshot_date DESC, p.slug;
```

The snapshot table has a unique `(protocol_id, snapshot_date)` constraint, so
Cron retries and repeated manual runs update the same UTC-day row.

### Future Analytics Canvas API

These read-only endpoints are ready for UI modules but do not change the
current Analytics Canvas:

- `/api/analytics/market-share?metric=volume&period=current`
- `/api/analytics/market-share?metric=volume&period=30d&protocols=hyperliquid,lighter`
- `/api/analytics/movers?metric=open_interest&period=30d`
- `/api/analytics/concentration?metric=volume&period=90d`
- `/api/analytics/growth?metric=volume&period=7d`
- `/api/analytics/volume-oi`

Supported share metrics are `volume`, `open_interest`, and `tvl`. A 7D/30D/90D
response exposes `sufficientHistory`, `availableDays`, and coverage. Until the
required number of consecutive UTC-day observations exists, `values` is empty.
The `current` period always uses only the latest canonical `snapshot_date`; it
returns its captured time, ranked values, coverage, provenance, and the dynamic
list of protocols missing the selected metric.
`/api/analytics/movers` returns canonical UTC `startDate`/`endDate`, separate
Top-5 `gainers` and `losers`, plus `coverage.currentAvailable`,
`coverage.eligible`, and `coverage.comparisonUnavailable`. A protocol must
have a valid selected metric at both comparison dates to be ranked; movement is
reported in percentage points, never percent growth.
`/api/analytics/volume-oi` uses one latest canonical UTC snapshot for the
cross-section. It returns only protocols with valid positive Volume and OI as
scatter points, while Volume Share and OI Share keep their own denominators of
all active protocols reporting the corresponding metric. The response includes
dynamic coverage, provenance, ranks, median Volume/OI, and Top-5 high/low
turnover ratios. Missing values remain missing and never become zero.
The same response powers the current **Volume Share vs OI Share** module:
`shareGapPp = volumeShare - openInterestShare`, with dynamic positive and
negative gap rankings. Shares are deliberately not renormalized to the scatter
subset: protocols reporting only one metric still participate in that metric's
full valid denominator.
`/api/analytics/growth?matrix=1&period=7d` powers Growth Matrix. It compares
the same consecutive canonical UTC window as market-share movers. Volume, OI
and TVL cells are point-to-point percentage growth; Volume Share is a
percentage-point change with independently calculated start/end denominators.
Platform history unlocks the matrix, while each protocol/metric keeps its own
availability, so a newly added DEX cannot block older protocols.
For rolling 24h volume, growth compares the average of the latest N daily
observations with the previous N observations; it is not labelled as a period
sum. `volume-oi` calculates denominators using only protocols with a valid
metric on that snapshot date.

### Zig Signals calibration

`/api/analytics/signals` derives research prompts only from the canonical
snapshot layer. Its read-only calibration command is:

```bash
npm run check:signals
```

It reports the canonical date, metric coverage, peer-sample distributions,
raw candidates, displayed signals, and suppressed candidates without writing
to Neon. Signals require at least six comparable peers and a quality score of
70. Structural outliers use the outer 10% of the peer distribution, then have
their score discounted by covered-market impact so a ratio created by very
small OI cannot dominate the feed. Multiple leadership dimensions for the
same protocol are consolidated into one card. Missing metrics remain missing;
no detector invents zeroes or historical data.

### Daily Research Feed

The **Daily Research** workspace consumes the calibrated Zig Signals output;
it does not run a separate detector system. Signals with the same protocol,
period, and semantic family become one deterministic Research Case, while
independent families remain separate. Case IDs use
`research:{canonical-snapshot-date}:{protocol-slug}:{family}`, so only a
user’s workflow status needs persistence.

Run the migration once after pulling this feature:

```bash
npm run db:migrate
```

It creates `research_case_statuses` for the three workflow states:
`IGNORED`, `WATCHING`, and `RESEARCHING`. The normal feed hides ignored cases;
the Ignored filter reveals them again. The diagnostic remains read-only:

```bash
npm run check:research-feed
```

`GET /api/research/feed` returns the compact feed. The same endpoint accepts a
validated `PATCH` containing `{ caseId, status }` to persist a workflow state.
The feed always displays **Data through** the canonical UTC snapshot date;
it never substitutes the browser date or fabricates historical context.

### Protocol Research View

**Open Research** uses a reload-safe hash route:

```text
#research/case/research:{snapshot-date}:{protocol-slug}:{family}
```

The existing research endpoint returns a detail payload when given `caseId`:
`GET /api/research/feed?caseId=...`. It reconstructs the latest canonical
case from calibrated Signals, then assembles the exact snapshot metrics,
metric-specific peer ranks/medians/percentiles, source metadata, and stored
history. Volume and OI shares always retain their separate full-valid-metric
denominators. V1 intentionally does not reconstruct stale cases because
historical Signal payloads are not yet persisted.

Run a read-only dossier diagnostic with a case ID or protocol slug:

```bash
npm run check:research-case -- edgex
```

### External Research Assistant

Each Protocol Research dossier now has an explicit **Research external
context** action. It never runs on page load and never changes canonical
snapshots, Signals, scores, or workflow status. Searches are anchored to the
case’s canonical UTC snapshot date. The default lookback is period-aware:
Current uses -7/+1 days, 7D uses -14/+1, 30D uses -35/+1, and 90D uses
-100/+1. The optional 30D control uses an explicit -30/+1 window. Browser time
and the current wall-clock date are not used.

External findings are stored independently in `external_research_runs` and
`external_research_findings` by migrations `003_external_research.sql` and
`004_external_research_audit_metadata.sql`. This
makes a completed research run reproducible even though V1 does not persist
full historical Signal payloads. Each finding stores only compact metadata,
a factual summary, provenance, date, relevance explanation and its source URL
— never a copied article body. Cache identity is case ID + window + research
version. A fresh click reuses the matching completed/partial run unless
**Refresh research** is chosen. Failed runs are retained for audit but are not
treated as successful cache entries.

The provider interface is server-only. Set `TAVILY_API_KEY` in Vercel to use
Tavily Search. Zig sends canonical `start_date` / `end_date` constraints and,
where registry metadata exists, one official-domain-constrained query. Without
the key the feature shows a clear provider-unavailable state; it does not ship
mock findings or silently fall back to a lower-confidence production source.
No provider key reaches React.

Each run is limited to seven queries, five results per query, seven final
findings, an eight-second request timeout, and one restrained retry for 429/5xx
responses. Search-result snippets are normalized into short factual context;
full article bodies are not fetched. Partial provider failure preserves
successful findings, while a complete outage remains isolated from internal
Zig evidence.

External Research relevance version `v3` applies independent eligibility
gates before scoring: the result must strongly identify the target protocol
(or the specifically requested competitor), contain concrete Perp DEX/product
context, match the requested event topic, and come from an acceptable source
class. Short ticker aliases match only case-preserved title tokens or explicit
`$SYMBOL` forms, not arbitrary snippet prose. Generic price/token pages and
LOW-confidence community/unknown sources are retained in suppression audit
metadata but are not published as findings. Source quality and date proximity
therefore cannot compensate for weak protocol or topic relevance. Competitor
context is limited to one qualifying result and cannot displace direct
protocol evidence. These rules are protocol- and domain-agnostic.

Persisted PostgreSQL `DATE` values are normalized from either database strings
or native JavaScript `Date` objects. The UI displays the exact stored
`window_start` and `window_end`; it never substitutes the current date.

The central `projects.json` registry can optionally supply
`external_research.website`, `docs`, `x`/`xHandle`, `partners`, and
`governance` URLs. Those domains
are used for source classification, so adding a protocol remains a registry
and integration task rather than a UI rewrite. Unknown signal families use the
generic product-update / announcement / integration / incentives query set.

Run a real-data, read-only diagnostic (it does not persist a run):

```bash
npm run check:external-research -- edgex
```

The external layer reports verified/reported events and possible relevance
only. Confidence describes source evidence quality, not the probability that
an event caused a Zig observation. External runs retain their original case ID
and resolve against the persisted Research Case payload described below.

### Research Case persistence

Daily Research Feed cases are durable historical artifacts. Migration
`005_research_case_persistence.sql` stores the complete normalized dossier in
`research_cases.case_payload` with `payload_version = 1`. The immutable payload
includes the original Signal evidence, related signals, normalized metrics,
peer ranks/medians/percentiles, coverage, research questions, provenance, and
history anchored to the Case snapshot date. It is inserted in one batch with
`ON CONFLICT (id) DO NOTHING`, so concurrent Feed requests cannot overwrite
the first factual observation.

Workflow status remains mutable and authoritative in
`research_case_statuses`; it is never stored as authoritative immutable Case
evidence. External Research continues to attach by the same deterministic
`caseId` and resolves persisted Case context before considering current Signal
reconstruction. Inactive or renamed protocols therefore do not alter an old
dossier.

`GET /api/research/feed?caseId=...` now reads persisted evidence first. A
currently reconstructable legacy Case remains supported as a fallback and is
persisted by the normal Feed write path. A valid old link with neither a
persisted record nor a matching current Case returns the explicit
`HISTORICAL_CASE_UNAVAILABLE` state rather than substituting a newer protocol
observation. PostgreSQL dates are selected as canonical text to avoid driver
timezone shifts.

Validate current Case persistence and exact read-back with:

```bash
npm run check:research-case-persistence
```

The command persists only cases generated by the real current Feed. It does
not synthesize or backfill earlier dates.

### Research Synthesis

Research Synthesis is a deterministic, server-side evidence layer built from
an immutable persisted Research Case and its latest retained External Research
run. Migration `006_research_case_synthesis.sql` stores versioned synthesis
payloads in `research_case_syntheses`. The input fingerprint includes the Case
payload version, External Research run ID, and synthesis version, so an
identical rebuild is idempotent while newer retained evidence creates a new
revision. Existing revisions are never rewritten. The API marks a synthesis
as stale when a newer retained External Research run is available.

Confirmed Zig facts and external facts remain separate and every fact carries
source provenance. Explanatory hypotheses are only generated from centrally
mapped signal-family and event-category combinations; they use conditional
language and retain both supporting and contradicting evidence references.
Missing metrics, insufficient history, missing market-level data, failed
research, and no relevant external event are reported as explicit evidence
gaps rather than inferred or converted to zero. Case workflow status does not
change the factual synthesis.

The conclusion is intentionally conservative: it describes evidence strength
and does not claim that an event caused a market observation. The synthesis
service is deterministic and does not use an LLM. The Protocol Research UI
does not generate synthesis automatically; **Build synthesis** and **Refresh
synthesis** are explicit actions and the latest saved result remains visible.

Inspect a real persisted Case without writing a synthesis:

```bash
npm run check:research-synthesis -- edgex
```

The diagnostic uses retained External Research only. It does not call Tavily,
invent external evidence, or persist a synthesis.

### Signal History

Signal History retrospectively evaluates the current Signal Engine against
real stored canonical daily snapshots. It answers what engine version `v3`
would have observed on each historical UTC date; it does not claim that Zig
emitted those signals live at the time. A semantic series uses
`protocolSlug:signalFamily`, matching production family deduplication, while a
PRESENT observation retains the winning detector `signalType`.

Each canonical snapshot is classified as `PRESENT`, `ABSENT`, or
`NOT_EVALUABLE`. ABSENT means the detector inputs and peer sample were valid
but the semantic signal did not survive production thresholds/deduplication.
Missing metrics, insufficient peers, or insufficient prior history are not
evaluable. Missing calendar days remain gaps and never become absence.
Presence rate therefore uses evaluable snapshots only.

Historical evaluation is always capped at the immutable Research Case anchor
date, so later snapshots cannot leak into old peer baselines, shares, growth,
or scores. Existing historical rows are retained even if a protocol is now
inactive, matching Zig's recorded-history policy. Evaluations are loaded in
batch and cached on demand in `signal_observations`; engine-version changes
create separate rows instead of overwriting earlier evaluations. Migration
`007_signal_history.sql` creates this cache. No migration-time mass backfill is
performed.

```bash
npm run check:signal-history -- edgex --period=30d
```

Signal Lifecycle is intentionally not part of this feature. A later version
can derive lifecycle semantics from these three-state observations.

### Signal Lifecycle

Signal Lifecycle v1 is derived dynamically from the canonical 30D Signal
History window; it does not add or rewrite database rows. `NEW`, `PERSISTING`,
`STRENGTHENING`, `WEAKENING`, and `RESOLVED` describe the Zig research pattern,
not price direction. A latest `NOT_EVALUABLE` observation produces an
unavailable lifecycle, never `RESOLVED`. Reappearance is represented as `NEW`
with a `reappeared` flag.

Trend uses the last three consecutive evaluable PRESENT observations. Family
extractors compare peer-relative Volume/OI, absolute structural share gap,
Volume-share change in percentage points, or leadership share. A 15% relative
change (or 0.5pp for share metrics) is required to avoid noise-driven
strengthening/weakening. Unknown families still support NEW, PERSISTING, and
RESOLVED without inventing a strength measure. Recent data gaps reduce
classification confidence without breaking evaluable continuity.

Daily Research ranking keeps the original Signal score visible and applies a
bounded novelty adjustment afterward: NEW and materially changing patterns
receive a modest boost, while long stable PERSISTING patterns receive at most
a four-point fatigue reduction. Lifecycle never admits a Signal that failed
the Signal Engine quality threshold.

```bash
npm run check:signal-lifecycle -- edgex
npm run check:signal-lifecycle -- --all
```

### Research Watchlist

Watchlist membership comes exclusively from the existing `WATCHING` Research
Case status. Each case remains immutable and case-scoped, even when several
cases belong to the same protocol. The Watchlist evaluates that semantic
series against the latest complete canonical UTC snapshot and displays the
original Case state separately from the current follow-up state.

Migration `008_research_watchlist.sql` adds append-only daily evaluations.
The unique `(case_id, canonical_date, engine_version, lifecycle_version)` key
makes page refreshes idempotent, while a new canonical day creates a new row.
Signal or Lifecycle version changes establish a fresh baseline instead of
reporting a false research change. Unwatching removes membership only; stored
evaluations and the original Case are retained. No external research, polling,
notifications, or background automation is triggered by Watchlist.

```bash

# Evaluate WATCHING Research Cases against the latest canonical snapshot.
# Same-day runs reuse the versioned daily evaluation.
npm run check:watchlist
npm run check:watchlist -- lighter
```

## Next steps

- Verify on the live deployment how many of the 16 registered exchanges
  actually return data (expect the 5 "confirmed" ones to work reliably;
  the rest are unverified against a real response)
- Revisit the stubbed/excluded exchanges if their public APIs mature
  (Hotstuff's docs weren't even indexed by search at time of writing; GRVT
  has no bulk ticker; QFEX's OI proxy is weak)
- First Analytics Canvas chart — the historical snapshot pipeline and its
  read-only APIs are ready; wait for enough real daily observations before
  visualizing 7D/30D/90D results
- Build out News, Analytics, Calendar, Settings sections
- Consider unifying the name mismatches between `projects.json` and
  `api/derivatives.js`'s adapter registry (currently bridged by an alias
  map, works but easy to forget when adding a new exchange)
