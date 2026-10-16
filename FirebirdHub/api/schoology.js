/**
 * Schoology calendar for a signed-in student (Vercel serverless function).
 *
 * Every Schoology user has a private iCal link (Account Settings > Share your Schoology
 * Calendar > Enable). The link carries its own token, so it works without a Schoology login,
 * and it lists that student's assignments, quizzes and events from every course. Schoology
 * doesn't send CORS headers, so the app can't read it directly; this function fetches it,
 * parses it and returns the next 60 days as JSON.
 *
 * Privacy: the link comes in the POST body (never in a URL, so it never lands in logs) and is
 * not stored or logged here. The app keeps it only in that student's own browser.
 * Safety: only links shaped exactly like a Schoology calendar feed are fetched, so this can't
 * be used to fetch anything else. Reading a feed needs its secret link, which only its owner
 * has, so no extra auth is needed (the app still asks for a school Google sign-in first).
 *
 * Body: { feed: "webcal://fuhsd.schoology.com/calendar/feed/ical/<n>/<hex>/ical.ics" }
 * 200 { ok:true, items:[{id,title,type,date,time,allDay,start,url,desc}], fetchedAt }
 * 400 { ok:false, error:"bad-link" }   the text isn't a Schoology calendar link
 * 404 { ok:false, error:"dead-link" }  Schoology no longer accepts it (reset or disabled)
 * 502 { ok:false, error:"unreachable" } Schoology didn't answer; the app keeps its last copy
 */
const TZ = "America/Los_Angeles";
const ALLOWED_ORIGINS = ["https://firebirdhub.vercel.app", "https://app-sigma-woad-53.vercel.app"];
const FEED_RE = /^(?:webcal|https?):\/\/([a-z0-9-]+\.schoology\.com)(\/calendar\/feed\/ical\/\d{4,20}\/[0-9a-f]{16,64}\/ical\.ics)$/i;
const DAYS_AHEAD = 60;
const MAX_ITEMS = 150;
const MAX_BYTES = 3 * 1024 * 1024;
// Per warm instance, per IP: a speed bump only (each instance counts on its own).
const LIMIT_PER_MIN = 20;
const hits = new Map();

function allowedOrigin(o){
  if(!o) return false;
  if(ALLOWED_ORIGINS.includes(o)) return true;
  // Vercel preview deployments of this project.
  return /^https:\/\/app-[a-z0-9-]+-fremont-asb-tech\.vercel\.app$/.test(o);
}
function limited(ip){
  const now = Date.now(), list = (hits.get(ip) || []).filter(t => now - t < 60000);
  list.push(now); hits.set(ip, list);
  if(hits.size > 5000) hits.clear();
  return list.length > LIMIT_PER_MIN;
}

// "webcal://…", "http://…" or "https://…" with stray spaces or quotes → the https URL, or "".
function normalizeFeed(raw){
  const s = String(raw || "").trim().replace(/^["'<]+|["'>]+$/g, "");
  const m = s.match(FEED_RE);
  return m ? "https://" + m[1].toLowerCase() + m[2] : "";
}

/* ---------- iCal parsing (RFC 5545, the parts Schoology uses) ---------- */
function unfold(text){ return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, ""); }
function unescapeText(v){
  return v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
}
// Schoology writes descriptions with *bold* markers, footnote links and a trailing
// " - Link: http://…" line. Keep a short plain-text summary.
function cleanDesc(v){
  let s = unescapeText(v)
    .replace(/\s*-\s*Link:\s*https?:\/\/\S+\s*$/i, "")
    .replace(/\[\d+\]\s*https?:\/\/\S+/g, "")
    .replace(/\[\d+\]/g, "")
    .replace(/\*/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if(s.length > 220) s = s.slice(0, 217).replace(/\s+\S*$/, "") + "…";
  return s;
}
const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false
});
function ptParts(d){
  const p = {}; partsFmt.formatToParts(d).forEach(x => { p[x.type] = x.value; });
  return { date: p.year + "-" + p.month + "-" + p.day, hh: +p.hour % 24, mm: +p.minute };
}
function fmtTime(hh, mm){
  const h12 = hh % 12 || 12;
  return h12 + ":" + String(mm).padStart(2, "0") + " " + (hh < 12 ? "AM" : "PM");
}
// DTSTART;VALUE=DATE:20261020  or  DTSTART;VALUE=DATE-TIME:20261021T065900Z (or local TZID).
function parseStart(params, val){
  let m = val.match(/^(\d{4})(\d{2})(\d{2})$/);
  if(m || /VALUE=DATE(?!-)/i.test(params)){
    m = m || val.match(/^(\d{4})(\d{2})(\d{2})/);
    if(!m) return null;
    const date = m[1] + "-" + m[2] + "-" + m[3];
    return { allDay: true, date, time: "", start: date };
  }
  m = val.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if(!m) return null;
  let d;
  if(m[7] === "Z") d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  else {
    // Floating or TZID time: Schoology uses the school's zone, so read it as Pacific.
    const guess = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
    const p = ptParts(guess);
    const shownUTC = Date.UTC(+p.date.slice(0, 4), +p.date.slice(5, 7) - 1, +p.date.slice(8, 10), p.hh, p.mm);
    d = new Date(guess.getTime() + (guess.getTime() - shownUTC));
  }
  const p = ptParts(d);
  return { allDay: false, date: p.date, time: fmtTime(p.hh, p.mm), start: d.toISOString() };
}
function typeOf(url){
  const m = String(url || "").match(/schoology\.com\/(assignment|assessment|assessments|discussion|event|page|course|group)\b/i);
  const k = m ? m[1].toLowerCase() : "";
  if(k === "assignment") return "assignment";
  if(k === "assessment" || k === "assessments") return "quiz";
  if(k === "discussion") return "discussion";
  return "event";
}
function parseICS(text){
  const out = [];
  let cur = null;
  unfold(text).split("\n").forEach(line => {
    if(line === "BEGIN:VEVENT"){ cur = {}; return; }
    if(line === "END:VEVENT"){ if(cur) out.push(cur); cur = null; return; }
    if(!cur) return;
    const i = line.indexOf(":"); if(i < 0) return;
    const head = line.slice(0, i), val = line.slice(i + 1);
    const name = head.split(";")[0].toUpperCase(), params = head.slice(name.length);
    if(name === "SUMMARY") cur.title = unescapeText(val).replace(/\s+/g, " ").trim();
    else if(name === "DESCRIPTION") cur.desc = cleanDesc(val);
    else if(name === "URL") cur.url = val.trim();
    else if(name === "UID") cur.uid = val.trim();
    else if(name === "DTSTART") cur.when = parseStart(params, val.trim());
  });
  return out;
}

function upcoming(events){
  const today = ptParts(new Date()).date;
  const last = ptParts(new Date(Date.now() + DAYS_AHEAD * 86400000)).date;
  const seen = new Set();
  return events
    .filter(e => e.when && e.title && e.when.date >= today && e.when.date <= last)
    .map(e => {
      const url = /^https?:\/\/[a-z0-9-]+\.schoology\.com\//i.test(e.url || "") ? e.url.replace(/^http:/i, "https:") : "";
      const id = (String(e.uid || "").match(/(\d{5,})/) || [])[1] || (e.title + e.when.start);
      return { id, title: e.title.slice(0, 200), type: typeOf(url), date: e.when.date, time: e.when.time,
        allDay: e.when.allDay, start: e.when.start, url, desc: e.desc || "" };
    })
    .filter(e => (seen.has(e.id) ? false : (seen.add(e.id), true)))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.allDay === b.allDay ? (a.start < b.start ? -1 : 1) : (a.allDay ? -1 : 1))))
    .slice(0, MAX_ITEMS);
}

async function fetchFeed(url){
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try{
    const r = await fetch(url, { signal: ctrl.signal, redirect: "manual",
      headers: { "User-Agent": "FirebirdHub/1.0 (+https://firebirdhub.vercel.app)", "Accept": "text/calendar" } });
    // A reset link answers 404/403 or bounces to the login page.
    if(r.status === 404 || r.status === 403 || r.status === 410 || (r.status >= 300 && r.status < 400)) return { dead: true };
    if(!r.ok) return { fail: true };
    const text = await r.text();
    if(text.length > MAX_BYTES) return { fail: true };
    if(!/^\s*BEGIN:VCALENDAR/.test(text)) return { dead: true };
    return { text };
  } catch(e){
    return { fail: true };
  } finally { clearTimeout(timer); }
}

export default async function handler(req, res){
  res.setHeader("Vary", "Origin");
  res.setHeader("Cache-Control", "no-store");
  if(allowedOrigin(req.headers.origin)){
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if(req.method === "OPTIONS"){ res.status(204).end(); return; }
  if(req.method !== "POST"){ res.status(405).json({ ok: false, error: "POST only" }); return; }
  if(req.headers.origin && !allowedOrigin(req.headers.origin)){ res.status(403).json({ ok: false, error: "origin" }); return; }
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "?";
  if(limited(ip)){ res.setHeader("Retry-After", "60"); res.status(429).json({ ok: false, error: "busy" }); return; }

  let body = req.body;
  if(typeof body === "string"){ try{ body = JSON.parse(body); }catch(e){ body = {}; } }
  const url = normalizeFeed(body && body.feed);
  if(!url){ res.status(400).json({ ok: false, error: "bad-link" }); return; }

  const got = await fetchFeed(url);
  if(got.dead){ res.status(404).json({ ok: false, error: "dead-link" }); return; }
  if(got.fail){ res.status(502).json({ ok: false, error: "unreachable" }); return; }
  const all = parseICS(got.text);
  res.status(200).json({ ok: true, total: all.length, items: upcoming(all), fetchedAt: new Date().toISOString() });
}

// For local tests.
export { normalizeFeed, parseICS, upcoming };
