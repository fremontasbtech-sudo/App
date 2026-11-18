# Ask Felipe baseline (before the speed and scope rework)

Measured 2026-11-18, 09:45 to 10:05 PT, on the code at App commit `38f1006` (`FirebirdHub/api/ask.js` sha256 `9b1184742c41…`, `app.js` sha256 `f51b739c1d82…`). Full numbers: `baseline.json`.

**Real Gemini latency was not measured.** `App/.env` does not exist, so there is no `GEMINI_API_KEY` on this Mac, and the live app is blocked by Securly. Every Gemini time below comes from the mock (first token at 800 ms + 25 ms per 1,000 prompt tokens, then 600 characters/s). Those mock settings are assumptions, not measurements. The server overhead, context fetch times, prompt sizes and routing are real.

## Headline numbers

| What | Baseline |
|---|---|
| Classifier in front of Gemini | none: all 104 of 104 cases call Gemini |
| "cannot" and "crisis" questions sent to Gemini | 19 of 19 |
| Streaming | no: the student sees the first character only when the whole answer is done |
| Time to first visible character (mock Gemini) | p50 1,359.1 ms, p95 1,361.7 ms, max 1,514.1 ms (= total time) |
| Server overhead around Gemini, warm | p50 1 ms, p95 2 ms |
| Server overhead, first question after a cold start (CDN warm) | 89, 91, 97, 98, 201 ms over 5 cold starts |
| Cold start when sources are slow (simulated 2,600 ms, the observed Events CDN miss) | +2,653 ms overhead, 4,022.6 ms total |
| Cold start when a source passes the 5 s timeout (simulated 6,000 ms) | +5,020 ms overhead; every section turns "unavailable" and the prompt drops to 6,809 characters |
| System prompt size | 25,588 characters, about 6,397 tokens (4 characters per token) |
| Prompt sent per question (system + history + question) | p50 25,623 characters, about 6,406 tokens; min 25,600, max 25,890 |
| Share of the prompt that is the 76-club list | 14,774 characters, 57.7 % |
| Output cap | `maxOutputTokens` 2,048, `thinkingLevel` "low", temperature 0.25 |

## Live source fetch times (curl, 2026-11-18 09:26 to 09:33 PT)

| Source | First fetch (CDN miss) | Repeats (CDN hit) |
|---|---|---|
| `/api/sheet?tab=Events` | 2,645 ms | 38, 44, 37 ms |
| `/api/sheet?tab=Sports` (73.9 KB) | 1,958 ms | 148, 144, 135 ms |
| `/api/sheet?tab=Spirit%20Points` | 1,594 ms | 136, 49, 44 ms |
| `/api/clubs` (47.4 KB) | **112,561 ms** | 46, 160, 138 ms |
| `/api/announcements` (62.5 KB) | 83 ms | 53, 86, 63 ms |

The context cache lives 5 min (30 s if a source failed) and is keyed by day, with no stale-while-revalidate: the first question after each expiry waits for all 4 sources. A clubs CDN miss makes that student wait the full 5 s source timeout, and Felipe then answers without clubs.

## What the baseline context cannot answer

These cases fail on facts even with a perfect model, because the data is not in the prompt:
- Morning announcements (6 cases): nothing from `/api/announcements` is sent.
- The Bell Game score (13–42, 2026-11-06) and JV 20–20: results older than 7 days are dropped.
- Past events (Multicultural Fair, 10-28): ended events are dropped.
- Schoology assignments (7 cases): the request has no context field.
- School-life generative requests (study help, emails, explanations, 8 cases): the prompt says to answer only about FHS data and decline the rest.

## Route results on the 104 cases (mock, legacy body)

86 of 104 pass the route check. The server cannot answer "local" cases on the client, so those count as passing when the server answers them. All 18 failures are questions that should never reach Gemini: 5 unrelated, 3 private-data (a 4th, "What's my GPA?", may go to the LLM), 4 unsafe, 4 crisis, and the 2 Spanish cases (Super Bowl, "me quiero morir"). The answer wording was not checked because the mock answer is fake.

## Data issues found while building the cases (website side, not edited)

- Clubs list vs announcements disagree: Movie Club is "Room 134, Wed lunch, bi-monthly" in `/api/clubs` but "every Wednesday in A-208" in the 11-18 announcement. Girls Who Code is "Room A-212" in `/api/clubs` but "A-208 every Monday" in the announcement.
- `/api/announcements` already returns items dated 2026-11-20 and 2026-11-24. A server-side "today's announcements" must apply the same date and 8:30 AM reveal rule as the app.

## How to rerun

```
cd "Not on Drive/App/felipe-evals"
# Baseline copy (mock Gemini, live sources)
FELIPE_MOCK=1 node dev-server.mjs 8811 --api-file ask=<scratchpad>/felipe/baseline/ask.js
node run.mjs --url http://127.0.0.1:8811 --legacy-body --label baseline-mock
# Current code, new contract
FELIPE_MOCK=1 node dev-server.mjs 8787
node run.mjs --url http://127.0.0.1:8787 --stream --label new-mock
# Same thing with no server, deterministic data
FELIPE_MOCK=1 FELIPE_FIXTURES=1 node run.mjs --inproc --stream --label new-inproc
# Classifier and local answers (no network)
node run.mjs --core            # loads FirebirdHub/felipe-core.js
# Real Gemini on the 15 representative cases (needs GEMINI_API_KEY in App/.env)
node dev-server.mjs 8787 & node run.mjs --url http://127.0.0.1:8787 --stream --representative --label real
```

Results go to `results/<label>-<time>.json`. `fixtures/` holds the 2026-11-18 snapshot of the website APIs, with student emails and student names removed from `clubs.json`.
