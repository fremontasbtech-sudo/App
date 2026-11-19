/**
 * Ask Felipe: the quota-aware provider router.
 *
 * The list is built from the env vars that are set, in this order (FELIPE_PROVIDERS can
 * reorder or drop providers, e.g. "groq,gemini"):
 *   gemini      GEMINI_API_KEY      models from FELIPE_MODELS, default
 *                                    gemini-3.6-flash, gemini-3.1-flash-lite, gemini-2.5-flash-lite
 *                                    (each has its own free-tier quota; gemini-flash-lite-latest was
 *                                    dropped from the default because it may be an alias that
 *                                    shares gemini-3.1-flash-lite's quota)
 *   groq        GROQ_API_KEY        GROQ_MODELS, default llama-3.3-70b-versatile, llama-3.1-8b-instant
 *   cerebras    CEREBRAS_API_KEY    CEREBRAS_MODELS, default qwen-3.8-27b
 *   openrouter  OPENROUTER_API_KEY  OPENROUTER_MODELS, default meta-llama/llama-3.3-70b-instruct:free
 * Groq, Cerebras and OpenRouter speak the OpenAI chat-completions format. Every provider
 * streams and gets the same system prompt and fenced live data; models with a small
 * tokens-per-minute limit get a shorter prompt (shrink(), from ask.js).
 *
 * Rules:
 *  - 429: the model is marked out of quota in the shared store (store.js), under a fingerprint
 *    of the API key (a short SHA-256, never the key), so every instance
 *    skips it: a daily quota until midnight Pacific (Google's reset) or the provider's
 *    Retry-After, a per-minute one for its Retry-After or 60 s. The next model is tried at once.
 *  - 401, 403, 404 (bad key, model gone): skipped for 10 minutes.
 *  - 5xx or a network error: one short retry on the same model, then the next model; a model
 *    that failed both times is skipped for 30 s.
 *  - Gemini 3: thinkingLevel "low", never thinkingBudget 0; an empty answer or a 400 is retried
 *    once without thinkingConfig (gemini.js has the details).
 *  - Once any text has reached the student, nothing is retried (they would see it twice).
 *  - An empty answer (usually a safety block) is not sent on to another provider.
 *  - No new attempt starts after 14 s, or once the student has left.
 * Keys are sent only in request headers and are never logged.
 */
import { callGemini, thinksLow, quotaInfo } from "./gemini.js";
import { createHash } from "node:crypto";
import { markExhausted, exhaustedMap } from "./store.js";

const GEMINI_DEFAULT = "gemini-3.6-flash,gemini-3.1-flash-lite,gemini-2.5-flash-lite";
const OPENAI = {
  groq:       { url: "https://api.groq.com/openai/v1/chat/completions", env: "GROQ_API_KEY", models: "GROQ_MODELS", def: "llama-3.3-70b-versatile,llama-3.1-8b-instant" },
  cerebras:   { url: "https://api.cerebras.ai/v1/chat/completions", env: "CEREBRAS_API_KEY", models: "CEREBRAS_MODELS", def: "qwen-3.8-27b" },
  openrouter: { url: "https://openrouter.ai/api/v1/chat/completions", env: "OPENROUTER_API_KEY", models: "OPENROUTER_MODELS", def: "meta-llama/llama-3.3-70b-instruct:free" }
};
// System prompt budget (characters) for models with a small tokens-per-minute limit
// (about 4 characters per token; llama-3.1-8b-instant allows 6,000 tokens a minute and
// llama-3.3-70b-versatile 12,000, prompt and answer together). shrink() then uses the compact rules.
const PROMPT_BUDGET = { "llama-3.1-8b-instant": 5000, "llama-3.3-70b-versatile": 9000 };
const MAX_TOKENS_SMALL = { "llama-3.1-8b-instant": 500 };
const FIRST_TEXT_MS = 12000, IDLE_MS = 10000, TOTAL_MS = 30000;
const DEADLINE_MS = 14000, MAX_ATTEMPTS = 8, RETRY_5XX_MS = 400;

const list = s=> String(s || "").split(",").map(x=> x.trim()).filter(Boolean);
// 12 hex characters of a SHA-256 of the key: out-of-quota flags belong to one key, so a new or
// upgraded (paid) key is used at once instead of waiting for the old key's flags to run out.
const fingerprint = key=> createHash("sha256").update(String(key || "")).digest("hex").slice(0, 12);

// [{ id, provider, kind, model, url, key, budget }] for the keys that are set, in order.
export function providerList(env){
  const E = env || process.env, out = [];
  const order = list(E.FELIPE_PROVIDERS).length ? list(E.FELIPE_PROVIDERS).map(x=> x.toLowerCase()) : ["gemini", "groq", "cerebras", "openrouter"];
  for(const name of order){
    if(name === "gemini"){
      if(!E.GEMINI_API_KEY) continue;
      for(const model of (list(E.FELIPE_MODELS).length ? list(E.FELIPE_MODELS) : list(GEMINI_DEFAULT)))
        out.push({ id: "gemini:"+model, flag: "gemini:"+fingerprint(E.GEMINI_API_KEY)+":"+model, provider: "gemini", kind: "gemini", model, key: E.GEMINI_API_KEY });
    } else if(OPENAI[name]){
      const p = OPENAI[name], key = E[p.env];
      if(!key) continue;
      for(const model of (list(E[p.models]).length ? list(E[p.models]) : list(p.def)))
        out.push({ id: name+":"+model, flag: name+":"+fingerprint(key)+":"+model, provider: name, kind: "openai", model, url: p.url, key, budget: PROMPT_BUDGET[model] || 0, maxTokens: MAX_TOKENS_SMALL[model] || 900 });
    }
  }
  return out;
}

/* ---------- midnight Pacific ---------- */
// DST days are 23 or 25 hours long, so the wall-clock guess is checked and corrected by an hour
// (the same rule as the website's secondsUntilMidnightPT in api/_llm.js).
const ptHMS = t=>{
  const p = {};
  new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(t)).forEach(x=>{ p[x.type] = x.value; });
  return { h: Number(p.hour) % 24, m: Number(p.minute), s: Number(p.second) };
};
export function nextMidnightPT(fromMs){
  const t = fromMs || Date.now(), c = ptHMS(t);
  let sec = 86400 - (c.h*3600 + c.m*60 + c.s);
  const h = ptHMS(t + sec*1000).h;
  if(h === 23) sec += 3600; else if(h === 1) sec -= 3600;
  return t + sec*1000 + 5000;
}
// How long a 429 keeps a model out.
function exhaustedUntil(prov, quota, now){
  const q = quota || { daily: false, retryS: 0 };
  if(q.daily){
    // Google resets free-tier quotas at midnight Pacific; others say when in Retry-After.
    if(prov.provider !== "gemini" && q.fromHeader && q.retryS > 0) return now + Math.min(q.retryS, 26*3600)*1000;
    return nextMidnightPT(now);
  }
  return now + Math.min(Math.max(q.retryS || 60, 5), 600)*1000;
}

/* ---------- OpenAI-compatible streaming call ---------- */
// Hides <think>...</think> blocks some open models write before the answer.
function thinkFilter(){
  let raw = "", sent = 0;
  const visible = ()=>{
    let v = raw.replace(/<think>[\s\S]*?<\/think>\s*/g, "");
    const open = v.indexOf("<think>"); if(open >= 0) v = v.slice(0, open);
    const lt = v.lastIndexOf("<"); if(lt >= 0 && v.length - lt < 8 && "<think>".startsWith(v.slice(lt))) v = v.slice(0, lt);
    return v.replace(/^\s+/, "");
  };
  return { push(piece){ raw += piece; const v = visible(); const out = v.slice(sent); sent = v.length; return out; },
           end(){ const v = raw.replace(/<think>[\s\S]*?(<\/think>|$)\s*/g, "").replace(/^\s+/, ""); const out = v.slice(sent); sent = v.length; return out; } };
}
export async function callOpenAI({ prov, system, contents, temperature, onDelta, signal }){
  const messages = [{ role: "system", content: system }].concat(contents.map(c=> ({
    role: c.role === "model" ? "assistant" : "user", content: (c.parts || []).map(p=> p.text || "").join("\n\n") })));
  const body = JSON.stringify({ model: prov.model, messages, temperature, max_tokens: prov.maxTokens || 900, stream: !!onDelta });
  const headers = { "Content-Type": "application/json", "Authorization": "Bearer " + prov.key };
  if(prov.provider === "openrouter"){ headers["HTTP-Referer"] = "https://firebirdhub.vercel.app"; headers["X-Title"] = "Firebird Hub"; }
  const ctrl = new AbortController();
  const stop = ()=> ctrl.abort();
  if(signal){ if(signal.aborted) stop(); else signal.addEventListener("abort", stop, { once: true }); }
  let timer = setTimeout(stop, FIRST_TEXT_MS);
  const total = onDelta ? setTimeout(stop, TOTAL_MS) : null;
  let text = "", emitted = false;
  const tf = thinkFilter();
  const give = piece=>{ if(!piece) return; text += piece; emitted = true; onDelta(piece); };
  try{
    const r = await fetch(prov.url, { method: "POST", headers, body, signal: ctrl.signal });
    if(!r.ok){
      const errBody = await r.text().catch(()=> "");   // never logged
      return { text: "", ok: false, status: r.status, emitted: false, quota: r.status === 429 ? quotaInfo(errBody, r.headers) : null };
    }
    if(!onDelta){
      const data = await r.json().catch(()=> ({}));
      let t = "", finish = ""; try{ t = String(data.choices[0].message.content || ""); finish = String(data.choices[0].finish_reason || ""); }catch(e){}
      t = t.replace(/<think>[\s\S]*?(<\/think>|$)\s*/g, "").trim();
      return { text: t, ok: true, status: 200, emitted: false, finish };
    }
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = "", status = 200, quota = null, finish = "";
    const line = l=>{
      if(!l.startsWith("data:")) return;
      const json = l.slice(5).trim();
      if(!json || json === "[DONE]") return;
      let d; try{ d = JSON.parse(json); }catch(e){ return; }
      if(d.error){ status = Number(d.error.code) || (/rate|quota/i.test(String(d.error.message || d.error.type || "")) ? 429 : 500); if(status === 429) quota = quotaInfo(JSON.stringify(d.error), null); return; }
      let piece = ""; try{ piece = d.choices[0].delta.content || ""; if(d.choices[0].finish_reason) finish = String(d.choices[0].finish_reason); }catch(e){}
      if(piece) give(tf.push(piece));
    };
    for(;;){
      const { value, done } = await reader.read();
      if(done) break;
      clearTimeout(timer); timer = setTimeout(stop, emitted ? IDLE_MS : FIRST_TEXT_MS);
      buf += dec.decode(value, { stream: true });
      let i;
      while((i = buf.indexOf("\n")) >= 0){ line(buf.slice(0, i).trim()); buf = buf.slice(i + 1); }
    }
    buf += dec.decode();
    if(buf.trim()) line(buf.trim());
    give(tf.end());
    if(status !== 200 && !text) return { text: "", ok: false, status, emitted: false, quota };
    return { text: text.trim(), ok: true, status: 200, emitted, finish };
  }catch(e){
    return { text: text.trim(), ok: false, status: 0, emitted, aborted: ctrl.signal.aborted };
  }finally{ clearTimeout(timer); if(total) clearTimeout(total); if(signal) signal.removeEventListener("abort", stop); }
}

/* ---------- the router ---------- */
const sleep = ms=> new Promise(r=> setTimeout(r, ms));
/**
 * askAI({ system, contents, temperature, onDelta, signal, shrink, only })
 *  shrink(maxChars) -> { system, contents }: a shorter prompt for small-limit models.
 * Returns { text, ok, emitted, finish, provider, model, id, first, attempts:[{ id, status, ms }], allExhausted, none }.
 *  none: no provider is configured. allExhausted: every configured model is out of quota.
 *  finish: the model's stop reason ("STOP"/"stop" for a complete answer). first: the answer came
 *  from the first model in the list (the main one), not a backup.
 */
// True when every model allowed for a question is already out of quota (no network call).
export async function allOutNow({ env, only } = {}){
  const provs = providerList(env).filter(p=> !only || only.includes(p.provider));
  if(!provs.length) return false;
  const out = await exhaustedMap(provs.map(p=> p.flag));
  return provs.every(p=> out[p.flag]);
}
export async function askAI({ system, contents, temperature = 0.3, onDelta, signal, shrink, env, only }){
  // only: provider names allowed for this question (a student's Schoology items go to Gemini only).
  const provs = providerList(env).filter(p=> !only || only.includes(p.provider));
  if(!provs.length) return { text: "", ok: false, emitted: false, none: true, attempts: [] };
  const started = Date.now();
  const out = await exhaustedMap(provs.map(p=> p.flag));
  const usable = provs.filter(p=> !out[p.flag]);
  const attempts = [];
  let last = { text: "", ok: false, emitted: false, status: 0 };
  for(const prov of usable){
    if(attempts.length >= MAX_ATTEMPTS || Date.now() - started > DEADLINE_MS || (signal && signal.aborted)) break;
    let sys = system, cts = contents;
    if(prov.budget && system.length > prov.budget && typeof shrink === "function"){ const s = shrink(prov.budget); if(s){ sys = s.system; cts = s.contents; } }
    const one = async (thinking)=>{
      const t0 = Date.now();
      const r = prov.kind === "gemini"
        ? await callGemini({ key: prov.key, model: prov.model, system: sys, contents: cts, temperature, onDelta, signal, thinking })
        : await callOpenAI({ prov, system: sys, contents: cts, temperature, onDelta, signal });
      attempts.push({ id: prov.id, status: r.status, ms: Date.now() - t0 });
      return r;
    };
    let r = await one();
    // Gemini: an empty answer or a 400 with thinking on gets one try without thinkingConfig.
    if(prov.kind === "gemini" && !r.text && !r.emitted && (r.status === 200 || r.status === 400) && thinksLow(prov.model) && !(signal && signal.aborted)) r = await one(false);
    // 5xx or a network error (not our timeout, not the student leaving): one short retry.
    if(!r.text && !r.emitted && (r.status >= 500 || (r.status === 0 && !r.aborted)) && !(signal && signal.aborted) && Date.now() - started < DEADLINE_MS){
      await sleep(RETRY_5XX_MS); r = await one();
    }
    last = r;
    if(r.text || r.emitted) return { ...r, provider: prov.provider, model: prov.model, id: prov.id, first: prov === provs[0], attempts };
    // An empty 200 (after the retry above) usually means a safety block: the question is not
    // shopped around to other providers. ask.js answers it from the data or kindly.
    if(r.status === 200) return { ...r, text: "", emitted: false, ok: false, blocked: true, provider: prov.provider, model: prov.model, id: prov.id, attempts };
    const now = Date.now();
    if(r.status === 429){
      const until = exhaustedUntil(prov, r.quota, now);
      console.warn("ask: " + prov.id + " out of quota (" + (r.quota && r.quota.daily ? "daily" : "per minute") + "), skipped for " + Math.round((until - now)/60000) + " min");
      await markExhausted(prov.flag, until, r.quota && r.quota.daily ? "daily" : "minute");
    } else if(r.status === 401 || r.status === 403 || r.status === 404){
      console.warn("ask: " + prov.id + " HTTP " + r.status + ", skipped for 10 min");
      await markExhausted(prov.flag, now + 600000, "http " + r.status);
    } else if(r.status >= 500 || (r.status === 0 && !r.aborted)){
      // Failed twice in a row: skipped for 30 s, so an outage doesn't slow every question down.
      console.warn("ask: " + prov.id + " HTTP " + r.status + " twice, skipped for 30 s");
      await markExhausted(prov.flag, now + 30000, "http " + r.status);
    } else if(r.status !== 200) console.warn("ask: " + prov.id + " HTTP " + r.status);
    if(r.aborted && Date.now() - started >= FIRST_TEXT_MS) break;   // a timeout already used the time
  }
  const after = await exhaustedMap(provs.map(p=> p.flag));
  return { ...last, text: "", emitted: false, ok: false, attempts, allExhausted: provs.every(p=> after[p.flag]) };
}
