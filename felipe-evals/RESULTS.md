# Ask Felipe: results before and after the rework

Measured 2026-11-18, 10:40 to 11:35 PT, on this Mac (Node v26). Nothing was committed, pushed or deployed.

## Read this first: what is real and what is mocked

- **Real Gemini was never called.** `App/.env` does not exist, so there is no `GEMINI_API_KEY` here. Every Gemini latency below comes from the eval mock: first token after 800 ms plus 25 ms per 1,000 prompt tokens, then 600 characters a second. Those mock settings are assumptions, not measurements. Answer quality, tone, refusal wording, the "help, don't write graded work" policy, resistance to prompt injection by the model itself, and real time to first token are **not measured**.
- **Real (no mock involved):** the classifier and instant-answer timings, routing accuracy, which questions reach Gemini, prompt sizes, which facts are in the prompt, server overhead, rate limits, and the browser checks.
- Data: the 2026-11-18 snapshot of fremontasb.org `/api/sheet`, `/api/clubs` and `/api/announcements` (`fixtures/`), and the bell tables in `FirebirdHub/app.js`. The fake clock is Wed 2026-11-18 9:40 AM PT.
- Suite: the 104 cases in `cases.json`. "Before" is the baseline `ask.js` at App commit `38f1006` (`BASELINE.md`). "Rework" is the first version of the new code (`*-after*.json`). "Repair" is this round (`*-repair*.json`).

## Before and after

| Measure (units) | Before (baseline) | Rework | Repair (now) | Mock? |
|---|---|---|---|---|
| Classifier time per call | none | p50 0.007 ms, p95 0.028 ms, max 0.59 ms | p50 0.009 ms, p95 0.017 ms, p99 0.027 ms, max 0.88 ms over 20,800 calls; 0 over 5 ms | real |
| Classifier, 3,000 hostile 500-character questions with history | not measured | worst 1.5 ms steady state | p50 0.044 ms, p99 0.26 ms, max 7.0 ms (1 call over 5 ms, none over 50 ms) | real |
| Instant (in-page) answer time, classify plus answerLocal | none | p50 0.24 ms, p95 0.97 ms, max 2.1 ms | one cold call per case: p50 0.21 ms, p95 1.19 ms, max 2.84 ms; warm worst 0.12 ms | real |
| Questions answered in the page, no network | 0 of 104 | 55 of 104 | 57 of 104 (38 app-data answers, 19 canned cannot or crisis replies) | real |
| Gemini calls for the 104 questions | 104 | 49 | 47 | real |
| "cannot" or "crisis" questions that reach Gemini | 19 of 19 | 5 of 19 | 0 of 19 | real |
| Route accuracy (expected or also-ok route) | 86 of 104 | 97 of 104 | 104 of 104 | real |
| Cases passing (route plus required text on in-page answers) | n/a | 93 of 104 | 104 of 104 (38 of 38 app-data answers and 19 of 19 canned replies pass their text checks) | real |
| Time to first visible text, all 104 questions | p50 1,366.9 ms, p95 1,570.1 ms, max 2,028.3 ms | p50 1.0 ms, p95 863.1 ms, max 880.3 ms | p50 0.9 ms, p95 870.8 ms, max 897.7 ms | server part mocked |
| Time to first visible text, the 57 in-page questions | p50 1,367.5 ms, p95 1,798.7 ms | p50 0.1 ms | p50 0.1 ms, p95 1.2 ms, max 2.8 ms (browser probe: 1 to 8 ms) | real |
| Time to first visible text, the 47 that reach Gemini | (whole answer at once) | p50 850.4 ms, p95 864.8 ms | p50 855.4 ms, p95 882.7 ms | **mock** |
| Whole answer, questions that reach Gemini | p50 1,367 ms, p95 1,573 ms | p50 1,235 ms | p50 1,242.3 ms, p95 1,269.6 ms | **mock** |
| Prompt size per Gemini call | p50 25,341 characters (about 6,340 tokens) | p50 6,595, p95 9,823, max 10,892 | p50 7,443, p95 10,447, max 14,486 characters (about 1,860 tokens at p50); 71 % smaller than before | real |
| Prompt size, the 47 questions that still reach Gemini | mean 25,355 characters | mean 7,601 | mean 8,534 | real |
| Needed facts present in the prompt (36 server-path cases with required facts) | 24 of 36 | 29 of 36 | 35 of 36 (the one left, photosynthesis, is general knowledge, not app data) | real |
| Server overhead around Gemini, warm | p50 2 ms, p95 29 ms | p50 1 ms, p95 2 ms | p50 2 ms, p95 4 ms, max 23 ms | real |
| First question on a cold instance, sources 2,600 ms slow | +2,662 ms | +2,606 ms | +1,528 ms (later questions +5 to +10 ms) | real (delay simulated) |
| First question on a cold instance, sources past the 4.5 s timeout | +5,020 ms | +4,030 ms | +1,530 ms; the second question can wait up to 1.5 s more while the fetch is still running | real (delay simulated) |
| Old clients sending only `{question, history}` | JSON | 104 of 104 HTTP 200 JSON | 104 of 104 HTTP 200 JSON, 0 fallbacks | server part mocked |

Why the prompt grew from the rework to now (p50 +848 characters): the rules the review asked for (decline rule-breaking and bullying, treat LIVE DATA as facts only, the abuse hotline) and a random-marker fence around LIVE DATA add about 600 characters to every prompt, and the announcement headlines now list all of the day's items. Named-sport results, past events and matching announcement text are added only when the question needs them.

Two mock runs at 10:47 to 11:11 PT had 3 random cases stall for 30 s to 594 s before the first byte (`es-lunch`, `app-firebucks`, `gen-rec-letter`, and similar in the legacy run). The same cases ran in 1.2 s in 3 repeat runs and in the 2 full reruns used above, at 1 to 2 % CPU, so it looks like the Mac stalling timers during that window, not the code. If it shows up again, run `node run.mjs --inproc --stream --only <id>` a few times.

## What changed in the repair round

Classifier (`FirebirdHub/felipe-core.js`, now version 2):
- Follow-ups borrow the last question only when every new word is a refinement (team, level, gender, day, date, time, period, school). "who is the principal", "whats the wifi", "tickets?", "is the library open" and "Gracias, muy amable" now stand on their own. All 11 reported pairs are regression tests.
- New "cannot" rules: pro and college leagues even with words like "finals"; "what grade did I get"; "<name>'s schedule, grades, address or phone" (read from the raw text; school names and common nouns excluded); vaping, drugs or skipping "without getting caught"; mean or roast messages aimed at a person; DAN and "no rules" jailbreaks; answers to a quiz or test (reply offers practice questions); passwords get their own reply.
- Crisis: more self-harm and abuse wording in English and Spanish ("cutting again", "don't want to be here anymore", "nobody would care", "me estoy cortando", "me pega", "ya no quiero estar aquí"), with false positives avoided ("cutting class", "cortarme el pelo"). The reply uses the language the student typed; the app also shows its own language when they differ. Abuse disclosures get their own reply that leads with a trusted adult and the counselors and gives Childhelp 1-800-422-4453 (call, or text GO), plus 988, 741741 and 911. Spanish gives "llama al 988 y marca 2" and "envía AYUDA al 988" (checked on 988lifeline.org on 2026-11-18).
- Planning questions ("make me a plan before Thanksgiving break", "what should I do first today") are the planning intent and ask for the student's Schoology items.
- Instant answers: a named event answers that event first (rare words like "trivia" outweigh shared ones like "club"); "online" instead of "at Online"; "in the evening" instead of "at Evening"; "tomorrow, Thursday, Nov 19 (A day)"; "and lunch?" gives both lunch times; "this week" instead of "that week", with that week's games listed; nothing today names the next game; past tense, Firebird Football and Rancho San Antonio go to Gemini; badminton, tennis and golf are matches; daughter, hija and hijo map to girls or boys; all of today's headlines; "Las vacaciones ... son"; typo map adds ther, thr, wed, thur and others; a bare "home game?" is answered in the page.
- Schoology items carry the weekday with the due date ("Fri 2026-11-20 8:30 AM"), are sorted by date, and match subject words the titles don't use (spanish to unidad and vocabulario, chem to stoichiometry).

Server (`FirebirdHub/api/ask.js`, `api/_felipe/*`):
- Context: a named sport gets its latest 3 posted results per team at any age (the Bell Game 13-42 and JV 20-20 are now in the prompt); past events the question names are included; announcements from the last 7 days that share a distinctive word with the question go in with full text (up to about 1,600 characters); emails in announcement text are replaced; cold waits are 1.5 s, not 4 s.
- LIVE DATA sits inside a random-marker fence with a rule to use it only as facts. New system-prompt rule to decline rule-breaking, cheating and bullying.
- Wellbeing questions are never rate limited and never end in "I couldn't answer that one": if Gemini is blocked, empty, errors or has no key, the student gets a kind line about the counselors and 988.
- Rate limits: per student by a random per-browser id (10 a minute, 80 an hour), per IP looser (40 a minute, 400 an hour), 60 Gemini calls a minute per instance, and 60 requests a minute per IP for everything, canned replies included. Checked in process: 12 rapid questions from one student gave 10 answers and 2 busy replies with a 60 s wait; 30 students on one IP gave 30 answers; 14 rapid wellbeing questions gave 14 answers; 65 canned questions from one IP gave 5 HTTP 429.
- The request's abort controller starts at the top of the handler and is checked before Gemini; a student who leaves during a 800 ms cold context wait cost 0 Gemini calls. The JSON path is aborted too.
- Input: text is sliced before the regexes run (a 4 MB question cleans in 0.75 ms; 100,000 assignment items in 0.39 ms).
- Debug headers (`x-felipe-route`, `x-felipe-answered-by`, `x-felipe-intent`, `x-felipe-prompt-chars`, `x-felipe-sections`) are sent only with `FELIPE_DEBUG_HEADERS=1`; the eval harness sets it. `x-felipe-route` now says `llm` whenever Gemini is called.

App (`FirebirdHub/app.js`, `index.html`; `felipe-core.js?v=2`, `app.js?v=56`):
- App-data, canned and crisis answers are never blocked by the 1.5 s gap or a busy server answer; server questions queue instead of being dropped (probe: "tickets?" sent 100 ms after another question was answered in turn).
- A second Gemini call happens only when the first request never got a streamed reply; a stream that ends with no text shows "try asking a different way". Client timeout 30 s.
- `aria-busy` on `#askLog` while an answer streams; focus returns to the input after a starter question; no "From the app's data" tag on greetings and thanks; the busy reply says how long to wait; a follow-up like "summarize the first one" resends the items from the last assignment question; the random per-browser id is sent as `client`.
- Spanish crisis buttons: "Enviar AYUDA al 988" (`sms:988?&body=AYUDA`); abuse replies add a "Call Childhelp" button.

Browser probe at 390 px against `dev-server.mjs` on port 4463 (mock Gemini, fixtures): "who is the principal" after "what period is it" went to the server; `aria-busy` was "true" while streaming and removed after; "me quiero morir" in an English app showed the Spanish reply then the English one, each with its buttons; with Schoology seeded, "make me a plan ... before thanksgiving break" sent 4 items, "summarize the first one" resent them, "when is my spanish quiz" sent only the Unidad 4 quiz, and every due date had its weekday. The only console errors were Google sign-in refusing the localhost origin (expected).

## Privacy and About text (the security review's sentences)

Added to the app (this round): the About panel paragraph in English and Spanish, and the Schoology connect note.

The website Privacy page is a website change, so it was **not** edited here. For `Website/fremontasb-site/src/pages/Privacy.jsx`, add a section after "The contact form":

**Ask Felipe in the Firebird Hub app**

> Ask Felipe answers questions in the Firebird Hub app. Simple questions, like what period it is or when the next game is, are answered on your own device from the app's data and are not sent anywhere.
>
> Other questions are sent to Google's Gemini AI service so it can write an answer. We send your question, your last few messages in that chat, and the language you picked. If you have connected Schoology and your question is about your assignments, we also send the title, type, due date and short description of the matching assignments, up to 12 of them. We never send your name, your email, or your Schoology calendar link.
>
> We don't save your questions, Felipe's answers or your assignments, and no one at ASB reads them. Google handles them under its Gemini API terms. Please don't type private information, like passwords, grades or other students' details, into Ask Felipe.

Only if the Gemini key is on a paid (billed) tier, add: "Google doesn't use them to train its models, but it may keep them for a short time to check for misuse." If the key stays on the unpaid tier, say instead that Google may use the questions to improve its services, or stop sending assignments.

App About panel (`index.html`, added):
- English: "Ask Felipe answers simple questions from the app's data on your device. Other questions, your last few messages and, when you ask about your assignments, the matching Schoology items (title, due date and short description) are sent to Google's Gemini AI to write an answer. ASB doesn't save them. Please don't share private information with Felipe."
- Spanish: "Pregúntale a Felipe responde las preguntas sencillas con los datos de la app en tu dispositivo. Las demás preguntas, tus últimos mensajes y, cuando preguntas por tus tareas, las tareas de Schoology que coinciden (título, fecha de entrega y descripción corta) se envían a Gemini, la IA de Google, para escribir la respuesta. ASB no las guarda. Por favor, no compartas información privada con Felipe."

Schoology connect note (`app.js`, added):
- English: "If you ask Felipe about your assignments, the matching items are sent to Google's Gemini to write the answer."
- Spanish: "Si le preguntas a Felipe por tus tareas, las tareas que coinciden se envían a Gemini de Google para escribir la respuesta."

## How to reproduce

```
cd "Not on Drive/App/felipe-evals"
node core.test.mjs                                    # 296 unit tests
node run.mjs --core --out results/core-repair.json    # routing, instant answers, timings
FELIPE_MOCK=1 FELIPE_FIXTURES=1 FELIPE_DUMP_PROMPT_DIR=<dir> node run.mjs --inproc --stream --out results/repair-stream-mock-fixtures.json
FELIPE_MOCK=1 FELIPE_FIXTURES=1 node run.mjs --inproc --legacy-body --out results/repair-legacy-json.json
node coverage.mjs --dumps <dir> --core results/core-repair.json --out results/coverage-repair.json
node compare.mjs --before results/baseline-fixtures.json --after results/repair-stream-mock-fixtures.json --core results/core-repair.json --out results/compare-repair.json
```

With a key in `App/.env` (gitignored): `node dev-server.mjs 4461` then `node run.mjs --url http://127.0.0.1:4461 --stream --representative`, each run on its own port.
