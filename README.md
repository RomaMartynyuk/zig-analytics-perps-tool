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
(Perp Volume 24h/7d/30d, Open Interest), Perps Volume Graph placeholder,
Perp Volume / Open Interest rankings, recurring Upcoming Snapshots, Last News
placeholder, Last Perps Tickers. All list cards scroll internally with a
custom thin scrollbar once content overflows.

**Sidebar navigation** — fully functional and animated (framer-motion
`layoutId` spring animation on the active indicator, fade transition on
content). Two sections have real content:

- **Dashboard** — stat cards + Perp Volume/OI rankings and Last Perps Tickers
  are **real, live data**. The ticker card uses one batched CoinGecko request
  for HYPE, LIT, EDGE, ASTER, BP and GRVT, ordered by live USD price. Perps
  Volume Graph and Last News are still placeholders. Upcoming Snapshots are
  configured per project in `src/data/projects.json`.
- **Projects** — live TVL from DeFiLlama for all 20 tracked projects.

News, Analytics, Community, Calendar, and Settings render a "coming soon"
placeholder — routing and animation work, those pages just need content.

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

**7d/30d volume is always `null`.** No exchange exposes that as a single
live call; it needs our own historical snapshots (Month 2 of the roadmap,
not built yet).

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

Only projects with `points_status` set to `live` or `running` appear in the
card. At the configured weekly time, the row displays `Points Day` for 24 hours;
then it automatically begins counting down to the following week.

## Project structure

```
api/
  tvl.js               ← DeFiLlama TVL proxy (CORS workaround)
  derivatives.js         ← Perp Volume + OI aggregation across 16 exchange adapters

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

## Next steps

- Verify on the live deployment how many of the 16 registered exchanges
  actually return data (expect the 5 "confirmed" ones to work reliably;
  the rest are unverified against a real response)
- Revisit the stubbed/excluded exchanges if their public APIs mature
  (Hotstuff's docs weren't even indexed by search at time of writing; GRVT
  has no bulk ticker; QFEX's OI proxy is weak)
- Month 2 of the roadmap: WoW volume comparison + Farming Difficulty
  Index — needs a historical snapshot pipeline, not built yet
- Build out News, Analytics, Community, Calendar, Settings sections
- Consider unifying the name mismatches between `projects.json` and
  `api/derivatives.js`'s adapter registry (currently bridged by an alias
  map, works but easy to forget when adding a new exchange)
