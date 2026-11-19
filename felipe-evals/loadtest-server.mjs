#!/usr/bin/env node
/**
 * Starts dev-server.mjs (unchanged) for loadtest.mjs, with two additions a one-day simulation needs:
 *
 * 1. A virtual clock. Date.now() (and new Date()) inside the server read a clock that runs at real
 *    speed but can be jumped forward from outside. loadtest.mjs jumps it across quiet gaps between
 *    questions, so a whole school day runs in minutes while every time-based rule keeps its real
 *    length: cache TTLs (30, 10, 5 min), rate-limit windows, Retry-After skips, the 20 s "being
 *    answered" marker and "out of quota until midnight Pacific". performance.now() is not touched,
 *    so the latencies the server and the client measure are real.
 *
 * 2. Per-minute and per-day limits that the mock's FELIPE_MOCK_QUOTA can't express (its counts never
 *    reset and every model has its own count). LOADTEST_LIMITS is JSON:
 *      { "buckets": { "<name>": { "rpm": 10, "tpm": 6000, "rpd": 1000 } },
 *        "models":  { "<model id>": "<bucket name>" } }
 *    Models in one bucket share it (gemini-flash-lite-latest, if it is set, is modeled as an alias of gemini-3.1-flash-lite).
 *    Over a limit, the call gets a 429 shaped like the real one (Gemini QuotaFailure with a
 *    PerMinute or PerDay quotaId and RetryInfo; Groq "requests per minute (RPM)" or "tokens per
 *    minute (TPM)" with Retry-After). Only calls that get through count toward a limit. Calls that
 *    pass go on to the mock (lib/instrument.mjs), which still applies FELIPE_MOCK_QUOTA.
 *
 *   FELIPE_MOCK=1 FELIPE_FIXTURES=1 node loadtest-server.mjs 4490
 *   Control (port + 1): GET /clock, POST /clock?to=<epoch ms> (forward only), GET /limits
 *   LOADTEST_START: the virtual start time (default 2026-11-18T07:00:00-08:00).
 */
import http from "node:http";

const START = Date.parse(process.env.LOADTEST_START || "2026-11-18T07:00:00-08:00");
const realDateNow = Date.now.bind(Date);
let offset = START - realDateNow();
Date.now = () => realDateNow() + offset;     // before instrument.mjs binds its own copy of Date.now

const port = Number(process.argv.slice(2).find(a => /^\d+$/.test(a))) || 4490;
await import("./dev-server.mjs");             // reads the same argv (port) and installs the mock
const { als } = await import("./lib/instrument.mjs");

/* ---------- limits ---------- */
let CFG = { buckets: {}, models: {} };
try{ if(process.env.LOADTEST_LIMITS) CFG = JSON.parse(process.env.LOADTEST_LIMITS); }catch(e){ console.error("bad LOADTEST_LIMITS"); }
const win = {};       // bucket -> [{ t, tok }] accepted calls in the last minute
const day = {};       // bucket -> accepted calls today
const stats = {};     // model -> { ok, rpm, tpm, rpd }
const perMinute = {}; // "HH:MM" -> accepted AI calls in that virtual minute
const st = m => stats[m] || (stats[m] = { ok: 0, rpm: 0, tpm: 0, rpd: 0 });
const hhmm = t => new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour12: false, hour: "2-digit", minute: "2-digit" }).format(new Date(t));
const OPENAI_HOSTS = { "api.groq.com": "groq", "api.cerebras.ai": "cerebras", "openrouter.ai": "openrouter" };

function gemini429(model, kind, retryS){
  const minute = kind !== "rpd";
  const body = { error: { code: 429, status: "RESOURCE_EXHAUSTED",
    message: "You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits.",
    details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
      quotaId: minute ? "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" : "GenerateRequestsPerDayPerProjectPerModel-FreeTier", quotaDimensions: { model } }] },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: Math.max(1, retryS) + "s" }] } };
  return new Response(JSON.stringify(body), { status: 429, headers: { "content-type": "application/json" } });
}
function openai429(model, kind, retryS, lim, used, asked){
  const what = kind === "tpm" ? "tokens per minute (TPM)" : kind === "rpd" ? "requests per day (RPD)" : "requests per minute (RPM)";
  const body = { error: { message: "Rate limit reached for model `" + model + "` in organization `org_mock` service tier `on_demand` on " + what + ": Limit " + lim + ", Used " + used + ", Requested " + asked + ". Please try again in " + retryS + "s.", type: kind === "tpm" ? "tokens" : "requests", code: "rate_limit_exceeded" } };
  return new Response(JSON.stringify(body), { status: 429, headers: { "content-type": "application/json", "retry-after": String(Math.max(1, retryS)) } });
}

const innerFetch = globalThis.fetch;
globalThis.fetch = async function(input, init){
  const u = typeof input === "string" ? input : (input && input.url) || String(input);
  let host = ""; try{ host = new URL(u).hostname; }catch(e){}
  const isGemini = /generativelanguage\.googleapis\.com/.test(u);
  const oa = /\/chat\/completions$/.test(u.split("?")[0]) ? OPENAI_HOSTS[host] : null;
  if(!isGemini && !oa) return innerFetch(input, init);
  let model = "";
  if(isGemini) model = (u.match(/models\/([^:]+):/) || [])[1] || "";
  else { try{ model = JSON.parse(init.body).model || ""; }catch(e){} }
  const bname = CFG.models[model], b = bname ? CFG.buckets[bname] : null;
  const now = Date.now();
  if(b){
    const w = (win[bname] = (win[bname] || []).filter(x => now - x.t < 60000));
    // Prompt tokens (about 4 characters each) plus about 200 output tokens.
    const tok = Math.round(String((init && init.body) || "").length / 4) + 200;
    const usedTok = w.reduce((n, x) => n + x.tok, 0);
    let kind = null, retryS = 0;
    if(b.rpd && (day[bname] || 0) >= b.rpd){ kind = "rpd"; retryS = 3600; }
    else if(b.rpm && w.length >= b.rpm){ kind = "rpm"; retryS = Math.ceil((w[0].t + 60000 - now) / 1000); }
    else if(b.tpm && usedTok + tok > b.tpm){
      kind = "tpm"; let free = usedTok + tok - b.tpm, i = 0;
      while(i < w.length && free > 0){ free -= w[i].tok; i++; }
      retryS = Math.ceil((w[Math.max(0, i - 1)].t + 60000 - now) / 1000);
    }
    if(kind){
      st(model)[kind]++;
      const s = als.getStore();
      if(s && s.rec) s.rec.gemini.push({ provider: isGemini ? "gemini" : oa, model, status: 429, limit: kind, synthetic: true });
      await new Promise(r => setTimeout(r, 120));   // a 429 comes back quickly
      return isGemini ? gemini429(model, kind, retryS) : openai429(model, kind, retryS, b[kind], kind === "tpm" ? usedTok : w.length, kind === "tpm" ? tok : 1);
    }
    w.push({ t: now, tok }); day[bname] = (day[bname] || 0) + 1;
  }
  const r = await innerFetch(input, init);
  if(r.status === 200){ st(model).ok++; const k = hhmm(now); perMinute[k] = (perMinute[k] || 0) + 1; }
  else if(r.status === 429) st(model).rpd++;     // the mock's own FELIPE_MOCK_QUOTA (a daily quota)
  return r;
};

/* ---------- control port ---------- */
http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  res.setHeader("Content-Type", "application/json");
  if(url.pathname === "/clock"){
    if(req.method === "POST"){
      const to = Number(url.searchParams.get("to"));
      if(Number.isFinite(to) && to > Date.now()) offset += to - Date.now();
    }
    res.end(JSON.stringify({ now: Date.now() }));
    return;
  }
  if(url.pathname === "/limits"){ res.end(JSON.stringify({ cfg: CFG, stats, perMinute, day })); return; }
  res.statusCode = 404; res.end("{}");
}).listen(port + 1, "127.0.0.1", () => console.log("loadtest control on http://127.0.0.1:" + (port + 1) + " (virtual clock starts " + new Date(START).toISOString() + ")"));
