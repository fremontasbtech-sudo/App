/**
 * Ask Felipe: the school-life assistant in Firebird Hub (Vercel serverless function).
 *
 * POST JSON { question, history:[{role:"user"|"model", text}], lang:"en"|"es", stream:true|false,
 *             context?: { assignments?: [{ title, type, due, desc, url }] }, client?, v? }
 *  - stream:true  -> text/event-stream: "data: {"t":"delta","text":"..."}" lines, then
 *                    "data: {"t":"done","route":"..."}". When no answer could be made, a
 *                    "data: {"t":"error","text":"<friendly message>"}" comes before done.
 *  - stream:false (or an old client sending only {question, history}) -> JSON { answer }, or
 *                    { answer, fallback:true } for the friendly fallback messages.
 *  - An answer made from the data without AI carries source:"data" (in done, or in the JSON).
 *    Clients that send v:2 (the app since 2026-11-18) also get note:"<fuller answers are back
 *    soon>" there and show it themselves; older clients get that line at the end of the answer.
 * Debug headers, only when the FELIPE_DEBUG_HEADERS=1 env var is set (the eval dev server sets
 * it; production does not): x-felipe-route (what the classifier said: local|llm|cannot|crisis;
 * "llm" whenever Gemini was called), x-felipe-answered-by (llm|canned|fallback),
 * x-felipe-intent, x-felipe-prompt-chars (system prompt plus contents, 0 when Gemini is not
 * called) and x-felipe-sections (the data sections sent). Since 2026-11-18 answered-by can also
 * be "cache" or "data", with x-felipe-data-why (none|budget|busy|exhausted|blocked|failed).
 *
 * How it stays fast:
 *  - FelipeCore.classify (felipe-core.js, shared with the app) runs first. "cannot" and
 *    "crisis" get their reply at once, with no Gemini call. The app answers "local" questions
 *    itself; if one reaches the server it is treated as "llm".
 *  - Live data (Events, Sports, Spirit, clubs, announcements) is cached per warm instance,
 *    stale-while-revalidate, and prewarmed when the function loads (_felipe/context.js).
 *  - Only the data sections the question needs are sent, plus a short "next 3 weeks" digest.
 *  - Gemini streams (streamGenerateContent, SSE), so the first words show quickly.
 *
 * How it lasts for 1,000 students on free or cheap quotas (2026-11-18):
 *  - Shared answer cache (_felipe/store.js): self-contained general questions (not a follow-up,
 *    no Schoology items, nothing personal) are answered without the chat history, once, and
 *    reused: up to 6 hours for stable topics (clubs, results, app help), 2 hours for events,
 *    30 minutes otherwise, 5 to 10 minutes when time-sensitive. The key is the normalized
 *    question, intent, language, date and a hash of the live data, so a sheet edit makes a new
 *    key. An answer from a backup provider (not Gemini) is kept 5 minutes. Identical questions asked at the
 *    same moment share one call.
 *  - Provider router (_felipe/providers.js): Gemini models in order, then Groq, Cerebras and
 *    OpenRouter when their keys are set. A model that answers 429 is skipped by every instance
 *    until its quota resets.
 *  - Never dead (_felipe/dataanswer.js): with every provider out, or past FELIPE_DAILY_CAP AI
 *    questions in a day, or past one person's daily limit, questions about events, games,
 *    clubs, announcements, spirit and the schedule are answered straight from the data. When
 *    every model is already known to be out, data answers skip the per-minute limits.
 *
 * The GEMINI_API_KEY lives only here (a server-side Vercel env var on the app project) and
 * is sent only in the x-goog-api-key header. Questions, history and assignments are never
 * logged. Only answers to self-contained general questions are kept, in the shared cache
 * above, under a hash (the question text itself is not stored). Assignments are the student's
 * own Schoology items for one question; they are validated and fenced as untrusted data
 * (_felipe/input.js), and a question with Schoology items or chat history goes to Gemini only.
 */
import { classify, cannotReply, crisisReply, intentSections, normText } from "./_felipe/core.js";
import { nowPT, todayLines } from "./_felipe/calendar.js";
import { buildLive, pickSections, prewarm, trimLive } from "./_felipe/context.js";
import { noEmDash, dashFilter } from "./_felipe/gemini.js";
import { askAI, providerList, allOutNow } from "./_felipe/providers.js";
import { dataAnswer, BACK_SOON } from "./_felipe/dataanswer.js";
import { hash, getAnswer, putAnswer, joinFlight, startFlight, ride, markPending, clearPending, pendingElsewhere, waitForAnswer, countCall, callsToday, personCount, personAdd } from "./_felipe/store.js";
import { buildSystem } from "./_felipe/prompt.js";
import { cleanQuestion, cleanLang, cleanTurns, cleanHistory, cleanAssignments, fenceAssignments, cleanClientId } from "./_felipe/input.js";

// Start loading every source as soon as the instance starts (not in local tests that opt out).
if(!process.env.FELIPE_NO_PREWARM) prewarm();

// Browsers may call from the app's own domains (or the same deployment, e.g. a preview URL).
// Requests with no Origin header (same-origin GETs, server-to-server) pass; the limiter
// below still applies to them, since an Origin check alone can't stop a script.
const ALLOWED_ORIGINS = ["https://firebirdhub.vercel.app", "https://app-sigma-woad-53.vercel.app"];
// Per warm instance (each instance counts on its own, so these are speed bumps; the real caps
// belong in the dashboards: a Vercel Firewall rate-limit rule on /api/ask and a quota cap on
// the Gemini key):
//  - per student (the app's random per-browser id, or the IP when there is none):
//    10 Gemini questions a minute and 80 an hour;
//  - per IP, looser, because a whole school network or a phone carrier can share one IP:
//    40 a minute and 400 an hour;
//  - 60 new AI calls a minute in total (past that, answers come from the data; students
//    joining an identical question already being answered don't count);
//  - every request, canned replies included: 60 a minute per IP.
// Shared by every instance (Runtime Cache), per Pacific day: 40 AI questions per student id
// and 400 per IP (FELIPE_PERSON_DAILY, FELIPE_IP_DAILY), so one script can't use up the whole
// school's FELIPE_DAILY_CAP. Past it, questions are answered from the data. If the shared cache
// is down these counts, like FELIPE_DAILY_CAP, are per instance only (they fail open).
// Wellbeing questions skip the per-minute limits; past the daily limit they get the kind
// support message instead of AI, never a refusal.
const LIMIT = { userPerMin: 10, userPerHour: 80, ipPerMin: 40, ipPerHour: 400, globalPerMin: 60, anyPerMin: 60 };
const PERSON_DAILY = ()=> Number(process.env.FELIPE_PERSON_DAILY) || 40;
const IP_DAILY = ()=> Number(process.env.FELIPE_IP_DAILY) || 400;
const DEBUG_HEADERS = process.env.FELIPE_DEBUG_HEADERS === "1";

// Same wording as the app's I18N_EN_ES entries, so old clients (no lang) still get Spanish there.
const MSG = {
  en: {
    noKey: "Ask Felipe isn't set up yet. For now, please check the Schedule, Clubs, Sports and More tabs.",
    busy: "Felipe needs a short break. Please wait a minute and ask again, or check the Schedule, Clubs and Sports tabs in the meantime.",
    empty: "I couldn't answer that one. Try asking about the bell schedule, clubs, events or sports.",
    error: "Felipe is having a moment. Please try again in a bit, or check the Schedule, Clubs and Sports tabs.",
    // For wellbeing questions, when Gemini can't answer: never a dead end.
    support: "I'm sorry you're dealing with this, and I'm glad you asked. The school counselors are a great person to talk to, and a trusted adult can help too. If things ever feel like too much, you can call or text 988 any time."
  },
  es: {
    noKey: "Pregúntale a Felipe todavía no está listo. Por ahora, revisa las pestañas Horario, Clubes, Deportes y Más.",
    busy: "Felipe necesita un breve descanso. Espera un minuto y vuelve a preguntar, o mientras tanto revisa las pestañas Horario, Clubes y Deportes.",
    empty: "No pude responder esa pregunta. Intenta preguntar sobre el horario de campanas, los clubes, los eventos o los deportes.",
    error: "Felipe tiene un pequeño problema en este momento. Inténtalo de nuevo en un rato, o revisa las pestañas Horario, Clubes y Deportes.",
    support: "Siento que estés pasando por esto, y me alegra que preguntes. Los consejeros de la escuela son muy buenas personas para hablar, y un adulto de confianza también puede ayudarte. Si alguna vez sientes que es demasiado, puedes llamar o enviar un mensaje de texto al 988 en cualquier momento."
  }
};

/* ---------- abuse guards ---------- */
function originOk(req){
  const o = req.headers.origin;
  if(!o) return true;
  if(ALLOWED_ORIGINS.includes(o)) return true;
  try{ return new URL(o).host === String(req.headers["x-forwarded-host"] || req.headers.host || ""); }catch(e){ return false; }
}
function clientIp(req){
  const h = req.headers;
  return String(h["x-vercel-forwarded-for"] || h["x-forwarded-for"] || h["x-real-ip"] || (req.socket && req.socket.remoteAddress) || "unknown").split(",")[0].trim();
}
// Sliding windows of timestamps, per key.
function windowCounter(){
  const m = new Map();
  return {
    // Seconds to wait if adding one more would pass a limit (0 = fine), without counting it.
    check(key, perMin, perHour){
      const now = Date.now(), list = (m.get(key)||[]).filter(t=> now-t < 3600000);
      m.set(key, list);
      const lastMin = list.filter(t=> now-t < 60000);
      let wait = 0;
      if(perMin && lastMin.length >= perMin) wait = Math.max(wait, lastMin[0]+60000-now);
      if(perHour && list.length >= perHour) wait = Math.max(wait, list[0]+3600000-now);
      return Math.ceil(wait/1000);
    },
    add(key){
      const now = Date.now(), list = m.get(key) || [];
      list.push(now); m.set(key, list);
      if(m.size > 5000) for(const [k,v] of m){ if(!v.length || now-v[v.length-1] >= 3600000) m.delete(k); }
    }
  };
}
const userHits = windowCounter(), ipHits = windowCounter(), anyHits = windowCounter();
let allHits = [];   // every Gemini question in the last minute
// Every request: a loose cap per IP, canned replies included. Returns seconds to wait or 0.
function requestLimited(ip){
  const w = anyHits.check(ip, LIMIT.anyPerMin, 0);
  if(!w) anyHits.add(ip);
  return w;
}
// AI questions. Returns 0 when the question may go ahead (and counts it), else seconds to wait.
// globalFull() says the instance-wide cap is the reason (then the student gets a data answer,
// since it isn't their fault), as opposed to their own or their network's limit.
function rateLimited(ip, cid){
  const now = Date.now();
  allHits = allHits.filter(t=> now-t < 60000);
  const user = cid ? "c:"+cid : "i:"+ip;
  const wait = Math.max(userHits.check(user, LIMIT.userPerMin, LIMIT.userPerHour), ipHits.check(ip, LIMIT.ipPerMin, LIMIT.ipPerHour));
  if(wait > 0) return wait;
  if(allHits.length >= LIMIT.globalPerMin) return -1;
  userHits.add(user); ipHits.add(ip); allHits.push(now);
  return 0;
}

/* ---------- replies (work on Vercel's res and on a plain Node res) ---------- */
function sendJson(res, code, obj){
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}
function openStream(res){
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  if(typeof res.flushHeaders === "function") res.flushHeaders();
  return obj=> { if(!res.writableEnded) res.write("data: "+JSON.stringify(obj)+"\n\n"); };
}
// A complete reply with no Gemini call (canned or fallback), in either mode.
function replyNow(res, stream, text, extra){
  const e = extra || {};
  if(!stream){ sendJson(res, e.status || 200, { answer:text, ...(e.fallback ? { fallback:true } : {}), ...(e.route ? { route:e.route } : {}), ...(e.wait ? { retryAfter:e.wait } : {}) }); return; }
  const send = openStream(res);
  if(e.fallback) send({ t:"error", text, ...(e.wait ? { wait:e.wait } : {}) });
  else send({ t:"delta", text });
  send({ t:"done", ...(e.route ? { route:e.route } : {}) });
  res.end();
}

export { cleanHistory };
export default async function handler(req, res){
  // Stops the Gemini call (and any wait before it) when the student leaves.
  const gone = new AbortController();
  if(typeof res.on === "function") res.on("close", ()=>{ if(!res.writableEnded) gone.abort(); });
  const dbg = (k, v)=>{ if(DEBUG_HEADERS && !res.headersSent) res.setHeader(k, v); };
  res.setHeader("Vary", "Origin");
  if(!originOk(req)){ sendJson(res, 403, { error:"origin not allowed" }); return; }
  if(req.headers.origin){
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if(DEBUG_HEADERS) res.setHeader("Access-Control-Expose-Headers", "x-felipe-route, x-felipe-answered-by, x-felipe-intent, x-felipe-prompt-chars, x-felipe-sections, x-felipe-provider, x-felipe-data-why");
  }
  if(req.method === "OPTIONS"){ res.statusCode = 204; res.end(); return; }
  if(req.method !== "POST"){ sendJson(res, 405, { error:"POST only" }); return; }

  const ip = clientIp(req);
  const anyWait = requestLimited(ip);
  if(anyWait){ res.setHeader("Retry-After", String(anyWait)); sendJson(res, 429, { error:"too many requests" }); return; }

  let body = req.body;
  if(typeof body === "string"){ try{ body = JSON.parse(body.slice(0, 200000)); }catch(e){ body = {}; } }
  if(!body || typeof body !== "object") body = {};
  const q = cleanQuestion(body.question);
  if(!q){ sendJson(res, 400, { error:"missing question" }); return; }
  const stream = body.stream === true;
  let lang = cleanLang(body.lang);
  const cid = cleanClientId(body.client);
  const v2 = Number(body.v) >= 2;   // the client shows the "back soon" note itself
  const turns = cleanTurns(body.history);
  const ctxIn = body.context && typeof body.context === "object" && !Array.isArray(body.context) ? body.context : {};
  const assignments = cleanAssignments(ctxIn.assignments);

  // 1. Classify (the same rules the app runs before calling us).
  const cls = classify(q, { history: turns.map(t=> ({ role:t.role, text:t.text })), lang, now: new Date() });
  dbg("x-felipe-route", cls.route);
  dbg("x-felipe-intent", cls.intent || "none");
  // A question written in Spanish gets Spanish replies even from an old client that sends no lang.
  if(cls.lang === "es") lang = "es";
  else if(cls.route === "crisis" && cls.lang === "en") lang = "en";
  const msg = MSG[lang];
  if(cls.route === "crisis"){ dbg("x-felipe-prompt-chars", "0"); dbg("x-felipe-answered-by", "canned"); replyNow(res, stream, crisisReply(lang, cls.reason), { route:"crisis" }); return; }
  if(cls.route === "cannot"){ dbg("x-felipe-prompt-chars", "0"); dbg("x-felipe-answered-by", "canned"); replyNow(res, stream, cannotReply(cls.reason, lang), { route:"cannot" }); return; }
  // Struggling students always get an answer, even when Gemini can't give one.
  const wellbeing = cls.intent === "wellbeing";

  let send = null;
  // The stream opens with the first text, so the debug headers can say who answered.
  const sendSSE = obj=>{ if(!send) send = openStream(res); send(obj); };
  try{
    // 2. Only the data this question needs.
    const now = nowPT();
    const prevUser = (turns.filter(t=> t.role==="user").pop() || {}).text || "";
    // A follow-up borrows the last question's topic: FelipeCore's merged follow-ups ("next
    // soccer game? Girls") and short questions that point back ("where is it?", "and JV?").
    // A new question that happens to be short ("When are color guard auditions?") stands alone.
    const pointsBack = !!prevUser && isPointingBack(q);
    const followUp = !!(cls.followUp || cls.resolved) || pointsBack;
    const sections = pickSections(cls.intent, q, followUp ? prevUser : "", intentSections(cls.intent));
    if(assignments.length) sections.add("assignments");
    const topicText = cls.resolved || (pointsBack ? prevUser+" "+q : q);
    const live = await buildLive(sections, now, topicText);
    if(gone.signal.aborted){ if(!res.writableEnded) res.end(); return; }
    const fence = fenceAssignments(assignments);
    const today = todayLines(now, sections.has("year"));
    const system = buildSystem({ sections, live:live.text, today, lang, marker:fence.marker });
    const userParts = fence.text ? [{ text:fence.text }, { text:"Student's question: "+q }] : [{ text:q }];
    // 3a. The shared answer cache: self-contained general questions only. Those are answered
    //     without the chat history, so the kept answer fits every student who asks it.
    const key = cacheKey({ cls, q, lang, now, sections, liveText:live.text, followUp, assignments, hasHistory: turns.length > 0 });
    const sendTurns = key.key ? [] : turns;
    const contents = sendTurns.map(t=> ({ role:t.role, parts:[{ text:t.text }] })).concat([{ role:"user", parts:userParts }]);
    // A student's own Schoology items, and anything from earlier in the chat (which can hold
    // them or personal details), go only to Gemini (what the Privacy page describes).
    const only = (assignments.length || sendTurns.length || NO_CACHE_INTENTS.has(cls.intent) || PERSONAL_RE.test(q)) ? ["gemini"] : null;
    const promptChars = system.length + contents.reduce((n,c)=> n + c.parts.reduce((m,p)=> m + p.text.length, 0), 0);
    dbg("x-felipe-route", "llm");
    dbg("x-felipe-sections", [...sections].join(",") || "none");
    const dataQ = ["sports","events","spirit","clubs","announcements","schedule"].some(k=> sections.has(k));
    const temperature = dataQ ? 0.3 : 0.6;
    // Small-limit models get the compact rules, the question's own data first and the last 2 turns.
    const shrink = maxChars=>{
      const base = buildSystem({ sections, live:"", today, lang, marker:fence.marker, compact:true });
      const liveText = trimLive(live.parts, Math.max(800, maxChars - base.length - 120));
      return { system: buildSystem({ sections, live:liveText, today, lang, marker:fence.marker, compact:true }), contents: contents.slice(-3) };
    };

    // Answers made without AI (every provider out of quota or failing, or the day's budget used).
    const fromData = ()=> dataAnswer({ intent:cls.intent, text:topicText, lang, sections, data:live.data, now, assignments, note: !v2 });
    const replyData = why=>{
      dbg("x-felipe-prompt-chars", "0");
      if(wellbeing){ dbg("x-felipe-answered-by", "canned"); if(stream){ sendSSE({ t:"delta", text:msg.support }); sendSSE({ t:"done", route:"llm" }); res.end(); } else sendJson(res, 200, { answer:msg.support, route:"llm" }); return; }
      const d = fromData();
      if(d && d.kind === "data"){
        dbg("x-felipe-answered-by", "data"); dbg("x-felipe-data-why", why);
        const extra = { source:"data", ...(v2 ? { note: BACK_SOON[lang] } : {}) };
        if(stream){ sendSSE({ t:"delta", text:d.text }); sendSSE({ t:"done", route:"llm", ...extra }); res.end(); }
        else sendJson(res, 200, { answer:d.text, route:"llm", ...extra });
        return;
      }
      // No AI set up at all: the old "not set up yet" note; otherwise "please try again later".
      // A blocked answer gets the plain "couldn't answer that one", never "try again later".
      const text = why === "none" ? msg.noKey : why === "blocked" ? msg.empty : (d ? d.text : msg.error);
      dbg("x-felipe-answered-by", "fallback");
      if(stream){ sendSSE({ t:"error", text }); sendSSE({ t:"done" }); res.end(); }
      else sendJson(res, 200, { answer:text, fallback:true });
    };

    // 3b. A kept answer.
    const replyCached = hit=>{
      dbg("x-felipe-prompt-chars", "0"); dbg("x-felipe-answered-by", "cache");
      if(stream){ sendSSE({ t:"delta", text:hit.text }); sendSSE({ t:"done", route:"llm" }); res.end(); }
      else sendJson(res, 200, { answer:hit.text, route:"llm" });
    };
    if(key.key){
      const hit = await getAnswer(key.key);
      if(hit){ replyCached(hit); return; }
    }

    // 4. Identical general questions asked at the same moment share one call: in this instance
    //    they join it, and another instance that is already answering it is waited for (up to
    //    8 s) instead of paying twice. Joining costs nothing, so it isn't rate limited.
    let joined = key.key ? joinFlight(key.key) : null;
    if(key.key && !joined && await pendingElsewhere(key.key)){
      const other = await waitForAnswer(key.key, 8000, gone.signal);
      if(gone.signal.aborted){ if(!res.writableEnded) res.end(); return; }
      if(other){ replyCached(other); return; }
      joined = joinFlight(key.key);
    }
    // 5. Guards for questions that cost an AI call.
    if(!joined){
      if(!providerList().length){ replyData("none"); return; }
      // Every model is already out of quota: answer from the data at once. No AI is called,
      // so the per-minute limits (and the day's budget) aren't used up by these answers.
      if(await allOutNow({ only })){ replyData("exhausted"); return; }
      const wait = wellbeing ? 0 : rateLimited(ip, cid);
      if(wait > 0){
        res.setHeader("Retry-After", String(wait)); dbg("x-felipe-prompt-chars", "0"); dbg("x-felipe-answered-by", "fallback");
        replyNow(res, stream, msg.busy, { fallback:true, status: stream ? 200 : 429, wait }); return;
      }
      if(wait < 0){ replyData("busy"); return; }
      if(await overBudget()){ replyData("budget"); return; }
      if(await overPersonLimit(ip, cid)){ replyData("limit"); return; }
    }
    const runAI = (signal, emit)=>{
      const df = dashFilter();
      return askAI({ system, contents, temperature, signal, shrink, only, onDelta: piece=>{ const s = df.push(piece); if(s) emit(s); } })
        .then(out=>{
          // The day's budget counts questions that reached a provider (not ones skipped because
          // every model was already out).
          if(out.attempts && out.attempts.length) countToday();
          const tail = df.end(); if(tail) emit(tail); return out;
        });
    };
    let out, full = "";
    const onPiece = piece=>{ full += piece; if(stream){ if(!res.headersSent){ dbg("x-felipe-answered-by", "llm"); dbg("x-felipe-prompt-chars", String(promptChars)); } sendSSE({ t:"delta", text:piece }); } };
    // 6. The AI, through the quota-aware router.
    if(key.key){
      const f = joined || joinFlight(key.key) || startFlight(key.key, async fl=>{
        markPending(key.key).catch(()=>{});
        try{
          const o = await runAI(fl.ctrl.signal, fl.emit);
          const text = fl.chunks.join("").trim();
          // Only complete answers are kept: never fallbacks, errors, a stream that broke or an
          // answer cut off by the length limit or a safety stop. An answer from a backup provider
          // (Groq, Cerebras, OpenRouter: other models, often a shorter prompt) is kept only 5
          // minutes, so Gemini's answer replaces it soon. Every Gemini model gets the full prompt.
          if(o.ok && text && /^stop$/i.test(String(o.finish || "")))
            await putAnswer(key.key, text, o.provider === "gemini" ? key.ttl : Math.min(key.ttl, BACKUP_TTL_S), o.id).catch(()=>{});
          return o;
        }catch(e){ return { text:"", ok:false, emitted:fl.chunks.length > 0 }; }
        finally{ clearPending(key.key).catch(()=>{}); }
      });
      const r = ride(f, onPiece);
      gone.signal.addEventListener("abort", r.leave, { once:true });
      out = await r.done;
    } else {
      out = await runAI(gone.signal, onPiece);
    }
    if(gone.signal.aborted && !full){ if(!res.writableEnded) res.end(); return; }
    dbg("x-felipe-provider", out.id || "none");
    if(!full){
      // Nothing reached the student: answer from the data instead of a dead end.
      replyData(out.allExhausted ? "exhausted" : out.blocked ? "blocked" : "failed"); return;
    }
    dbg("x-felipe-answered-by", "llm"); dbg("x-felipe-prompt-chars", String(promptChars));
    if(!stream){ sendJson(res, 200, { answer:noEmDash(full), route:"llm" }); return; }
    // A stream that broke after some text keeps that text; partial tells the app it was cut.
    // The debug "prov" field stands in for x-felipe-provider, which a stream can't send late.
    sendSSE({ t:"done", route:"llm", ...(!out.ok ? { partial:true } : {}), ...(DEBUG_HEADERS ? { prov: out.id || "none" } : {}) });
    res.end();
  }catch(e){
    if(send){ send(wellbeing ? { t:"delta", text:msg.support } : { t:"error", text:msg.error }); send({ t:"done" }); res.end(); }
    else if(!res.headersSent){
      if(stream){ sendSSE(wellbeing ? { t:"delta", text:msg.support } : { t:"error", text:msg.error }); sendSSE({ t:"done" }); res.end(); }
      else sendJson(res, 200, { answer: wellbeing ? msg.support : msg.error, fallback:!wellbeing });
    }
    else if(!res.writableEnded) res.end();
  }
}

/* ---------- follow-ups ---------- */
// A short question that points back at the chat ("where is it?", "and JV?", "what about
// tomorrow", "y el viernes?"). FelipeCore's classify() flags the fragment follow-ups it can
// merge (cls.followUp); this catches the rest, so they keep the chat history and are never cached.
// ("there" and "this" are left out: "is there school", "this week" stand on their own.)
const POINT_RE = /\b(it|its|that|those|these|them|they|he|she|him|her|one|ones|same|else|more|again|instead|then|ese|esa|eso|esos|esas|ello|ellos|ellas|alli|ahi|mismo|otra vez)\b/;
const LEAD_RE = /^(and|also|what about|how about|or|but|so|then|y|o|pero|que tal|tambien)\b/;
function isPointingBack(q){
  const n = normText(q), k = n.split(" ").filter(Boolean).length;
  if(!k) return false;
  return LEAD_RE.test(n) || (k <= 8 && POINT_RE.test(n)) || k <= 2;
}

/* ---------- the answer cache key ---------- */
// Questions that may carry personal details, and follow-ups, are never cached.
const NO_CACHE_INTENTS = new Set(["wellbeing", "writing", "assignments", "planning"]);
const PERSONAL_RE = /@|\d{3}[-. )]*\d{3}[-. ]*\d{4}|\b(my name|i am|i'm|im|me llamo|soy|my (mom|dad|mother|father|parents?|friend|teacher|counselor|boyfriend|girlfriend|brother|sister|grade|grades))\b/i;
// Time-sensitive questions: right-now ones change every few minutes, today ones every hour.
// "What's next period" and "how long until lunch" count as right-now ones.
const NOW_INTENTS = new Set(["period_now", "time_left", "next_event", "next_game", "bell_time"]);
const TODAY_INTENTS = new Set(["day_type", "school_on", "schedule", "announcements_today"]);
const NOW_RE = /\b(right now|now|currently|this period|next period|until|left|how long|how much longer|soon|ahora|ahorita|falta|faltan|cuanto falta|siguiente periodo|proximo periodo)\b/i;
const TODAY_RE = /\b(today|tonight|this morning|this afternoon|this evening|later|hoy|esta noche|esta tarde|mas tarde)\b/i;
// Topics whose answers only change when the data does (and the live-data hash is in the key):
// kept up to 6 hours. Events get 2 hours (an event later today can pass). Never past midnight,
// since the date is in the key too.
const LONG_INTENTS = new Set(["clubs", "sports", "spirit", "spirit_standings", "app_help", "capabilities", "guidance"]);
const EVENT_INTENTS = new Set(["events", "announcements"]);
const NEXT_RE = /\b(next|upcoming|coming up|this week|weekend|tomorrow|proximo|proxima|siguiente|esta semana|fin de semana|manana)\b/i;
const CACHE_TTL_S = 30*60, TODAY_TTL_S = 10*60, NOW_TTL_S = 5*60, BACKUP_TTL_S = 5*60;
const longTtl = ()=> Math.max(0, Number(process.env.FELIPE_CACHE_HOURS === undefined ? 6 : process.env.FELIPE_CACHE_HOURS) || 0) * 3600;
function cacheKey({ cls, q, lang, now, sections, liveText, followUp, assignments, hasHistory }){
  if(process.env.FELIPE_CACHE === "0") return { key:"" };
  // Any earlier turn in the chat means the question may lean on it ("who is the advisor?" after a
  // club question), so it is answered with the history and never shared.
  if(hasHistory || followUp || assignments.length || NO_CACHE_INTENTS.has(cls.intent) || PERSONAL_RE.test(q)) return { key:"" };
  const text = normText(q);
  if(!text || text.length > 200) return { key:"" };
  let bucket = "", ttl = CACHE_TTL_S;
  if(NOW_INTENTS.has(cls.intent) || NOW_RE.test(text)){ bucket = "m"+Math.floor(now.min/5); ttl = NOW_TTL_S; }
  else if(TODAY_INTENTS.has(cls.intent) || TODAY_RE.test(text)){ bucket = "h"+Math.floor(now.min/60); ttl = TODAY_TTL_S; }
  else if(!NEXT_RE.test(text) && LONG_INTENTS.has(cls.intent)) ttl = Math.max(CACHE_TTL_S, longTtl());
  else if(!NEXT_RE.test(text) && EVENT_INTENTS.has(cls.intent)) ttl = Math.max(CACHE_TTL_S, Math.min(2*3600, longTtl()));
  // Never past midnight Pacific (the key's date changes then anyway).
  ttl = Math.max(60, Math.min(ttl, (24*60 - now.min)*60));
  return { key: hash([text, cls.intent || "", lang, now.iso, bucket, [...sections].sort().join(","), hash(liveText, 12)].join("|")), ttl };
}

/* ---------- the day's budget (FELIPE_DAILY_CAP) and each person's daily limit ---------- */
// The real date, not a test clock: the budget is about real spending.
const realDay = ()=> nowPT(new Date(Date.now())).iso;
// Over the per-student or per-IP daily limit? If not, counts this question for both.
// Ids are SHA-256 hashes, never the address or the client id itself.
async function overPersonLimit(ip, cid){
  const day = realDay();
  const ids = [["i"+hash("ip:"+ip, 20), IP_DAILY()]];
  if(cid) ids.push(["c"+hash("cid:"+cid, 20), PERSON_DAILY()]);
  try{
    const counts = await Promise.all(ids.map(([id])=> personCount(day, id)));
    if(counts.some((n, i)=> n >= ids[i][1])) return true;
    await Promise.all(ids.map(([id])=> personAdd(day, id)));
  }catch(e){}
  return false;
}
function countToday(){ if(Number(process.env.FELIPE_DAILY_CAP) > 0) countCall(realDay()).catch(()=>{}); }
async function overBudget(){
  const cap = Number(process.env.FELIPE_DAILY_CAP) || 0;
  if(cap <= 0) return false;
  try{ return (await callsToday(realDay())) >= cap; }catch(e){ return false; }
}
