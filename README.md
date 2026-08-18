# ZigAnalytics

Analytics dashboard for tracking points-farming / DeFi / perp-DEX projects.
Built for @herzig_crypto — matches the approved homepage design exactly,
with a working sidebar navigation foundation and live DeFiLlama data on the
Projects page.

## Run locally

Requires Node.js 18+ (check with `node -v`).

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`.

## What's built

**Homepage (Dashboard)** — matches the approved mockup 1:1: stat cards
(Perp Volume 24h/7d/30d, Open Interest), Perps Volume Graph placeholder,
Perp Volume / Open Interest rankings, Upcoming Snapshots, Last News
placeholder, Last Perps Tickers. All list cards scroll internally (custom
thin scrollbar) once content overflows — that's the "повзунки" requirement.

**Sidebar navigation** — fully functional and animated. Clicking an icon
switches sections with a spring-animated active indicator (framer-motion
`layoutId`, so it slides smoothly between buttons instead of snapping) and
a fade transition on the content area. Two sections have real content:

- **Dashboard** — the homepage above (mock metrics — see note below)
- **Projects** — live TVL pulled from DeFiLlama for all 19 tracked
  projects (this reuses the Week 1 API layer)

The rest (News, Analytics, Community, Calendar, Settings) render a
"coming soon" placeholder — the routing and animation are ready, those
pages just need content in a later pass.

## Important — how live TVL data actually loads (CORS fix)

DeFiLlama's API blocks direct browser requests (no CORS header on their
side) — calling `api.llama.fi` straight from client-side JS fails, in
production too, not just locally. Fixed with a tiny Vercel Serverless
Function at `api/tvl.js` that proxies the request server-side (not subject
to browser CORS), and `src/lib/defillama.js` now calls `/api/tvl?slug=...`
instead of DefiLlama directly.

**Caveat:** `npm run dev` / `npm run preview` alone won't run that
serverless function — Vite's dev server doesn't execute `/api` routes.
Every project will show "Manual" until you either deploy to Vercel, or
run `npx vercel dev` locally (needs a free Vercel account + `vercel login`,
then it serves both the frontend and `/api` correctly). This hasn't been
tested against a live deployment yet — worth checking as the very next
step.

## Slug verification — done for 9 of 19 projects

Confirmed live on DefiLlama: Arcus, Perpl, Rise (slug `risex`), TreadFi
(slug `tread.fi-perps` — note the dot), Variational, Pacifica, Nado,
Hibachi, GMTrade, StandX (slug `standx-perps`), Ostium.

Still unconfirmed / likely not indexed yet (showing "Manual", matches
their "ultra early / invite-only" status from your original tier list):
QFEX, TxFlow, TrueNorth, Bulktrade, TrueCurrentX, TradeHotStuff, Meridian.

N1 is a chain (powers 01.xyz), not a single protocol — doesn't map to the
`/protocol/{slug}` endpoint this app uses, left as `null` on purpose.

| Section | Status |
|---|---|
| Projects page (TVL) | **Real** — live DeFiLlama fetch, same as Week 1 |
| Stat cards (Perp Volume, Open Interest) | Placeholder — DeFiLlama's derivatives/OI endpoints aren't wired yet |
| Perp Volume / Open Interest rankings | Placeholder numbers, but **real project list** from `projects.json` |
| Upcoming Snapshots | Placeholder countdowns |
| Last Perps Tickers | Placeholder prices |
| Last News | Empty state — no source connected yet (Phase 3) |

Loading the Projects page right now shows every project as **"Manual"** —
that's the graceful-fallback working correctly, not a bug. It means none
of the guessed `defillama_slug` values in `projects.json` matched a real
DeFiLlama protocol yet. Worth doing next: verify/correct slugs one by one
against https://defillama.com/protocols.

## Project structure

```
src/
  data/projects.json        ← tracked-project list (tier, category, DefiLlama slug, points status)
  data/mockMetrics.js        ← placeholder Perp Volume / OI / ticker data (deterministic, not random per reload)
  lib/defillama.js           ← DeFiLlama API client (graceful fallback if a slug isn't indexed)
  lib/format.js               ← number/percent formatting helpers
  lib/icons.js                 ← accent color cycling for project icons
  hooks/useProjectsData.js     ← loads live TVL for every tracked project
  components/
    Header.jsx                  ← logo, title, search bar
    Sidebar.jsx                  ← animated nav (framer-motion)
    StatCard.jsx, ChartCard.jsx, RankingList.jsx, NewsCard.jsx
    ProjectsPage.jsx              ← live-data "Projects" section
    ComingSoon.jsx                 ← placeholder for unbuilt sections
  styles/tokens.css              ← design tokens (approved cream/black palette)
```

## Design system

- Font: **Fredoka** (Google Fonts) — matches the rounded, friendly look in the approved mockup
- Background: warm cream `#E6E0D3`, cards white `#FEFCF8`, sidebar near-black `#18181C`
- Semantic colors: green `#3FB56B` (up), red `#E45B4E` (down)
- Project icons cycle through 5 accent colors (`src/lib/icons.js`) since we don't have real project logos — swap in actual logo images later if you get them

## One thing to swap in yourself

`.sb-avatar` in the sidebar is currently a gradient placeholder circle.
Drop your actual profile picture in `public/` and reference it there when
you're ready — didn't want to hardcode a base64 image into the repo.

## Deploy (Vercel, free tier)

1. Push this project to a GitHub repo:
   ```bash
   git init
   git add .
   git commit -m "ZigAnalytics — homepage v2"
   git branch -M main
   git remote add origin <your-repo-url>
   git push -u origin main
   ```
2. Go to [vercel.com](https://vercel.com), sign in with GitHub, click
   **Add New → Project**, select the repo.
3. Framework preset: **Vite** (auto-detected). Leave build settings default.
4. Deploy — you get a live `.vercel.app` URL, custom domain optional later.

## Next steps

- Verify/correct `defillama_slug` values in `projects.json`
- Wire real Perp Volume / Open Interest data (DeFiLlama has a derivatives
  overview endpoint separate from the TVL one used today — worth checking
  before Month 2's WoW work)
- Build out News, Analytics, Community, Calendar, Settings sections
- Swap in the real avatar image
