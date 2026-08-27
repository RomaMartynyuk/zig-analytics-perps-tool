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
For rolling 24h volume, growth compares the average of the latest N daily
observations with the previous N observations; it is not labelled as a period
sum. `volume-oi` calculates denominators using only protocols with a valid
metric on that snapshot date.

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
