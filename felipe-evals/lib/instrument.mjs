/**
 * Instrumentation shared by dev-server.mjs and run.mjs (in-process mode).
 *
 * - Wraps globalThis.fetch so every call a handler makes is timed and attributed to the
 *   eval request that caused it (AsyncLocalStorage). Calls made outside a request (a
 *   background refresh) land in a global log.
 * - Gemini calls: the request body is measured (system prompt, contents, history turns,
 *   generationConfig). Headers are never recorded, so the API key never reaches a log.
 * - MOCK mode (FELIPE_MOCK=1): Gemini is never contacted. generateContent and
 *   streamGenerateContent?alt=sse get a fake answer after a delay modeled on prompt size.
 * - FIXTURES mode (FELIPE_FIXTURES=1): https://www.fremontasb.org/api/* is served from
 *   ./fixtures (the 2026-11-18 snapshot) instead of the network, for deterministic runs.
 * - Fake clock: a request may carry "x-felipe-now" (an ISO time); inside that request
 *   new Date() (no arguments) returns that moment. Date.now() is NOT shifted, so rate limits,
 *   cache TTLs and timeouts still run on real time.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const EVALS_DIR = path.resolve(HERE, "..");
export const APP_DIR = path.resolve(EVALS_DIR, "..");
const FIXTURES = path.join(EVALS_DIR, "fixtures");

// The handler sends its x-felipe-* debug headers only when this is set; evals always want them.
if(process.env.FELIPE_DEBUG_HEADERS === undefined) process.env.FELIPE_DEBUG_HEADERS = "1";

export const als = new AsyncLocalStorage();
export const globalLog = [];          // fetches made outside any eval request
const records = new Map();            // eval id -> record
const RECORD_CAP = 2000;

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
export const MOCK = process.env.FELIPE_MOCK === "1";
export const USE_FIXTURES = process.env.FELIPE_FIXTURES === "1";
// Mock timing model (assumptions, not measured Gemini numbers; override with env vars):
// first token after FIRST_MS + PREFILL_MS_PER_1K * (prompt tokens / 1000), then text at CHARS_PER_S.
export const MOCK_CFG = {
  firstMs: num(process.env.FELIPE_MOCK_FIRST_MS, 800),
  prefillMsPer1k: num(process.env.FELIPE_MOCK_PREFILL_MS_PER_1K, 25),
  charsPerS: num(process.env.FELIPE_MOCK_CHARS_PER_S, 600),
  status: num(process.env.FELIPE_MOCK_STATUS, 200),          // e.g. 429 to exercise retries
  fixtureDelayMs: num(process.env.FELIPE_FIXTURE_DELAY_MS, 0)
};
const MOCK_TEXT = "This is a mock answer from the eval harness. The real Felipe would answer the question here, " +
  "in one to three short sentences, using the schedule, events, sports and clubs data. Mock mode measures the " +
  "server around Gemini, not the wording.";

export function newRecord(id){
  const rec = { id, t0: performance.now(), gemini: [], sources: [], other: [] };
  records.set(id, rec);
  if(records.size > RECORD_CAP){ const first = records.keys().next().value; records.delete(first); }
  return rec;
}
export function getRecord(id){ return records.get(id) || null; }

/* ---------- fake clock ---------- */
const RealDate = Date, realNow = Date.now.bind(Date);
function offsetNow(){ const s = als.getStore(); return s && s.clockOffset ? realNow() + s.clockOffset : realNow(); }
// Only "new Date()" with no arguments is shifted. Date.now() stays real on purpose, so the
// handler's rate limiter, cache TTLs and timeouts keep working while cases jump between days.
// (A handler that reads the wall clock for "today" must use new Date(), as ask.js nowPT does.)
class ShiftedDate extends RealDate {
  constructor(...a){ if(a.length) super(...a); else super(offsetNow()); }
}
let clockInstalled = false;
export function installClock(){
  if(clockInstalled) return; clockInstalled = true;
  globalThis.Date = ShiftedDate;
}
export function clockOffsetFor(iso){
  if(!iso) return 0;
  const t = RealDate.parse(iso);
  return Number.isFinite(t) ? t - realNow() : 0;
}

/* ---------- prompt measurement ---------- */
// Character count per prompt section. A section starts at a line that opens with an
// ALL-CAPS heading ("UPCOMING EVENTS (...):", "STATIC FACTS:", "TODAY: ..."); text before the first is "preamble".
export function sectionSizes(text){
  const out = {}; let cur = "preamble";
  for(const line of String(text || "").split("\n")){
    const m = line.match(/^([A-Z][A-Z0-9 '&/-]{2,60}?)(?:\s*\(|:)/);
    if(m && m[1].trim().length >= 4) cur = m[1].trim();
    out[cur] = (out[cur] || 0) + line.length + 1;
  }
  return out;
}
function partsText(parts){ return (parts || []).map(p => (p && typeof p.text === "string") ? p.text : "").join(""); }
export function measurePayload(body, evalId){
  let j = null; try{ j = JSON.parse(body); }catch(e){ return { bodyChars: String(body || "").length }; }
  const system = j.systemInstruction ? partsText(j.systemInstruction.parts) : "";
  const contents = Array.isArray(j.contents) ? j.contents : [];
  const contentsChars = contents.reduce((s, c) => s + partsText(c.parts).length, 0);
  const gc = j.generationConfig || {};
  if(process.env.FELIPE_DUMP_PROMPT_DIR){
    try{ mkdirSync(process.env.FELIPE_DUMP_PROMPT_DIR, { recursive: true });
      writeFileSync(path.join(process.env.FELIPE_DUMP_PROMPT_DIR, "prompt-" + (evalId ? String(evalId).replace(/[^a-z0-9_.-]/gi, "_") + "-" : "") + Date.now() + "-" + Math.random().toString(36).slice(2, 7) + ".txt"), system + "\n\n=== CONTENTS ===\n" + JSON.stringify(contents, null, 1)); }catch(e){}
  }
  return {
    sections: sectionSizes(system),
    systemChars: system.length,
    contentsChars,
    promptChars: system.length + contentsChars,
    estTokens: Math.round((system.length + contentsChars) / 4),   // 4 chars per token heuristic
    turns: contents.length,
    maxOutputTokens: gc.maxOutputTokens ?? null,
    thinking: gc.thinkingConfig ? JSON.stringify(gc.thinkingConfig) : null,
    temperature: gc.temperature ?? null
  };
}

/* ---------- mock Gemini ---------- */
const sleep = (ms, signal) => new Promise((res, rej) => {
  if(signal && signal.aborted){ rej(signal.reason || new Error("aborted")); return; }
  const t = setTimeout(res, ms);
  if(signal) signal.addEventListener("abort", () => { clearTimeout(t); rej(signal.reason || new Error("aborted")); }, { once: true });
});
function mockGemini(url, init, call){
  const stream = /:streamGenerateContent/.test(url);
  const signal = init && init.signal;
  const firstMs = MOCK_CFG.firstMs + MOCK_CFG.prefillMsPer1k * (call.estTokens || 0) / 1000;
  const text = MOCK_TEXT;
  const usage = { promptTokenCount: call.estTokens || 0, candidatesTokenCount: Math.round(text.length / 4) };
  if(MOCK_CFG.status !== 200){
    return sleep(150, signal).then(() => new Response(JSON.stringify({ error: { code: MOCK_CFG.status, message: "mock error" } }),
      { status: MOCK_CFG.status, headers: { "content-type": "application/json" } }));
  }
  if(!stream){
    return sleep(firstMs + text.length / MOCK_CFG.charsPerS * 1000, signal).then(() => {
      call.mockFirstMs = Math.round(firstMs);
      return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: usage, modelVersion: "mock" }),
        { status: 200, headers: { "content-type": "application/json" } });
    });
  }
  const enc = new TextEncoder();
  const chunks = text.match(/.{1,48}(\s|$)/g) || [text];
  const body = new ReadableStream({
    async start(ctrl){
      try{
        await sleep(firstMs, signal);
        call.mockFirstMs = Math.round(firstMs);
        for(let i = 0; i < chunks.length; i++){
          const last = i === chunks.length - 1;
          const ev = { candidates: [{ content: { role: "model", parts: [{ text: chunks[i] }] }, ...(last ? { finishReason: "STOP" } : {}) }], ...(last ? { usageMetadata: usage } : {}) };
          ctrl.enqueue(enc.encode("data: " + JSON.stringify(ev) + "\r\n\r\n"));
          if(!last) await sleep(chunks[i].length / MOCK_CFG.charsPerS * 1000, signal);
        }
        ctrl.close();
      }catch(e){ try{ ctrl.error(e); }catch(_){} }
    }
  });
  return Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }));
}

/* ---------- fixtures for fremontasb.org ---------- */
function fixtureFor(u){
  const url = new URL(u);
  if(url.hostname !== "www.fremontasb.org" || !url.pathname.startsWith("/api/")) return null;
  const name = url.pathname.slice(5);
  let file = null, type = "application/json";
  if(name === "sheet"){ file = "sheet_" + String(url.searchParams.get("tab") || "").replace(/\s+/g, "_") + ".csv"; type = "text/csv"; }
  else if(name === "clubs") file = "clubs.json";
  else if(name === "announcements") file = "announcements.json";
  else if(name === "events") file = "events_api.json";
  if(!file) return null;
  try{ return { text: readFileSync(path.join(FIXTURES, file), "utf8"), type }; }catch(e){ return { missing: true }; }
}

/* ---------- the fetch wrapper ---------- */
let fetchInstalled = false;
export function installFetch(){
  if(fetchInstalled) return; fetchInstalled = true;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async function(input, init){
    const u = typeof input === "string" ? input : (input && input.url) || String(input);
    const store = als.getStore();
    const rec = store && store.rec;
    const t0 = performance.now();
    const isGemini = /generativelanguage\.googleapis\.com/.test(u);
    if(isGemini){
      const model = (u.match(/models\/([^:]+):/) || [])[1] || "";
      const call = { model, stream: /:streamGenerateContent/.test(u), mock: MOCK, ...measurePayload(init && init.body, rec && rec.id), tStart: rec ? Math.round(t0 - rec.t0) : null };
      if(rec) rec.gemini.push(call); else globalLog.push({ kind: "gemini", ...call });
      try{
        const r = MOCK ? await mockGemini(u, init, call) : await realFetch(input, init);
        call.status = r.status; call.headersMs = Math.round(performance.now() - t0);
        return wrapBody(r, call, t0);
      }catch(e){ call.error = String(e && e.name || e); call.ms = Math.round(performance.now() - t0); throw e; }
    }
    const entry = { url: u.replace(/[?&](key|token|api_key)=[^&]+/gi, ""), tStart: rec ? Math.round(t0 - rec.t0) : null };
    const target = /fremontasb\.org/.test(u) ? (rec ? rec.sources : globalLog) : (rec ? rec.other : globalLog);
    target.push(entry);
    try{
      let r;
      const fx = USE_FIXTURES ? fixtureFor(u) : null;
      if(fx && !fx.missing){
        if(MOCK_CFG.fixtureDelayMs) await sleep(MOCK_CFG.fixtureDelayMs, init && init.signal);
        r = new Response(fx.text, { status: 200, headers: { "content-type": fx.type } });
        entry.fixture = true;
      } else r = await realFetch(input, init);
      entry.status = r.status; entry.ms = Math.round(performance.now() - t0);
      return r;
    }catch(e){ entry.error = String(e && e.name || e); entry.ms = Math.round(performance.now() - t0); throw e; }
  };
}
// Time to first body byte and end of body for a Gemini response, without changing what the handler reads.
function wrapBody(r, call, t0){
  if(!r.body) return r;
  const reader = r.body.getReader();
  let first = true;
  const body = new ReadableStream({
    async pull(ctrl){
      const { done, value } = await reader.read();
      if(done){ call.ms = Math.round(performance.now() - t0); ctrl.close(); return; }
      if(first){ call.firstByteMs = Math.round(performance.now() - t0); first = false; }
      ctrl.enqueue(value);
    },
    cancel(reason){ call.cancelled = true; return reader.cancel(reason); }
  });
  return new Response(body, { status: r.status, statusText: r.statusText, headers: r.headers });
}

// In mock mode the handler still needs *a* key to get past its "not set up" check. The
// placeholder never leaves this process: every Gemini URL is answered by mockGemini above.
export function install(){
  installFetch(); installClock();
  if(MOCK && !process.env.GEMINI_API_KEY) process.env.GEMINI_API_KEY = "mock-placeholder-not-a-key";
}
