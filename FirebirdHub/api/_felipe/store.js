/**
 * Ask Felipe: the shared memory that lets one Gemini answer serve many students, and lets
 * every warm instance know which AI providers are out of quota.
 *
 * Two layers:
 *  - An in-memory LRU per warm instance. Always on; if everything else fails it still works.
 *  - Vercel Runtime Cache (getCache() from @vercel/functions): a key-value store shared by all
 *    instances in a region, scoped to this project and environment (preview and production
 *    never share). Loaded with a dynamic import; if the package is missing, the import fails,
 *    or the cache is slow (over 250 ms) or failing, the instance quietly uses memory alone.
 *    FELIPE_SHARED_CACHE=0 turns the shared layer off.
 *    getCache() hashes every key with a 32-bit hash by default, so two keys could share a slot.
 *    Keys here are hashed with SHA-256 instead, and every value carries its own full key: a hit
 *    whose key doesn't match is treated as a miss (so one question can never get another's answer).
 *
 * What is kept (nothing here is ever logged):
 *  - "a:<hash>"  answers to self-contained general questions (no Schoology items, no follow-up;
 *                they are answered without the chat history), keyed by a hash of the normalized
 *                question plus intent, language, date and a hash of the live data. The question
 *                itself is not stored. Up to 6 hours for stable topics (clubs, results, app help),
 *                30 minutes otherwise, 5 to 10 minutes when time-sensitive (ask.js cacheKey).
 *  - "p:<hash>"  a short "someone is asking this right now" marker, so another instance can
 *                wait for that answer instead of paying for a second call.
 *  - "x:<provider>:<key fingerprint>:<model>" when a model is out of quota, until when. The
 *                fingerprint is 12 hex characters of a SHA-256 of the API key (never the key), so a
 *                new or upgraded key starts fresh at once. Tagged "felipe-quota": expiring that tag
 *                in the Vercel dashboard clears every quota flag without dropping cached answers.
 *  - "n:<date>:<shard>" the day's count of AI questions (only when FELIPE_DAILY_CAP is set).
 *  - "u:<date>:<hash>" how many AI questions one student id or one IP (a SHA-256 of it, never the
 *                address) asked today, for the per-person daily limit in ask.js.
 */
import { createHash, randomBytes } from "node:crypto";

const SHARED_TIMEOUT_MS = 250;
const LRU_MAX = 600;
export let INSTANCE_ID = randomBytes(5).toString("hex");

/* ---------- in-memory LRU ---------- */
const lru = new Map();   // key -> { v, exp }
function memGet(k){
  const e = lru.get(k);
  if(!e) return undefined;
  if(e.exp <= Date.now()){ lru.delete(k); return undefined; }
  lru.delete(k); lru.set(k, e);   // most recently used goes last
  return e.v;
}
function memSet(k, v, ttlS){
  lru.delete(k);
  lru.set(k, { v, exp: Date.now() + ttlS*1000 });
  while(lru.size > LRU_MAX) lru.delete(lru.keys().next().value);
}
function memDel(k){ lru.delete(k); }

/* ---------- the shared layer ---------- */
let sharedP = null, failStreak = 0, offUntil = 0;
function shared(){
  if(process.env.FELIPE_SHARED_CACHE === "0") return Promise.resolve(null);
  if(Date.now() < offUntil) return Promise.resolve(null);
  // The eval harness installs a stand-in here (felipe-evals/lib/instrument.mjs).
  if(globalThis.__felipeSharedCache) return Promise.resolve(globalThis.__felipeSharedCache);
  if(!sharedP){
    sharedP = import("@vercel/functions")
      .then(m=> (m && typeof m.getCache === "function") ? m.getCache({ namespace:"felipe", keyHashFunction: k=> createHash("sha256").update(String(k)).digest("hex") }) : null)
      .catch(()=> null);
  }
  return sharedP;
}
function withTimeout(p){
  let t;
  return Promise.race([p, new Promise((_, rej)=>{ t = setTimeout(()=> rej(new Error("shared cache timeout")), SHARED_TIMEOUT_MS); })])
    .finally(()=> clearTimeout(t));
}
// After 5 failures in a row the shared layer rests for a minute; memory carries on.
const ok = v=>{ failStreak = 0; return v; };
const fail = ()=>{ if(++failStreak >= 5){ offUntil = Date.now() + 60000; failStreak = 0; } return undefined; };
// Every value is stored as { k: <full key>, v: <value> }; a hit for another key is a miss.
async function sharedGet(k){
  const c = await shared(); if(!c) return undefined;
  try{
    const e = ok(await withTimeout(c.get(k)));
    return (e && typeof e === "object" && e.k === k) ? e.v : undefined;
  }catch(e){ return fail(); }
}
async function sharedSet(k, v, ttlS, tags){
  const c = await shared(); if(!c) return false;
  try{ await withTimeout(c.set(k, { k, v }, { ttl: Math.max(1, Math.ceil(ttlS)), tags: tags || ["felipe"], name: "felipe" })); ok(); return true; }catch(e){ fail(); return false; }
}
async function sharedDel(k){
  const c = await shared(); if(!c) return;
  try{ await withTimeout(typeof c.delete === "function" ? c.delete(k) : c.set(k, null, { ttl:1 })); ok(); }catch(e){ fail(); }
}
export async function sharedAvailable(){ return !!(await shared()); }

/* ---------- answers ---------- */
export const hash = (s, n)=> createHash("sha256").update(String(s)).digest("hex").slice(0, n || 24);

// Returns { text, at, by } or undefined. Shared hits are copied into memory for their remaining life.
export async function getAnswer(key){
  const k = "a:"+key;
  const m = memGet(k);
  if(m) return m;
  const s = await sharedGet(k);
  if(s && typeof s.text === "string" && s.text && s.exp > Date.now()){
    memSet(k, s, (s.exp - Date.now())/1000);
    return s;
  }
  return undefined;
}
export async function putAnswer(key, text, ttlS, by){
  const k = "a:"+key, v = { text, at: Date.now(), exp: Date.now() + ttlS*1000, by: by || "" };
  memSet(k, v, ttlS);
  await sharedSet(k, v, ttlS, ["felipe", "felipe-answers"]);
}

/* ---------- one call for many students ---------- */
/* In this instance: the first request for a key starts the call; the rest join it and get its
   text as it streams. The call is stopped only when every joined student has left.
   Flight: { chunks:[], listeners:Set, done:Promise<result>, ctrl:AbortController, riders } */
const flights = new Map();
export function joinFlight(key){ return flights.get(key) || null; }
export function startFlight(key, run){
  const f = { chunks: [], listeners: new Set(), ctrl: new AbortController(), riders: 0, done: null };
  f.emit = piece=>{ f.chunks.push(piece); for(const l of f.listeners){ try{ l(piece); }catch(e){} } };
  f.done = (async ()=>{ try{ return await run(f); } finally { flights.delete(key); } })();
  flights.set(key, f);
  return f;
}
/* A rider: replays what already arrived, then follows live. leave() when the student goes;
   the call is aborted once nobody is left. Returns { done, leave }. */
export function ride(f, onPiece){
  f.riders++;
  for(const p of f.chunks) onPiece(p);
  const l = p=> onPiece(p);
  f.listeners.add(l);
  let left = false;
  const leave = ()=>{ if(left) return; left = true; f.listeners.delete(l); if(--f.riders <= 0) f.ctrl.abort(); };
  return { done: f.done.finally(()=>{ if(!left){ left = true; f.listeners.delete(l); f.riders--; } }), leave };
}
export function flightCount(){ return flights.size; }

// Across instances: a short marker while an answer is being made elsewhere.
export async function markPending(key, ttlS){ await sharedSet("p:"+key, { by: INSTANCE_ID, at: Date.now() }, ttlS || 20); }
export async function clearPending(key){ await sharedDel("p:"+key); }
export async function pendingElsewhere(key){
  const p = await sharedGet("p:"+key);
  return !!(p && p.by && p.by !== INSTANCE_ID && Date.now() - p.at < 20000);
}
// Polls for another instance's answer. Returns it, or undefined after maxMs. Students in this
// instance waiting for the same key share one poller (2 shared reads every 250 ms in all).
const waits = new Map();
function pollFor(key, maxMs){
  const until = Date.now() + maxMs;
  return (async ()=>{
    while(Date.now() < until){
      await new Promise(r=> setTimeout(r, 250));
      const a = await getAnswer(key);
      if(a) return a;
      if(!(await pendingElsewhere(key))) return getAnswer(key);
    }
    return undefined;
  })();
}
export async function waitForAnswer(key, maxMs, signal){
  let w = waits.get(key);
  if(!w){ w = pollFor(key, maxMs).finally(()=> waits.delete(key)); waits.set(key, w); }
  if(!signal) return w;
  if(signal.aborted) return undefined;
  return Promise.race([w, new Promise(r=> signal.addEventListener("abort", ()=> r(undefined), { once:true }))]);
}

/* ---------- providers out of quota ---------- */
const exhaustedLocal = new Map();   // id -> until (ms)
const checkedAt = new Map();        // id -> when the shared copy was last read
// A longer flag already written by another instance (say a daily quota) is never shortened.
export async function markExhausted(id, untilMs, why){
  const prev = exhaustedLocal.get(id) || 0;
  if(untilMs <= prev) return;
  exhaustedLocal.set(id, untilMs);
  checkedAt.set(id, Date.now());
  const s = await sharedGet("x:"+id);
  if(s && Number(s.until) >= untilMs){ exhaustedLocal.set(id, Number(s.until)); return; }
  await sharedSet("x:"+id, { until: untilMs, why: why || "" }, (untilMs - Date.now())/1000, ["felipe", "felipe-quota"]);
}
// id -> until (ms) for the ids that are out of quota now. Shared state is read at most every 10 s per id.
export async function exhaustedMap(ids){
  const now = Date.now(), out = {};
  await Promise.all(ids.map(async id=>{
    let until = exhaustedLocal.get(id) || 0;
    if(until <= now && now - (checkedAt.get(id) || 0) > 10000){
      checkedAt.set(id, now);
      const s = await sharedGet("x:"+id);
      if(s && s.until > now){ until = s.until; exhaustedLocal.set(id, until); }
    }
    if(until > now) out[id] = until;
  }));
  return out;
}

/* ---------- one person's AI questions today (ask.js per-person daily limit) ----------
   id: a hash of "c:<client id>" or "i:<ip>". Read-modify-write (no atomic add): two instances
   counting at the same moment can lose one count, which only makes the limit a little loose. */
const personLocal = new Map();   // "u:<day>:<id>" -> count
export async function personCount(day, id){
  const k = "u:"+day+":"+id;
  const s = await sharedGet(k);
  return Math.max(personLocal.get(k) || 0, Number(s) || 0);
}
export async function personAdd(day, id){
  const k = "u:"+day+":"+id;
  const n = (await personCount(day, id)) + 1;
  personLocal.set(k, n);
  if(personLocal.size > 20000) for(const key of personLocal.keys()){ if(!key.startsWith("u:"+day+":")) personLocal.delete(key); }
  await sharedSet(k, n, 26*3600, ["felipe", "felipe-quota"]);
  return n;
}

/* ---------- the day's count of AI questions (FELIPE_DAILY_CAP) ----------
   One count per question that reached at least one AI provider (a question whose first model
   says 429 and second answers counts once; it is a question count, not a billing count).
   Runtime Cache has no atomic add, so each instance writes its own running total into one of
   8 shard maps ({ instanceId: count }). A lost write heals on that instance's next call, since
   it always writes its whole total. The sum is read at most every 10 s. */
const SHARDS = 8, myShard = ()=> parseInt(INSTANCE_ID.slice(0, 6), 16) % SHARDS;
let localDay = "", localCount = 0, sumCache = { day:"", at:0, others:0 }, flushing = Promise.resolve();
export function countCall(day){
  if(day !== localDay){ localDay = day; localCount = 0; }
  localCount++;
  const mine = localCount;
  flushing = flushing.then(async ()=>{
    const k = "n:"+day+":"+myShard();
    const cur = (await sharedGet(k)) || {};
    if((cur[INSTANCE_ID] || 0) >= mine) return;
    cur[INSTANCE_ID] = mine;
    await sharedSet(k, cur, 26*3600, ["felipe", "felipe-quota"]);
  }).catch(()=>{});
  return flushing;
}
export async function callsToday(day){
  const mine = day === localDay ? localCount : 0;
  if(sumCache.day === day && Date.now() - sumCache.at < 10000) return sumCache.others + mine;
  let others = 0;
  const maps = await Promise.all(Array.from({ length: SHARDS }, (_, i)=> sharedGet("n:"+day+":"+i)));
  for(const m of maps) if(m && typeof m === "object") for(const id in m) if(id !== INSTANCE_ID) others += Number(m[id]) || 0;
  sumCache = { day, at: Date.now(), others };
  return others + mine;
}

/* For tests: forget this instance's memory (a fresh instance), keeping the shared layer. */
export function _resetLocalForTests(){
  lru.clear(); flights.clear(); exhaustedLocal.clear(); checkedAt.clear(); waits.clear(); personLocal.clear();
  INSTANCE_ID = randomBytes(5).toString("hex");
  localDay = ""; localCount = 0; sumCache = { day:"", at:0, others:0 }; failStreak = 0; offUntil = 0;
}
