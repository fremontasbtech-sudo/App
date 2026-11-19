# Ask Felipe for about 1,000 students: how it keeps answering

Written 2026-11-18 (evening, PT). Everything here was measured with mocks: no AI key was used, Gemini and Groq were the eval harness's fake models, the school data was the fixtures snapshot, and Vercel Runtime Cache was an in-process stand-in. Nothing in this pass was committed, pushed or deployed.

## 1. The problem in one paragraph

Felipe's Gemini key is on Google's free tier. Free quotas belong to the whole Google project behind the key, they reset at midnight Pacific, and on 2026-11-18 the project was out ("429 You exceeded your current quota"). Every question that needed AI then got "Felipe is having a moment". The website's title cleaner uses the same key name (`GEMINI_API_KEY`) and probably the same project, so it was spending the same quota. With 1,000 students, the free tier alone is tight on a normal day and runs out on a busy one, so the fix has two parts: use far fewer AI calls (code, done), and make the remaining calls dependable (a paid tier or a second key, which only Abir can set up).

## 2. How Felipe answers now

A question goes through these steps in order. Each step that can answer stops there.

1. **On the phone (no network).** `felipe-core.js` answers about half of all questions on the student's own device: the current period, bell times, school days, the next game or event, spirit standings, today's announcements. Crisis and "can't help with that" replies are also made on the phone. In the load test, 52% of questions never reached the server.
2. **The shared answer cache.** On the server, a question that stands on its own (not a follow-up like "where is it?" or "and JV?", no Schoology items, nothing personal like a name or phone number) is answered once and the answer is reused for every student who asks the same thing. It is sent to the AI *without* the chat history, so the saved answer fits anyone. How long an answer is kept:
   - up to 6 hours for topics that only change when the data changes (clubs, results, spirit, app help);
   - 2 hours for events and announcements;
   - 30 minutes for anything else;
   - 10 minutes for "today" questions and 5 minutes for "right now", "next period" or "how long until" questions;
   - 5 minutes when a backup model wrote the answer, so the main model's answer replaces it soon;
   - never past midnight, and a sheet edit makes a new cache key at once, because the key includes a hash of the live data.
   The cache lives in Vercel Runtime Cache, shared by every server instance in the region, with a copy in each instance's memory. Identical questions asked at the same moment share one AI call.
3. **The AI, through a quota-aware router** (`api/_felipe/providers.js`). Models are tried in order: `gemini-3.6-flash`, `gemini-3.1-flash-lite`, `gemini-2.5-flash-lite` (each has its own free quota), then Groq, Cerebras and OpenRouter only if their keys are set. A model that answers "out of quota" is skipped by every instance until its quota resets (midnight Pacific for a daily Google quota, its retry time for a per-minute one), so no student waits on a model that can't answer. These "out of quota" flags belong to one key (a 12-character fingerprint of it, never the key), so a new or upgraded key works the moment it is set.
4. **Answers from the school's data** (`api/_felipe/dataanswer.js`). When no AI is available (every model out of quota, the school's daily cap reached, or one student's daily limit reached), questions about events, games, results, clubs, announcements, spirit, the schedule and the student's own Schoology items are answered straight from the data, in English or Spanish. Writing and study requests get "I can't write that right now"; other questions the data can't answer get "I can't answer that one right now". A student who is struggling always gets the kind support message with the counselor and 988 information. In the app these answers are tagged "From the school's data", and the first one in a visit adds "Fuller answers will be back soon."
5. **Limits that keep it fair.** Per warm instance: 10 AI questions a minute and 80 an hour per student, 40 a minute and 400 an hour per IP. Shared by all instances, per Pacific day: 40 AI questions per student (`FELIPE_PERSON_DAILY`), 400 per IP (`FELIPE_IP_DAILY`), and an optional cap for the whole school (`FELIPE_DAILY_CAP`). Over a daily limit, a student gets data answers, not an error. When every model is already known to be out, data answers skip the per-minute limits.

**Privacy rules in the code.** Questions are never logged. Only answers to self-contained questions are kept, under a SHA-256 hash (the question text itself isn't stored). A question with Schoology items or chat history goes to Gemini only, never to Groq, Cerebras or OpenRouter. Daily counts are kept under a SHA-256 of the IP or the app's random browser id and expire after about a day. The website Privacy page and the app's own notice (English and Spanish) were updated to say so.

**Safety of the shared cache.** Vercel's `getCache()` hashes keys with a 32-bit hash by default, so two different questions could share a slot (and, since the repo is public, someone could plant an answer on purpose). Both the app and the website now hash keys with SHA-256, and every saved value carries its own full key: a value that belongs to another key is treated as a miss.

## 3. Load test: one simulated school day (mocks, port 4492)

`node loadtest.mjs --port 4492` runs 1,000 students through Wednesday 2026-11-18 (a B day) against the dev server with a virtual clock. 30% of students ask (normal day) or 60% ask with up to 6 questions each (heavy day). Questions come from a weighted bank of about 30 topics with paraphrases, 10% in Spanish, 30% of askers with Schoology connected, and the app's real behavior: classify on the phone first, then the server with the chat's history. Free-tier limits modeled: `gemini-3.6-flash` 250 a day, `gemini-3.1-flash-lite` 1,000 a day, `gemini-2.5-flash-lite` 1,000 a day (assumed equal to 3.1-flash-lite's; check it in AI Studio), 10 requests a minute each; Groq `llama-3.3-70b-versatile` 30 a minute, 1,000 a day, 12,000 tokens a minute and `llama-3.1-8b-instant` 30 a minute, 14,400 a day, 6,000 tokens a minute.

Results: `results/loadtest-repair-normal.json` and `results/loadtest-repair-heavy.json` (gitignored). "Before" is the same day on the code before this repair (`results/loadtest-2026-11-18.json` and `loadtest-heavy-2026-11-18.json`).

### Normal day: 300 of 1,000 students ask, 578 questions

| | a. free Gemini | b. free Gemini + Groq | c. paid Gemini | a, cache off | before (a) |
|---|---|---|---|---|---|
| Answered on the phone | 301 (52.1%) | 301 | 301 | 301 | 301 |
| Questions to the server | 277 | 277 | 277 | 277 | 277 |
| AI answers / from the cache | 193 / 84 | 193 / 84 | 193 / 84 | 277 / 0 | 254 / 23 |
| Cache hits, share of server questions | 30.3% | 30.3% | 30.3% | 0% | 8.3% |
| Provider calls (answered + 429) | 193 (193 + 0) | 193 (193 + 0) | 193 | 279 (277 + 2) | 255 (254 + 1) |
| gemini-3.6-flash's 250 a day used up at | never (193 used) | never | no limit | 6:28 PM | 9:20 PM |
| Data answers / "try later" / "busy" / errors | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| First text, AI answer p50 / p95 | 882 / 912 ms | 883 / 908 ms | 883 / 909 ms | 880 / 905 ms | 873 / 901 ms |
| First text, cache hit p50 / p95 | 2 / 7 ms | 3 / 5 ms | 3 / 6 ms | none | 3 / 5 ms |
| Busiest minute: server questions / AI calls | 10 / 6 (10:51 AM) | 10 / 6 | 10 / 6 | 10 / 10 | 10 / 7 |
| Input tokens sent to the AI | 465,235 | 465,235 | 465,235 | 682,364 | 637,867 |

What changed: the cache now serves 84 questions instead of 23, so the day needs 193 AI calls instead of 254 (24% fewer), and the free 250 a day on `gemini-3.6-flash` is never used up. Groq was never needed.

### Heavy day: 600 of 1,000 students ask, up to 6 questions each, 1,394 questions

| | a. free Gemini | b. free Gemini + Groq | c. paid Gemini | before (a) | before (c) |
|---|---|---|---|---|---|
| Answered on the phone | 710 (50.9%) | 710 | 710 | 710 | 710 |
| Questions to the server | 684 | 684 | 684 | 684 | 684 |
| AI answers / from the cache | 432 / 252 | 432 / 252 | 432 / 252 | 608 / 67 | 615 / 69 |
| Cache hits, share of server questions | 36.8% | 36.8% | 36.8% | 9.8% | 10.1% |
| Provider calls (answered + 429) | 434 (432 + 2) | 434 (432 + 2) | 432 (432 + 0) | 623 (608 + 15) | 615 |
| Who answered | 3.6-flash 250, 3.1-flash-lite 182 | same, Groq 0 | 3.6-flash 432 | 3.6-flash 250, 3.1-flash-lite 358 | 3.6-flash 615 |
| gemini-3.6-flash's 250 a day used up at | 12:55 PM | 12:55 PM | no limit | 11:19 AM | no limit |
| Data answers / "try later" / errors | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 8 / 1 / 0 | 0 / 0 / 0 |
| First text, AI answer p50 / p95 | 881 / 909 ms | 881 / 909 ms | 882 / 909 ms | 870 / 900 ms | 870 / 898 ms |
| First text, cache hit p50 / p95 | 3 / 6 ms | 3 / 5 ms | 3 / 5 ms | | |
| Busiest minute: server questions / AI calls | 21 / 10 (10:50 AM) | 21 / 10 | 21 / 10 | 21 / 12 | 21 / 13 |
| Input tokens sent to the AI | 1,021,154 | 1,021,154 | 1,021,154 | | 1,529,121 |

What changed: 432 AI calls instead of 608 to 615 (29% fewer), so the free tier now gets through the heavy day with no data answers and no "try later". It has no room to spare, though: the busiest minute (10:50 AM, at the morning break) used exactly 10 AI calls, the free limit per model, and one per-minute 429 was hit (the router moved on to the next model at once). The main model ran out at 12:55 PM, and the lighter `gemini-3.1-flash-lite` answered the rest of the day. A slightly busier day, a bigger rally week or the website still sharing the key would push it past the free limits; then students get answers from the data (section 2, step 4), never an error.

All three scenarios had 0 empty answers and 0 errors on both days. Latency in a mock run only shows the server's own overhead: the mock model takes 800 ms plus 25 ms per 1,000 prompt tokens to start. Real Gemini measured on 2026-11-18 (15 questions): first words p50 1.7 s, p90 2.2 s.

## 4. What paid Gemini would cost

Prices per 1 million tokens (checked 2026-11-18): `gemini-3.6-flash` $0.75 input, $3.75 output (this price runs through 2026-12-31); `gemini-3.1-flash-lite` $0.25 / $1.50; `gemini-2.5-flash-lite` $0.10 / $0.40. Input tokens are the real prompts the server built from the fixtures, at 4 characters per token (about 2,410 tokens per call). Output tokens are an assumption: 200 to 600 per answer, low thinking included.

**Normal day on gemini-3.6-flash (193 AI calls):**
- Input: 465,235 tokens = 0.465 M tokens x $0.75 per M = $0.35
- Output: 193 answers x 200 to 600 tokens = 38,600 to 115,800 tokens = 0.039 to 0.116 M tokens x $3.75 per M = $0.14 to $0.43
- Total: **$0.49 to $0.78 a day**, or **$89 to $141 for a 180-day school year**.

**Heavy day on gemini-3.6-flash (432 AI calls):**
- Input: 1,021,154 tokens = 1.021 M tokens x $0.75 per M = $0.77
- Output: 432 answers x 200 to 600 tokens = 86,400 to 259,200 tokens = 0.086 to 0.259 M tokens x $3.75 per M = $0.32 to $0.97
- Total: **$1.09 to $1.74 a day**. Even if every school day were a heavy day, that is $196 to $313 for 180 days.

**The same traffic on the cheaper models:** normal day $0.17 to $0.29 on `gemini-3.1-flash-lite` and $0.06 to $0.09 on `gemini-2.5-flash-lite`; heavy day $0.39 to $0.64 and $0.14 to $0.21 (order them first with `FELIPE_MODELS` if cost matters more than answer quality; their answers were not checked on real Gemini).

**Before this repair** the normal day was $0.67 to $1.05 and the heavy day $1.61 to $2.53 on `gemini-3.6-flash` (254 and 615 calls). The cache saves about a quarter to a third of the bill as well as the quota.

A paid key still has per-minute limits, but Google's paid tiers start in the hundreds of requests a minute, far above the 6 to 13 AI calls a minute measured here.

## 5. Settings (Vercel environment variables)

Abir sets these himself in the Vercel dashboard (team `fremont-asb-tech`), then redeploys. None of them is needed for the code to work; with none set, Felipe behaves as described above on the one Gemini key.

**App project (`app`, firebirdhub.vercel.app):**

| Name | What it does | Where to get it |
|---|---|---|
| `GEMINI_API_KEY` | Felipe's Gemini key (already set). To leave the free tier, keep the key and turn on billing for its Google Cloud project, or replace it with a key from a project that has billing. | Google AI Studio (aistudio.google.com, "Get API key"), signed in as the ASB Gmail; billing in the Google Cloud console under Billing for that project. |
| `FELIPE_DAILY_CAP` | Most AI questions the whole school may use in one Pacific day (a spending guard; past it, data answers). Not set means no cap. Suggested: 1500 on a paid key. | Any number. |
| `FELIPE_PERSON_DAILY` | AI questions one student (the app's random browser id) may ask per day. Default 40. | Any number. |
| `FELIPE_IP_DAILY` | AI questions one IP address may ask per day. Default 400 (phones on one carrier can share an IP). | Any number. |
| `FELIPE_MODELS` | The Gemini models to try, in order. Default `gemini-3.6-flash,gemini-3.1-flash-lite,gemini-2.5-flash-lite`. | Model names from the Gemini API docs. |
| `FELIPE_CACHE_HOURS` | Longest time a stable answer is kept. Default 6; 0 keeps everything at 30 minutes or less. If changed, change "up to 6 hours" on the Privacy page and in the app's notice. | Any number. |
| `FELIPE_CACHE` | `0` turns the answer cache off (not recommended). | |
| `FELIPE_SHARED_CACHE` | `0` turns off the shared Runtime Cache layer (each instance then caches only its own answers and counts only its own limits). | |
| `GROQ_API_KEY` | Adds Groq's free models as backups after Gemini (`GROQ_MODELS` to change them). **Update the Privacy page and the app notice to name Groq first.** | console.groq.com, API Keys |
| `CEREBRAS_API_KEY` | Adds Cerebras as a backup (`CEREBRAS_MODELS`). Same Privacy rule. | cloud.cerebras.ai, API Keys |
| `OPENROUTER_API_KEY` | Adds OpenRouter's free models as a backup (`OPENROUTER_MODELS`). Same Privacy rule. | openrouter.ai, Keys |
| `FELIPE_PROVIDERS` | Order or drop providers, for example `gemini,groq`. | |
| `FELIPE_DEBUG_HEADERS` | Eval headers. Never set it in production. | |

**Website project (`fremontasb-site`):**

| Name | What it does | Where to get it |
|---|---|---|
| `SITE_GEMINI_API_KEY` | The website's own Gemini key for cleaning titles, used instead of `GEMINI_API_KEY`. Make it in a **separate Google Cloud project** so the website never uses Felipe's quota. The free tier is plenty for the website now: each title is made once and kept 7 days. | Google AI Studio, "Create API key" in a new project. |

Runtime Cache tags, for the Vercel dashboard: `felipe-answers` (Felipe's saved answers), `felipe-quota` (Felipe's out-of-quota flags and daily counts; expiring it clears them without dropping answers), `site-llm-titles` and `site-llm-quota` on the website.

**Text for the Privacy page if a backup provider is ever added** (replace the sentence that starts "Other questions are sent to Google's Gemini AI service"): "Other questions are sent to Google's Gemini AI service so it can write an answer. When Gemini is busy, a general question with no assignments and no earlier messages may go to Groq instead, under Groq's terms." In Spanish: "Las demás preguntas se envían a Gemini, el servicio de IA de Google, para escribir la respuesta. Cuando Gemini está ocupado, una pregunta general sin tareas ni mensajes anteriores puede enviarse a Groq, según los términos de Groq."

## 6. What still needs Abir

1. **Choose the plan for the key.** The recommended fix is to turn on billing for the Google Cloud project behind Felipe's key (about $90 to $140 a school year at normal use, section 4), set a budget alert there, and set `FELIPE_DAILY_CAP` (for example 1500) as a guard. The free tier alone now gets through both modeled days (normal: 193 of the main model's 250; heavy: the main model runs out at 12:55 PM and the lighter one takes over), but with no headroom at the bell peaks, and only once the website stops sharing the key's project (item 3).
2. **If billing goes on,** the Privacy line "may use them to improve its services" should change (Google doesn't use paid-tier data that way). Also still open from HANDOFF item 21: Google's Gemini API terms on users under 18.
3. **Give the website its own key** (`SITE_GEMINI_API_KEY`, separate project), so title cleaning never touches Felipe's quota.
4. **Before any Groq, Cerebras or OpenRouter key:** update both privacy texts (section 5 has the wording).
5. **After the next deploy (on a preview first):**
   - check that the `app` project runs Node 20 or 22 (`@vercel/functions` needs 20 or later; `package.json` now says so);
   - check that `https://<deployment>/node_modules/@vercel/functions/package.json` returns 404;
   - check in Observability that Runtime Cache shows entries for the app (it is not confirmed on the Hobby plan; without it each instance keeps its own cache and its own daily counts, which still works, just less well);
   - run the real-Gemini eval (`.github/workflows/felipe-eval.yml`) with a key, for answer quality and real speed. `gemini-2.5-flash-lite` (the new third model) has never been checked on real Gemini.
6. **Check the free limits of `gemini-2.5-flash-lite`** in AI Studio's rate-limit page (the load test assumed 10 a minute and 1,000 a day).
7. **Vercel Firewall rate-limit rule on `/api/ask`** (HANDOFF item 15). The daily limits in the code count per student id (which a script can change) and per IP, and they fail open if Runtime Cache is down.
8. **Commit, push and deploy.** Nothing from the scale work or this repair is committed. The app and website changes go together (the Privacy page describes the app's cache).

## 7. Review items not done, and why

- **"Any announcements about tutoring?" lists unrelated headlines, and event descriptions stay in English inside Spanish data answers.** Both were already known. A better match needs the AI, and translating sheet text needs the AI too; data answers only run when the AI is out.
- **Count billable HTTP calls instead of questions for `FELIPE_DAILY_CAP`.** Kept as a count of AI questions (one per question that reached any provider), and the docs now say so. A question that falls through a 429 costs nothing for the failed call.
- **Adding `"type": "module"` to `FirebirdHub/package.json`** to silence Node's local "MODULE_TYPELESS_PACKAGE_JSON" warning: not done, because `felipe-core.js` is a UMD file that the server loads as CommonJS and the browser loads as a plain script. The warning is local only; Vercel built these files the same way before `package.json` existed.
- **Not sending on-device answers as chat history** (an option in the review): not needed. A self-contained question is now answered from the cache whatever the history holds, and real follow-ups still need the earlier turns.

## 8. Checks run for this pass

- `node core.test.mjs`: 305 of 305 (2 new: dates without a year, final exams as schedule).
- `FELIPE_MOCK=1 FELIPE_FIXTURES=1 node run.mjs --inproc --stream`: 117 of 117 (104 old cases plus 13 new; 11 are `no_ai` cases that check answers made from the data, all 11 passed their text checks). `--legacy-body`: 117 of 117. `node run.mjs --core`: 117 of 117 routes.
- `node scale.mjs`: every scenario as expected, including 5 new ones: a self-contained question with history comes from the cache with 0 AI calls while "where is it?" makes its own call; a new key works at once after the old key's 3 models were flagged; 12 questions in a minute during a full outage got 12 data answers and no "busy"; a 4th question past `FELIPE_PERSON_DAILY=3` got a data answer and a wellbeing one got the support message; a cache entry holding another key is a miss.
- `nextMidnightPT` across both 2026-27 time changes: 12:30 AM on Nov 1 and Mar 14 both give the next midnight.
- Website: `site-llm.test.mjs` 22 of 22 and the caller test pass; `vite build` succeeds; `src/data/events.json` and `photos.json` unchanged (same SHA-1 before and after).
- The app in a 390-px browser with every model out: data answers show the "From the school's data" tag, with the "back soon" line only on the first one, in English and Spanish.
