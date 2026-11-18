/**
 * Ask Felipe: the school-life assistant in Firebird Hub (Vercel serverless function).
 *
 * POST JSON { question, history:[{role:"user"|"model", text}], lang:"en"|"es", stream:true|false,
 *             context?: { assignments?: [{ title, type, due, desc, url }] } }
 *  - stream:true  -> text/event-stream: "data: {"t":"delta","text":"..."}" lines, then
 *                    "data: {"t":"done","route":"..."}". When no answer could be made, a
 *                    "data: {"t":"error","text":"<friendly message>"}" comes before done.
 *  - stream:false (or an old client sending only {question, history}) -> JSON { answer }, or
 *                    { answer, fallback:true } for the friendly fallback messages.
 * Debug headers, only when the FELIPE_DEBUG_HEADERS=1 env var is set (the eval dev server sets
 * it; production does not): x-felipe-route (what the classifier said: local|llm|cannot|crisis;
 * "llm" whenever Gemini was called), x-felipe-answered-by (llm|canned|fallback),
 * x-felipe-intent, x-felipe-prompt-chars (system prompt plus contents, 0 when Gemini is not
 * called) and x-felipe-sections (the data sections sent).
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
 * The GEMINI_API_KEY lives only here (a server-side Vercel env var on the app project) and
 * is sent only in the x-goog-api-key header. Questions, history and assignments are never
 * logged or stored. Assignments are the student's own Schoology items for one question;
 * they are validated and fenced as untrusted data (_felipe/input.js).
 */
import { classify, cannotReply, crisisReply, intentSections } from "./_felipe/core.js";
import { nowPT, todayLines } from "./_felipe/calendar.js";
import { buildLive, pickSections, prewarm } from "./_felipe/context.js";
import { askGemini, noEmDash, dashFilter } from "./_felipe/gemini.js";
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
//  - 60 Gemini questions a minute in total;
//  - every request, canned replies included: 60 a minute per IP.
// Wellbeing questions are never limited: a student who is struggling always gets an answer.
const LIMIT = { userPerMin: 10, userPerHour: 80, ipPerMin: 40, ipPerHour: 400, globalPerMin: 60, anyPerMin: 60 };
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
// Gemini questions. Returns 0 when the question may go ahead (and counts it), else seconds to wait.
function rateLimited(ip, cid){
  const now = Date.now();
  allHits = allHits.filter(t=> now-t < 60000);
  const user = cid ? "c:"+cid : "i:"+ip;
  let wait = Math.max(userHits.check(user, LIMIT.userPerMin, LIMIT.userPerHour), ipHits.check(ip, LIMIT.ipPerMin, LIMIT.ipPerHour));
  if(allHits.length >= LIMIT.globalPerMin) wait = Math.max(wait, Math.ceil((allHits[0]+60000-now)/1000));
  if(wait > 0) return wait;
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
    if(DEBUG_HEADERS) res.setHeader("Access-Control-Expose-Headers", "x-felipe-route, x-felipe-answered-by, x-felipe-intent, x-felipe-prompt-chars, x-felipe-sections");
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
  const failText = ok=> wellbeing ? msg.support : (ok ? msg.empty : msg.error);

  // 2. Guards for questions that cost a Gemini call.
  const wait = wellbeing ? 0 : rateLimited(ip, cid);
  if(wait){
    res.setHeader("Retry-After", String(wait)); dbg("x-felipe-prompt-chars", "0"); dbg("x-felipe-answered-by", "fallback");
    replyNow(res, stream, msg.busy, { fallback:true, status: stream ? 200 : 429, wait }); return;
  }
  const key = process.env.GEMINI_API_KEY;
  if(!key){ dbg("x-felipe-prompt-chars", "0"); dbg("x-felipe-answered-by", "fallback"); replyNow(res, stream, wellbeing ? msg.support : msg.noKey, { fallback:!wellbeing, route: wellbeing ? "llm" : undefined }); return; }

  let send = null;
  try{
    // 3. Only the data this question needs.
    const now = nowPT();
    const prevUser = (turns.filter(t=> t.role==="user").pop() || {}).text || "";
    const short = q.split(/\s+/).length <= 6;
    const sections = pickSections(cls.intent, q, prevUser, intentSections(cls.intent));
    if(assignments.length) sections.add("assignments");
    // FelipeCore merges a short follow-up with the last question ("next soccer game? Girls").
    const topicText = cls.resolved || (short && prevUser ? prevUser+" "+q : q);
    const live = await buildLive(sections, now, topicText);
    if(gone.signal.aborted){ if(!res.writableEnded) res.end(); return; }
    const fence = fenceAssignments(assignments);
    const system = buildSystem({ sections, live:live.text, today:todayLines(now, sections.has("year")), lang, marker:fence.marker });
    const userParts = fence.text ? [{ text:fence.text }, { text:"Student's question: "+q }] : [{ text:q }];
    const contents = turns.map(t=> ({ role:t.role, parts:[{ text:t.text }] })).concat([{ role:"user", parts:userParts }]);
    const promptChars = system.length + contents.reduce((n,c)=> n + c.parts.reduce((m,p)=> m + p.text.length, 0), 0);
    dbg("x-felipe-route", "llm");
    dbg("x-felipe-prompt-chars", String(promptChars));
    dbg("x-felipe-sections", [...sections].join(",") || "none");
    const dataQ = ["sports","events","spirit","clubs","announcements","schedule"].some(k=> sections.has(k));
    const temperature = dataQ ? 0.3 : 0.6;

    // 4. Gemini.
    if(!stream){
      const out = await askGemini({ key, system, contents, temperature, signal:gone.signal });
      dbg("x-felipe-answered-by", out.text ? "llm" : "fallback");
      sendJson(res, 200, out.text ? { answer:noEmDash(out.text), route:"llm" } : { answer: failText(out.ok), fallback:!wellbeing });
      return;
    }
    dbg("x-felipe-answered-by", "llm");
    send = openStream(res);
    const df = dashFilter();
    const out = await askGemini({ key, system, contents, temperature, signal:gone.signal, onDelta: piece=>{ const s = df.push(piece); if(s) send({ t:"delta", text:s }); } });
    const tail = df.end();
    if(tail) send({ t:"delta", text:tail });
    if(!out.emitted){
      // A wellbeing question that Gemini blocked or couldn't answer still gets a kind reply.
      if(wellbeing) send({ t:"delta", text:msg.support });
      else send({ t:"error", text: failText(out.ok) });
    }
    // A stream that broke after some text keeps that text; partial tells the app it was cut.
    send({ t:"done", route:"llm", ...(out.emitted && !out.ok ? { partial:true } : {}) });
    res.end();
  }catch(e){
    if(send){ send(wellbeing ? { t:"delta", text:msg.support } : { t:"error", text:msg.error }); send({ t:"done" }); res.end(); }
    else if(!res.headersSent) sendJson(res, 200, { answer: wellbeing ? msg.support : msg.error, fallback:!wellbeing });
    else if(!res.writableEnded) res.end();
  }
}
