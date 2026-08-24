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
Perp Volume / Open Interest rankings, Upcoming Snapshots, Last News
placeholder, Last Perps Tickers. All list cards scroll internally with a
custom thin scrollbar once content overflows.

**Sidebar navigation** — fully functional and animated (framer-motion
`layoutId` spring animation on the active indicator, fade transition on
content). Two sections have real content:

- **Dashboard** — stat cards + Perp Volume/OI rankings are **real, live
  data**. Perps Volume Graph, Upcoming Snapshots, Last News, and Last Perps
  Tickers are still placeholders.
- **Projects** — live TVL from DeFiLlama for all 20 tracked projects.

News, Analytics, Community, Calendar, and Settings render a "coming soon"
placeholder — routing and animation work, those pages just need content.

## Data sources — what's real, what's not

### TVL (Projects page) — DeFiLlama, free tier
`/protocol/{slug}` is free and CORS-blocked from the browser, so it's
proxied through `api/tvl.js`. **DeFiLlama's Derivatives data (volume/OI)
is Pro-only ($300/mo)** — confirmed against their own pricing docs — so
it's not used anywhere in this project. TVL is the one thing DeFiLlama
still provides.

### Perp Volume (24h) + Open Interest (Dashboard) — direct exchange APIs
Proxied through `api/derivatives.js`, one small adapter per exchange, 20
exchanges total (the list from the research doc), 16 registered:

| Confidence | Exchanges | Notes |
|---|---|---|
| **Confirmed** (real example response checked) | Hyperliquid, Aster, Pacifica, Variational, Decibel | Volume for all 5; OI for all except Aster (no bulk OI endpoint on Binance-fork APIs) |
| **Low risk** (from docs, no live example) | StandX, Nado | Single bulk call, pre-aggregated totals |
| **Medium risk** | Hibachi, edgeX | Per-symbol fan-out; Hibachi multiplies quantity × price to keep OI in USD |
| **High risk** | QFEX | Uses `startingOpenInterest` (start-of-candle, not current) as a rough proxy — least trustworthy number in the set |
| **Stubbed** (return null, need research) | Lighter, Reya, GRVT, Extended, Hotstuff, RISEx | GRVT specifically: only a per-instrument ticker exists, no bulk endpoint |
| **Excluded entirely** | TrueNorth, N1/01, GMTrade, Arcus | Research doc explicitly warns against guessing an endpoint for these |

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
Aster, edgeX, Grvt, Extended, Reya, Decibel.

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

## Project structure

```
api/
  tvl.js               ← DeFiLlama TVL proxy (CORS workaround)
  derivatives.js         ← Perp Volume + OI aggregation across 16 exchange adapters

src/
  data/
    projects.json          ← 20 tracked projects (tier, category, slug, points status)
    mockMetrics.js            ← still-placeholder data (Snapshots, Tickers) — volume/OI rankings are real now
  hooks/
    useProjectsData.js        ← TVL for the Projects page
    useDerivativesData.js       ← volume/OI for the Dashboard
  lib/
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