# Firebird Hub — problems to fix (paste this into a fresh chat)

Fremont HS ASB app. Live at **https://firebirdhub.vercel.app** (repo `github.com/fremontasbtech-sudo/App`, Vercel Root Directory = `FirebirdHub/`, push to `main` → auto-deploy). Canonical files: `App/FirebirdHub/{index.html,app.js,styles.css}`; a single-file mirror `App/Firebird Hub - Fremont ASB.html` must be kept in sync. Read the companion **FIREBIRD_HUB_TECH_CONTEXT.md** for all IDs/URLs before editing.

Work top-down. Verify each fix on a **fresh** load (`firebirdhub.vercel.app/?cb=<random>`), not a cached tab.

## 0. CRITICAL — stop the multi-session clobbering
The git history has commits from **more than one Claude conversation** editing `app.js` and pushing to the same repo (e.g. `00c9540 Sports redesign…`, `981bcea…` alongside chatbot commits). Two sessions overwriting the same file is why fixes "don't stick."
- Use **ONE** chat to edit the app. Before ANY edit: `cd App && git pull`. After editing: commit + push immediately. Never edit from a second chat in parallel.
- Every deploy: bump the asset version (`?v=NN` on the script/link tags in `index.html`) so browsers don't serve a stale `app.js`.

## 1. Chatbot ("Ask Felipe") won't close for the user
It must dismiss on: the **X**, **clicking outside**, **Escape**, and a **full-screen backdrop** (tap anywhere off the panel). The code for all four is in commit `2f1b81f` (`#askBack` backdrop + delegated `#askClose` handler). If the deployed `app.js` lacks `askBack`, a parallel session overwrote it — re-apply and redeploy. Verify: open the panel, click the X → panel hides; tap the page → hides.

## 2. Duplicate sports games
The Sports list shows the same game twice (e.g. **Sep 19 Cross Country at Hayward HS appears twice** — once as "FARMER INVITATIONAL", once blank). Cause: `SportsSync.gs` merges the athletics results feed on top of the embedded schedule and the two rows differ only by opponent text, so dedup misses them.
- Fix in `backend/SportsSync.gs`: dedup by `sport|date|level|time` (NOT including opponent) before writing the Sheet, keeping the row with the richer opponent/score. Re-run `syncSports`.
- Also dedup defensively in the app's `rowsToGames`/render by the same key.

## 3. Cross Country / Track are MEETS, not "at opponent"
XC/Track/Swim have no single opponent — their "opponent" field is the **meet name or venue** (Rancho San Antonio, Hayward HS, Baylands Park, Firebird XC Invite). The app still shows "**at RANCHO SAN ANTONIO**" on the **FALL TEAMS summary cards** ("NEXT …") and possibly game cards.
- In every place that renders a sport's next/again line, when the sport is a meet sport, show the venue/meet name **plainly** (no "vs/at"). Helper: `isMeet = /cross country|track|swim|dive|wrestl/i.test(sport)`.
- Felipe's context already has a MEETS-vs-GAMES note (`api/ask.js`); keep it.

## 4. In-season teams / "FALL TEAMS" layout
Show only the **currently in-season** sports (Fall: Aug–Oct; Winter: Nov–Feb; Spring: Mar–Jul) as the team cards; keep off-season sports in the Sheet as data so they appear automatically in season. Make the FALL/WINTER/SPRING team-card layout consistent with the rest of the app.

## 5. Felipe (Gemini) config
- Model is `gemini-3.6-flash` in `FirebirdHub/api/ask.js` (2.0-flash was **retired** — that was the "stupid/blank" bug). Don't revert it.
- **`GEMINI_API_KEY` must be set in the `firebirdhub` Vercel project → Settings → Environment Variables (Production)**, then redeploy. If Felipe says "isn't set up yet," the key isn't there.
- The function reads live Events + Sports from the Sheet each call (auto-updating context). Good — keep it.

## 6. Featured events = type `y`
The `syncFeaturedEvents` trigger (which overwrote the column from red highlights) has been **deleted**. The app already treats `y`/`YES` in the events tab `featured` column as featured. Confirm typing `y` features an event (it shows on Home within the ~6-week window). Do NOT recreate that trigger.

## 7. Deploy auth
Pushing needs a token for the **fremontasbtech-sudo** GitHub account (classic token with `repo` scope, or fine-grained with **Contents: Read and write**). The Mac's stored git credential is a different account (`fhsastrophysics`) with no write access, so a plain `git push` 403s.

## Definition of done
Fresh load of `firebirdhub.vercel.app/?cb=1`: chatbot closes 4 ways; no duplicate games; XC/Track read as meets; only in-season teams shown; Felipe answers "next football game" and "when is Clubs Day" correctly; typing `y` features an event.
