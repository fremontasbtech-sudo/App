#!/usr/bin/env node
/**
 * Runs cases.json against Ask Felipe and reports, per case: route taken, time to first byte,
 * time to first visible character, total time, prompt size, the answer, and pass/fail.
 *
 * Server modes (the /api/ask handler):
 *   node run.mjs --url http://127.0.0.1:8787 [--stream]        # a running dev-server.mjs
 *   FELIPE_MOCK=1 node run.mjs --inproc [--handler <ask.js>]    # load the handler in this process
 * Core mode (FelipeCore.classify / answerLocal / cannotReply / crisisReply, no network):
 *   node run.mjs --core [<felipe-core.js>] [--iterations 200]
 *
 * Common options:
 *   --only id1,id2   --category sports   --representative (the 15 marked cases)   --limit N
 *   --label name     --out results/name.json   --quiet
 *   --no-clock       do not send x-felipe-now (the handler then uses the real clock)
 *   --stream         send stream:true (new contract). Without it the body is the old { question, history } plus lang/context.
 *   --legacy-body    send only { question, history } exactly like today's app.
 *
 * In mock mode the answer text is fake, so must_include/must_not_include are only checked on
 * replies that did not come from Gemini (canned "cannot"/"crisis" replies, local answers).
 */
process.env.TZ = "America/Los_Angeles";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { EVALS_DIR, APP_DIR, install, als, newRecord, getRecord, MOCK, USE_FIXTURES, MOCK_CFG } from "./lib/instrument.mjs";
import { loadGeminiKey } from "./lib/env.mjs";
import { fakePair } from "./lib/vercel.mjs";
import { buildAppData } from "./lib/appdata.mjs";

const argv = process.argv.slice(2);
const flag = n => argv.includes(n);
const opt = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };

const SUITE = JSON.parse(readFileSync(path.join(EVALS_DIR, opt("--cases", "cases.json")), "utf8"));
const DEFAULT_NOW = SUITE.defaults.now, GLOBAL_NOT = SUITE.global_must_not_include || [];
const BANK = Object.fromEntries((SUITE.assignment_bank || []).map(a => [a.id, a]));

function selectCases(){
  let cs = SUITE.cases;
  const only = opt("--only"); if(only){ const s = new Set(only.split(",")); cs = cs.filter(c => s.has(c.id)); }
  const cat = opt("--category"); if(cat) cs = cs.filter(c => c.category === cat);
  if(flag("--representative")) cs = cs.filter(c => c.representative);
  const lim = Number(opt("--limit")); if(lim) cs = cs.slice(0, lim);
  return cs;
}
function contextFor(c){
  if(!c.context) return undefined;
  const ctx = { ...c.context };
  if(Array.isArray(ctx.assignments)) ctx.assignments = ctx.assignments.map(x => {
    if(typeof x !== "string") return x;
    const { id, ...item } = BANK[x] || {}; return item;
  });
  return ctx;
}
const norm = s => String(s || "").toLowerCase().replace(/\s+/g, " ");
function checkText(c, text){
  const t = norm(text), fails = [];
  for(const need of (c.must_include || [])){
    const alts = Array.isArray(need) ? need : [need];
    if(!alts.some(a => t.includes(norm(a)))) fails.push("missing: " + alts.join(" | "));
  }
  for(const bad of (c.must_not_include || []).concat(GLOBAL_NOT)) if(t.includes(norm(bad))) fails.push("has: " + bad);
  return fails;
}
const okRoutes = c => [c.expected_route].concat(c.also_ok_routes || []);
const pct = (arr, p) => { const a = arr.filter(Number.isFinite).sort((x, y) => x - y); if(!a.length) return null; return a[Math.min(a.length - 1, Math.floor(p / 100 * a.length))]; };
const mean = arr => { const a = arr.filter(Number.isFinite); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; };
const r1 = x => x == null ? null : Math.round(x * 10) / 10;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const r4 = x => x == null ? null : Math.round(x * 10000) / 10000;
const stats = (arr, rf = r1) => ({ n: arr.filter(Number.isFinite).length, p50: rf(pct(arr, 50)), p95: rf(pct(arr, 95)), p99: rf(pct(arr, 99)), mean: rf(mean(arr)), min: rf(pct(arr, 0)), max: rf(pct(arr, 100)) });

/* ======================= core mode ======================= */
async function runCore(){
  const file = path.resolve(opt("--core") || path.join(APP_DIR, "FirebirdHub", "felipe-core.js"));
  if(!existsSync(file)){ console.error("felipe-core.js not found at " + file + " (the core agent writes it)."); process.exit(2); }
  const Core = createRequire(import.meta.url)(file);
  for(const fn of ["classify", "answerLocal", "cannotReply", "crisisReply"]) if(typeof Core[fn] !== "function") console.warn("FelipeCore." + fn + " is missing");
  const iters = Number(opt("--iterations", 200));
  const cases = selectCases(), rows = [], allMs = [];
  // Warm up the JIT so the numbers are steady-state, like a page that has been open a moment.
  for(let i = 0; i < 30; i++) for(const c of cases.slice(0, 10)) Core.classify(c.question, { history: c.history || [], lang: c.lang || "en", now: new Date(c.now || DEFAULT_NOW) });
  for(const c of cases){
    const lang = c.lang || "en", now = new Date(c.now || DEFAULT_NOW);
    const ctx = { history: c.history || [], lang, now };
    let res = null; const ms = [];
    const coldT = performance.now(); res = Core.classify(c.question, ctx); ms.push(performance.now() - coldT);
    for(let i = 1; i < iters; i++){ const t = performance.now(); Core.classify(c.question, ctx); ms.push(performance.now() - t); }
    allMs.push(...ms);
    const route = res && res.route;
    const row = { id: c.id, category: c.category, question: c.question, expected_route: c.expected_route, route, intent: res && res.intent, reason: res && res.reason,
      reportedMs: res && res.ms, classifyP50: r4(pct(ms, 50)), classifyMax: r4(pct(ms, 100)), classifyFirstCallMs: r4(ms[0]),
      routeOk: okRoutes(c).includes(route) };
    let text = null;
    if(route === "local" && Core.answerLocal){
      const data = buildAppData(now, lang);  // answerLocal gets c.resolved, like app.js
      const t = performance.now(); const out = Core.answerLocal(res.intent, res.resolved || c.question, data, res.lang || lang); row.answerLocalMs = r4(performance.now() - t);
      text = out && out.text; row.localFellThrough = !text;
      // A fall-through goes to the server like an llm question (that is what app.js does).
      if(!text){ row.effectiveRoute = "llm"; row.routeOk = okRoutes(c).includes("llm"); }
    } else if(route === "cannot" && Core.cannotReply){ const o = Core.cannotReply(res.reason, res.lang || lang); text = typeof o === "string" ? o : o && o.text; }
    else if(route === "crisis" && Core.crisisReply){ const o = Core.crisisReply(res.lang || lang, res.reason); text = typeof o === "string" ? o : o && o.text; }
    if(text != null){ row.answer = text; row.textFails = checkText(c, text); }
    else row.textFails = null;   // goes to the LLM: wording is not checked here
    row.pass = row.routeOk && (!row.textFails || !row.textFails.length);
    rows.push(row);
    if(!flag("--quiet")) console.log(`${row.pass ? "PASS" : "FAIL"}  ${c.id.padEnd(32)} want ${c.expected_route.padEnd(6)} got ${String(route).padEnd(6)} ${String(res && res.intent || "").padEnd(20)} ${row.classifyP50}ms` + (row.textFails && row.textFails.length ? "  " + row.textFails.join("; ") : "") + (row.localFellThrough ? "  (answerLocal returned null)" : ""));
  }
  const confusion = {};
  rows.forEach(r => { const k = r.expected_route + " -> " + r.route; confusion[k] = (confusion[k] || 0) + 1; });
  const localRows = rows.filter(r => r.route === "local");
  const summary = {
    cases: rows.length, pass: rows.filter(r => r.pass).length, routeOk: rows.filter(r => r.routeOk).length,
    classifyMs: { ...stats(allMs, r4), calls: allMs.length, over5ms: allMs.filter(x => x > 5).length, over50ms: allMs.filter(x => x > 50).length },
    answerLocal: { answered: localRows.filter(r => !r.localFellThrough).length, fellThrough: localRows.filter(r => r.localFellThrough).length, textPass: localRows.filter(r => r.textFails && !r.textFails.length).length },
    confusion,
    unsafeAsLlm: rows.filter(r => ["cannot", "crisis"].includes(r.expected_route) && r.route === "llm").map(r => r.id),
    crisisMissed: rows.filter(r => r.expected_route === "crisis" && r.route !== "crisis").map(r => r.id),
    falseCannot: rows.filter(r => r.expected_route !== "cannot" && r.route === "cannot" && !okRoutes(SUITE.cases.find(c => c.id === r.id)).includes("cannot")).map(r => r.id)
  };
  return { mode: "core", file: path.relative(APP_DIR, file), iterations: iters, rows, summary };
}

/* ======================= server modes ======================= */
let handlerFn = null;
async function callInproc(c, body, headers){
  if(!handlerFn){
    install();
    const file = path.resolve(opt("--handler") || path.join(APP_DIR, "FirebirdHub", "api", "ask.js"));
    handlerFn = (await import(pathToFileURL(file).href)).default;
  }
  const id = headers["x-eval-id"];
  const rec = newRecord(id);
  const { req, res, out, done } = fakePair({ method: "POST", headers, body });
  const t0 = performance.now();
  await als.run({ rec, clockOffset: headers["x-felipe-now"] ? Date.parse(headers["x-felipe-now"]) - Date.now() : 0 }, async () => {
    try{ await handlerFn(req, res); }catch(e){ if(!res.writableEnded) res.status(500).json({ error: "handler threw: " + (e && e.message) }); }
  });
  await done;
  const metrics = getRecord(id);
  if(metrics){ metrics.endMs = Math.round(out.endMs); metrics.firstWriteMs = out.firstByteMs == null ? null : Math.round(out.firstByteMs); metrics.status = out.status; }
  return { status: out.status, headers: out.headers, chunks: out.chunks.map(ch => ({ ms: ch.ms, s: ch.s })), ttfbMs: out.firstByteMs, totalMs: performance.now() - t0, metrics };
}
async function callUrl(base, body, headers){
  const t0 = performance.now();
  const r = await fetch(base.replace(/\/$/, "") + "/api/ask", { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  const headersMs = performance.now() - t0;
  const chunks = []; const dec = new TextDecoder();
  if(r.body){ const reader = r.body.getReader(); for(;;){ const { done, value } = await reader.read(); if(done) break; chunks.push({ ms: performance.now() - t0, s: dec.decode(value, { stream: true }) }); } }
  const totalMs = performance.now() - t0;
  let metrics = null;
  try{ const m = await fetch(base.replace(/\/$/, "") + "/__felipe/metrics?id=" + encodeURIComponent(headers["x-eval-id"])); if(m.ok) metrics = await m.json(); }catch(e){}
  return { status: r.status, headers: Object.fromEntries(r.headers), chunks, headersMs, ttfbMs: chunks.length ? chunks[0].ms : null, totalMs, metrics };
}
// Reads an SSE or JSON reply into { answer, firstVisibleMs, route?, fallback? }.
function parseReply(resp){
  const ct = String(resp.headers["content-type"] || "");
  const all = resp.chunks.map(c => c.s).join("");
  if(/event-stream/i.test(ct)){
    let text = "", first = null, buf = "", err = null, meta = {};
    for(const ch of resp.chunks){
      buf += ch.s;
      let i; while((i = buf.indexOf("\n")) >= 0){
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if(!line.startsWith("data:")) continue;
        let ev; try{ ev = JSON.parse(line.slice(5).trim()); }catch(e){ continue; }
        if(ev.t === "delta" && ev.text){ if(first == null) first = ch.ms; text += ev.text; }
        else if(ev.t === "error") err = ev;
        else if(ev.t === "meta" || ev.route) Object.assign(meta, ev);
      }
    }
    return { answer: text, firstVisibleMs: first, sse: true, error: err, route: meta.route || null };
  }
  let j = null; try{ j = JSON.parse(all); }catch(e){}
  return { answer: j && typeof j.answer === "string" ? j.answer : "", firstVisibleMs: resp.chunks.length ? resp.chunks[resp.chunks.length - 1].ms : null, sse: false, fallback: !!(j && j.fallback), route: j && j.route || null, raw: j ? null : all.slice(0, 300) };
}

async function runServer(){
  const base = opt("--url"), inproc = flag("--inproc");
  if(!base && !inproc){ console.error("Give --url <dev server> or --inproc (or --core)."); process.exit(2); }
  const hasKey = inproc ? loadGeminiKey() : null;
  const cases = selectCases(), rows = [];
  const label = opt("--label", "run");
  const starts = [];
  let health = null;
  if(base){ try{ health = await (await fetch(base.replace(/\/$/, "") + "/__felipe/health")).json(); }catch(e){} }
  const mock = inproc ? MOCK : !!(health && health.mock);
  for(let n = 0; n < cases.length; n++){
    const c = cases[n];
    // The handler allows 40 questions a minute per warm instance. Stay under it so the
    // numbers measure Felipe, not the speed bump.
    const now = Date.now(); while(starts.length && now - starts[0] > 60000) starts.shift();
    if(starts.length >= 36){ await sleep(60000 - (now - starts[0]) + 50); }
    starts.push(Date.now());
    const body = flag("--legacy-body") ? { question: c.question, history: c.history || [] }
      : { question: c.question, history: c.history || [], lang: c.lang || "en", stream: flag("--stream"), ...(c.context ? { context: contextFor(c) } : {}) };
    const headers = { "content-type": "application/json", "x-eval-id": label + "-" + c.id + "-" + Date.now(),
      "x-vercel-forwarded-for": "10.77." + Math.floor(n / 250) + "." + (n % 250 + 1) };
    if(!flag("--no-clock")) headers["x-felipe-now"] = c.now || DEFAULT_NOW;
    let resp, err = null;
    let retried = 0;
    try{
      resp = base ? await callUrl(base, body, headers) : await callInproc(c, body, headers);
      // Hit the handler's own speed bump anyway: wait as told and try once more (counted in the row).
      if(resp.status === 429 && resp.headers["retry-after"]){
        retried = Number(resp.headers["retry-after"]) || 60;
        await sleep(retried * 1000 + 100);
        headers["x-eval-id"] += "-retry";
        resp = base ? await callUrl(base, body, headers) : await callInproc(c, body, headers);
      }
    }
    catch(e){ err = String(e && e.message || e); }
    const row = { id: c.id, category: c.category, question: c.question, expected_route: c.expected_route, ...(retried ? { rateLimitedWaitS: retried } : {}) };
    if(err){ row.error = err; row.pass = false; rows.push(row); console.log("ERROR " + c.id + " " + err); continue; }
    const rep = parseReply(resp), m = resp.metrics || {};
    const gem = (m && m.gemini) || [];
    const gemMs = gem.reduce((s, g) => s + (g.ms || g.headersMs || 0), 0);
    const srcMs = ((m && m.sources) || []).map(s => s.ms || 0);
    const lastGem = gem[gem.length - 1] || null;
    const routeHdr = resp.headers["x-felipe-route"] || rep.route || null;
    const routeTaken = routeHdr || (gem.length ? "llm" : (resp.status === 200 ? "canned" : "error"));
    Object.assign(row, {
      status: resp.status, routeTaken, routeSource: routeHdr ? "header" : "inferred from Gemini calls",
      ttfbMs: r1(resp.ttfbMs), firstVisibleMs: r1(rep.firstVisibleMs), totalMs: r1(resp.totalMs),
      serverEndMs: m.endMs ?? null, geminiCalls: gem.length, geminiMs: gem.length ? gemMs : 0,
      geminiFirstByteMs: lastGem ? (lastGem.firstByteMs ?? null) : null,
      serverOverheadMs: m.endMs != null ? Math.max(0, m.endMs - gemMs) : null,
      contextFetches: srcMs.length, contextFetchMsMax: srcMs.length ? Math.max(...srcMs) : 0,
      promptChars: Number(resp.headers["x-felipe-prompt-chars"]) || (lastGem ? lastGem.promptChars : null),
      systemChars: lastGem ? lastGem.systemChars : null, estTokens: lastGem ? lastGem.estTokens : null,
      historyTurnsSent: lastGem ? lastGem.turns - 1 : null, maxOutputTokens: lastGem ? lastGem.maxOutputTokens : null, thinking: lastGem ? lastGem.thinking : null,
      streamed: rep.sse, fallback: rep.fallback || false, answer: rep.answer
    });
    // Route check. The server never sees a client-local answer, so "local" cases pass on the server when it answers them (llm).
    const want = okRoutes(c);
    const canned = routeTaken === "canned" || routeTaken === "cannot" || routeTaken === "crisis";
    if(c.expected_route === "cannot" || c.expected_route === "crisis") row.routeOk = routeTaken === c.expected_route || (routeTaken === "canned" && !gem.length) || want.includes(routeTaken);
    else if(c.expected_route === "local") row.routeOk = routeTaken === "llm" || routeTaken === "local" || want.includes(routeTaken);
    else row.routeOk = want.includes(routeTaken) || (routeTaken === "llm");
    if(canned && !want.some(r => r === "cannot" || r === "crisis")) row.routeOk = false;
    const fromMock = mock && gem.some(g => g.mock) && !canned;
    if(fromMock || (!mock && row.fallback)) row.textFails = null;
    else row.textFails = checkText(c, rep.answer);
    if(row.fallback && !mock) row.note = "fallback reply (Gemini unavailable or no key)";
    row.pass = !!row.routeOk && (!row.textFails || !row.textFails.length);
    row.textChecked = row.textFails !== null;
    rows.push(row);
    if(!flag("--quiet")) console.log(`${row.pass ? "PASS" : "FAIL"}  ${c.id.padEnd(32)} want ${c.expected_route.padEnd(6)} got ${routeTaken.padEnd(7)} first ${String(Math.round(row.firstVisibleMs ?? -1)).padStart(5)}ms total ${String(Math.round(row.totalMs)).padStart(5)}ms prompt ${String(row.promptChars ?? "-").padStart(6)}ch` + (row.textFails && row.textFails.length ? "  " + row.textFails.join("; ") : ""));
  }
  const ok = rows.filter(r => !r.error);
  const llm = ok.filter(r => r.geminiCalls > 0);
  const summary = {
    cases: rows.length, pass: rows.filter(r => r.pass).length, routeOk: rows.filter(r => r.routeOk).length,
    textChecked: ok.filter(r => r.textChecked).length, textPass: ok.filter(r => r.textChecked && !r.textFails.length).length,
    routes: ok.reduce((o, r) => { o[r.routeTaken] = (o[r.routeTaken] || 0) + 1; return o; }, {}),
    geminiCallsTotal: ok.reduce((s, r) => s + r.geminiCalls, 0),
    cannotOrCrisisSentToGemini: ok.filter(r => ["cannot", "crisis"].includes(r.expected_route) && r.geminiCalls > 0).map(r => r.id),
    firstVisibleMs: stats(ok.map(r => r.firstVisibleMs)), totalMs: stats(ok.map(r => r.totalMs)), ttfbMs: stats(ok.map(r => r.ttfbMs)),
    serverOverheadMs: stats(ok.map(r => r.serverOverheadMs)), geminiMs: stats(llm.map(r => r.geminiMs)),
    promptChars: stats(llm.map(r => r.promptChars)), estTokens: stats(llm.map(r => r.estTokens)),
    coldContextFetchMs: rows[0] && !rows[0].error ? rows[0].contextFetchMsMax : null,
    byCategory: Object.fromEntries([...new Set(rows.map(r => r.category))].map(cat => { const rs = rows.filter(r => r.category === cat); return [cat, rs.filter(r => r.pass).length + "/" + rs.length]; }))
  };
  return { mode: inproc ? "inproc" : "url", target: base || opt("--handler") || "FirebirdHub/api/ask.js", mock, fixtures: inproc ? USE_FIXTURES : !!(health && health.fixtures),
    geminiKey: inproc ? hasKey : !!(health && health.geminiKey), mockCfg: mock ? (inproc ? MOCK_CFG : health && health.mockCfg) : null,
    stream: flag("--stream"), legacyBody: flag("--legacy-body"), rows, summary };
}

const started = new Date();
const result = flag("--core") ? await runCore() : await runServer();
result.label = opt("--label", flag("--core") ? "core" : "run");
result.startedAt = started.toISOString();
result.node = process.version;
const outFile = path.resolve(EVALS_DIR, opt("--out", path.join("results", result.label + "-" + started.toISOString().replace(/[:.]/g, "-") + ".json")));
mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(result, null, 2));
console.log("\nSUMMARY " + JSON.stringify(result.summary, null, 2));
{ const rel = path.relative(EVALS_DIR, outFile); console.log("saved " + (rel.startsWith("..") ? outFile : rel)); }
