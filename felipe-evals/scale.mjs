#!/usr/bin/env node
/**
 * Measures how Ask Felipe holds up for about 1,000 students on limited AI quotas, with mocks
 * only (no AI key, no network: Gemini, Groq, Cerebras and OpenRouter are answered by
 * lib/instrument.mjs, fremontasb.org by ./fixtures, Vercel Runtime Cache by its shim).
 *
 *   node scale.mjs                       # every scenario
 *   node scale.mjs --only cache,router   # some of them
 *   node scale.mjs --out results/scale.json
 *
 * Each scenario runs in its own child process, so each one starts as a fresh warm instance
 * (its own rate limiter, memory cache and provider state). Scenarios:
 *   cache       12 common questions asked twice: AI answer vs cache hit latency, and a hit from
 *               the shared layer after the instance's memory is wiped (a new instance).
 *   coalesce    50 students ask the same new question at once: AI calls made, first-text times.
 *               Then a second instance asks while the first is still answering.
 *   router      Mock quotas on 7 models across 4 providers (cache off): who answers each of
 *               55 questions, how many 429s were hit, and what a new instance does afterwards.
 *   minute      A per-minute 429 (Retry-After 30 s) vs a daily one (until midnight Pacific).
 *   budget      FELIPE_DAILY_CAP=5: AI calls stop at 5, the rest are answered from the data.
 *   sharedfail  The shared cache hangs, then throws: answers keep coming from memory.
 *   memonly     No shared layer at all (like a failed @vercel/functions import).
 *   trim        Only llama-3.1-8b-instant (6,000 tokens a minute): the prompt it is sent.
 *   history     A self-contained question asked after other chat turns comes from the cache
 *               (and is sent without the history); a follow-up ("where is it?") never does.
 *   keychange   Every Gemini model out of quota on key A; then a new key B is used at once.
 *   outage      Every model out: 12 questions from one student in a minute all get data
 *               answers (no "needs a short break").
 *   person      FELIPE_PERSON_DAILY=3: a 4th AI question from one student is answered from the
 *               data, a wellbeing one past the limit gets the support message.
 *   collide     A shared-cache entry that belongs to another key is treated as a miss.
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const NOW = "2026-11-18T09:40:00-08:00";

const SCENARIOS = {
  cache: { env: {} },
  coalesce: { env: {} },
  router: { env: { FELIPE_MOCK_PROVIDERS: "groq,cerebras,openrouter", FELIPE_CACHE: "0",
    FELIPE_MOCK_QUOTA: "gemini-3.6-flash=10,gemini-3.1-flash-lite=10,gemini-2.5-flash-lite=5,groq=10,cerebras=5,openrouter=5" } },
  minute: { env: { FELIPE_CACHE: "0", FELIPE_MOCK_QUOTA_KIND: "minute", FELIPE_MOCK_QUOTA: "gemini-3.6-flash=2" } },
  budget: { env: { FELIPE_CACHE: "0", FELIPE_DAILY_CAP: "5" } },
  sharedfail: { env: {} },
  memonly: { env: { FELIPE_MOCK_SHARED: "0" } },
  trim: { env: { FELIPE_MOCK_PROVIDERS: "groq", FELIPE_PROVIDERS: "groq", GROQ_MODELS: "llama-3.1-8b-instant", FELIPE_MOCK_NO_GEMINI: "1", FELIPE_CACHE: "0" } },
  history: { env: {} },
  keychange: { env: { GEMINI_API_KEY: "mock-key-A-not-a-key", FELIPE_CACHE: "0", FELIPE_MOCK_QUOTA: "gemini=0" } },
  outage: { env: { FELIPE_MOCK_QUOTA: "gemini=0" } },
  person: { env: { FELIPE_PERSON_DAILY: "3", FELIPE_CACHE: "0" } },
  collide: { env: {} }
};

/* ======================= parent ======================= */
if(!process.env.FELIPE_SCALE_CHILD){
  const only = opt("--only"), names = only ? only.split(",") : Object.keys(SCENARIOS);
  const results = {};
  for(const name of names){
    if(!SCENARIOS[name]){ console.error("unknown scenario " + name); continue; }
    const env = { ...process.env, FELIPE_MOCK: "1", FELIPE_FIXTURES: "1", FELIPE_SCALE_CHILD: name, TZ: "America/Los_Angeles", ...SCENARIOS[name].env };
    for(const k of ["GEMINI_API_KEY", "GROQ_API_KEY", "CEREBRAS_API_KEY", "OPENROUTER_API_KEY"]) if(!SCENARIOS[name].env[k]) delete env[k];
    const out = await new Promise(resolve => {
      const p = spawn(process.execPath, [fileURLToPath(import.meta.url)], { env, stdio: ["ignore", "pipe", "pipe"] });
      let so = "", se = "";
      p.stdout.on("data", d => so += d); p.stderr.on("data", d => se += d);
      p.on("close", code => resolve({ code, so, se }));
    });
    const line = out.so.split("\n").find(l => l.startsWith("RESULT "));
    results[name] = line ? JSON.parse(line.slice(7)) : { error: "no result", code: out.code, stderr: out.se.slice(-2000) };
    console.log("\n=== " + name + " ===\n" + JSON.stringify(results[name].summary || results[name], null, 2));
  }
  const file = path.resolve(HERE, opt("--out", path.join("results", "scale-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json")));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), node: process.version, results }, null, 2));
  console.log("\nsaved " + path.relative(HERE, file));
  process.exit(0);
}

/* ======================= child (one scenario) ======================= */
const { install, als, newRecord, getRecord, setMockQuota, makeSharedShim } = await import("./lib/instrument.mjs");
const { fakePair } = await import("./lib/vercel.mjs");
install();
const APP = path.resolve(HERE, "..", "FirebirdHub", "api");
const handler = (await import(pathToFileURL(path.join(APP, "ask.js")).href)).default;
const store = await import(pathToFileURL(path.join(APP, "_felipe", "store.js")).href);
const providers = await import(pathToFileURL(path.join(APP, "_felipe", "providers.js")).href);
// Out-of-quota flags are per key fingerprint ("gemini:<fp>:<model>"); report them by model id.
async function exMap(ids){
  const flags = Object.fromEntries(providers.providerList().map(p => [p.id, p.flag]));
  const m = await store.exhaustedMap(ids.map(i => flags[i] || i));
  return Object.fromEntries(ids.filter(i => m[flags[i] || i]).map(i => [i, m[flags[i] || i]]));
}

let n = 0;
const r1 = x => x == null ? null : Math.round(x * 10) / 10;
const pct = (a, p) => { a = a.filter(Number.isFinite).sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p / 100 * a.length))] : null; };
const stats = a => ({ n: a.length, p50: r1(pct(a, 50)), p90: r1(pct(a, 90)), max: r1(pct(a, 100)) });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function ask(question, o = {}){
  const id = "scale-" + (++n) + "-" + Date.now();
  const headers = { "content-type": "application/json", "x-eval-id": id, "x-felipe-now": o.now || NOW,
    "x-vercel-forwarded-for": "10.88." + Math.floor(n / 250) + "." + (n % 250 + 1) };
  const body = { question, history: o.history || [], lang: o.lang || "en", stream: o.stream !== false, client: o.client || ("scaleclient" + String(n).padStart(6, "0")) };
  const rec = newRecord(id);
  const { req, res, out, done } = fakePair({ method: "POST", headers, body });
  const t0 = performance.now();
  await als.run({ rec, clockOffset: Date.parse(headers["x-felipe-now"]) - Date.now() }, () => handler(req, res));
  await done;
  const all = out.chunks.map(c => c.s).join("");
  let text = "", first = null;
  for(const ch of out.chunks) for(const l of ch.s.split("\n")) if(l.startsWith("data:")){ try{ const ev = JSON.parse(l.slice(5)); if(ev.t === "delta"){ text += ev.text; if(first == null) first = ch.ms; } else if(ev.t === "error") text += "[error] " + ev.text; }catch(e){} }
  if(!/event-stream/.test(String(out.headers["content-type"]))){ try{ text = JSON.parse(all).answer || ""; }catch(e){} first = out.endMs; }
  const m = getRecord(id) || { gemini: [] };
  return { q: question, ms: r1(performance.now() - t0), firstMs: r1(first), by: out.headers["x-felipe-answered-by"] || null, why: out.headers["x-felipe-data-why"] || null,
    calls: m.gemini.map(g => ({ id: (g.provider || "gemini") + ":" + g.model, status: g.status, systemChars: g.systemChars, promptChars: g.promptChars })),
    promptChars: Number(out.headers["x-felipe-prompt-chars"]) || null, text };
}
const QUESTIONS = ["When is the fall play?", "how much are tickets for pandemonium", "When is Club Trivia Night?", "Who does girls basketball play this weekend?",
  "What was the score of the Bell Game?", "When does Astrophysics Club meet?", "who is the advisor for girls who code", "Are there any coding clubs?",
  "When are color guard auditions?", "How do spirit points work?", "Explain photosynthesis simply", "How should I ask a teacher for a letter of recommendation?"];
const tally = rows => rows.reduce((o, r) => { o[r.by] = (o[r.by] || 0) + 1; return o; }, {});

const S = {
  async cache(){
    const miss = [], hit = [], fresh = [];
    for(const q of QUESTIONS) miss.push(await ask(q));
    for(const q of QUESTIONS) hit.push(await ask(q));
    store._resetLocalForTests();                     // a new instance: memory empty, shared layer kept
    for(const q of QUESTIONS) fresh.push(await ask(q));
    const es = await ask("¿Cuándo es la obra de teatro de otoño?", { lang: "es" });
    const json = await ask("When is the fall play?", { stream: false });
    return { summary: {
      firstAsk: { answeredBy: tally(miss), totalMs: stats(miss.map(r => r.ms)), firstTextMs: stats(miss.map(r => r.firstMs)) },
      secondAsk: { answeredBy: tally(hit), totalMs: stats(hit.map(r => r.ms)), aiCalls: hit.reduce((s, r) => s + r.calls.length, 0) },
      newInstanceFromShared: { answeredBy: tally(fresh), totalMs: stats(fresh.map(r => r.ms)), aiCalls: fresh.reduce((s, r) => s + r.calls.length, 0) },
      spanishSameQuestion: { answeredBy: es.by, note: "different language = different key" },
      oldJsonClientHit: { answeredBy: json.by, hasAnswer: !!json.text },
      sharedShim: globalThis.__felipeSharedCache.stats
    }, rows: { miss, hit, fresh } };
  },
  async coalesce(){
    const q = "When is the fall play?";
    const rows = await Promise.all(Array.from({ length: 50 }, () => ask(q)));
    const aiCalls = rows.reduce((s, r) => s + r.calls.length, 0);
    const sameText = new Set(rows.map(r => r.text)).size;
    // Across instances: B arrives while A (another instance) is still answering.
    const q2 = "When is Club Trivia Night?";
    const pA = ask(q2);
    await sleep(60);
    store._resetLocalForTests();                     // B runs as a different instance id with empty memory
    const b = await ask(q2), a = await pA;
    return { summary: { students: 50, aiCalls, distinctAnswers: sameText, answeredBy: tally(rows), firstTextMs: stats(rows.map(r => r.firstMs)), totalMs: stats(rows.map(r => r.ms)),
      crossInstance: { aCalls: a.calls.length, bCalls: b.calls.length, bAnsweredBy: b.by, bMs: b.ms, aMs: a.ms } } };
  },
  async router(){
    const rows = [];
    for(let i = 0; i < 50; i++) rows.push(await ask(QUESTIONS[i % QUESTIONS.length]));
    const byProvider = {}, statuses = {};
    rows.forEach(r => {
      const ok = r.calls.filter(c => c.status === 200).pop();
      const k = r.by === "llm" && ok ? ok.id : r.by + (r.why ? "(" + r.why + ")" : "");
      byProvider[k] = (byProvider[k] || 0) + 1;
      r.calls.forEach(c => { const s = c.id + " " + c.status; statuses[s] = (statuses[s] || 0) + 1; });
    });
    const fall = rows.filter(r => r.calls.some(c => c.status === 429) && r.by === "llm");
    const exhausted = await exMap(["gemini:gemini-3.6-flash", "gemini:gemini-3.1-flash-lite", "gemini:gemini-2.5-flash-lite", "groq:llama-3.3-70b-versatile", "groq:llama-3.1-8b-instant", "cerebras:qwen-3.8-27b", "openrouter:meta-llama/llama-3.3-70b-instruct:free"]);
    store._resetLocalForTests();                     // a new instance
    const after = []; for(let i = 0; i < 5; i++) after.push(await ask(QUESTIONS[i]));
    return { summary: { questions: rows.length, answeredBy: byProvider, aiCallStatuses: statuses,
      total429s: rows.reduce((s, r) => s + r.calls.filter(c => c.status === 429).length, 0),
      fallThroughMs: stats(fall.map(r => r.firstMs)), normalFirstTextMs: stats(rows.filter(r => r.by === "llm" && !r.calls.some(c => c.status === 429)).map(r => r.firstMs)),
      exhaustedUntilMinutes: Object.fromEntries(Object.entries(exhausted).map(([k, v]) => [k, Math.round((v - Date.now()) / 60000)])),
      newInstance: { answeredBy: tally(after), aiCallsMade: after.reduce((s, r) => s + r.calls.length, 0), ms: stats(after.map(r => r.ms)) },
      dataAnswerSample: rows.filter(r => r.by === "data").slice(0, 2).map(r => r.q + " => " + r.text.slice(0, 160)) } };
  },
  async minute(){
    const rows = []; for(let i = 0; i < 4; i++) rows.push(await ask(QUESTIONS[i]));
    const ex = await exMap(["gemini:gemini-3.6-flash"]);
    process.env.FELIPE_MOCK_QUOTA_KIND = "daily"; setMockQuota("gemini-3.1-flash-lite=0");
    const d = await ask(QUESTIONS[5]);
    const ex2 = await exMap(["gemini:gemini-3.1-flash-lite"]);
    return { summary: {
      perMinute: { answeredBy: rows.map(r => (r.calls.filter(c => c.status === 200).pop() || {}).id || r.by), skippedForSeconds: ex["gemini:gemini-3.6-flash"] ? Math.round((ex["gemini:gemini-3.6-flash"] - Date.now()) / 1000) : 0 },
      daily: { answeredBy: (d.calls.filter(c => c.status === 200).pop() || {}).id || d.by, skippedUntil: ex2["gemini:gemini-3.1-flash-lite"] ? new Date(ex2["gemini:gemini-3.1-flash-lite"]).toLocaleString("en-US", { timeZone: "America/Los_Angeles" }) + " PT" : null } } };
  },
  async budget(){
    const rows = []; for(let i = 0; i < 8; i++) rows.push(await ask(QUESTIONS[i]));
    return { summary: { cap: 5, answeredBy: rows.map(r => r.by + (r.why ? "(" + r.why + ")" : "")), aiCalls: rows.reduce((s, r) => s + r.calls.length, 0),
      callsToday: await store.callsToday(new Date(Date.now()).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })) } };
  },
  async sharedfail(){
    // 1. The shared cache never answers (each call waits for the 250 ms timeout).
    globalThis.__felipeSharedCache = { get: () => new Promise(() => {}), set: () => new Promise(() => {}), delete: () => new Promise(() => {}) };
    const hang1 = [], hang2 = [];
    for(const q of QUESTIONS.slice(0, 6)) hang1.push(await ask(q));
    for(const q of QUESTIONS.slice(0, 6)) hang2.push(await ask(q));
    // 2. It throws.
    store._resetLocalForTests();
    globalThis.__felipeSharedCache = { get: async () => { throw new Error("down"); }, set: async () => { throw new Error("down"); }, delete: async () => { throw new Error("down"); } };
    const thr1 = [], thr2 = [];
    for(const q of QUESTIONS.slice(0, 6)) thr1.push(await ask(q));
    for(const q of QUESTIONS.slice(0, 6)) thr2.push(await ask(q));
    globalThis.__felipeSharedCache = makeSharedShim();
    return { summary: {
      hanging: { first: { answeredBy: tally(hang1), ms: stats(hang1.map(r => r.ms)) }, again: { answeredBy: tally(hang2), ms: stats(hang2.map(r => r.ms)) } },
      throwing: { first: { answeredBy: tally(thr1), ms: stats(thr1.map(r => r.ms)) }, again: { answeredBy: tally(thr2), ms: stats(thr2.map(r => r.ms)) } } } };
  },
  async memonly(){
    const a = [], b = [];
    for(const q of QUESTIONS.slice(0, 6)) a.push(await ask(q));
    for(const q of QUESTIONS.slice(0, 6)) b.push(await ask(q));
    return { summary: { sharedShimInstalled: !!globalThis.__felipeSharedCache, first: tally(a), again: { answeredBy: tally(b), ms: stats(b.map(r => r.ms)) } } };
  },
  async history(){
    const h = [{ role: "user", text: "What period is it?" }, { role: "model", text: "It's Period 4, until 10:05 AM." }];
    const a = await ask("When is the fall play?");
    const b = await ask("When is the fall play?", { history: h });
    const c = await ask("where is it?", { history: [{ role: "user", text: "When is the fall play?" }, { role: "model", text: "December 2 to 4." }] });
    return { summary: { firstNoHistory: a.by, sameWithHistory: { answeredBy: b.by, aiCalls: b.calls.length }, followUp: { answeredBy: c.by, aiCalls: c.calls.length } } };
  },
  async keychange(){
    const a = await ask(QUESTIONS[0]);
    const flaggedA = Object.keys(await exMap(["gemini:gemini-3.6-flash", "gemini:gemini-3.1-flash-lite", "gemini:gemini-2.5-flash-lite"])).length;
    process.env.GEMINI_API_KEY = "mock-key-B-not-a-key"; setMockQuota("");
    const b = await ask(QUESTIONS[1]);
    return { summary: { keyA: { answeredBy: a.by + (a.why ? "(" + a.why + ")" : ""), modelsFlagged: flaggedA }, newKeyB: { answeredBy: b.by, aiCalls: b.calls.length, by: (b.calls.filter(c => c.status === 200).pop() || {}).id || null } } };
  },
  async outage(){
    await ask("Who won the Bell Game?");   // trips the flags
    const rows = []; for(let i = 0; i < 12; i++) rows.push(await ask(QUESTIONS[i % 10] + (i >= 10 ? " please" : ""), { client: "sameStudent0001" }));
    return { summary: { questions: rows.length, answeredBy: tally(rows), busy: rows.filter(r => /short break/.test(r.text)).length, aiCalls: rows.reduce((s, r) => s + r.calls.length, 0) } };
  },
  async person(){
    const rows = []; for(let i = 0; i < 4; i++) rows.push(await ask(QUESTIONS[i], { client: "sameStudent0002" }));
    const w = await ask("I'm so stressed about everything, can you help?", { client: "sameStudent0002" });
    const other = await ask(QUESTIONS[4], { client: "otherStudent003" });
    return { summary: { limit: 3, sameStudent: rows.map(r => r.by + (r.why ? "(" + r.why + ")" : "")), aiCalls: rows.reduce((s, r) => s + r.calls.length, 0),
      wellbeingPastLimit: { answeredBy: w.by, support: /counselor/i.test(w.text) }, anotherStudent: other.by } };
  },
  async collide(){
    await store.putAnswer("victimkey", "the real answer", 600, "test");
    const sh = globalThis.__felipeSharedCache;
    const good = await sh.get("a:victimkey");
    await sh.set("a:victimkey", { k: "a:attackerkey", v: { text: "POISONED", at: Date.now(), exp: Date.now() + 600000 } }, { ttl: 600 });
    store._resetLocalForTests();
    const hit = await store.getAnswer("victimkey");
    return { summary: { storedWithItsKey: !!(good && good.k === "a:victimkey"), wrongKeyEntryIsMiss: hit === undefined } };
  },
  async trim(){
    const rows = []; for(const q of QUESTIONS.slice(0, 6)) rows.push(await ask(q));
    return { summary: { rows: rows.map(r => ({ q: r.q, fullPromptChars: r.promptChars, sentSystemChars: (r.calls[0] || {}).systemChars, sentPromptChars: (r.calls[0] || {}).promptChars, by: r.by })) } };
  }
};

const name = process.env.FELIPE_SCALE_CHILD;
try{
  const res = await S[name]();
  delete res.rows;
  console.log("RESULT " + JSON.stringify(res));
}catch(e){ console.log("RESULT " + JSON.stringify({ error: String(e && e.stack || e) })); }
process.exit(0);
