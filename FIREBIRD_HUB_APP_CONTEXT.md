# Firebird Hub (app) — context for the website chat

Paste this into the Claude chat that controls the **website** (`fremontasb-site`). It explains where the **app** (Firebird Hub, `firebirdhub.vercel.app`) gets its data so the website can pull the **same important events and sports** from the **same source** and stay in sync — never a separate hand-kept list.

---

## The single source of truth: one Google Sheet

**"Firebird Hub — Events (26-27)"** — ID `11Pm2zUc_O40E0oTZekYvsD_D8FenH9s7PiJ43m7JCH0` (owned by abirpogo421@gmail.com, shared "anyone with link → Viewer"). Everything the app shows about events and sports comes from this one sheet. The website should read the **same sheet** so both surfaces match.

Read any tab as CSV (no key, public), e.g.:
```
https://docs.google.com/spreadsheets/d/11Pm2zUc_O40E0oTZekYvsD_D8FenH9s7PiJ43m7JCH0/gviz/tq?tqx=out:csv&sheet=<TabName>
```
Add `&_cb=<timestamp>` to bypass gviz's ~5-min cache when you need it fresh.

---

## Events (Home)

- **Tab:** the main events tab (`gid=0`). Columns: `name, date, endDate, time, location, description, tags, featured`.
- **Curation ("important events"):** a row is **featured** when its `featured` column is `YES` (ASB sets this by highlighting the row **red**; a bound Apps Script, `FeaturedEvents.gs`, converts red → `YES` on a 5-min trigger). The app shows **only featured events**, and only those in the **next ~6 weeks**.
- **For the website:** to show the same "important events," read this tab and filter to `featured = YES` (and, if you want the same feel, a ~6-week window). Do **not** keep a separate events list — edit the sheet and both update.

## Sports (Sports tab) — read this before touching anything sports

- **Tab:** `Sports`. It is **machine-generated** — do **not** hand-edit game rows; they are wiped and rewritten every 3 hours. Columns:
  `push, sport, date, day, time, level, homeAway, opponent, location, type, kind, section, score, seniorNight, title`.
  - `section` = `upcoming` | `result`; `kind` = `Game` | `Scrimmage`; `score` filled for finished games; `seniorNight` = `YES`.
  - The sheet is grouped **Fall → Winter → Spring**, each sport under a bright divider row. Divider/season rows have **no date** — skip any row whose `date` isn't `YYYY-MM-DD`. (Note: because the "FALL SPORTS" banner is a merged cell, gviz mangles the **`push`** header label — read the push flag from **column A by position**, not by header name.)
- **The `push` column = feature it on the app.** Type **`y`** in a game's first cell (`push`) and that game is pinned to a **★ Featured** strip on the Sports tab **and** the Home page. Blank = not shown. A human's `y` survives the 3-hour rewrites (the sync remembers it by game). This is the ONE way to promote a specific game — the website should use the same convention if it surfaces games.
- **In-season only:** the app shows only sports whose season is current (Fall Aug–Oct, Winter Nov–Feb, Spring Mar–Jul); off-season sports stay in the sheet as data and appear automatically when their season arrives.
- **Senior nights** (badged): Football Oct 22 (vs Los Altos), Field Hockey Oct 26, Girls Tennis Oct 29.

### Where the Sports tab comes from (for further updates)
- An Apps Script, **`SportsSync.gs`**, writes the Sports tab on a 3-hour trigger. It embeds the full posted season (fall + winter) and merges **live scores** from the athletics feed. It lives in the abirpogo421 Apps Script project alongside `FeaturedEvents.gs`. (An older rogue "Untitled project" that wrote the tab in a different format has been deleted — do not recreate a second sports writer; two scripts fighting over the `Sports` tab is what caused earlier chaos.)
- **Athletics feed** (games + scores, JSONP): `https://script.google.com/macros/s/AKfycby_2RTRuFEiIRdoNQtzbuUQzSGCGJ3G_p7CxNrqcqOcQiPk268kXu63uLf21GIT5RfQ/exec?view=results`
- **Athletics site** (schedules, rosters, register, shop, boosters, contact): `https://www.fremonthsathletics.org` and per-sport pages `.../<slug>`.

---

## Other things the app already has (so the website doesn't duplicate or contradict)

- **Ask Firebird chatbot** — Gemini-backed, via a serverless function `FirebirdHub/api/ask.js` (model `gemini-3.6-flash`; `GEMINI_API_KEY` is a **server-side** Vercel env var, never in client code). Scoped to school topics, refuses off-topic, routes self-harm to 988 + a trusted adult.
- **Spirit points** live-pull from the Spirit Points sheet; **Fire Bucks** backend is a separate bound Apps Script (`Code.gs`).
- **Language:** the app has an English/Español toggle for its own chrome (menus/buttons). Dynamic listings stay in the language they were entered.

## Deploy
- App repo: `github.com/fremontasbtech-sudo/App` → **push to `main`** → Vercel auto-deploys `firebirdhub.vercel.app` in ~1–2 min. The site is served from the `FirebirdHub/` folder (so serverless functions live at `FirebirdHub/api/`).

**Bottom line for the website:** read the same Events sheet for important events (`featured = YES`) and, if you show games, read the `Sports` tab and honor the `push = y` convention. One sheet, two surfaces, always in sync.
