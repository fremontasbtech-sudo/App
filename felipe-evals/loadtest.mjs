#!/usr/bin/env node
/**
 * One simulated school day of Ask Felipe for about 1,000 students, against the dev server in mock
 * mode (no AI key, no network). Wednesday 2026-11-18, a B day, with the fixtures snapshot.
 *
 *   node loadtest.mjs                       # scenarios a, b, c
 *   node loadtest.mjs --only a --seed 7     # one scenario, another day
 *   node loadtest.mjs --share 0.6 --max-q 6 # a heavier day (60% of students ask, 1 to 6 questions)
 *   node loadtest.mjs --out results/loadtest.json
 *
 * Scenarios (limits from the 2026-11-18 price and quota check):
 *   a  free Gemini only: gemini-3.6-flash 250 a day, gemini-3.1-flash-lite 1,000 a day,
 *      gemini-2.5-flash-lite 1,000 a day (its own quota; the router's third model since
 *      2026-11-18, replacing the gemini-flash-lite-latest alias), 10 requests a minute each.
 *      2.5-flash-lite's free limits are an assumption (the same as 3.1-flash-lite's).
 *   b  a + a Groq key: llama-3.3-70b-versatile 30 a minute, 1,000 a day, 12,000 tokens a minute;
 *      llama-3.1-8b-instant 30 a minute, 14,400 a day, 6,000 tokens a minute.
 *   c  paid Gemini: no daily limit (per-minute limits on a paid tier are far above this load).
 *
 * How the day is made (seeded, so every scenario gets the same questions at the same moments):
 *   - 1,000 students; --share (default 30%) ask Felipe, 1 to --max-q (default 4) questions each
 *     (40% ask 1, 30% 2, 18% 3, 12% 4). 30% of those with 2 or more ask again later in the day.
 *   - When: before school 8%, period 4 5%, tutorial 12%, brunch 18%, period 5 5%, lunch 25%,
 *     period 6 4%, after school 15%, evening 8%. Brunch, lunch and after school are front-loaded
 *     (most questions in the first minutes after the bell).
 *   - What: a weighted bank of about 30 topics with paraphrases (the most common wording about
 *     45% of the time), from cases.json plus everyday variants. 10% of askers use the app in
 *     Spanish. 30% have Schoology connected. A 2nd question in a sitting is a follow-up 30% of the
 *     time ("and JV?", "make it shorter").
 *   - Like app.js: FelipeCore.classify first (with the chat's last 6 turns); crisis, cannot and
 *     local answers stay on the phone. Every server question carries the chat's history, since the
 *     app keeps it for the page's life; a later sitting keeps it half the time (the page reloads).
 *   - Each student has their own IP (phones on cellular; Securly blocks the app on school Wi-Fi).
 *
 * The server runs under loadtest-server.mjs: a virtual clock that loadtest.mjs jumps across quiet
 * gaps (so cache TTLs, rate limits and quota windows keep their real lengths while the day runs
 * in minutes), plus per-minute limits on top of the mock's daily quotas.
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.TZ = "America/Los_Angeles";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const Core = require(path.join(HERE, "..", "FirebirdHub", "felipe-core.js"));
const { buildAppData } = await import("./lib/appdata.mjs");
const SUITE = JSON.parse(readFileSync(path.join(HERE, "cases.json"), "utf8"));
const BANK = (SUITE.assignment_bank || []).map(({ id, url, ...x }) => x);

const argv = process.argv.slice(2);
const opt = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const PORT = Number(opt("--port", 4490));
const SEED = Number(opt("--seed", 20261118));
const STUDENTS = Number(opt("--students", 1000));
const SHARE = Number(opt("--share", 0.3));
const MAX_Q = Number(opt("--max-q", 4));
const DAY = "2026-11-18";
const at = hm => Date.parse(DAY + "T" + hm + ":00-08:00");

/* ======================= scenarios ======================= */
const GEM_FREE = { buckets: { g36: { rpm: 10 }, lite: { rpm: 10, rpd: 1000 }, lite25: { rpm: 10, rpd: 1000 } },
  models: { "gemini-3.6-flash": "g36", "gemini-3.1-flash-lite": "lite", "gemini-flash-lite-latest": "lite", "gemini-2.5-flash-lite": "lite25" } };
const SCENARIOS = {
  a: { label: "Free Gemini only", env: { FELIPE_MOCK_QUOTA: "gemini-3.6-flash=250,gemini-3.1-flash-lite=1000,gemini-2.5-flash-lite=1000" }, limits: GEM_FREE },
  b: { label: "Free Gemini plus a free Groq key", env: { FELIPE_MOCK_PROVIDERS: "groq",
      FELIPE_MOCK_QUOTA: "gemini-3.6-flash=250,gemini-3.1-flash-lite=1000,gemini-2.5-flash-lite=1000,llama-3.3-70b-versatile=1000,llama-3.1-8b-instant=14400" },
    limits: { buckets: { ...GEM_FREE.buckets, g70: { rpm: 30, tpm: 12000 }, g8: { rpm: 30, tpm: 6000 } },
      models: { ...GEM_FREE.models, "llama-3.3-70b-versatile": "g70", "llama-3.1-8b-instant": "g8" } } },
  c: { label: "Paid Gemini (no daily limit)", env: {}, limits: { buckets: {}, models: {} } },
  // Only for comparison: what the answer cache is worth on the free tier.
  "a-nocache": { label: "Free Gemini only, answer cache off", env: { FELIPE_CACHE: "0", FELIPE_MOCK_QUOTA: "gemini-3.6-flash=250,gemini-3.1-flash-lite=1000,gemini-2.5-flash-lite=1000" }, limits: GEM_FREE }
};

/* ======================= the question bank ======================= */
// w: weight. v: English wordings (first is the most common). es: Spanish wordings.
// tw: weight multipliers by window. f: follow-ups. sgy: a Schoology question (items attached when connected).
const TOPICS = [
  { id: "period_now", w: 10, tw: { "after school": 0.3, evening: 0.05 }, v: ["what period is it", "What period is it right now?", "when does this period end", "how long until lunch?", "how much time is left in this period"], es: ["¿Qué periodo es ahora?", "¿Cuánto falta para el almuerzo?"] },
  { id: "lunch_time", w: 5, tw: { evening: 0.2 }, v: ["When is lunch today?", "what time is lunch", "when's brunch"], es: ["¿A qué hora es el almuerzo hoy?"], f: ["and brunch?"] },
  { id: "school_tomorrow", w: 10, tw: { "after school": 1.6, evening: 3 }, v: ["is there school tomorrow", "Is there school next week?", "When is Thanksgiving break?", "do we have school on wednesday next week", "Is there school on Wednesday November 25?", "what time does school start tomorrow"], es: ["¿Hay clases mañana?", "¿Hay clases el 25 de noviembre?", "¿Cuándo son las vacaciones de Acción de Gracias?"], f: ["what about friday", "and monday?"] },
  { id: "ab_day", w: 4, v: ["Is today an A day or a B day?", "is tomorrow an a day", "What schedule is Monday?"], es: ["¿Mañana es día A?"] },
  { id: "school_end", w: 4, tw: { evening: 0 }, v: ["What time does school get out today?", "when does school end today"], es: ["¿A qué hora salimos hoy?"] },
  { id: "next_game", w: 6, v: ["When is the next boys basketball game?", "next girls soccer game?", "Are there any games tonight?", "When is the next home game?", "When is the next wrestling meet?"], es: ["¿Cuándo es el próximo partido de básquetbol?"], f: ["And JV?", "where is it?", "what about girls?"] },
  { id: "spirit_standings", w: 4, v: ["Who's winning spirit points?", "how many points do the seniors have", "spirit point standings"], es: ["¿Quién va ganando en los puntos de espíritu?"] },
  { id: "ann_today", w: 3, tw: { "before school": 0.3 }, v: ["What were today's announcements?", "any announcements today"], es: ["¿Cuáles fueron los anuncios de hoy?"] },
  { id: "next_event", w: 3, v: ["What's the next event?", "what's coming up this week", "When is winter formal?"], es: ["¿Cuál es el próximo evento?"] },
  { id: "greet", w: 3, v: ["hi", "thanks felipe", "what can you do"], es: ["hola", "gracias"] },
  { id: "fall_play", w: 8, v: ["When is the fall play?", "how much are tickets for pandemonium", "where do I buy tickets for the fall play", "what time does the play start", "When is Pandemonium?"], es: ["¿Cuándo es la obra de teatro de otoño?", "¿Cuánto cuestan los boletos para la obra?"], f: ["how long is it?", "where is it?"] },
  { id: "bell_game", w: 4, v: ["What was the score of the Bell Game?", "who won the bell game", "how did JV football do against homestead"], es: ["¿Quién ganó el Bell Game?"] },
  { id: "club_info", w: 6, v: ["When does Astrophysics Club meet?", "Are there any coding clubs?", "who is the advisor for girls who code", "Is there a chess club?", "How do I start a new club?", "where does movie club meet"], es: ["¿Hay un club de programación?", "¿Cómo empiezo un club nuevo?"], f: ["when do they meet?", "who's the advisor?"] },
  { id: "club_events", w: 4, v: ["When is Club Trivia Night?", "When is the club monthly check-in due?", "is there a club grub day this year", "When is Firebird Football?"], es: ["¿Cuándo es la noche de trivia de clubes?"] },
  { id: "dance_rally", w: 3, v: ["Is there a dance coming up?", "is there a rally soon", "when is the next rally"], es: ["¿Hay un baile pronto?"] },
  { id: "lunch_happenings", w: 5, tw: { lunch: 2, brunch: 1.5, tutorial: 1.5, "after school": 0.3, evening: 0.1 }, v: ["anything happening at lunch today?", "what is there to do at lunch today", "is anything going on today"], es: ["¿Hay algo en el almuerzo hoy?"] },
  { id: "ann_specific", w: 4, v: ["When are color guard auditions?", "where can I drop off stuff for the clothing drive", "Is there college application help today?", "how did marching band do at their competition"], es: ["¿Dónde dejo la ropa para la colecta?"] },
  { id: "spirit_how", w: 3, v: ["How do spirit points work?", "how do I submit my spirit wear photo"], es: ["¿Cómo funcionan los puntos de espíritu?"] },
  { id: "app_help", w: 3, v: ["How do I connect my Schoology?", "how do i switch the app to spanish", "What are Fire Bucks?"], es: ["¿Cómo conecto mi Schoology?"] },
  { id: "finals", w: 2, v: ["when are finals", "when is the last day before winter break"], es: ["¿Cuándo son los exámenes finales?"] },
  { id: "study", w: 5, tw: { evening: 2, "after school": 1.5 }, v: ["Explain photosynthesis simply", "Quiz me on the causes of World War 1", "Make me a study plan for my chemistry test on Monday", "any tips for staying focused on homework?", "explain the difference between mitosis and meiosis"], es: ["Explícame la fotosíntesis de forma sencilla"], f: ["can you explain that more simply", "Make it shorter"] },
  { id: "writing", w: 3, tw: { evening: 2 }, v: ["Help me write an email to my teacher asking for an extension because I was sick", "How should I ask a teacher for a letter of recommendation?", "Give me some ideas for a club fundraiser"], es: ["Ayúdame a escribir un correo a mi maestra porque falté a clase por estar enfermo"], f: ["Make it shorter and more casual"] },
  { id: "sgy", w: 6, sgy: true, tw: { "after school": 1.5, evening: 2.5 }, v: ["what do I have due tomorrow", "Help me plan my week so I get everything done", "Can you summarize what my lab report assignment is about?", "Explain how to start problem set 5.3", "when is my history quiz"], es: ["¿Qué tareas tengo para mañana?"] },
  { id: "wellbeing", w: 1, v: ["I'm really stressed about all my tests this week", "i feel overwhelmed with school"], es: ["Estoy muy estresado con la escuela"] },
  { id: "cannot", w: 4, v: ["What's my GPA?", "Is Taylor Swift dating anyone right now?", "Who will win the NBA finals this year?", "what grade did I get on my chem test", "best fortnite loadout right now?"], es: ["¿Quién ganó el Super Bowl?"] },
  { id: "crisis", w: 0.2, v: ["i dont want to be alive anymore"], es: ["Ya no quiero vivir"] }
];
const WINDOWS = [
  { name: "before school", from: "07:30", to: "08:30", w: 8, shape: 1 },
  { name: "period 4", from: "08:30", to: "10:05", w: 5, shape: 1 },
  { name: "tutorial", from: "10:10", to: "10:50", w: 12, shape: 1 },
  { name: "brunch", from: "10:50", to: "11:05", w: 18, shape: 1.8 },
  { name: "period 5", from: "11:15", to: "12:45", w: 5, shape: 1 },
  { name: "lunch", from: "12:45", to: "13:25", w: 25, shape: 1.8 },
  { name: "period 6", from: "13:35", to: "15:05", w: 4, shape: 1 },
  { name: "after school", from: "15:05", to: "16:30", w: 15, shape: 2 },
  { name: "evening", from: "18:00", to: "22:00", w: 8, shape: 1 }
];

/* ======================= the day ======================= */
function mulberry32(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function buildDay(){
  const rnd = mulberry32(SEED);
  const pick = (arr, wf) => { const ws = arr.map(wf), tot = ws.reduce((a, b) => a + b, 0); let x = rnd() * tot; for(let i = 0; i < arr.length; i++){ x -= ws[i]; if(x <= 0) return arr[i]; } return arr[arr.length - 1]; };
  const wording = list => rnd() < 0.45 || list.length === 1 ? list[0] : list[1 + Math.floor(rnd() * (list.length - 1))];
  const nQ = () => { const r = rnd(); const base = r < 0.4 ? 1 : r < 0.7 ? 2 : r < 0.88 ? 3 : 4; return MAX_Q > 4 ? Math.min(MAX_Q, base + (rnd() < 0.3 ? Math.floor(rnd() * (MAX_Q - 3)) : 0)) : Math.min(MAX_Q, base); };
  const students = [], questions = [];
  const askers = Math.round(STUDENTS * SHARE);
  for(let s = 0; s < askers; s++){
    const st = { id: s, es: rnd() < 0.1, sgy: rnd() < 0.3, ip: "10." + (40 + Math.floor(s / 62500)) + "." + Math.floor(s / 250) % 250 + "." + (s % 250 + 1),
      cid: "lt" + String(s).padStart(6, "0") + Math.floor(rnd() * 1e9).toString(36) };
    students.push(st);
    const n = nQ();
    const split = n >= 2 && rnd() < 0.3 ? 1 + Math.floor(rnd() * (n - 1)) : n;
    const sittings = split < n ? [split, n - split] : [n];
    const used = new Set();
    let lastEnd = 0;
    sittings.forEach((count, si) => {
      let W, start, tries = 0;
      do{ W = pick(WINDOWS, w => w.w); start = at(W.from) + (at(W.to) - at(W.from)) * Math.pow(rnd(), W.shape); tries++; }
      while((used.has(W.name) || start < lastEnd + 20 * 60000) && tries < 30);
      used.add(W.name);
      let t = start, prevTopic = null;
      for(let k = 0; k < count; k++){
        let topic, text, followup = false;
        if(k > 0 && prevTopic && prevTopic.f && rnd() < 0.3){ topic = prevTopic; text = prevTopic.f[Math.floor(rnd() * prevTopic.f.length)]; followup = true; }
        else {
          topic = pick(TOPICS, tp => tp.w * ((tp.tw && tp.tw[W.name] != null) ? tp.tw[W.name] : 1));
          const useEs = st.es && topic.es && rnd() < 0.85;
          text = wording(useEs ? topic.es : topic.v);
        }
        questions.push({ student: s, sitting: si, k, t: Math.round(t), window: W.name, topic: topic.id, text, followup, keepHistory: si === 0 || rnd() < 0.5 });
        prevTopic = topic;
        // Reading the answer and typing the next question: median about 40 s.
        t += Math.min(180000, Math.max(12000, 40000 * Math.exp(0.6 * (rnd() * 2 - 1) * 1.6)));
      }
      lastEnd = t;
    });
  }
  questions.sort((a, b) => a.t - b.t);
  return { students, questions };
}

/* ======================= running one scenario ======================= */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BASE = "http://127.0.0.1:" + PORT, CTRL = "http://127.0.0.1:" + (PORT + 1);
const getJson = async (u, init) => (await fetch(u, init)).json();
const clockNow = async () => (await getJson(CTRL + "/clock")).now;
const clockTo = async to => (await getJson(CTRL + "/clock?to=" + to, { method: "POST" })).now;
const KNOWN = [
  ["cant", /^(I can't write that right now|No puedo escribir eso)/],
  ["busy", /^(Felipe needs a short break|Felipe necesita un breve descanso)/],
  ["error", /^(Felipe is having a moment|Felipe tiene un pequeño problema|I couldn't answer that one|No pude responder|Ask Felipe isn't set up|Pregúntale a Felipe todavía no)/]
];

async function startServer(sc){
  const env = { ...process.env, FELIPE_MOCK: "1", FELIPE_FIXTURES: "1", TZ: "America/Los_Angeles", LOADTEST_LIMITS: JSON.stringify(sc.limits), ...sc.env };
  for(const k of ["GEMINI_API_KEY", "GROQ_API_KEY", "CEREBRAS_API_KEY", "OPENROUTER_API_KEY", "FELIPE_DAILY_CAP"]) delete env[k];
  const p = spawn(process.execPath, [path.join(HERE, "loadtest-server.mjs"), String(PORT)], { env, stdio: ["ignore", "pipe", "pipe"] });
  p.log = ""; p.stdout.on("data", d => p.log += d); p.stderr.on("data", d => p.log += d);
  for(let i = 0; i < 100; i++){ try{ const h = await getJson(BASE + "/__felipe/health"); if(h.ok){ await clockNow(); return p; } }catch(e){} await sleep(100); }
  throw new Error("server did not start:\n" + p.log);
}

async function askServer(st, q, body){
  const id = "lt-" + q.idx;
  const t0 = performance.now();
  let res;
  try{
    res = await fetch(BASE + "/api/ask", { method: "POST", headers: { "content-type": "application/json", "x-eval-id": id, "x-vercel-forwarded-for": st.ip }, body: JSON.stringify(body) });
  }catch(e){ return { status: 0, kind: "error", text: "", ttft: null, total: performance.now() - t0, calls: [] }; }
  const by = res.headers.get("x-felipe-answered-by"), why = res.headers.get("x-felipe-data-why"), provider = res.headers.get("x-felipe-provider");
  let text = "", errText = "", ttft = null, buf = "";
  const reader = res.body.getReader(), dec = new TextDecoder();
  for(;;){
    const { value, done } = await reader.read();
    if(done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while((i = buf.indexOf("\n\n")) >= 0){
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      for(const l of block.split("\n")) if(l.startsWith("data:")){
        let ev; try{ ev = JSON.parse(l.slice(5)); }catch(e){ continue; }
        if(ev.t === "delta"){ if(ttft == null) ttft = performance.now() - t0; text += ev.text; }
        else if(ev.t === "error"){ if(ttft == null) ttft = performance.now() - t0; errText += ev.text; }
      }
    }
  }
  const total = performance.now() - t0;
  const m = await getJson(BASE + "/__felipe/metrics?id=" + id).catch(() => null);
  const calls = (m && m.gemini || []).map(g => ({ provider: g.provider, model: g.model, status: g.status, limit: g.limit || null, estTokens: g.estTokens || null }));
  const shown = (text || errText).trim();
  let kind = by || "none";
  for(const [k, re] of KNOWN) if(re.test(shown)){ kind = k; break; }
  if(by === "data") kind = "data";
  if(by === "cache") kind = "cache";
  if(by === "llm") kind = calls.length ? "llm" : "coalesced";
  if(by === "canned") kind = "support";
  if(res.status !== 200 || !shown) kind = "error";
  return { status: res.status, by, why, provider, kind, text: shown, ttft, total, calls };
}

async function runScenario(name, day){
  const sc = SCENARIOS[name];
  const server = await startServer(sc);
  const t0 = performance.now();
  const rows = [];
  const hist = new Map(), lastAssign = new Map(), chain = new Map();
  const appDataCache = new Map();
  const appData = (t, lang) => { const k = Math.floor(t / 300000) + lang; if(!appDataCache.has(k)) appDataCache.set(k, buildAppData(new Date(t), lang)); return appDataCache.get(k); };
  const inflight = new Set();
  try{
    day.questions.forEach((q, i) => q.idx = i);
    for(const q of day.questions){
      // Move the server's clock to this question: jump when nothing is running, otherwise wait.
      for(;;){
        const v = await clockNow();
        if(q.t <= v) break;
        if(!inflight.size){ await clockTo(q.t); break; }
        await Promise.race([Promise.race([...inflight]), sleep(Math.min(q.t - v, 1000))]);
      }
      const st = day.students[q.student];
      const prev = chain.get(st.id) || Promise.resolve();
      const p = prev.then(async () => {
        if(q.k === 0 && !q.keepHistory){ hist.set(st.id, []); lastAssign.delete(st.id); }
        const h = (hist.get(st.id) || []).slice(-6);
        const now = new Date(q.t);
        const appLang = st.es ? "es" : "en";
        const tc = performance.now();
        const c = Core.classify(q.text, { history: h, lang: appLang, now });
        const lang = c.lang || appLang;
        const row = { idx: q.idx, t: q.t, window: q.window, topic: q.topic, text: q.text, lang, followup: q.followup, route: c.route, intent: c.intent, hadHistory: h.length > 0 };
        const remember = a => { const hh = hist.get(st.id) || []; hh.push({ role: "user", text: q.text.slice(0, 500) }, { role: "model", text: String(a).slice(0, 500) }); hist.set(st.id, hh.slice(-6)); };
        if(c.route === "crisis" || c.route === "cannot"){ row.where = "phone"; row.kind = c.route; row.phoneMs = performance.now() - tc; rows.push(row); return; }
        if(c.route === "local"){
          let loc = null; try{ loc = Core.answerLocal(c.intent, c.resolved || q.text, appData(q.t, lang), lang); }catch(e){}
          if(loc && loc.text){ row.where = "phone"; row.kind = "local"; row.phoneMs = performance.now() - tc; rows.push(row); remember(loc.text); return; }
          row.localFellThrough = true;
        }
        const body = { question: q.text, history: h, lang, stream: true, client: st.cid };
        if(c.needsAssignments && st.sgy){
          const items = Core.pickAssignments(c.resolved || q.text, BANK);
          if(items.length){ body.context = { assignments: items }; lastAssign.set(st.id, items); }
        } else if(lastAssign.get(st.id) && st.sgy && h.length && /\b(?:it|that|this|the (?:first|second|third|last|other) one|one|them|those|esa|eso|esta|la primera|la segunda)\b/i.test(q.text)) body.context = { assignments: lastAssign.get(st.id) };
        else lastAssign.delete(st.id);
        row.where = "server"; row.items = body.context ? body.context.assignments.length : 0;
        Object.assign(row, await askServer(st, q, body));
        if(!["error", "busy", "cant"].includes(row.kind)) remember(row.text);
        rows.push(row);
      }).catch(e => { rows.push({ idx: q.idx, t: q.t, where: "server", kind: "error", text: "client error: " + e.message, calls: [] }); });
      chain.set(st.id, p);
      inflight.add(p); p.finally(() => inflight.delete(p));
    }
    await Promise.all([...inflight]);
    await sleep(300);
    const limits = await getJson(CTRL + "/limits");
    const quota = await getJson(BASE + "/__felipe/quota");
    return { name, label: sc.label, realSeconds: Math.round((performance.now() - t0) / 100) / 10, rows: rows.sort((a, b) => a.idx - b.idx), limits, quota, serverLog: server.log.split("\n").filter(l => /out of quota|HTTP|error/i.test(l)).slice(0, 40) };
  } finally { server.kill(); await sleep(200); }
}

/* ======================= the report ======================= */
const pct = (a, p) => { a = a.filter(Number.isFinite).sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p / 100 * a.length))] : null; };
const r0 = x => x == null ? null : Math.round(x);
const hm = t => new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" }).format(new Date(t));
const PRICES = { "gemini-3.6-flash": [0.75, 3.75], "gemini-3.1-flash-lite": [0.25, 1.5], "gemini-flash-lite-latest": [0.25, 1.5], "gemini-2.5-flash-lite": [0.10, 0.40] };
function summarize(r){
  const rows = r.rows, server = rows.filter(x => x.where === "server"), phone = rows.filter(x => x.where === "phone");
  const count = (arr, f) => arr.filter(f).length;
  const calls = server.flatMap(x => x.calls || []);
  const ok = calls.filter(c => c.status === 200);
  const byModel = {};
  for(const c of calls){ const k = c.provider + ":" + c.model; const m = byModel[k] || (byModel[k] = { ok: 0, rpm429: 0, tpm429: 0, daily429: 0, other: 0, inTokens: 0 }); if(c.status === 200){ m.ok++; m.inTokens += c.estTokens || 0; } else if(c.status === 429) m[c.limit === "rpm" ? "rpm429" : c.limit === "tpm" ? "tpm429" : "daily429"]++; else m.other++; }
  const firstDaily = {};
  for(const x of server) for(const c of x.calls || []) if(c.status === 429 && (!c.limit || c.limit === "rpd")){ const k = c.provider + ":" + c.model; if(!firstDaily[k]) firstDaily[k] = hm(x.t); }
  const kinds = {}; for(const x of server) kinds[x.kind] = (kinds[x.kind] || 0) + 1;
  const dataWhy = {}; for(const x of server.filter(x => x.kind === "data" || x.kind === "cant")) dataWhy[x.why || "?"] = (dataWhy[x.why || "?"] || 0) + 1;
  const cacheable = server.filter(x => !x.hadHistory && !x.items && !["writing", "study", "assignments", "planning", "wellbeing"].includes(x.intent));
  const ttft = server.map(x => x.ttft);
  const ttftBy = k => { const a = server.filter(x => x.kind === k).map(x => x.ttft); return a.length ? { n: a.length, p50: r0(pct(a, 50)), p95: r0(pct(a, 95)) } : null; };
  const perMin = {}; for(const x of server){ const k = hm(Math.floor(x.t / 60000) * 60000); perMin[k] = (perMin[k] || 0) + 1; }
  const peakMin = Object.entries(perMin).sort((a, b) => b[1] - a[1])[0] || ["", 0];
  const aiPerMin = Object.entries(r.limits.perMinute || {}).sort((a, b) => b[1] - a[1])[0] || ["", 0];
  const byWindow = {};
  for(const x of rows){ const w = byWindow[x.window] || (byWindow[x.window] = { questions: 0, server: 0, ai: 0, cache: 0, data: 0, cant: 0 }); w.questions++; if(x.where === "server"){ w.server++; if(x.kind === "llm" || x.kind === "coalesced") w.ai++; if(x.kind === "cache") w.cache++; if(x.kind === "data") w.data++; if(x.kind === "cant") w.cant++; } }
  // Cost (scenario c): prompt tokens measured by the mock (characters / 4); output tokens assumed.
  const inTok = ok.reduce((n, c) => n + (c.estTokens || 0), 0);
  const cost = {};
  for(const [model, [pin, pout]] of Object.entries(PRICES)){
    const lo = 200, hi = 600;   // output tokens per answer, thinking included (assumption)
    cost[model] = { calls: ok.length, inTokens: inTok, outTokensLow: ok.length * lo, outTokensHigh: ok.length * hi,
      usdLow: Math.round((inTok / 1e6 * pin + ok.length * lo / 1e6 * pout) * 1000) / 1000, usdHigh: Math.round((inTok / 1e6 * pin + ok.length * hi / 1e6 * pout) * 1000) / 1000 };
  }
  return {
    scenario: r.name, label: r.label, realSeconds: r.realSeconds,
    questions: rows.length,
    spanish: count(rows, x => x.lang === "es"), followups: count(rows, x => x.followup),
    phone: { n: phone.length, share: Math.round(phone.length / rows.length * 1000) / 10, local: count(phone, x => x.kind === "local"), cannot: count(phone, x => x.kind === "cannot"), crisis: count(phone, x => x.kind === "crisis"), p95ms: Math.round(pct(phone.map(x => x.phoneMs), 95) * 100) / 100 },
    server: { n: server.length, localFellThrough: count(server, x => x.localFellThrough), withHistory: count(server, x => x.hadHistory), withSchoology: count(server, x => x.items > 0), cacheEligible: cacheable.length },
    answeredBy: kinds,
    cacheHitRate: { ofServer: Math.round((kinds.cache || 0) / server.length * 1000) / 10, ofCacheEligible: Math.round((kinds.cache || 0) / Math.max(1, cacheable.length) * 1000) / 10 },
    coalesced: kinds.coalesced || 0,
    providerCalls: { total: calls.length, ok: ok.length, s429: count(calls, c => c.status === 429), other: count(calls, c => c.status !== 200 && c.status !== 429), byModel, firstDaily429: firstDaily },
    dataAnswers: kinds.data || 0, tryLater: kinds.cant || 0, busy: kinds.busy || 0, support: kinds.support || 0, errorsOrEmpty: (kinds.error || 0) + (kinds.none || 0),
    dataOrCantWhy: dataWhy,
    ttftMs: { all: { p50: r0(pct(ttft, 50)), p95: r0(pct(ttft, 95)) }, llm: ttftBy("llm"), coalesced: ttftBy("coalesced"), cache: ttftBy("cache"), data: ttftBy("data"), cant: ttftBy("cant") },
    peaks: { serverQuestionsBusiestMinute: peakMin, aiCallsBusiestMinute: aiPerMin },
    byWindow, cost,
    serverLog: r.serverLog.slice(0, 12)
  };
}

/* ======================= main ======================= */
const day = buildDay();
const names = (opt("--only") || "a,b,c").split(",");
console.log(`Day ${DAY}: ${STUDENTS} students, ${day.students.length} ask (${Math.round(SHARE * 100)}%), ${day.questions.length} questions, seed ${SEED}`);
const out = { at: new Date().toISOString(), seed: SEED, students: STUDENTS, share: SHARE, maxQ: MAX_Q, askers: day.students.length, questions: day.questions.length, scenarios: {} };
for(const name of names){
  if(!SCENARIOS[name]){ console.error("unknown scenario " + name); continue; }
  console.log(`\n=== ${name}: ${SCENARIOS[name].label} ===`);
  const r = await runScenario(name, day);
  const s = summarize(r);
  out.scenarios[name] = { summary: s, rows: r.rows.map(({ text, ...x }) => ({ ...x, q: day.questions[x.idx].text, a: String(text || "").slice(0, 160) })) };
  const { cost, byWindow, serverLog, ...short } = s;
  console.log(JSON.stringify(short, null, 1));
  if(name.startsWith("c")) console.log("cost", JSON.stringify(cost));
}
const file = path.resolve(HERE, opt("--out", path.join("results", "loadtest-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json")));
mkdirSync(path.dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify(out, null, 1));
console.log("\nsaved " + path.relative(HERE, file));
