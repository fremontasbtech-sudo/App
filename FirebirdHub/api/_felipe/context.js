/**
 * Ask Felipe: live data, cached per warm instance, stale-while-revalidate.
 *
 * Sources (all public through the ASB website; the Events sheet itself is private):
 *   events, sports, spirit  https://www.fremontasb.org/api/sheet?tab=...  (CSV)
 *   clubs                   https://www.fremontasb.org/api/clubs (JSON), hedged with the
 *                           official clubs list as gviz CSV when the API is slow or down
 *   announcements           https://www.fremontasb.org/api/announcements (JSON)
 *
 * Caching: each source is parsed once per fetch and kept in module scope. A request never
 * waits on a fetch when any copy (up to 24 h old) exists: it uses that copy and refreshes in
 * the background once the copy is 5 minutes old (30 s between attempts while a source is
 * failing). Only a cold instance with no copy waits, at most COLD_WAIT_MS, and only for the
 * sources the question needs. prewarm() starts every fetch when the module loads.
 *
 * Sections are rebuilt per request from the parsed data (a few ms), so "today", "played"
 * and the 8:30 AM announcement reveal are always current. Only the sections the question
 * needs are sent to Gemini, plus a compact "next 3 weeks" digest.
 */
import { addDays, isoDate, timeMin, weekday, WD_SHORT, noClassBetween } from "./calendar.js";

const SITE = "https://www.fremontasb.org";
const SHEET = SITE + "/api/sheet?tab=";
const URLS = {
  events: SHEET + "Events",
  sports: SHEET + "Sports",
  spirit: SHEET + "Spirit%20Points",
  clubsApi: SITE + "/api/clubs",
  // Same fallback the app uses. Never add a cache-buster to gviz URLs.
  clubsSheet: "https://docs.google.com/spreadsheets/d/1IQo9QG0ubONWAeaZfwPQ2GJH7zpBr_QexsH9o0XTOLg/gviz/tq?tqx=out:csv&gid=0",
  announcements: SITE + "/api/announcements",
  // Band, orchestra, choir and theater calendar (public since 2026-11-18).
  arts: SHEET + "Performing%20Arts"
};
export const KEYS = ["events","sports","spirit","clubs","announcements","arts"];
const FRESH_MS = 5*60*1000, RETRY_MS = 30*1000, MAX_AGE_MS = 24*3600*1000;
// A cold instance waits at most 1.5 s for a source the question needs; the fetch keeps going in
// the background (up to 4.5 s), so the next question has the data even when this one didn't.
const FETCH_TIMEOUT_MS = 4500, COLD_WAIT_MS = 1500, DIGEST_WAIT_MS = 1200, CLUBS_HEDGE_MS = 1500;

/* ---------- parsing helpers ---------- */
export function parseCSV(text){
  const rows=[]; let row=[],cell="",q=false;
  for(let i=0;i<text.length;i++){ const c=text[i];
    if(q){ if(c==='"'&&text[i+1]==='"'){cell+='"';i++;} else if(c==='"')q=false; else cell+=c; }
    else if(c==='"')q=true;
    else if(c===","){row.push(cell);cell="";}
    else if(c==="\n"||c==="\r"){ if(c==="\r"&&text[i+1]==="\n")i++; row.push(cell);rows.push(row);row=[];cell=""; }
    else cell+=c;
  }
  if(cell.length||row.length){row.push(cell);rows.push(row);}
  return rows;
}
function reader(rows){
  const head = (rows[0]||[]).map(h=>String(h).trim().toLowerCase());
  return (r,names)=>{ for(const n of [].concat(names)){ const i=head.indexOf(n); if(i>=0) return String(r[i]||"").trim(); } return ""; };
}
const oneLine = s => String(s||"").replace(/\s+/g," ").trim();
const clip = (s,n) => { s = oneLine(s); return s.length>n ? s.slice(0,n-1).replace(/\s+\S*$/,"")+"..." : s; };
function sheetYes(v){ const t=String(v||"").trim().toLowerCase(); return t!=="" && (t==="y"||t==="yes"||t==="true"||t==="x"||t==="✓"||t==="1"||t==="done"||t.charAt(0)==="y"); }
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;   // never pass student emails to the model

// Fetch with a timeout. A non-200, or a 200 that's empty or an HTML page (a sign-in
// redirect, a filter), is a failure so it can never stand in for real data.
async function getText(u, ms){
  const r = await fetch(u, { signal: AbortSignal.timeout(ms || FETCH_TIMEOUT_MS) });
  if(!r.ok) throw new Error("HTTP "+r.status);
  const t = await r.text();
  if(!t.trim() || /^\s*</.test(t)) throw new Error("not data");
  return t;
}

/* ---------- parsers: raw text -> plain data ---------- */
const PARSE = {
  // Performing Arts tab: a title row, then the header (Push, Date, Day, Time, Event, Category,
  // Ensemble(s), Location, Important?, Notes). The header row is found by name.
  arts(text){
    const rows = parseCSV(text);
    const hi = rows.findIndex(r=> r.some(c=> /^date$/i.test(String(c).trim())) && r.some(c=> /^event$/i.test(String(c).trim())));
    if(hi < 0) throw new Error("no Performing Arts header");
    const col = reader(rows.slice(hi)), out = [];
    for(let i=hi+1;i<rows.length;i++){ const r=rows[i];
      const date = isoDate(col(r,"date")), name = oneLine(col(r,"event"));
      if(!date || !name) continue;
      // Notes are for the directors ("MR KELLY FLAGGED - ..."); keep only the useful part.
      const note = clip(String(col(r,"notes")).replace(/mr\.? kelly flagged\s*[-:]?\s*/i,"").replace(EMAIL_RE,""), 140);
      out.push({ date, name, time: oneLine(col(r,"time")), cat: oneLine(col(r,"category")), who: oneLine(col(r,["ensemble(s)","ensembles","ensemble"])),
        loc: oneLine(col(r,"location")), big: sheetYes(col(r,"important?")), note });
    }
    if(!out.length) throw new Error("no Performing Arts rows");
    return out;
  },
  events(text){
    const rows = parseCSV(text), col = reader(rows), out = [];
    for(let i=1;i<rows.length;i++){ const r=rows[i];
      const name = col(r,"name"), start = isoDate(col(r,"date")), end = isoDate(col(r,"enddate")) || start;
      if(!name || !start) continue;
      if(/^(no|n|false|0|hide|hidden|off|skip)$/i.test(col(r,"hide"))) continue; // same opt-out as the app
      out.push({ name, start, end, time:col(r,"time"), loc:col(r,"location"), desc:clip(col(r,"description"),180), featured:sheetYes(col(r,"featured")) });
    }
    return out;   // an empty Events tab is valid ("nothing listed")
  },
  sports(text){
    const rows = parseCSV(text), col = reader(rows), games = [];
    for(let i=1;i<rows.length;i++){ const r=rows[i];
      const sport = col(r,"sport"), date = isoDate(col(r,"date"));
      if(!sport || !date) continue;
      if(/rancho\s*san\s*antonio/i.test(r.join(" "))) continue; // XC practice spot, never an event
      const title = col(r,"title"), sn = col(r,"seniornight"), time = col(r,"time");
      const opp = col(r,"opponent").replace(/^\s*(vs\.?|at)\s+/i,"").trim();
      const level = col(r,"level"), ha = col(r,"homeaway");
      games.push({ sport, date, time, t:timeMin(time), level, ha, opp:/^opponent$/i.test(opp)?"":opp,
        loc:col(r,"location"), type:col(r,"type"), score:col(r,"score").replace(/[\u2013\u2014]/g,"-"), section:col(r,"section").toLowerCase(),
        senior: sheetYes(sn) || /senior\s*night/i.test(sn) || /senior\s*night/i.test(title),
        push: sheetYes(col(r,"push")),
        bell: /bell\s*game/i.test(title) || (/^football$/i.test(sport) && /varsity/i.test(level) && /homestead/i.test(opp)) });
    }
    if(!games.length) throw new Error("no games in Sports");
    return games;
  },
  spirit(text){
    const rows = parseCSV(text);
    // Same rule as the app's Spirit tab: the first row whose column A is the class name; its total is the sum of the row.
    const st = ["Seniors","Juniors","Sophomores","Freshmen"].map(cls=>{
      const r = rows.find(x=> String(x[0]||"").trim().toLowerCase()===cls.toLowerCase());
      if(!r) return null;
      const pts = r.slice(1).reduce((s,c)=>{ const n=Number(String(c).replace(/[^\d.-]/g,"")); return s+(Number.isFinite(n)?n:0); },0);
      return { cls, pts };
    }).filter(Boolean).sort((a,b)=> b.pts-a.pts);
    if(!st.length) throw new Error("no classes in Spirit Points");
    return st;
  },
  clubsApi(text){
    const data = JSON.parse(text);
    const cl = (data.clubs||[]).filter(c=> c && c.name && !c.disbanded)
      .map(c=> ({ name:oneLine(c.name), purpose:clip(String(c.purpose||"").replace(EMAIL_RE,""),150), advisor:oneLine(c.teacherAdvisor), meeting:clip(String(c.meetingInfo||"").replace(EMAIL_RE,""),90) }));
    if(!cl.length) throw new Error("no clubs");
    return cl;
  },
  clubsSheet(text){
    const rows = parseCSV(text), col = reader(rows), cl = [];
    for(let i=1;i<rows.length;i++){ const r=rows[i];
      const name = col(r,["club","name","club name"]); if(!name || /disband/i.test(name)) continue;
      // Only these 4 columns: the sheet also has student advisors and their emails.
      cl.push({ name:oneLine(name), purpose:clip(col(r,["club purpose","purpose","description"]).replace(EMAIL_RE,""),150),
        advisor:oneLine(col(r,["teacher advisor","advisor"])), meeting:clip(col(r,["meeting location & times","meeting location and times","meeting"]).replace(EMAIL_RE,""),90) });
    }
    if(!cl.length) throw new Error("no clubs");
    return cl;
  },
  announcements(text){
    const data = JSON.parse(text);
    const list = (Array.isArray(data.announcements)?data.announcements:[])
      .map(a=> ({ date:isoDate(a && a.date), title:oneLine(a && (a.title || a.xtitle)), text:clip(String((a && a.text) || "").replace(EMAIL_RE,"(email on the Home tab)"), 700) }))
      .filter(a=> a.date && (a.title || a.text));
    if(!list.length) throw new Error("no announcements");
    return list;
  }
};

/* ---------- the cache ---------- */
const state = {};   // key -> { data, at, inflight, lastTry }
for(const k of KEYS) state[k] = { data:null, at:0, inflight:null, lastTry:0 };

// Clubs: the website API first; if it hasn't answered in 1.5 s (or failed), the official
// list's gviz CSV races it, and the first good answer wins.
function fetchClubs(){
  return new Promise((resolve, reject)=>{
    let done = false, pending = 2, sheetStarted = false;
    const fail = ()=>{ if(--pending===0 && !done) reject(new Error("clubs unavailable")); };
    const win = d=>{ if(!done){ done = true; resolve(d); } };
    const startSheet = ()=>{ if(sheetStarted || done) return; sheetStarted = true;
      getText(URLS.clubsSheet).then(t=> win(PARSE.clubsSheet(t))).catch(fail); };
    getText(URLS.clubsApi).then(t=> win(PARSE.clubsApi(t))).catch(()=>{ startSheet(); fail(); });
    setTimeout(startSheet, CLUBS_HEDGE_MS);
    // If the API fails, pending drops to 1 and the sheet decides; if both fail, reject.
  });
}
async function fetchSource(k){
  if(k === "clubs") return fetchClubs();
  return PARSE[k](await getText(URLS[k]));
}
function refresh(k){
  const s = state[k];
  if(s.inflight) return s.inflight;
  s.lastTry = Date.now();
  s.inflight = fetchSource(k)
    .then(data=>{ s.data = data; s.at = Date.now(); return data; })
    .catch(()=> null)
    .finally(()=>{ s.inflight = null; });
  return s.inflight;
}
// Returns the parsed data for a source (or null when there is none). Never waits when a
// usable copy exists. A cold source is awaited up to waitMs (0: not at all).
async function getSource(k, waitMs){
  const s = state[k], now = Date.now(), age = now - s.at;
  if(s.data && age < MAX_AGE_MS){
    if(age >= FRESH_MS && !s.inflight && now - s.lastTry >= RETRY_MS) refresh(k);
    return s.data;
  }
  const p = (!s.inflight && now - s.lastTry < RETRY_MS && s.lastTry) ? Promise.resolve(null) : refresh(k);
  if(!waitMs) return null;
  let timer;
  return Promise.race([p, new Promise(r=>{ timer = setTimeout(()=> r(null), waitMs); })]).finally(()=> clearTimeout(timer));
}
export function prewarm(){ for(const k of KEYS) if(!state[k].data) refresh(k); }
export function cacheStatus(){ const o = {}; for(const k of KEYS) o[k] = state[k].data ? Math.round((Date.now()-state[k].at)/1000)+"s" : "none"; return o; }
export function _resetForTests(){ for(const k of KEYS) state[k] = { data:null, at:0, inflight:null, lastTry:0 }; }

/* ---------- choosing what the question needs ---------- */
const TOPIC_RE = {
  sports: /\b(games?|match(es)?|(track|swim|xc|cross country|dual|wrestling) meets?|scores?|won|win|wins|lost|lose|beat|vs\.?|versus|against|senior nights?|varsity|jv|frosh|team|sports?|athletics?|football|soccer|basketball|baseball|softball|volleyball|water ?polo|wrestl\w*|tennis|badminton|golf|swim\w*|div(e|ing)|track|cross ?country|xc|field hockey|hockey|lacrosse|cheer\w*|bell game|homestead|partidos?|juegos?|deportes?|equipos?|f[uú]tbol|baloncesto|b[aá]squetbol|b[eé]isbol|voleibol|nataci[oó]n|lucha|atletismo|tenis|marcador|gan(o|ó|amos)|perdi\w*)\b/i,
  events: /\b(events?|happening|rally|rallies|dance|formal|prom|homecoming|hoco|spirit week|social|fair|festival|night|show|play|concert|musical|theat(er|re)|tickets?|this week(end)?|next week|weekend|plans?|calendar|eventos?|baile|feria|fiesta|semana|obra|concierto|boletos?)\b/i,
  spirit: /\b(spirit|points?|standings?|leaderboard|ranking|winning|leading|ahead|which class|seniors|juniors|sophomores|freshmen|esp[ií]ritu|puntos|clasificaci[oó]n)\b/i,
  clubs: /\b(clubs?|join|advisor|officers?|club fair|clubs day|clubes?|unirme|asesor)\b/i,
  arts: /\b(concerts?|band|bands|orchestras?|choir|choral|theat(er|re)|drama|plays?|musical|marching|color guard|winter guard|percussion|pops|parade|recital|honor band|performing arts|music|pandemonium|one acts?|conciertos?|banda|orquesta|coro|obras?|teatro|desfile|m[uú]sica)\b/i,
  announcements: /\b(happening (?:at|during) (?:lunch|brunch|tutorial)|(?:at|during) (?:lunch|brunch) today|today at (?:lunch|brunch)|announcements?|announced|morning|ftv|news|bulletin|anything new|what'?s new|anuncios?|noticias)\b/i,
  schedule: /\b(periods?|bell|schedules?|lunch|brunch|tutorial|start|starts|end|ends|over|out|dismiss\w*|a ?day|b ?day|minimum day|late start|class(es)?|school (today|tomorrow)|no school|day off|days off|holiday|break|vacation|thanksgiving|winter break|spring break|today|tomorrow|monday|tuesday|wednesday|thursday|friday|horario|periodos?|almuerzo|clases?|escuela|hoy|ma[nñ]ana|vacaciones|feriado|lunes|martes|mi[eé]rcoles|jueves|viernes)\b/i,
  assignments: /\b(assignments?|homework|hw|due|quiz(zes)?|tests?|exams?|essays?|projects?|labs?|worksheets?|schoology|study|studying|summar\w*|deadline|tareas?|deberes|examen(es)?|ensayos?|proyectos?|estudiar|resum\w*|entrega)\b/i,
  year: /\b(day off|days off|holiday|break|vacation|no school|last day|first day|calendar|thanksgiving|winter break|spring break|summer|memorial|presidents|mlk|vacaciones|feriado|[uú]ltimo d[ií]a)\b/i
};
// Intent names come from FelipeCore.classify; any naming works, since they are matched by
// meaning (sport, event, club, ...), and the question's own words are checked too.
const INTENT_RE = {
  sports: /sport|game|meet|score|senior|athlet/i,
  events: /event|rally|dance|happen|week|plan/i,
  spirit: /spirit|standing|point/i,
  clubs: /club/i,
  arts: /event|happen|week|plan|arts|concert|music/i,
  announcements: /announce|news|ftv/i,
  schedule: /sched|bell|period|lunch|class|school|time|day|plan/i,
  assignments: /assign|homework|schoology|study|summar|due|quiz|test|plan/i,
  year: /no_?school|day_?off|holiday|break|calendar/i
};
// fromCore: FelipeCore.INTENT_SECTIONS[intent] ("digest" and "app" are always sent anyway).
export function pickSections(intent, question, prevUser, fromCore){
  const set = new Set();
  for(const k of fromCore || []) if(KEYS.includes(k) || k==="schedule" || k==="assignments" || k==="year") set.add(k);
  const text = String(question||"");
  for(const k in TOPIC_RE) if(TOPIC_RE[k].test(text)) set.add(k);
  if(intent) for(const k in INTENT_RE) if(INTENT_RE[k].test(intent)) set.add(k);
  // A short follow-up ("Girls", "what about Friday?") keeps the previous topic.
  if(prevUser && text.split(/\s+/).length <= 6) for(const k in TOPIC_RE) if(TOPIC_RE[k].test(prevUser)) set.add(k);
  // "Firebird Football" is a Homecoming spirit event, not a sport.
  if(/firebird football/i.test(text)){ set.add("events"); set.add("spirit"); }
  return set;
}

/* ---------- section builders ---------- */
const team = g=> g.sport+(g.level && !/^all$/i.test(g.level) ? " "+g.level : "");
const versus = g=> (/away/i.test(g.ha) ? "away at " : /home/i.test(g.ha) ? "home vs " : "vs ")+(g.opp||"opponent TBA");
const namedEvent = o=> /\b(finals?|invitational|invite|tournament|classic|championships?|ccs|cif|regionals?|duals|memorial)\b/i.test(o);
const matchup = g=> /cross country|track|swim|dive/i.test(g.sport) ? ("meet"+(g.opp?": "+g.opp:""))
  : /wrestl/i.test(g.sport) ? (/dual/i.test(g.type) ? "dual meet, "+versus(g) : (/tournament/i.test(g.type)?"tournament":"meet")+(g.opp?": "+g.opp:""))
  : namedEvent(g.opp) ? "event: "+g.opp
  : versus(g);
const gameLine = g=> WD_SHORT[weekday(g.date)]+" "+g.date+(g.time?", "+g.time:"")+": "+team(g)+", "+matchup(g)+(g.loc?", at "+g.loc:"")
  + (g.bell?". BELL GAME":"") + (g.senior?". SENIOR NIGHT":"") + (g.push?". FEATURED":"");
const byWhen = (a,b)=> a.date.localeCompare(b.date) || a.t-b.t || a.sport.localeCompare(b.sport);
const isPlayed = (g,now)=> g.section==="result" || !!g.score || g.date<now.iso || (g.date===now.iso && g.t<9999 && now.min>=g.t+180);

// Which sports a question names (English and Spanish), and boys/girls if it says.
const SPORT_WORDS = [
  [/\bflag ?football\b|f[uú]tbol de bandera/i, /^flag football$/i],
  [/(?<!flag |firebird )\bfootball\b|f[uú]tbol americano|bell game/i, /^football$/i],
  [/\bsoccer\b|\bf[uú]tbol\b(?! americano| de bandera)/i, /soccer/i],
  [/basketball|b-?ball|hoops|baloncesto|b[aá]squet/i, /basketball/i],
  [/volleyball|voleibol|v[oó]ley/i, /volleyball/i],
  [/water ?polo|waterpolo/i, /water polo/i],
  [/wrestl|lucha/i, /wrestl/i],
  [/tennis|tenis/i, /tennis/i],
  [/field hockey|hockey/i, /field hockey/i],
  [/cross ?country|\bxc\b|campo traviesa/i, /cross country/i],
  [/\btrack\b|atletismo/i, /track/i],
  [/swim|div(e|ing)\b|nataci[oó]n/i, /swim|dive/i],
  [/badminton|b[aá]dminton/i, /badminton/i],
  [/\bgolf\b/i, /golf/i],
  [/baseball|b[eé]isbol/i, /baseball/i],
  [/softball/i, /softball/i],
  [/lacrosse/i, /lacrosse/i]
];
function sportFilter(text){
  const pats = SPORT_WORDS.filter(w=> w[0].test(text)).map(w=> w[1]);
  const girls = /\b(girls?|women'?s?|ladies|chicas|ni[nñ]as|femenil|femenino)\b/i.test(text);
  const boys = /\b(boys?|men'?s?|chicos|ni[nñ]os|varonil|masculino)\b/i.test(text);
  return { pats, gender: girls && !boys ? "girls" : boys && !girls ? "boys" : "" };
}

function sportsSection(games, now, text){
  const f = sportFilter(text);
  let pool = games;
  let label = "";
  if(f.pats.length){
    pool = games.filter(g=> f.pats.some(p=> p.test(g.sport)));
    if(f.gender) pool = pool.filter(g=> !/^(boys|girls)\b/i.test(g.sport) || new RegExp("^"+f.gender,"i").test(g.sport));
    label = " (only the sports this question names)";
    if(!pool.length) return "SPORTS: the schedule has no games or meets for the sport this question names (it may be out of season or not listed yet). Say so and point to the Sports tab. Never guess.";
  }
  const horizon = addDays(now.iso,30), upcoming = pool.filter(g=>!isPlayed(g,now)).sort(byWhen);
  const per = f.pats.length ? 3 : 2;
  const perTeam = {}, next = [], later = {};
  upcoming.forEach(g=>{
    const k = (g.sport+"|"+g.level).toLowerCase();
    if(g.date<=horizon){ perTeam[k]=(perTeam[k]||0)+1; if(perTeam[k]<=per) next.push(g); }
    else if(!later[k]) later[k]=g;
  });
  const laterList = Object.keys(later).filter(k=>!perTeam[k]).map(k=>later[k]).sort(byWhen);
  const out = [];
  out.push("NEXT GAMES AND MEETS"+label+" (next 30 days, up to "+per+" per team, soonest first; FEATURED = a game ASB is promoting):\n"
    + (next.length ? next.map(g=>"- "+gameLine(g)).join("\n") : "- None in the next 30 days."));
  if(laterList.length) out.push("FIRST GAME FOR TEAMS WITH NOTHING IN THE NEXT 30 DAYS:\n"+laterList.slice(0,12).map(g=>"- "+gameLine(g)).join("\n"));
  const seniors = pool.filter(g=>g.senior).sort(byWhen);
  out.push("SENIOR NIGHTS"+label+" (this school year):\n"
    + (seniors.length ? seniors.map(g=>"- "+gameLine(g).replace(/\. SENIOR NIGHT/,"")+(isPlayed(g,now)?(". Already played"+(g.score?", score "+g.score:"")):"")).join("\n") : "- None are listed."));
  const resultLine = g=> "- "+WD_SHORT[weekday(g.date)]+" "+g.date+": "+team(g)+", "+matchup(g)+(g.bell?" (BELL GAME)":"")+", score "+g.score;
  if(f.pats.length){
    // A named sport: its latest posted results whatever their age (the Bell Game was weeks ago),
    // up to 3 per team, newest first.
    const played = pool.filter(g=>isPlayed(g,now) && g.score && g.date<=now.iso).sort((a,b)=>byWhen(b,a));
    const seen = {}, latest = played.filter(g=>{ const k=(g.sport+"|"+g.level).toLowerCase(); seen[k]=(seen[k]||0)+1; return seen[k]<=3; });
    out.push("LATEST POSTED RESULTS"+label+" (up to 3 per team, newest first, any date; scores as posted by athletics, Fremont's score first):\n"
      + (latest.length ? latest.slice(0,12).map(resultLine).join("\n") : "- No scores have been posted for this sport yet."));
  }else{
    const weekAgo = addDays(now.iso,-7);
    const results = pool.filter(g=>isPlayed(g,now) && g.score && g.date>=weekAgo && g.date<=now.iso).sort((a,b)=>byWhen(b,a));
    out.push("RECENT RESULTS (last 7 days, newest first; scores as posted by athletics. For older results, name the sport):\n"
      + (results.length ? results.slice(0,16).map(resultLine).join("\n") : "- None posted in the last 7 days. Older results are on the Sports tab."));
  }
  return out.join("\n\n");
}

const evWhen = (e,today)=> e.start===e.end ? (WD_SHORT[weekday(e.start)]+" "+e.start) : (WD_SHORT[weekday(e.start)]+" "+e.start+" to "+WD_SHORT[weekday(e.end)]+" "+e.end+(e.start<=today?" (happening now)":""));
const evLine = (e,today)=> "- "+evWhen(e,today)+": "+e.name+(e.time?", "+e.time:"")+(e.loc?(/^tba$/i.test(e.loc)?", place TBA":", at "+e.loc):"")+(e.desc?". "+e.desc:"");
function eventsSection(events, today, text){
  const evs = events.filter(e=> e.end >= today).sort((a,b)=> a.start.localeCompare(b.start));
  const out = ["UPCOMING EVENTS (ASB, spirit and club events, soonest first):\n" + (evs.length ? evs.slice(0,14).map(e=> evLine(e,today)).join("\n") : "- None are listed right now.")];
  // Past events (this school year) whose name the question uses, e.g. "when was the Multicultural Fair".
  const q = new Set(words(text).filter(w=> w.length>=4 && !EV_STOP.has(w)));
  const yearStart = (Number(today.slice(5,7))>=8 ? today.slice(0,4) : String(Number(today.slice(0,4))-1))+"-08-01";
  const past = q.size ? events.filter(e=> e.end < today && e.start >= yearStart && words(e.name).some(w=> q.has(w))).sort((a,b)=> b.start.localeCompare(a.start)).slice(0,4) : [];
  if(past.length) out.push("PAST EVENTS THIS QUESTION NAMES (already happened):\n"+past.map(e=> evLine(e,today)).join("\n"));
  return out.join("\n\n");
}
const EV_STOP = new Set("when where what which next upcoming event events night club clubs day week school fremont have this that with there about".split(" "));
function artsSection(list, today, text){
  const q = new Set(words(text).filter(w=> w.length>=4 && !EV_STOP.has(w)));
  const up = list.filter(a=> a.date >= today);
  // What the question names first (a play, a concert), then the next 10 on the calendar.
  const named = q.size ? up.filter(a=> words(a.name+" "+a.who+" "+a.cat).some(w=> q.has(w))) : [];
  const pick = [...new Map([...named.slice(0,8), ...up.slice(0,10)].map(a=> [a.date+a.name+a.time, a])).values()].sort((a,b)=> a.date.localeCompare(b.date));
  const line = a=> "- "+WD_SHORT[weekday(a.date)]+" "+a.date+": "+a.name+(a.time && !/^tbd$/i.test(a.time)?", "+a.time:"")+(a.loc?", at "+a.loc:"")+(a.who?" ("+a.who+")":"")+(a.note?". "+a.note:"");
  return "PERFORMING ARTS CALENDAR (band, orchestra, choir and theater, from the Performing Arts tab; soonest first):\n"+(pick.length ? pick.map(line).join("\n") : "- Nothing upcoming is listed.");
}
function spiritSection(st){
  return "STANDINGS (class spirit points, live from the Spirit tab): "+st.map((s,i)=>(i+1)+". "+s.cls+" "+s.pts).join(", ")+".";
}

const STOP = new Set("the and for are what when where which who how does do did is was can you your our club clubs about there that this with from have has meet meets meeting join any some tell know want like more info information school fremont fhs que los las del una por para con como cuando donde cual club clubes sobre hay quiero".split(" "));
const words = s=> String(s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").match(/[a-z0-9]{3,}/g) || [];
function clubsSection(clubs, text){
  const q = words(text).filter(w=> !STOP.has(w));
  const lowText = String(text||"").toLowerCase();
  const scored = clubs.map(c=>{
    const nameW = new Set(words(c.name)), purW = new Set(words(c.purpose));
    let s = 0;
    if(c.name.length >= 3 && lowText.includes(c.name.toLowerCase())) s += 10;
    for(const w of q){ if(nameW.has(w)) s += 3; else if([...nameW].some(n=> n.length>=4 && (n.startsWith(w) || w.startsWith(n)))) s += 2; if(purW.has(w)) s += 1; }
    return { c, s };
  }).filter(x=> x.s >= 2).sort((a,b)=> b.s-a.s).slice(0,8);
  const out = [];
  if(scored.length) out.push("CLUBS THAT MATCH THIS QUESTION (details):\n"+scored.map(({c})=>
    "- "+c.name+(c.meeting?" (meets: "+c.meeting+")":"")+(c.advisor?", advisor "+c.advisor:"")+(c.purpose?": "+c.purpose:"")).join("\n"));
  out.push("ALL "+clubs.length+" OFFICIAL CLUBS (names only; the Clubs tab has details and search): "+clubs.map(c=>c.name).join("; ")+".");
  return out.join("\n\n");
}

// Revealed announcements only: each shows from 8:30 AM PT on its date, as on the site and app.
function revealed(list, now){ return list.filter(a=> a.date < now.iso || (a.date===now.iso && now.min >= 510)); }
function announcementsSection(list, now){
  const from = addDays(now.iso,-14);
  const shown = revealed(list, now).filter(a=> a.date >= from).sort((a,b)=> b.date.localeCompare(a.date)).slice(0,12);
  return "MORNING ANNOUNCEMENTS (FTV, last 2 weeks, newest first):\n"+(shown.length ? shown.map(a=>
    "- "+WD_SHORT[weekday(a.date)]+" "+a.date+": "+(a.title?a.title+". ":"")+clip(a.text,200)).join("\n") : "- None in the last 2 weeks.");
}
// Announcements from the last 7 days that share a distinctive word with the question ("color
// guard auditions", "clothing drive"): their full text, newest copy of each, about 1,500
// characters at most. Sent even when the question wasn't classified as an announcement one.
const ANN_STOP = new Set(("when where what which does will would could should there their this that these those with from about have " +
  "your you they them come came join today tomorrow week next club clubs school fremont firebirds students student meeting room " +
  "lunch time please more info information anyone everyone free need want like know tell show cuando donde para sobre esta este").split(" "));
export function matchingAnnouncements(list, now, text){
  const q = new Set(words(text).filter(w=> w.length>=4 && !ANN_STOP.has(w)));
  if(!q.size) return [];
  const from = addDays(now.iso,-7), seen = new Set(), hits = [];
  for(const a of revealed(list, now).filter(a=> a.date >= from).sort((x,y)=> y.date.localeCompare(x.date))){
    const key = (a.title||a.text.slice(0,40)).toLowerCase();
    if(seen.has(key)) continue;
    const tw = new Set(words(a.title)), bw = new Set(words(a.text));
    let sc = 0;
    for(const w of q){ if(tw.has(w)) sc += 3; else if(bw.has(w)) sc += 1; else if(w.length>=6 && [...tw].some(t=> t.startsWith(w.slice(0,5)))) sc += 2; }
    if(sc >= 2){ seen.add(key); hits.push({ a, sc }); }
  }
  hits.sort((x,y)=> y.sc-x.sc);
  const out = []; let len = 0;
  for(const { a } of hits){ const line = "- "+WD_SHORT[weekday(a.date)]+" "+a.date+": "+(a.title?a.title+". ":"")+a.text; if(len + line.length > 1600 && out.length) break; out.push(line); len += line.length; if(out.length>=4) break; }
  return out;
}

// Compact "next 3 weeks" digest, sent with every question.
function digest(d, now){
  const to = addDays(now.iso, 21), lines = [];
  if(d.events) d.events.filter(e=> e.end>=now.iso && e.start<=to).sort((a,b)=> a.start.localeCompare(b.start)).slice(0,8)
    .forEach(e=> lines.push(evWhen(e,now.iso)+": "+e.name+(e.time?", "+e.time:"")));
  noClassBetween(now.iso, to).forEach(s=> lines.push(s));
  if(d.sports) d.sports.filter(g=> (g.senior || g.push || g.bell) && !isPlayed(g,now) && g.date<=to).sort(byWhen).slice(0,4)
    .forEach(g=> lines.push(gameLine(g)));
  // Every line starts "Www YYYY-MM-DD", so sorting on that date puts them in order.
  const key = l=> (l.match(/\d{4}-\d{2}-\d{2}/)||[""])[0];
  lines.sort((x,y)=> key(x).localeCompare(key(y)));
  const out = ["NEXT 3 WEEKS AT A GLANCE ("+now.iso+" to "+to+"):\n"+(lines.length ? lines.map(l=>"- "+l).join("\n") : "- Nothing special is listed.")];
  if(d.announcements){
    const r = revealed(d.announcements, now).sort((a,b)=> b.date.localeCompare(a.date));
    if(r.length){ const day = r[0].date, all = [...new Set(r.filter(a=> a.date===day && a.title).map(a=> a.title))], titles = all.slice(0,15);
      if(titles.length) out.push("LATEST MORNING ANNOUNCEMENTS ("+WD_SHORT[weekday(day)]+" "+day+", headlines only): "+titles.join("; ")+(all.length>titles.length?"; and "+(all.length-titles.length)+" more":"")+"."); }
  }
  return out.join("\n");
}

// What Felipe says when a source is down and there is no copy.
const UNAVAILABLE = {
  events: "UPCOMING EVENTS: unavailable right now. Say you don't have the event list at the moment and point to the Home tab. Never guess an event or date.",
  spirit: "STANDINGS: unavailable right now. Point to the Spirit tab for the class standings.",
  sports: "SPORTS DATA UNAVAILABLE right now. Say you don't have the schedule at the moment and point to the Sports tab. Never guess a game, date, time, opponent or score.",
  clubs:  "CLUBS: unavailable right now. Point to the Clubs tab.",
  announcements: "MORNING ANNOUNCEMENTS: unavailable right now. Point to the Home tab.",
  arts: "PERFORMING ARTS CALENDAR: unavailable right now. Say you don't have it at the moment. Never guess a concert or show date."
};

/* Build the live-data text for one question.
   sections: Set from pickSections. Returns { text, used:[...], waitedMs }. */
// For answers made without AI: a source the question needs that hadn't loaded yet (a cold
// instance) gets more time, so the answer never says "not on the calendar" just because the
// sheet was still loading.
export async function fillMissing(data, sections, waitMs){
  const miss = KEYS.filter(k=> sections.has(k) && data && !data[k]);
  await Promise.all(miss.map(async k=>{ data[k] = await getSource(k, waitMs); }));
  return data;
}
export async function buildLive(sections, now, text){
  const need = KEYS.filter(k=> sections.has(k));
  const t0 = Date.now();
  // Only a cold source is waited for: up to 4 s when the question needs it, up to 1.2 s for
  // the digest's sources (they normally load in well under 200 ms), never for the rest.
  const DIGEST = ["events","sports","announcements"];
  const data = {};
  await Promise.all(KEYS.map(async k=>{ data[k] = await getSource(k, need.includes(k) ? COLD_WAIT_MS : DIGEST.includes(k) ? DIGEST_WAIT_MS : 0); }));
  const waitedMs = Date.now()-t0;
  // named: [name, text]; the digest is first in the prompt, the question's own sections after it.
  const named = [["digest", digest(data, now)]];
  for(const k of need){
    if(!data[k]){ named.push([k, UNAVAILABLE[k]]); continue; }
    if(k==="events") named.push([k, eventsSection(data.events, now.iso, text)]);
    if(k==="sports") named.push([k, sportsSection(data.sports, now, text)]);
    if(k==="spirit") named.push([k, spiritSection(data.spirit)]);
    if(k==="clubs") named.push([k, clubsSection(data.clubs, text)]);
    if(k==="announcements") named.push([k, announcementsSection(data.announcements, now)]);
    if(k==="arts") named.push([k, artsSection(data.arts, now.iso, text)]);
  }
  // A question about something only the morning announcements mention gets those items in full.
  if(!need.includes("announcements") && data.announcements){
    const m = matchingAnnouncements(data.announcements, now, text);
    if(m.length) named.push(["announcements-match", "MORNING ANNOUNCEMENTS THAT MATCH THIS QUESTION (full text, last 7 days):\n"+m.join("\n")]);
  }
  // data: the parsed sources (for answers made without AI, dataanswer.js).
  return { text: named.map(x=> x[1]).join("\n\n"), used: need, waitedMs, parts: named, data };
}
/* The same live text cut to at most maxChars for models with a small token limit: the
   question's own sections first, then the digest, whole sections only (a section that does
   not fit is cut at a line break). */
export function trimLive(parts, maxChars){
  const order = parts.filter(p=> p[0] !== "digest").concat(parts.filter(p=> p[0] === "digest"));
  const out = []; let len = 0;
  for(const [, t] of order){
    if(len + t.length + 2 <= maxChars){ out.push(t); len += t.length + 2; continue; }
    const room = maxChars - len - 2;
    if(room > 300){ const cut = t.slice(0, room); out.push(cut.slice(0, Math.max(cut.lastIndexOf("\n"), 0)) || cut); }
    break;
  }
  return out.join("\n\n");
}

/* Helpers shared with dataanswer.js (answers made from the data without AI). */
export const helpers = { sportFilter, isPlayed, byWhen, team, matchup, words, EV_STOP, STOP, revealed, evWhen,
  scoreClubs: (clubs, text)=>{
    const q = words(text).filter(w=> !STOP.has(w)), lowText = String(text||"").toLowerCase();
    return clubs.map(c=>{
      const nameW = new Set(words(c.name)), purW = new Set(words(c.purpose));
      let s = 0;
      if(c.name.length >= 3 && lowText.includes(c.name.toLowerCase())) s += 10;
      for(const w of q){ if(nameW.has(w)) s += 3; else if([...nameW].some(n=> n.length>=4 && (n.startsWith(w) || w.startsWith(n)))) s += 2; if(purW.has(w)) s += 1; }
      return { c, s };
    }).filter(x=> x.s >= 2).sort((a,b)=> b.s-a.s);
  } };
