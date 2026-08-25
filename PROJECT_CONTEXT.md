# PROJECT_CONTEXT.md — ZigAnalytics

> Читай цей файл першим у будь-якому новому чаті про цей проєкт. Він написаний
> так, щоб з нього одного можна було зрозуміти стан проєкту без доступу до
> історії розмов. Онови його наприкінці кожної сесії, де відбулись суттєві зміни.

## Що це за проєкт

Аналітичний веб-дашборд для трекінгу points-farming / DeFi / perp-DEX
проєктів. Особистий продукт для власника X-акаунту **@herzig_crypto**
(display name Herzig) — використовується і як робочий інструмент, і як
джерело скрінів для контенту в X. Назва продукту: **ZigAnalytics**.

**Репозиторій:** https://github.com/RomaMartynyuk/zig-analytics-perps-tool
**Деплой:** Vercel, `zig-analytics-perps-tool.vercel.app`
**Бюджет:** $0 — усе на free tier, поки власник не пройде монетизацію X.

## Технічний стек

- **Frontend:** Vite + React (не Next.js — чистий SPA)
- **Анімації:** framer-motion (sidebar active-indicator, page transitions)
- **Іконки:** lucide-react
- **Дані:** прямі виклики API бірж + DeFiLlama (тільки для TVL) — усе через
  Vercel Serverless Functions (`/api/*`), бо i api.llama.fi, і більшість
  бірж не віддають CORS-заголовки для прямого browser-виклику
- **Шрифт:** Fredoka (Google Fonts) — округлий, під затверджений мокап
- **Стилі:** звичайний CSS з CSS-змінними (`src/styles/tokens.css`), без
  Tailwind

## Дизайн — джерело правди

Дизайн НЕ вигаданий мною — користувач надав власний Figma/UI-мокап
скріншотом ("Zig Analytics" — cream/black тема, sidebar-капсула зліва,
grid зі stat-картками). Я відтворив його максимально точно. Токени:

```
--bg: #E6E0D3        (кремовий фон)
--card: #FEFCF8       (майже білі картки)
--sidebar: #18181C     (темний sidebar/dark-блоки)
--up: #3FB56B / --down: #E45B4E  (семантичні кольори)
```

Є старіша "вино-кремова" палітра (#561C24 і т.д.) з раннього етапу
wireframe-ітерацій — вона БІЛЬШЕ НЕ АКТУАЛЬНА, замінена після того, як
користувач показав реальний мокап. Якщо десь у старих нотатках/чатах
згадується та палітра — ігноруй, дивись на `src/styles/tokens.css` як на
єдине джерело правди.

## Структура проєкту (актуальна)

```
api/
  tvl.js            ← proxy до DeFiLlama /protocol/{slug} (TVL для сторінки Projects)
  derivatives.js     ← агрегація Perp Volume 24h + Open Interest з прямих API бірж

src/
  data/
    projects.json      ← 20 tracked проєктів (джерело правди по tier/category/slug/points_status)
  hooks/
    useProjectsData.js    ← TVL для сторінки Projects
    useDerivativesData.js  ← volume/OI для Dashboard
  lib/
    pointsSnapshots.js  ← логіка щотижневих points snapshots
    defillama.js       ← клієнт для /api/tvl
    format.js            ← formatUSD/formatStatUSD/formatPercent
    icons.js               ← циклічна палітра акцентів для fallback-іконок
    projectLogos.js          ← резолвер лого: ім'я проєкту → /logos/{slug}.png
  components/
    Header.jsx, Sidebar.jsx, StatCard.jsx, ChartCard.jsx, RankingList.jsx,
    NewsCard.jsx, ProjectIcon.jsx, ProjectsPage.jsx, ComingSoon.jsx, Footer.jsx
  App.jsx             ← збирає Dashboard + роутинг між секціями sidebar

public/
  avatar.jpg           ← реальне фото власника (клікабельне, лінк на x.com/herzig_crypto)
  logo.png              ← лого проєкту (в Header, біля "Zig Analytics")
  logos/{slug}.png       ← 20 реальних лого проєктів, завантажені вручну користувачем
                            (CDN icons.llamao.fi виявився неповним — не покривав усі 20)
```

## Ключові архітектурні рішення (і чому саме так)

### 1. DeFiLlama Derivatives (volume/OI) — Pro-only, НЕ використовується
`/overview/derivatives` повертає HTTP 402 без paid plan. Спроба server-side
парсингу публічної `/perps` сторінки повертає HTTP 403, тож це не стабільний
fallback для Vercel і не доданий у production. TVL (`/protocol/{slug}`) —
безкоштовний і досі використовується для сторінки Projects.

### 2. Volume + Open Interest — прямі API бірж, через /api/derivatives.js
Через CORS усе йде через serverless-проксі. Список із 20 бірж — з
дослідницького файлу користувача (`perp_dex_direct_api_research.md`),
не з довільного вибору.

**Реєстр адаптерів (усі 20 tracked бірж зареєстровані):**

| Статус | Біржі | Деталі |
|---|---|---|
| **Працювали на live-deploy до цієї сесії** | Hyperliquid, edgeX, Aster, Pacifica, Variational, StandX | Volume: усі шість; OI: усі, крім Aster |
| **Виправлено / додано, API перевірено живою відповіддю** | Hibachi, Lighter, Extended, Reya, Nado, RISEx, Arcus | Volume + OI. Nado та Arcus повертають USD volume напряму; Hibachi, Reya, RISEx і Arcus множать base OI на co-timestamped mark/oracle price; Lighter і Extended повертають USD/USDC notional напряму. Потрібна остаточна перевірка після Vercel deploy. |
| **Додано з контрольованим per-market fan-out** | GRVT | Лише Volume: активні perpetual інструменти + один derived ticker на ринок, concurrency 4, outer-cache 75 хв. OI не додається. |
| **Свідомо вимкнені, щоб не показувати некоректні числа** | Hotstuff, N1, QFEX, Tread.fi | Hotstuff і N1 виключені на запит користувача; N1 доступний лише як devnet. QFEX відхилив валідні часові вікна; Tread.fi — account-specific execution/OEMS, не окрема біржа. |
| **Заглушки, чекають на перевірений публічний API** | GMTrade | Реєстр повертає `null`, а `meta.*Sources[].reason` пояснює причину. TrueNorth — AI data platform, не perp venue, тому теж лишається поза агрегатами. Не вигадувати endpoint чи одиниці виміру. |

**Volume та OI тепер НЕЗАЛЕЖНІ по кожній біржі** — біржа може дати volume,
але не OI (як-от Aster), і навпаки. Обидва рахуються й агрегуються окремо.

**7d/30d volume:** завжди `null` — жодна біржа не дає це одним викликом,
потрібна власна історія снепшотів (це "Місяць 2" з road map, ще не
реалізовано).

### 3. Кешування в /api/derivatives.js
Module-scope in-memory кеш, TTL 75 хв (середина запитаних 60-90).
**Важливе обмеження:** НЕ durable між cold start'ами чи різними
інстансами Vercel — це "best effort" кеш, а не гарантія. Якщо колись
знадобиться справжній shared-кеш — Vercel KV/Upstash (є free tier) +
Vercel Cron.

**Per-source stale-on-failure:** якщо біржа падає на конкретному циклі
оновлення — її останнє успішне значення НЕ затирається null'ом, просто
не оновлюється цього разу. Одна біржа, що впала, не валить весь агрегат.

### 4. Логотипи проєктів — локальні файли, не CDN
Спочатку пробували `icons.llamao.fi` (офіційний CDN DeFiLlama) —
покриття виявилось неповним (нові/нішеві проєкти відсутні). Перейшли на
`public/logos/{defillama_slug}.png`, завантажені користувачем вручну.
`ProjectIcon.jsx` має graceful fallback на кольорову літеру, якщо файлу
немає.

### 5. Дублікат-мапінг імен
`api/derivatives.js` (реєстр адаптерів) і `projects.json` іноді
називають один проєкт по-різному: `'GRVT'` vs `'Grvt'`, `'Hotstuff'` vs
`'TradeHotStuff'`, `'RISEx'` vs `'Rise'`. `projectLogos.js` має
`NAME_ALIASES` для мосту між ними. Якщо додаєш нову біржу — перевір цей
мапінг, інакше лого не зʼявиться.

## Відомі обмеження (не баги, свідомі рішення)

- **Дашборд-метрики (stat-картки) не тестувались наживо** — я багато разів
  не мав мережевого доступу з пісочниці до бірж/CDN, тому все тестувалось
  через мокований `fetch`/Playwright `route()`, а не реальні виклики.
  Перший реальний деплой варто уважно перевірити.
- **Upcoming Snapshots** беруться з `points_snapshot` у `projects.json` і
  повторюються щотижня. Наявність цього поля означає, що кампанія активна;
  завершену кампанію прибирають видаленням `points_snapshot`. У день снепшоту
  відображається `Points Day` протягом 24 годин, після чого сайт автоматично
  починає відлік до наступного такого дня. Last Perps
  Tickers — реальні CoinGecko USD price + 24h change для HYPE, LIT, EDGE,
  ASTER, BP і GRVT, одним batched server-side запитом та 60-секундним кешем.
  Volume Ranking і OI Ranking теж реальні.
- **"Perps Volume Graph"** — live bar chart топ-8 бірж за 24h perp volume.
  WoW-динаміка все ще потребує окремого історичного snapshot pipeline.
- **Predictions / Point Value Lab** — grid лише для проєктів з активною
  points-кампанією або `points_snapshot`. У картці користувач керує total
  points і FDV, а прогноз рахується як `FDV ÷ total points`; PolyMarket поле
  зарезервоване до появи джерела даних. Lighter має окрему вкладену картку
  Robinhood campaign: `11M LIT × live LIT price ÷ (65,000 × weeks)`.
- **News-картка — порожній стан**, RSS/новини не підключені (Фаза 3
  оригінального плану).
- **Сторінки News/Analytics/Calendar/Settings у sidebar** —
  "coming soon"-заглушки, роутинг є, контенту нема.

## Стиль спілкування з користувачем (важливо для тону відповідей)

- Спілкується українською, сам код/коментарі — англійською
- Хоче **тільки змінені файли**, не весь проєкт (`memory_user_edits`
  зафіксовано)
- Цінує чесність про рівень впевненості в даних — краще NaN, ніж вигадане
  число. Це наскрізний принцип усього проєкту, не відступай від нього
- Сам розробник (програміст), може читати код напряму, не треба
  спрощувати технічні пояснення
- Просив звіряти зміни з реальним кодом у GitHub, а не покладатись на
  пам'ять чату — якщо є сумніви, попроси посилання на репо або конкретні
  файли перш ніж редагувати

## Що далі (з незавершеного)

1. Задеплоїти та перевірити на живому Vercel: очікування — 14 джерел volume
   і 12 джерел OI (Aster і GRVT не дають OI). Звірити суми з UI кожної біржі.
2. Якщо QFEX/GRVT стабілізують публічні API — повернутись і замінити
   заглушки лише після перевірки полів та USD-одиниць.
3. Місяць 2 з road map: WoW-порівняння обсягів, Farming Difficulty Index
   (потребує історичних снепшотів — інфраструктура ще не збудована)
4. Naming inconsistency в `projects.json` (RISEx/Rise, Grvt/GRVT,
   TradeHotStuff/Hotstuff) — варто колись уніфікувати, зараз тримається
   на alias-мапінгу, що працює, але крихко для майбутніх правок
