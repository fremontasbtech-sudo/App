
document.documentElement.classList.add('js');

/* =====================================================
   CONFIG — ASB Tech edits live here
===================================================== */
const CONFIG = {
  // Paste the Apps Script web-app /exec URL (see App/backend/README.md).
  // While empty, the app runs in demo mode (everything confirmed locally only).
  apiUrl: "",
  // Paste the school Google OAuth client ID to enable real sign-in.
  googleClientId: "406202107849-qqtk7fth5t3qu1en1kitjr6il1oh5t7f.apps.googleusercontent.com"
};

// Feature flags — flip to true to bring a feature back into the live app.
// Fire Bucks (Firebird Card, QR, teacher "give" screen) stays built in the repo,
// but is hidden from the live app for now. Set fireBucks:true to re-enable it.
const FEATURES = { fireBucks: false };

/* The Events spreadsheet (Spirit Points, Events and Sports tabs) is PRIVATE, so the app
   reads those tabs through the website's proxy, which fetches them via the owner's Apps
   Script and CDN-caches the CSV with CORS *. Never add a cache-buster to these URLs:
   every new query string is a slow CDN miss that waits on Apps Script.
   Spirit Points is a matrix: col A = class, each next column = an event; a class's
   total is the sum of its row. Add an event = add a column, nothing else. */
const SHEET_PROXY = "https://www.fremontasb.org/api/sheet?tab=";
const SPIRIT_SHEET = SHEET_PROXY + "Spirit%20Points";

// Fetch a sheet CSV with a timeout. A 200 that's empty or an HTML page (a school filter,
// a captive portal) counts as a failure, so it can never replace good data.
async function fetchCsv(url, ms){
  const ctrl = typeof AbortController!=="undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(function(){ ctrl.abort(); }, ms||10000) : null;
  try{
    const res = await fetch(url, ctrl ? { signal:ctrl.signal } : undefined);
    if(!res.ok) throw new Error("HTTP "+res.status);
    const text = await res.text();
    if(!text.trim() || /^\s*</.test(text)) throw new Error("not a CSV");
    return text;
  } finally { if(timer) clearTimeout(timer); }
}
// Same "is this cell flagged?" rule as the website (api/_events.js isYes).
function sheetYes(v){ const t=String(v||"").trim().toLowerCase(); return t!=="" && (t==="y"||t==="yes"||t==="true"||t==="x"||t==="✓"||t==="1"||t==="done"||t.charAt(0)==="y"); }
// Dates typed into the sheet, same formats as the website's normDate (api/_events.js):
// ISO (2026-10-28) or M/D/YYYY and M/D/YY (10/28/2026, 10/28/26). Returns "" otherwise.
function normSheetDate(s){
  s = String(s||"").trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/), y, mo, d;
  if(m){ y=+m[1]; mo=+m[2]; d=+m[3]; }
  else if((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/))){ y=+m[3]; if(y<100) y+=2000; mo=+m[1]; d=+m[2]; }
  else return "";
  if(mo<1 || mo>12 || d<1 || d>31) return "";
  return y+"-"+("0"+mo).slice(-2)+"-"+("0"+d).slice(-2);
}
// English or Spanish for text the app builds itself (More → Settings → Language).
// Static markup goes through I18N_EN_ES instead.
function tr(en, es){ return (typeof fhLang!=="undefined" && fhLang==="es") ? es : en; }
// Write text only when it changed, so live regions don't re-announce every tick.
function setText(el, txt){ if(el && el.textContent!==txt) el.textContent = txt; }

/* ---- backend calls (Apps Script). Both return null in demo mode. ---- */
async function apiPost(body){
  if(!CONFIG.apiUrl) return null;
  const r = await fetch(CONFIG.apiUrl, { method:"POST",
    headers:{ "Content-Type":"text/plain;charset=utf-8" },  // simple request: no CORS preflight
    body: JSON.stringify(body) });
  return r.json();
}
async function apiGet(params){
  if(!CONFIG.apiUrl) return null;
  const u = new URL(CONFIG.apiUrl);
  Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,v));
  const r = await fetch(u);
  return r.json();
}

/* Official 2026-27 FHS weekly bell schedule (2627FHSBellSchedule.pdf / fhs.fuhsd.org). */
const SCHEDULES = {
  mon: { label: "Monday", rows: [
    ["Period 1","8:30","9:15"],["Period 2","9:20","10:05"],["Tutorial","10:10","10:35"],
    ["Period 3","10:40","11:25"],["Brunch","11:25","11:40"],["Period 4","11:50","12:35"],
    ["Period 5","12:40","1:25"],["Lunch","1:25","2:05"],["Period 6","2:15","3:00"],["Period 7","3:05","3:50"]
  ]},
  a: { label: "A day \u00b7 Tue & Thu", rows: [
    ["Period 1","8:30","10:00"],["Period 2","10:05","11:35"],["Brunch","11:35","11:50"],
    ["Period 3","12:00","1:30"],["Lunch","1:30","2:10"],["Period 7","2:20","3:50"]
  ]},
  b: { label: "B day \u00b7 Wed & Fri", rows: [
    ["Collaboration (staff only)","7:35","8:25"],["Period 4","8:30","10:05"],["Tutorial","10:10","10:50"],
    ["Brunch","10:50","11:05"],["Period 5","11:15","12:45"],["Lunch","12:45","1:25"],["Period 6","1:35","3:05"]
  ]}
};
const SCHED_LABEL_ES = { mon:"Lunes", a:"D\u00eda A \u00b7 mar y jue", b:"D\u00eda B \u00b7 mi\u00e9 y vie" };

/* FUHSD 2026-27 calendar (fuhsd.org > About Us > Calendar): days with no classes, as
   [from, to, reason, Spanish]. Classes run 2026-08-17 to 2027-06-03.
   Update this every August with the new district calendar. */
const SCHOOL_YEAR = { first:"2026-08-17", last:"2027-06-03" };
const NO_CLASSES = [
  ["2026-09-07","2026-09-07","Labor Day","D\u00eda del Trabajo"],
  ["2026-10-12","2026-10-12","Teacher Non-Duty Day","D\u00eda sin clases para maestros"],
  ["2026-11-11","2026-11-11","Veterans Day","D\u00eda de los Veteranos"],
  ["2026-11-25","2026-11-27","Thanksgiving Break","Vacaciones de Acci\u00f3n de Gracias"],
  ["2026-12-21","2027-01-01","Mid-Year Break","Vacaciones de mitad de a\u00f1o"],
  ["2027-01-18","2027-01-18","Martin Luther King Jr. Day","D\u00eda de Martin Luther King Jr."],
  ["2027-02-15","2027-02-19","Presidents' Week","Semana de los Presidentes"],
  ["2027-03-15","2027-03-15","Non-Duty Day","D\u00eda sin clases"],
  ["2027-04-12","2027-04-16","Spring Break","Vacaciones de primavera"],
  ["2027-05-31","2027-05-31","Memorial Day","D\u00eda de los Ca\u00eddos"]
];
/* Dated A/B swaps for weeks where a mid-week day off shifts the pattern ("YYYY-MM-DD":"a"|"b").
   Monday-off weeks need nothing here: Tue A, Wed B, Thu A, Fri B is already the default.
   Empty until Abir confirms the 2026-27 weeks. The school's special-schedule sheet only has
   2025-26 tabs; its pattern rule (the remaining days alternate A, B starting Monday) gives:
     "2026-11-09":"a", "2026-11-10":"b"   (Veterans Day week, Wed 11-11 off)
     "2026-11-23":"a", "2026-11-24":"b"   (Thanksgiving week, Wed-Fri off)
   Until then those days show the regular weekday schedule. */
const SPECIAL_DAYS = {};
function noClassReason(iso){
  // Summer is June 1 to the first day, and the last day to Aug 10. Past that, the table is
  // out of date (a new school year), so the app falls back to the regular week instead of
  // calling every day a day off.
  const SUMMER = ["Summer Break","Vacaciones de verano"];
  if(iso < SCHOOL_YEAR.first) return iso >= SCHOOL_YEAR.first.slice(0,4)+"-06-01" ? SUMMER : null;
  if(iso > SCHOOL_YEAR.last) return iso <= SCHOOL_YEAR.last.slice(0,4)+"-08-10" ? SUMMER : null;
  for(let i=0;i<NO_CLASSES.length;i++){ const r=NO_CLASSES[i]; if(iso>=r[0] && iso<=r[1]) return [r[2], r[3]]; }
  return null;
}
function isoWeekday(iso){ const m=String(iso).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); return m ? new Date(+m[1],+m[2]-1,+m[3]).getDay() : -1; }
function isClassDay(iso){ const wd=isoWeekday(iso); return wd>=1 && wd<=5 && !noClassReason(iso); }
function nextClassDay(iso){ for(let i=1;i<=60;i++){ const d=isoAddDays(iso,i); if(d > SCHOOL_YEAR.last) return ""; if(isClassDay(d)) return d; } return ""; }
// "Tuesday, Oct 13" (or "martes 13 de oct." in Spanish)
function longDayLabel(iso){
  const m=String(iso).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if(!m) return iso;
  const wd=isoWeekday(iso);
  return tr(["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][wd]+", "+["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m[2]-1]+" "+(+m[3]),
    ["domingo","lunes","martes","mi\u00e9rcoles","jueves","viernes","s\u00e1bado"][wd]+" "+(+m[3])+" de "+["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"][+m[2]-1]+".");
}
// Period names in the current language ("Period 3" -> "Periodo 3").
const PERIOD_ES = { "Brunch":"Brunch", "Lunch":"Almuerzo", "Tutorial":"Tutor\u00eda", "Rally":"Rally", "Enrichment":"Enriquecimiento",
  "Collaboration (staff only)":"Colaboraci\u00f3n (solo personal)", "CAASPP Testing (11th)":"Examen CAASPP (11.\u00ba grado)" };
function periodName(n){
  if(typeof fhLang==="undefined" || fhLang!=="es") return n;
  if(PERIOD_ES[n]) return PERIOD_ES[n];
  let m = n.match(/^Period (\d+)$/); if(m) return "Periodo "+m[1];
  m = n.match(/^Career Session #(\d+)$/); if(m) return "Sesi\u00f3n de carreras #"+m[1];
  m = n.match(/^(\d+)(st|nd|rd|th) Final$/); if(m) return "Final del periodo "+m[1];
  return n;
}

/* Regular-day templates reused across the built-in special weeks. */
const RALLY_B = SCHEDULES.b.rows.map(r => r[0]==="Tutorial" ? ["Rally","10:10","10:50"] : r);
function finalsFull(a,b){ return [[a+" Final","8:30","10:30"],["Brunch","10:30","10:50"],[b+" Final","11:00","1:00"],["Lunch","1:00","1:40"],["Enrichment","1:50","3:50"]]; }
function finalsMin(n){ return [["Enrichment","8:30","9:30"],["Brunch","9:30","9:40"],[n+" Final","9:50","11:50"],["Lunch","12:00","12:30"]]; }
const CAREER_MON=[["Period 1","8:30","9:10"],["Period 2","9:15","9:55"],["Career Session #1","10:05","10:30"],["Career Session #2","10:35","11:00"],["Brunch","11:00","11:15"],["Period 3","11:25","12:05"],["Period 4","12:10","12:50"],["Period 5","12:55","1:35"],["Lunch","1:35","2:15"],["Period 6","2:25","3:05"],["Period 7","3:10","3:50"]];
const CAASPP_TUE=[["CAASPP Testing (11th)","8:30","11:45"],["Brunch","11:45","12:00"],["Period 1","12:10","12:50"],["Period 2","12:55","1:35"],["Lunch","1:35","2:15"],["Period 3","2:25","3:05"],["Period 7","3:10","3:50"]];
const CAASPP_WED=[["Collaboration (staff only)","7:35","8:25"],["CAASPP Testing (11th)","8:30","11:10"],["Brunch","11:10","11:25"],["Period 4","11:35","12:20"],["Tutorial","12:25","12:50"],["Period 5","12:55","1:40"],["Lunch","1:40","2:20"],["Period 6","2:30","3:20"]];
const CAASPP_THU=[["CAASPP Testing (11th)","8:30","10:15"],["Brunch","10:15","10:30"],["Period 1","10:40","11:40"],["Period 2","11:45","12:45"],["Lunch","12:45","1:25"],["Period 3","1:35","2:35"],["Period 7","2:40","3:40"]];

/* Built-in special weeks (FHS "Special Bell Schedules"). Day PATTERNS repeat
   yearly; the "dates" text is a rough guide \u2014 follow announcements for the exact week. */
function D(d,label,rows){ return { d:d, label:label, rows:rows }; }
function OFF(d,reason){ return { d:d, label:"No School", rows:null, off:reason }; }
const A = SCHEDULES.a.rows, B = SCHEDULES.b.rows, MON = SCHEDULES.mon.rows;
const SPECIAL_WEEKS = [
  { id:"rally", name:"Rally Week", dates:"Rally week template",
    note:"A regular week, but Friday's Tutorial becomes the Rally (10:10\u201310:50).",
    days:[ D("Mon","Monday",MON), D("Tue","A day",A), D("Wed","B day",B), D("Thu","A day",A), D("Fri","B day + Rally",RALLY_B) ] },
  { id:"labor", name:"Labor Day Week", dates:"early September",
    days:[ OFF("Mon","Labor Day"), D("Tue","A day",A), D("Wed","B day",B), D("Thu","A day",A), D("Fri","B day",B) ] },
  { id:"homecoming", name:"Homecoming Week", dates:"Oct 5–9, 2026",
    note:"Friday runs a B day with the Homecoming Rally replacing Tutorial.",
    days:[ D("Mon","Monday",MON), D("Tue","A day",A), D("Wed","B day",B), D("Thu","A day",A), D("Fri","B day + Homecoming Rally",RALLY_B) ] },
  { id:"nonduty", name:"Non-Duty Day Week", dates:"Oct 12–16, 2026",
    days:[ OFF("Mon","Teacher Non-Duty Day"), D("Tue","A day",A), D("Wed","B day",B), D("Thu","A day",A), D("Fri","B day",B) ] },
  { id:"veterans", name:"Veterans Day Week", dates:"Nov 9–13, 2026",
    note:"Veterans Day is a Wednesday this year. The other days follow last year's pattern, so check the morning announcements for the final A and B days.",
    days:[ D("Mon","A day",A), D("Tue","B day",B), OFF("Wed","Veterans Day"), D("Thu","A day",A), D("Fri","B day",B) ] },
  { id:"thanksgiving", name:"Thanksgiving Week", dates:"Nov 23–27, 2026",
    note:"This follows last year's pattern, so check the morning announcements for the final A and B days.",
    days:[ D("Mon","A day",A), D("Tue","B day",B), OFF("Wed","Thanksgiving Break"), OFF("Thu","Thanksgiving"), OFF("Fri","Thanksgiving Break") ] },
  { id:"finals1", name:"1st Semester Finals", dates:"mid-December",
    days:[ D("Mon","Blocks 1\u20137",MON), D("Tue","Finals: 4th & 7th",finalsFull("4th","7th")), D("Wed","Finals: 5th & 6th",finalsFull("5th","6th")), D("Thu","Finals: 1st & 3rd",finalsFull("1st","3rd")), D("Fri","Finals: 2nd (min day)",finalsMin("2nd")) ] },
  { id:"mlk", name:"MLK Week", dates:"mid-January",
    days:[ OFF("Mon","MLK Jr. Day"), D("Tue","A day",A), D("Wed","B day",B), D("Thu","A day",A), D("Fri","B day",B) ] },
  { id:"career", name:"Career Day Week", dates:"early February",
    note:"Monday is a custom all-blocks Career Day; Tue\u2013Fri are normal A/B.",
    days:[ D("Mon","Career Day",CAREER_MON), D("Tue","A day",A), D("Wed","B day",B), D("Thu","A day",A), D("Fri","B day",B) ] },
  { id:"caaspp", name:"CAASPP Testing Week", dates:"early March \u00b7 11th graders test",
    note:"11th graders test Tue\u2013Thu; other grades have a delayed start, so check announcements.",
    days:[ D("Mon","Blocks 1\u20137",MON), D("Tue","CAASPP",CAASPP_TUE), D("Wed","CAASPP",CAASPP_WED), D("Thu","CAASPP",CAASPP_THU), D("Fri","B day",B) ] },
  { id:"march", name:"March Non-Duty Day Week", dates:"Mar 15–19, 2027",
    days:[ OFF("Mon","Non-Duty Day"), D("Tue","A day",A), D("Wed","B day",B), D("Thu","A day",A), D("Fri","B day",B) ] },
  { id:"srfinals", name:"Senior Finals Week", dates:"late May",
    note:"Senior finals happen in class. Friday closes with the Senior Goodbye Rally.",
    days:[ OFF("Mon","Memorial Day"), D("Tue","A day",A), D("Wed","B day",B), D("Thu","A day",A), D("Fri","B day + Senior Goodbye Rally",RALLY_B) ] },
  { id:"finals2", name:"2nd Semester Finals", dates:"early June \u00b7 9th\u201311th",
    days:[ D("Mon","Finals: 4th & 7th",finalsFull("4th","7th")), D("Tue","Finals: 1st & 2nd",finalsFull("1st","2nd")), D("Wed","Finals: 5th & 6th",finalsFull("5th","6th")), D("Thu","Finals: 3rd (last day)",finalsMin("3rd")), OFF("Fri","Teacher Work Day") ] }
];

/* Upcoming events for the countdown (local time). */
let eventsCurated = false, eventsApiLoaded = false;
let EVENTS = [
  { name:"BTS Spirit Week", when:new Date(2026,7,24,8,30), end:new Date(2026,7,28,23,59), time:"All week", loc:"Campus", desc:"Survivor-themed spirit week: Mon Island, Tue Outwit, Wed Outlast, Thu Outplay, Fri Tribe.", tags:["Spirit","Dress up"] },
  { name:"BTS Rally", when:new Date(2026,7,28,8,30), end:new Date(2026,7,28,23,59), time:"During school", loc:"Gym", desc:"First rally of the year - wear your class colors and sit with your class.", tags:["Rally","Spirit"] },
  { name:"Beach Bash: Back-to-School Social", when:new Date(2026,7,28,18,15), end:new Date(2026,7,28,23,59), time:"6:15-8:15 PM", loc:"Cafeteria + outside", desc:"Kona Ice, photobooth, dance floor, spikeball, cornhole, and decorating.", tags:["Social","Free"] },
  { name:"Clubs Day", when:new Date(2026,8,16,12,0), end:new Date(2026,8,16,23,59), time:"Lunch", loc:"The quad", desc:"Fall club fair. Meet the clubs and sign up in person.", tags:["Clubs"] },
  { name:"Homecoming Court Nominations Open", when:new Date(2026,8,25,8,0), end:new Date(2026,8,25,23,59), time:"All day", loc:"fremontasb.org/homecoming-court", desc:"Nominate up to 4 seniors for Homecoming Court on the ASB website using your school Google account.", tags:["Homecoming","Court"] },
  { name:"Homecoming Week", when:new Date(2026,9,5,8,0), end:new Date(2026,9,9,23,59), time:"All week", loc:"Campus", desc:"Hallway decorations, spirit days, the royalty vote, and the Friday rally and dance.", tags:["Homecoming","Dance","Spirit"] },
  { name:"Multicultural Night", when:new Date(2026,9,28,18,0), end:new Date(2026,9,28,23,59), time:"Evening", loc:"TBA", desc:"Performances and food celebrating Fremont's cultures, hosted with culture and identity clubs.", tags:["Clubs","Culture"] },
  { name:"Club Trivia Night", when:new Date(2027,0,27,18,0), end:new Date(2027,0,27,23,59), time:"Evening", loc:"TBA", desc:"Team trivia hosted by the Clubs Commission.", tags:["Clubs"] },
  { name:"Club Grub Day", when:new Date(2027,3,21,12,0), end:new Date(2027,3,21,23,59), time:"Lunch", loc:"The quad", desc:"Clubs sell food on campus - come hungry and support your favorite clubs.", tags:["Clubs","Food"] }
];

// Clubs + morning announcements come from the ASB website's Gemini-cleaned API
// (fremontasb.org). Raw gviz is the fallback if the API is unreachable.
const CLUBS_API = "https://www.fremontasb.org/api/clubs";
const ANN_API = "https://www.fremontasb.org/api/announcements";
const CLUB_SHEET = "https://docs.google.com/spreadsheets/d/1IQo9QG0ubONWAeaZfwPQ2GJH7zpBr_QexsH9o0XTOLg/gviz/tq?tqx=out:csv&gid=0";
// No built-in sample clubs: the list is the live API, the clubs sheet, or the last good
// copy saved on this device (CLUBS_CACHE_KEY). With none of those, Clubs shows a calm note.
let CLUBS = [];

/* =====================================================
   Tab navigation (hash deep-links, focus management)
===================================================== */
const VIEWS = ["home","schedule","spirit","clubs","sports","more","give"]; // "give" is reached by QR scan, not the nav
function parseHash(){
  const h = location.hash.replace(/^#/,"");
  const [view, qs] = h.split("?");
  const params = {};
  if(qs) qs.split("&").forEach(kv=>{
    const i = kv.indexOf("=");
    if(i>0) params[kv.slice(0,i)] = decodeURIComponent(kv.slice(i+1).replace(/\+/g," "));
  });
  if(view==="give" && !FEATURES.fireBucks) return { view:"home", params:{} };
  return { view, params };
}
function show(view, focusHeading){
  if(!VIEWS.includes(view)) view = "home";
  VIEWS.forEach(v=>{
    document.getElementById("view-"+v).classList.toggle("active", v===view);
  });
  document.querySelectorAll("[data-nav]").forEach(el=>{
    if(!el.closest("nav")) return;
    if(el.getAttribute("data-nav")===view) el.setAttribute("aria-current","page");
    else el.removeAttribute("aria-current");
  });
  // keep the QR's ?sid=… params in the URL while on the give screen
  if(history.replaceState && view!=="give") history.replaceState(null,"","#"+view);
  window.scrollTo({top:0, behavior:"auto"});
  if(focusHeading){
    const region = document.getElementById("view-"+view);
    region.setAttribute("tabindex","-1");
    region.focus({preventScroll:true});
  }
  if(view==="home") staggerOnce("eventList");
  if(view==="sports") loadSports();
  if(view==="clubs") staggerOnce("clubGrid");
}
document.addEventListener("click", e=>{
  const t = e.target.closest("[data-nav]");
  if(!t) return;
  e.preventDefault();
  show(t.getAttribute("data-nav"), true);
});
window.addEventListener("hashchange", ()=>{
  const ph = parseHash();
  Object.keys(DROPDOWNS).forEach(id=>ddClose(DROPDOWNS[id], false)); // e.g. Back while a list is open
  if(ph.view==="give") fillGive(ph.params);
  show(ph.view, true);
});

const staggered = new Set();
function staggerOnce(id){
  const el = document.getElementById(id);
  if(!el || staggered.has(id)) return;
  if(matchMedia("(prefers-reduced-motion: reduce)").matches){ staggered.add(id); return; }
  staggered.add(id);
  [...el.children].forEach((c,i)=> c.style.animationDelay = (i*60)+"ms");
  el.classList.add("ready");
}

/* =====================================================
   Countdown to the next event
===================================================== */
function nowPST(){ return new Date(new Date().toLocaleString("en-US",{timeZone:"America/Los_Angeles"})); }
function tickCountdown(){
  const now = nowPST();
  const future = EVENTS.filter(function(e){ return e.when > now; });
  // Senior nights count too, so "Next up" matches the first card on Home.
  try{
    if(typeof sportsGames!=="undefined" && sportsGames) sportsGames.forEach(function(g){
      if(!isSeniorNight(g)) return;
      const m = String(g.date||"").match(/^(\d{4})-(\d{2})-(\d{2})/); if(!m) return;
      const t = sportTimeMin(g.time);
      const when = new Date(+m[1],+m[2]-1,+m[3], t<9999?Math.floor(t/60):8, t<9999?t%60:0);
      if(when > now) future.push({ name:g.sport+" Senior Night", when:when });
    });
  }catch(e){}
  const next = future.length ? future.reduce(function(a,b){ return a.when<b.when?a:b; }) : null;
  const nameEl = document.getElementById("nextupName");
  const timeEl = document.getElementById("nextupTime");
  // Only the event name is a live region, and it's rewritten only when it changes; the
  // ticking time isn't announced.
  if(!next){ setText(nameEl, tr("More events coming soon","Más eventos muy pronto")); setText(timeEl, ""); return; }
  const ms = next.when - now;
  const d = Math.floor(ms/86400000), h = Math.floor(ms/3600000)%24, m = Math.floor(ms/60000)%60, s = Math.floor(ms/1000)%60;
  setText(nameEl, tr("Next up: ","Próximo: ") + next.name);
  timeEl.dateTime = next.when.toISOString();
  setText(timeEl, d>0 ? (d+"d "+h+"h "+m+"m") : (h+"h "+m+"m "+s+"s"));
}
/* Flickr photos on an event card. Shows a "View photos" button when the event has
   an album link; for a past event with no album yet, a "Photos coming soon" note. */
function eventPhotos(e, now){
  var url = e.photos || e.flickr || "";
  if(/^https?:\/\//.test(url)){
    return '<a class="btn gold evphotos" href="'+clubEsc(url)+'" target="_blank" rel="noopener">'+
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="2"/><circle cx="9" cy="11" r="2" stroke="currentColor" stroke-width="2"/><path d="M4 18l5-4 3 2 4-4 4 4" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg> View photos</a>';
  }
  if(e.end && e.end < now){ return '<p class="note evphotos-soon">Photos coming soon</p>'; }
  return "";
}
/* Upcoming events — rendered from EVENTS, past events auto-hidden in PST. */
function renderEvents(){
  const grid = document.getElementById("eventList");
  if(!grid) return;
  const now = nowPST();
  const MO = tr(["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"], MO_ES);
  const horizon = new Date(now.getTime()+21*86400000); // only the next 3 weeks
  let list = EVENTS.filter(function(e){ return e.end >= now && e.when <= horizon; });
  // Merge sports games, same rule as the website's Upcoming Events (src/data/useEvents.js):
  // every senior night in the window, plus the soonest pinned (push=y) game per sport,
  // preferring the Varsity row on the same day.
  try{
    if(typeof sportsGames!=="undefined" && sportsGames){
      const tks = todayKeyPST();
      const nextBySport = {};
      const toItem = function(g, when, m){
        return { name:(g.sport+(g.level?(" "+g.level):"")+(g.opponent?(isMeetSport(g.sport)?(": "+g.opponent):(/away/i.test(g.homeAway)?tr(" at "," en "):" vs ")+g.opponent):"")),
          when:when, end:new Date(+m[1],+m[2]-1,+m[3],23,59), time:g.time, loc:g.location, desc:"",
          tags:(isSeniorNight(g)?["Sports","Senior Night"]:["Sports","Featured"]), photos:"", senior:isSeniorNight(g) };
      };
      sportsGames.forEach(function(g){
        const senior = isSeniorNight(g);
        if(!g.push && !senior) return;
        if(isResultGame(g, tks)) return;
        const m=String(g.date||"").match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if(!m) return;
        const when=new Date(+m[1],+m[2]-1,+m[3],8,0); if(when>horizon) return;
        if(senior){ list.push(toItem(g, when, m)); return; }
        const prev = nextBySport[g.sport];
        if(!prev || g.date < prev.g.date || (g.date===prev.g.date && levelRank(g.level) < levelRank(prev.g.level))) nextBySport[g.sport] = { g:g, when:when, m:m };
      });
      Object.keys(nextBySport).forEach(function(k){ const v=nextBySport[k]; list.push(toItem(v.g, v.when, v.m)); });
    }
  }catch(e){}
  // At most 5 upcoming at a time, soonest first. Senior nights don't count toward the 5.
  let nonSenior = 0;
  list = list.sort(function(a,b){ return a.when-b.when; }).filter(function(e){ return e.senior || ++nonSenior <= 5; });
  if(!list.length){ lastEventsHtml = ""; grid.innerHTML = '<p class="note">More events coming soon.</p>'; return; }
  const html = list.map(function(e){
    const meta = [e.time,e.loc].filter(Boolean).map(clubEsc).join(" &middot; ");
    const tags = (e.tags||[]).map(function(t){ return '<span class="tag'+(t==="Senior Night"?' star':'')+'">'+(t==="Senior Night"?'&#9733; ':'')+clubEsc(t)+'</span>'; }).join("");
    return '<article class="ticket'+(e.senior?' senior':'')+'">'+
      '<div class="stub" aria-hidden="true"><span class="mo">'+MO[e.when.getMonth()]+'</span><span class="day">'+e.when.getDate()+'</span></div>'+
      '<div class="body"><h3>'+clubEsc(e.name)+'</h3>'+
      (meta?'<p class="meta">'+meta+'</p>':"")+
      (e.desc?'<p>'+clubEsc(e.desc)+'</p>':"")+
      tags+eventPhotos(e,now)+'</div></article>';
  }).join("");
  if(html === lastEventsHtml) return; // nothing changed: don't replay the card animation
  lastEventsHtml = html;
  grid.innerHTML = html;
  staggered.delete("eventList"); staggerOnce("eventList");
}
let lastEventsHtml = "";
/* Live events feed — the "Events" tab through the website proxy (see SHEET_PROXY), so
   any edit shows up on the app. EVERY dated row shows (read BY NAME, never gid=0, which
   falls back to Config). Opt-out: put no/hide in an optional "hide" column to skip a
   row. Red/featured is emphasis only. */
const EVENTS_SHEET = SHEET_PROXY + "Events";
function parseEvDate(s,isEnd){
  const m = normSheetDate(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m) return null;
  return isEnd ? new Date(+m[1],+m[2]-1,+m[3],23,59) : new Date(+m[1],+m[2]-1,+m[3],8,0);
}
// Start time from the Events tab's time column, so "Next up" counts down to the event
// itself: "6:15-8:15 PM" -> 6:15 PM, "Evening" -> 6 PM, "Lunch" -> 12:45 PM; else 8 AM.
function withStartTime(d, time){
  if(!d) return d;
  const s = String(time||"");
  let h = null, mi = 0;
  const range = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*[-\u2013]\s*\d{1,2}(?::\d{2})?\s*(am|pm)/i);
  const one = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if(range){ h = +range[1]%12 + (/pm/i.test(range[3]||range[4]) ? 12 : 0); mi = +(range[2]||0); }
  else if(one){ h = +one[1]%12 + (/pm/i.test(one[3]) ? 12 : 0); mi = +(one[2]||0); }
  else if(/evening|night/i.test(s)) h = 18;
  else if(/lunch/i.test(s)){ h = 12; mi = 45; }
  else if(/after school/i.test(s)){ h = 15; mi = 50; }
  if(h===null) return d;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, mi);
}
async function syncEventsSheet(){
  if(!EVENTS_SHEET) return;
  try{
    const rows = parseSheetRows(await fetchCsv(EVENTS_SHEET, 10000)); if(rows.length<2) return;
    const head = rows[0].map(function(h){ return String(h).trim().toLowerCase(); });
    const gi = function(n){ return head.indexOf(n); };
    const col = function(r,n){ const i=gi(n); return i>=0?String(r[i]||"").trim():""; };
    const list = [];
    for(let i=1;i<rows.length;i++){ const r=rows[i]; const name=col(r,"name"); const when=withStartTime(parseEvDate(col(r,"date"),false), col(r,"time")); if(!name||!when) continue;
      if(/^(no|n|false|0|hide|hidden|off|skip)$/i.test(col(r,"hide"))) continue; // opt-out
      const end = parseEvDate(col(r,"enddate"),true) || new Date(when.getFullYear(),when.getMonth(),when.getDate(),23,59);
      const tags = col(r,"tags").split(/[;,]/).map(function(t){return t.trim();}).filter(Boolean).map(clubCap);
      const feat = /^(yes|true|1|x|red|y)$/i.test(col(r,"featured"));
      list.push({ name:name, when:when, end:end, time:col(r,"time"), loc:col(r,"location")||col(r,"place"), desc:col(r,"description")||col(r,"desc"), tags:tags, featured:feat, photos:col(r,"photos")||col(r,"flickr") });
    }
    if(!list.length) return;
    eventsCurated = true;
    EVENTS = list.sort(function(a,b){ return a.when-b.when; }); // opt-out: show every event, hidden ones already skipped
    try{ localStorage.setItem(EVENTS_CACHE_KEY, JSON.stringify({ t:Date.now(), events:EVENTS.map(function(e){ return Object.assign({}, e, { when:e.when.getTime(), end:e.end.getTime() }); }) })); }catch(e){}
    renderEvents(); tickCountdown();
  }catch(e){ /* offline or the proxy is down: keep the last good events on screen */ }
}
// Last good Events tab, so a repeat visit paints real events instantly (and keeps them
// if the network fails) instead of the built-in seed.
const EVENTS_CACHE_KEY = "fh_events_v1";
(function restoreEventsCache(){
  try{
    const c = JSON.parse(localStorage.getItem(EVENTS_CACHE_KEY)||"null");
    if(c && Array.isArray(c.events) && c.events.length){
      EVENTS = c.events.map(function(e){ return Object.assign({}, e, { when:new Date(e.when), end:new Date(e.end) }); });
      eventsCurated = true;
    }
  }catch(e){}
})();

/* =====================================================
   Live bell-schedule clock + special-schedule sync
===================================================== */
/* =====================================================
   Sports — the full season from the Sports tab (through SHEET_PROXY).
   A sport shows while it's in season OR has a game in the last week or the next
   3 weeks, so November finals and playoffs don't vanish on Nov 1. Featured (push=y)
   games lead the All sports view. Senior nights come only from the sheet (its
   seniorNight column, which SportsSync fills, or "senior night" in the title).
===================================================== */
const SPORTS_SHEET = SHEET_PROXY + "Sports";
let sportsGames = null, sportsUpdatedLabel = "", sportFilter = "all", sportLevel = "all", sportsShowAll = false, sportsResultsAll = false;
let sportsFetching = false, sportsFetchedAt = 0, sportsSig = "", sportsRetry = 0, sportsRetryTimer = null;

const SPORT_ORDER = ["Football","Cross Country","Field Hockey","Flag Football","Girls Tennis","Girls Volleyball","Boys Water Polo","Girls Water Polo","Boys Basketball","Girls Basketball","Boys Soccer","Girls Soccer","Wrestling","Badminton","Baseball","Softball","Golf","Swimming & Diving","Boys Tennis","Track & Field","Boys Volleyball"];
function sportRank(s){ const i = SPORT_ORDER.indexOf(s); return i<0 ? 900 : i; }
function levelRank(l){ return /varsity/i.test(l)?0 : /jv/i.test(l)?1 : /frosh|fresh/i.test(l)?2 : 3; }
// "JV/Varsity", "Boys Varsity/Girls Varsity", "Varsity & JV" -> ["JV","Varsity"]. A blank level
// or "All" gives [], which fits every level filter.
function levelParts(l){
  const out = [];
  String(l||"").split(/[\/,&+]|\band\b/i).forEach(function(p){
    p = p.trim(); if(!p || /^all$/i.test(p)) return;
    const n = /varsity/i.test(p) ? "Varsity" : /\bjv\b|junior/i.test(p) ? "JV" : /frosh|fresh/i.test(p) ? "Frosh" : p;
    if(out.indexOf(n)<0) out.push(n);
  });
  return out;
}
function levelFits(g){ if(sportLevel==="all") return true; const parts = levelParts(g.level); return !parts.length || parts.indexOf(sportLevel)>=0; }
function eventNoun(sport, plural){
  const s = String(sport||"");
  if(/cross country|track|swim|dive|wrestl/i.test(s)) return plural?"meets":"meet";
  if(/tennis|badminton|golf/i.test(s)) return plural?"matches":"match";
  return plural?"games":"game";
}
// Spanish nouns for the same three kinds (competencia is feminine; the others aren't).
function eventNounEs(sport, plural){
  const s = String(sport||"");
  if(/cross country|track|swim|dive|wrestl/i.test(s)) return plural?"competencias":"competencia";
  if(/tennis|badminton|golf/i.test(s)) return plural?"encuentros":"encuentro";
  return plural?"partidos":"partido";
}
function isMeetSport(s){ return /cross country|track|swim|dive|wrestl/i.test(String(s||"")); }
// Meets and games with no home/away yet (playoffs, league finals) show the name alone.
function oppText(sport, opponent, homeAway){
  if(!opponent) return "TBA";
  if(isMeetSport(sport) || !String(homeAway||"").trim()) return clubEsc(opponent);
  return (/away/i.test(homeAway)?tr("at ","en "):"vs ")+clubEsc(opponent);
}
function sportTimeMin(t){ const m=String(t||"").match(/(\d+):(\d+)\s*(AM|PM)/i); if(!m) return 9999; let h=+m[1]%12; if(/PM/i.test(m[3])) h+=12; return h*60+(+m[2]); }
function isoOf(d){ return d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0"+d.getDate()).slice(-2); }
function todayKeyPST(){ return isoOf(nowPST()); }
function isoAddDays(iso, n){ const m=String(iso).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); return m ? isoOf(new Date(+m[1],+m[2]-1,+m[3]+n)) : iso; }
function normIsoDate(s){ return normSheetDate(s); }

/* Seasons: month-based, plus anything with a game near today (see activeSports). */
const SEASON_OF = {};
[["fall",["Football","Cross Country","Field Hockey","Flag Football","Girls Tennis","Girls Volleyball","Boys Water Polo","Girls Water Polo"]],
 ["winter",["Boys Basketball","Girls Basketball","Boys Soccer","Girls Soccer","Wrestling"]],
 ["spring",["Badminton","Baseball","Softball","Golf","Swimming & Diving","Boys Tennis","Track & Field","Boys Volleyball"]]
].forEach(function(pair){ pair[1].forEach(function(s){ SEASON_OF[s]=pair[0]; }); });
function currentSeason(){ const m=nowPST().getMonth()+1; if(m>=8&&m<=10) return "fall"; if(m>=11||m<=2) return "winter"; return "spring"; }
function sportSeason(s){ return SEASON_OF[s]||"other"; }
function activeSports(){
  const today = todayKeyPST(), lo = isoAddDays(today,-7), hi = isoAddDays(today,21), season = currentSeason();
  const set = {};
  sportsGames.forEach(function(g){ if(sportSeason(g.sport)===season || (g.date>=lo && g.date<=hi)) set[g.sport]=1; });
  return Object.keys(set).sort(function(a,b){ return sportRank(a)-sportRank(b) || a.localeCompare(b); });
}
const SPORT_SLUG = {"Football":"football","Cross Country":"cross-country","Field Hockey":"field-hockey","Flag Football":"flag-football","Girls Tennis":"girls-tennis","Girls Volleyball":"girls-volleyball","Boys Water Polo":"boys-water-polo","Girls Water Polo":"girlswaterpolo","Boys Basketball":"boys-basketball","Girls Basketball":"girls-basketball","Boys Soccer":"boys-soccer","Girls Soccer":"girls-soccer","Wrestling":"wrestling","Badminton":"badminton","Baseball":"baseball","Softball":"softball","Golf":"golf","Swimming & Diving":"swimming-and-diving","Boys Tennis":"boys-tennis","Track & Field":"track-and-field","Boys Volleyball":"boys-volleyball"};
function sportPage(s){ return "https://www.fremonthsathletics.org/" + (SPORT_SLUG[s]||""); }

const EVENTS_API = "https://www.fremontasb.org/api/events";
var SPORTS_SKELETON = '<div class="grid cols2">' +
  '<div class="ticket skel"><div class="stub"></div><div class="body"><span class="skl w60"></span><span class="skl w40"></span><span class="skl w80"></span></div></div>'.repeat(4) +
  '</div>';
// Scores for pinned and senior-night games: the website merges the athletics results feed
// server-side and CDN-caches it. Matched on sport + date + level only, so a JV score can
// never land on the Varsity game.
async function loadSportsScoresFast(){
  try{
    const res = await fetch(EVENTS_API); if(!res.ok) return;
    const data = await res.json();
    const games = Array.isArray(data.games) ? data.games : [];
    if(!games.length || !sportsGames) return;
    const key = function(x){ return [x.sport, x.date, x.level].join("|").toLowerCase(); };
    const map = {};
    games.forEach(function(x){ if(x.score) map[key(x)] = x.score; });
    let hit = false;
    sportsGames.forEach(function(g){
      if(g.score) return;
      const r = map[key(g)];
      if(r){ g.score = r; g.section = "result"; hit = true; }
    });
    if(hit){ writeSportsCache(); renderSports(); if(typeof renderEvents==="function") renderEvents(); }
  }catch(e){}
}
// The parsed schedule is cached so Sports paints instantly on open, at any age (the
// "Schedule updated" line says how fresh it is), then refreshes in the background.
const SPORTS_CACHE_KEY = "fh_sports_v3";
function readSportsCache(){
  try{
    localStorage.removeItem("fh_sports_v2"); // older shape, from before the sheet went private
    const c = JSON.parse(localStorage.getItem(SPORTS_CACHE_KEY)||"null");
    if(c && Array.isArray(c.games) && c.games.length) return c;
  }catch(e){}
  return null;
}
function writeSportsCache(){
  try{ if(sportsGames && sportsGames.length) localStorage.setItem(SPORTS_CACHE_KEY, JSON.stringify({ t:Date.now(), games:sportsGames, label:sportsUpdatedLabel })); }catch(e){}
}
function updateSportsStamp(){
  const upd = document.getElementById("sportsUpdated");
  if(upd) setText(upd, sportsUpdatedLabel ? (tr("Schedule updated ","Horario actualizado: ")+sportsUpdatedLabel) : "");
}
// force=true always refetches; otherwise a fetch from the last minute is reused.
async function loadSports(force){
  if(!sportsGames){
    const c = readSportsCache();
    if(c){
      sportsGames = c.games; sportsUpdatedLabel = c.label||""; sportsSig = JSON.stringify(c.games);
      renderSports(); if(typeof renderEvents==="function") renderEvents();
    }
  }
  if(sportsFetching) return;
  if(!force && sportsFetchedAt && Date.now()-sportsFetchedAt < 60000) return;
  sportsFetching = true;
  const b0 = document.getElementById("sportsBody");
  if(b0 && !sportsGames && !/ticket/.test(b0.innerHTML)) b0.innerHTML = SPORTS_SKELETON;
  try{
    const parsed = rowsToGames(parseSheetRows(await fetchCsv(SPORTS_SHEET, 10000)));
    if(!parsed.games.length) throw new Error("no games in the Sports tab");
    sportsFetchedAt = Date.now(); sportsRetry = 0; clearTimeout(sportsRetryTimer);
    sportsUpdatedLabel = parsed.label || sportsUpdatedLabel;
    const sig = JSON.stringify(parsed.games);
    if(sig !== sportsSig || !sportsGames){
      // Only replace (and re-render) when the sheet actually changed, so an open
      // dropdown or a scrolled list isn't disturbed by a background refresh.
      sportsGames = parsed.games; sportsSig = sig;
      writeSportsCache();
      renderSports();
      if(typeof renderEvents==="function") renderEvents();
    } else { writeSportsCache(); updateSportsStamp(); }
    loadSportsScoresFast();
  }catch(e){
    scheduleSportsRetry(); // keep whatever is on screen; try again quietly
  }finally{
    sportsFetching = false;
  }
}
function scheduleSportsRetry(){
  const delays = [5000, 20000, 60000];
  clearTimeout(sportsRetryTimer);
  if(sportsRetry < delays.length) sportsRetryTimer = setTimeout(function(){ loadSports(true); }, delays[sportsRetry++]);
  if(!sportsGames && sportsRetry >= 2){
    // Nothing cached and the first tries failed: a calm note instead of an endless skeleton.
    const b = document.getElementById("sportsBody");
    if(b) b.innerHTML = '<p class="note">The schedule will show here in a moment. Every team\'s full schedule is also on <a href="https://www.fremonthsathletics.org" target="_blank" rel="noopener">fremonthsathletics.org</a>.</p>';
  }
}
function rowsToGames(rows){
  let label = "";
  if(!rows || rows.length<2) return { games:[], label:"" };
  const head = rows[0].map(function(h){ return String(h).trim().toLowerCase(); });
  const gi = function(n){ return head.indexOf(n); };
  const col = function(r,n){ const i=gi(n); return i>=0?String(r[i]||"").trim():""; };
  // SportsSync stamps "Auto-updated Oct 12, 2026 12:38 PM — 432 rows" in the header row.
  rows[0].forEach(function(c){ const m=String(c||"").match(/Auto-updated\s+(.*)/); if(m) label = m[1].replace(/\s+—.*/,"").replace(/,\s*\d{4}\s+/,", ").trim(); });
  const out = [];
  for(let i=1;i<rows.length;i++){ const r=rows[i];
    const sport = col(r,"sport"), date = normIsoDate(col(r,"date"));
    if(!sport || !date) continue;
    if(/rancho\s*san\s*antonio/i.test(r.join(" "))) continue; // Rancho San Antonio = XC practice, not an event
    const title = col(r,"title"), sn = col(r,"seniornight"), ha = col(r,"homeaway");
    out.push({
      sport:sport, date:date, time:col(r,"time"), level:col(r,"level"),
      home:/home/i.test(ha), homeAway:ha,
      opponent:(function(o){ o=String(o||"").replace(/^\s*(vs\.?|at)\s+/i,"").trim(); return /^opponent$/i.test(o)?"":o; })(col(r,"opponent")),
      location:col(r,"location"), type:col(r,"type"), title:title,
      section:col(r,"section").toLowerCase(), score:col(r,"score"),
      senior: sheetYes(sn) || /senior\s*night/i.test(sn) || /senior\s*night/i.test(title),
      push: sheetYes(gi("push")>=0 ? col(r,"push") : r[0]),
      kind:col(r,"kind") || (/scrimmage/i.test(col(r,"type"))?"Scrimmage":"Game"),
      league:/league/i.test(col(r,"type"))
    });
  }
  // Defensive de-dup of feed twins: same sport, date, level and start time (meets: any
  // time) AND the same opponent, or one side is a placeholder. Tournament days with
  // several opponents stay separate games.
  const placeholder = function(o){ return !o || /^(tba|tbd|meet|opponent|at opponent)$/i.test(o); };
  const richness = function(x){ return (x.opponent?2:0)+(x.score?1:0)+(x.time?0.5:0)+String(x.opponent||"").length*0.001; };
  const groups = {}, dd = [];
  out.forEach(function(g){
    const base = [g.sport, g.date, g.level, isMeetSport(g.sport)?"":g.time].join("|").toLowerCase();
    const list = groups[base] || (groups[base] = []);
    const opp = String(g.opponent||"").toLowerCase();
    let hit = null;
    for(let j=0;j<list.length;j++){ const co = String(list[j].opponent||"").toLowerCase(); if(co===opp || placeholder(co) || placeholder(opp)){ hit = list[j]; break; } }
    if(!hit){ list.push(g); dd.push(g); return; }
    const push = hit.push||g.push, senior = hit.senior||g.senior, score = hit.score||g.score;
    if(richness(g) > richness(hit)) Object.assign(hit, g);
    hit.push = push; hit.senior = senior; if(!hit.score) hit.score = score;
  });
  return { games:dd, label:label };
}
function isSeniorNight(g){ return !!(g && (g.senior || /senior\s*(night|day)/i.test(String(g.title||"")))); }
const SP_MO=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MO_ES=["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
function fmtDateShort(date){ const m=String(date||"").match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); return m?tr(SP_MO[+m[2]-1]+" "+(+m[3]), (+m[3])+" "+MO_ES[+m[2]-1]):"TBA"; }
// A game is a result once athletics marks it one, a score is in, its day has passed, or
// it started more than 3 hours ago today.
function isResultGame(g, today){
  today = today || todayKeyPST();
  if(g.section==="result" || String(g.score||"").trim()) return true;
  if(!g.date || g.date > today) return false;
  if(g.date < today) return true;
  const t = sportTimeMin(g.time); if(t>=9999) return false;
  const n = nowPST(); return n.getHours()*60+n.getMinutes() >= t+180;
}
function byDateTime(a,b){ return String(a.date).localeCompare(String(b.date)) || sportTimeMin(a.time)-sportTimeMin(b.time); }
function resultLine(g){
  const sc = String(g.score||"").trim();
  if(sc) return 'Final: '+clubEsc(sc);
  if(/scrimmage/i.test(g.kind||g.type||"")) return "";
  if(isMeetSport(g.sport)) return '<a href="'+sportPage(g.sport)+'" target="_blank" rel="noopener">Results on the team page</a>';
  return (g.date && g.date < isoAddDays(todayKeyPST(),-3)) ? "Score not posted yet" : "Score coming soon";
}
/* Sport and Level filters: an in-page dropdown (a button plus a listbox) instead of a
   native <select>. The list opens directly under its field inside the page flow, so CSS
   zoom (Large text) or an embedded browser can't put it somewhere else. A background
   refresh never rebuilds or closes an open list: new options wait until it closes.
   Keys: Enter, Space or the arrows open it; arrows, Home and End move; Enter or Space
   picks; Escape or Tab closes and returns focus to the field; typing a letter jumps. */
const DROPDOWNS = {};
function ddInit(id, onPick){
  const btn = document.getElementById(id), list = document.getElementById(id+"List");
  if(!btn || !list) return;
  const dd = DROPDOWNS[id] = { id:id, btn:btn, list:list, wrap:btn.parentNode, items:[], value:"all", key:"", open:false, pending:null, active:0, onPick:onPick };
  btn.addEventListener("click", function(){ if(dd.open) ddClose(dd, true); else ddOpen(dd); });
  // Safari and iOS don't focus a pressed button, they just blur the open list, which would
  // close it before the click reopens it. Keeping focus in the list lets the click close it.
  btn.addEventListener("mousedown", function(e){ if(dd.open) e.preventDefault(); });
  btn.addEventListener("keydown", function(e){
    if(e.key==="ArrowDown" || e.key==="ArrowUp"){ e.preventDefault(); ddOpen(dd); }
  });
  list.addEventListener("click", function(e){
    const o = e.target.closest && e.target.closest('[role="option"]');
    if(o) ddPick(dd, +o.getAttribute("data-i"));
  });
  list.addEventListener("mousemove", function(e){
    const o = e.target.closest && e.target.closest('[role="option"]');
    if(o && +o.getAttribute("data-i")!==dd.active) ddActive(dd, +o.getAttribute("data-i"), false);
  });
  list.addEventListener("keydown", function(e){
    const n = dd.items.length, k = e.key;
    if(k==="ArrowDown"){ e.preventDefault(); ddActive(dd, Math.min(n-1, dd.active+1), true); }
    else if(k==="ArrowUp"){ e.preventDefault(); ddActive(dd, Math.max(0, dd.active-1), true); }
    else if(k==="Home"){ e.preventDefault(); ddActive(dd, 0, true); }
    else if(k==="End"){ e.preventDefault(); ddActive(dd, n-1, true); }
    else if(k==="PageDown"){ e.preventDefault(); ddActive(dd, dd.active+5, true); }
    else if(k==="PageUp"){ e.preventDefault(); ddActive(dd, dd.active-5, true); }
    else if(k==="Enter" || k===" "){ e.preventDefault(); ddPick(dd, dd.active); }
    else if(k==="Escape"){ e.preventDefault(); ddClose(dd, true); }
    else if(k==="Tab"){ ddClose(dd, true); } // focus goes back to the field, then Tab moves on from there
    else if(k.length===1 && /\S/.test(k)){
      const q = k.toLowerCase();
      for(let j=1;j<=n;j++){ const i=(dd.active+j)%n; if(String(dd.items[i].label).toLowerCase().charAt(0)===q){ ddActive(dd, i, true); break; } }
    }
  });
  list.addEventListener("focusout", function(e){
    if(dd.open && !(e.relatedTarget && dd.wrap.contains(e.relatedTarget))) ddClose(dd, false);
  });
}
// Outside tap or click closes an open list without moving focus.
document.addEventListener("pointerdown", function(e){
  Object.keys(DROPDOWNS).forEach(function(id){ const dd=DROPDOWNS[id]; if(dd.open && !dd.wrap.contains(e.target)) ddClose(dd, false); });
});
function ddRender(dd){
  dd.list.innerHTML = dd.items.map(function(it, i){
    return '<li role="option" class="dd-opt" id="'+dd.id+'-opt'+i+'" data-i="'+i+'" aria-selected="'+(it.v===dd.value)+'">'+
      '<span class="dd-name">'+clubEsc(it.label)+'</span>'+
      (it.count!=null ? '<span class="dd-count">'+it.count+' '+tr("upcoming","próximos")+'</span>' : '')+'</li>';
  }).join("");
}
function ddLabel(dd){
  const it = dd.items.filter(function(x){ return x.v===dd.value; })[0];
  const val = dd.btn.querySelector(".dd-val");
  if(val) setText(val, it ? it.label : "");
}
// items: [{ v, label, count }]. Safe to call on every render.
function ddSet(id, items, value){
  const dd = DROPDOWNS[id]; if(!dd) return;
  if(dd.open){ dd.pending = { items:items, value:value }; return; }
  const key = JSON.stringify(items);
  if(key!==dd.key || value!==dd.value){ dd.items = items; dd.value = value; dd.key = key; ddRender(dd); }
  ddLabel(dd);
}
function ddActive(dd, i, scroll){
  if(!dd.items.length) return;
  i = Math.max(0, Math.min(dd.items.length-1, i));
  const prev = dd.list.querySelector(".dd-opt.active"); if(prev) prev.classList.remove("active");
  const o = document.getElementById(dd.id+"-opt"+i);
  dd.active = i;
  if(!o) return;
  o.classList.add("active");
  dd.list.setAttribute("aria-activedescendant", o.id);
  if(scroll){ // keep the active row in view inside the list, without moving the page
    const top = o.offsetTop, bottom = top + o.offsetHeight, L = dd.list;
    if(top < L.scrollTop) L.scrollTop = top - 4;
    else if(bottom > L.scrollTop + L.clientHeight) L.scrollTop = bottom - L.clientHeight + 4;
  }
}
function ddOpen(dd){
  if(dd.open) return;
  Object.keys(DROPDOWNS).forEach(function(id){ if(DROPDOWNS[id].open) ddClose(DROPDOWNS[id], false); });
  dd.open = true;
  dd.btn.setAttribute("aria-expanded", "true");
  dd.list.hidden = false;
  document.body.classList.add("dd-open"); // hides the Ask Felipe button over the list
  let i = 0; dd.items.forEach(function(x, j){ if(x.v===dd.value) i = j; });
  dd.list.scrollTop = 0;
  ddActive(dd, i, true);
  dd.list.focus({ preventScroll:true });
  // If the list runs past the bottom nav, scroll the page just enough to show it.
  const r = dd.list.getBoundingClientRect(), navH = 76;
  if(r.bottom > window.innerHeight - navH){
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollBy({ top: Math.min(r.bottom - (window.innerHeight - navH), r.top - 80), behavior: reduce ? "auto" : "smooth" });
  }
}
function ddClose(dd, refocus){
  if(!dd.open) return;
  dd.open = false;
  dd.btn.setAttribute("aria-expanded", "false");
  dd.list.hidden = true;
  document.body.classList.remove("dd-open");
  dd.list.removeAttribute("aria-activedescendant");
  if(refocus) dd.btn.focus();
  if(dd.pending){ const p = dd.pending; dd.pending = null; ddSet(dd.id, p.items, p.value); }
}
function ddPick(dd, i){
  const it = dd.items[i]; if(!it) return;
  const changed = it.v!==dd.value;
  ddClose(dd, true);
  if(changed){ dd.value = it.v; ddRender(dd); ddLabel(dd); dd.onPick(it.v); }
}

function renderSports(){
  const body = document.getElementById("sportsBody");
  if(!body) return;
  const filters = document.getElementById("sportFilters");
  if(!sportsGames || !sportsGames.length){ if(filters) filters.hidden = true; updateSportsStamp(); return; }
  if(filters) filters.hidden = false;
  const today = todayKeyPST();
  const sports = activeSports();
  if(sportFilter!=="all" && sports.indexOf(sportFilter)<0) sportFilter = "all";

  // Each option shows how many upcoming games it has.
  const upNow = sportsGames.filter(function(g){ return !isResultGame(g,today); });
  const upOf = function(s){ return upNow.filter(function(g){ return g.sport===s; }).length; };
  ddSet("sportSelect", [{ v:"all", label:tr("All sports","Todos los deportes"), count:upNow.filter(function(g){ return sports.indexOf(g.sport)>=0; }).length }]
    .concat(sports.map(function(s){ return { v:s, label:s, count:upOf(s) }; })), sportFilter);
  const levelPool = sportsGames.filter(function(g){ return sportFilter==="all" ? sports.indexOf(g.sport)>=0 : g.sport===sportFilter; });
  const levels = [];
  levelPool.forEach(function(g){ levelParts(g.level).forEach(function(p){ if(levels.indexOf(p)<0) levels.push(p); }); });
  levels.sort(function(a,b){ return levelRank(a)-levelRank(b) || a.localeCompare(b); });
  if(sportLevel!=="all" && levels.indexOf(sportLevel)<0) sportLevel = "all";
  const levelUp = levelPool.filter(function(g){ return !isResultGame(g,today); });
  const upAtLevel = function(l){ return levelUp.filter(function(g){ const p=levelParts(g.level); return !p.length || p.indexOf(l)>=0; }).length; };
  ddSet("levelSelect", [{ v:"all", label:tr("All levels","Todos los niveles"), count:levelUp.length }]
    .concat(levels.map(function(l){ return { v:l, label:l, count:upAtLevel(l) }; })), sportLevel);
  updateSportsStamp();

  function gameCard(g, isResult){
    const sr = isSeniorNight(g);
    const m = String(g.date||"").match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    const mo = m?tr(SP_MO[+m[2]-1], MO_ES[+m[2]-1]):"TBA", day = m?+m[3]:"";
    const tags = [];
    if(String(g.homeAway||"").trim()) tags.push('<span class="tag'+(g.home?' free':'')+'">'+(g.home?'Home':'Away')+'</span>');
    if(g.league) tags.push('<span class="tag">League</span>');
    if(/scrimmage/i.test(g.kind||g.type||"")) tags.push('<span class="tag">Scrimmage</span>');
    if(g.push) tags.unshift('<span class="tag star">&#9733; Featured</span>');
    if(sr) tags.unshift('<span class="tag star">&#9733; Senior Night</span>');
    const line2 = isResult ? resultLine(g) : [g.time, g.location].filter(Boolean).map(clubEsc).join(" &middot; ");
    const vs = g.opponent ? oppText(g.sport, g.opponent, g.homeAway) : "";
    return '<article class="ticket'+(sr?' senior':'')+'"><div class="stub" aria-hidden="true"><span class="mo">'+mo+'</span><span class="day">'+day+'</span></div>'+
      '<div class="body"><h3>'+clubEsc(g.sport||"")+(g.level?(' &middot; '+clubEsc(g.level)):"")+'</h3>'+
      (vs?('<p class="meta">'+vs+'</p>'):"")+
      (line2?('<p>'+line2+'</p>'):"")+
      tags.join(" ")+'</div></article>';
  }
  const sechead = function(id, text){ return '<div class="sechead"><h2 id="'+id+'" style="font-size:20px">'+text+'</h2><span class="rule" aria-hidden="true"></span></div>'; };
  const byDateLevel = function(a,b){ return String(a.date).localeCompare(String(b.date)) || levelRank(a.level)-levelRank(b.level) || sportTimeMin(a.time)-sportTimeMin(b.time); };
  let html = "";

  if(sportFilter==="all"){
    // Featured (push=y): the next pinned game per sport (Varsity first on the same day),
    // then pinned results from the last 7 days.
    const pushed = sportsGames.filter(function(g){ return g.push && levelFits(g); });
    const seen = {}, pu = [];
    pushed.filter(function(g){ return !isResultGame(g,today); }).sort(byDateLevel).forEach(function(g){ if(!seen[g.sport]){ seen[g.sport]=1; pu.push(g); } });
    const weekAgo = isoAddDays(today,-7);
    const pr = pushed.filter(function(g){ return isResultGame(g,today) && g.date>=weekAgo; })
      .sort(function(a,b){ return String(b.date).localeCompare(String(a.date)) || levelRank(a.level)-levelRank(b.level); }).slice(0,4);
    if(pu.length || pr.length){
      html += '<section aria-labelledby="h-featured" style="margin-bottom:var(--space-5)">'+sechead("h-featured","&#9733; Featured")+
        '<div class="grid cols2">'+pu.map(function(g){ return gameCard(g,false); }).concat(pr.map(function(g){ return gameCard(g,true); })).join("")+'</div></section>';
    }

    html += '<section aria-labelledby="h-inseason">'+sechead("h-inseason","Teams in season");
    html += '<div class="sportgrid">'+sports.map(function(sp){
      const next = sportsGames.filter(function(g){ return g.sport===sp && !isResultGame(g,today); }).sort(byDateLevel)[0];
      const nx = next ? (fmtDateShort(next.date)+' &middot; '+oppText(sp, next.opponent, next.homeAway)) : tr('No upcoming '+eventNoun(sp,true), 'Sin '+eventNounEs(sp,true)+' por ahora');
      return '<button type="button" class="sportcard" data-sportpick="'+clubEsc(sp)+'">'+
        '<div class="sportcard-top"><span class="sportcard-name">'+clubEsc(sp)+'</span></div>'+
        '<div class="sportcard-next"><span class="sportcard-lbl">NEXT</span> '+nx+'</div>'+
        '<span class="sportcard-cta">View '+eventNoun(sp,true)+' &rarr;</span></button>';
    }).join("")+'</div></section>';

    const up = sportsGames.filter(function(g){ return sports.indexOf(g.sport)>=0 && !isResultGame(g,today) && levelFits(g); }).sort(byDateTime);
    const weekEnd = isoAddDays(today,7);
    const week = up.filter(function(g){ return g.date <= weekEnd; });
    const shown = sportsShowAll ? up : (week.length ? week : up.slice(0,6));
    const heading = sportsShowAll ? "All upcoming" : (week.length ? "This week" : "Coming up");
    html += '<section style="margin-top:var(--space-5)" aria-labelledby="h-thisweek">'+sechead("h-thisweek", heading);
    if(up.length){
      html += '<div class="grid cols2">'+shown.map(function(g){ return gameCard(g,false); }).join("")+'</div>';
      if(!sportsShowAll && up.length>shown.length) html += '<div style="text-align:center;margin-top:var(--space-3)"><button type="button" class="btn ghost" id="sportsViewAll">'+tr('View all '+up.length+' upcoming','Ver los '+up.length+' próximos')+'</button></div>';
    } else html += '<p class="note">No upcoming games are listed right now.</p>';
    html += '</section>';
  } else {
    // One sport: a header, then its schedule and results.
    const inFilter = function(g){ return g.sport===sportFilter && levelFits(g); };
    const upcoming = [], results = [];
    sportsGames.filter(inFilter).forEach(function(g){ if(isResultGame(g,today)) results.push(g); else upcoming.push(g); });
    upcoming.sort(byDateTime);
    results.sort(function(a,b){ return String(b.date).localeCompare(String(a.date)) || sportTimeMin(b.time)-sportTimeMin(a.time); });
    const levelsHere = [];
    sportsGames.forEach(function(g){ if(g.sport===sportFilter) levelParts(g.level).forEach(function(p){ if(levelsHere.indexOf(p)<0) levelsHere.push(p); }); });
    levelsHere.sort(function(a,b){ return levelRank(a)-levelRank(b); });
    const seasonName = sportSeason(sportFilter);
    const next = upcoming[0];
    html += '<section class="sporthero"><div class="sporthero-top"><h2>'+clubEsc(sportFilter)+'</h2></div>'+
      '<p class="sporthero-meta">'+(seasonName==="other" ? "" : tr(seasonName.charAt(0).toUpperCase()+seasonName.slice(1)+' season', 'Temporada de '+{fall:"otoño",winter:"invierno",spring:"primavera"}[seasonName]))+(levelsHere.length?((seasonName==="other"?"":" &middot; ")+levelsHere.map(clubEsc).join(", ")):'')+'</p>'+
      (next?('<p class="sporthero-next"><b>'+tr('Next '+eventNoun(sportFilter,false), (isMeetSport(sportFilter)?'Próxima ':'Próximo ')+eventNounEs(sportFilter,false))+':</b> '+fmtDateShort(next.date)+(next.time?(tr(' at ',' a las ')+clubEsc(next.time)):'')+' &middot; '+oppText(sportFilter, next.opponent, next.homeAway)+(next.location?(' &middot; '+clubEsc(next.location)):'')+'</p>'):'')+
      '<p style="margin:10px 0 0"><a class="btn ghost" style="font-size:13px" href="'+sportPage(sportFilter)+'" target="_blank" rel="noopener">Team page &amp; roster &rarr;</a></p></section>';

    const nounP = eventNoun(sportFilter, true);
    const weekEnd = isoAddDays(today,7);
    const week = upcoming.filter(function(g){ return g.date <= weekEnd; });
    const shown = sportsShowAll ? upcoming : (week.length ? week : upcoming.slice(0,4));
    html += '<section style="margin-top:var(--space-5)" aria-labelledby="h-upsp">'+sechead("h-upsp", "Upcoming "+nounP);
    if(upcoming.length){
      html += '<div class="grid cols2">'+shown.map(function(g){ return gameCard(g,false); }).join("")+'</div>';
      if(!sportsShowAll && upcoming.length>shown.length) html += '<div style="text-align:center;margin-top:var(--space-3)"><button type="button" class="btn ghost" id="sportsViewAll">'+tr('View all '+upcoming.length+' '+nounP, (isMeetSport(sportFilter)?'Ver las ':'Ver los ')+upcoming.length+' '+eventNounEs(sportFilter,true))+'</button></div>';
    } else html += '<p class="note">'+tr('No upcoming '+nounP+' are listed right now.', 'Por ahora no hay '+eventNounEs(sportFilter,true)+' en el calendario.')+'</p>';
    html += '</section>';
    if(results.length){
      const rShown = sportsResultsAll ? results : results.slice(0,12);
      html += '<section style="margin-top:var(--space-5)" aria-labelledby="h-resp">'+sechead("h-resp","Recent results");
      html += '<div class="grid cols2">'+rShown.map(function(g){ return gameCard(g,true); }).join("")+'</div>';
      if(!sportsResultsAll && results.length>rShown.length) html += '<div style="text-align:center;margin-top:var(--space-3)"><button type="button" class="btn ghost" id="sportsResultsAll">'+tr('Show all '+results.length+' results','Ver los '+results.length+' resultados')+'</button></div>';
      html += '</section>';
    }
  }
  body.innerHTML = html;
}
ddInit("sportSelect", function(v){ sportFilter = v; sportLevel = "all"; sportsShowAll = false; sportsResultsAll = false; renderSports(); });
ddInit("levelSelect", function(v){ sportLevel = v; sportsShowAll = false; sportsResultsAll = false; renderSports(); });
document.getElementById("sportsBody").addEventListener("click", function(e){
  const pick = e.target.closest && e.target.closest("[data-sportpick]");
  if(pick){ sportFilter = pick.getAttribute("data-sportpick"); sportLevel = "all"; sportsShowAll = false; sportsResultsAll = false; renderSports(); window.scrollTo(0,0); return; }
  if(e.target.closest("#sportsViewAll")){ sportsShowAll = true; renderSports(); }
  if(e.target.closest("#sportsResultsAll")){ sportsResultsAll = true; renderSports(); }
});

function todayKey(){
  const wd = nowPST().getDay(); // 0 Sun … 6 Sat, in Fremont's time zone
  if(wd===1) return "mon";
  if(wd===2||wd===4) return "a";
  if(wd===3||wd===5) return "b";
  return null;
}
function toMin(t){ // "8:30" → minutes since midnight; hours < 7 are PM (school runs 7:35am–3:50pm)
  let [h,m] = t.split(":").map(Number);
  if(h<7) h+=12;
  return h*60+m;
}
function nowMinPST(){ const n=nowPST(); return n.getHours()*60+n.getMinutes(); }
// Special-week text goes through the same EN→ES dictionary as the page.
function weekT(s){ return (typeof fhLang!=="undefined" && fhLang==="es" && typeof I18N_EN_ES!=="undefined" && I18N_EN_ES[s]) || s; }

/* --- render a table body of [name,start,end] rows (live-highlights now) --- */
function rowsHTML(rows, live){
  const nowMin=nowMinPST();
  return rows.map(r=>{
    const isLive = live && nowMin>=toMin(r[1]) && nowMin<toMin(r[2]);
    return "<tr"+(isLive?' class="live"':"")+"><td>"+periodName(r[0])+(isLive?' <span class="sr">'+tr("(happening now)","(en curso)")+'</span>':"")+
      '</td><td class="t">'+r[1]+'</td><td class="t">'+r[2]+"</td></tr>";
  }).join("");
}
/* --- render a full special week (all five days) --- */
function renderWeek(week){
  const host=document.getElementById("weekView");
  const note=document.getElementById("weekNote");
  note.textContent = (week.dates ? weekT(week.dates)+". " : "") + (week.note ? weekT(week.note) : "");
  host.innerHTML = week.days.map(day=>{
    const head='<div class="schedday-h"><b>'+weekT(day.d)+'</b><span>'+weekT(day.label)+'</span></div>';
    const body = (day.off || !day.rows)
      ? '<p class="schedday-off">'+tr("No school","Sin clases")+' · '+weekT(day.off||"")+'</p>'
      : '<div class="schedwrap"><table><caption class="sr">'+weekT(day.d)+' '+weekT(day.label)+'</caption>'+
        '<thead><tr><th scope="col">'+tr("Period","Periodo")+'</th><th scope="col">'+tr("Starts","Empieza")+'</th><th scope="col">'+tr("Ends","Termina")+'</th></tr></thead>'+
        '<tbody>'+rowsHTML(day.rows,false)+'</tbody></table></div>';
    return '<div class="schedday">'+head+body+'</div>';
  }).join("");
}
let pickedWeek = -1;
/* --- wire the Normal/Special toggle + week picker --- */
function initSchedule(){
  const sel=document.getElementById("weekPick");
  sel.innerHTML='<option value="">Pick a week…</option>'+
    SPECIAL_WEEKS.map((w,i)=>'<option value="'+i+'">'+w.name+'</option>').join("");
  sel.addEventListener("change",e=>{
    const v=e.target.value;
    if(v===""){ pickedWeek=-1; document.getElementById("weekView").innerHTML=""; document.getElementById("weekNote").textContent=""; return; }
    pickedWeek=+v; renderWeek(SPECIAL_WEEKS[+v]);
  });
  document.querySelectorAll(".segmented button").forEach(b=>
    b.addEventListener("click", ()=>{
      const mode=b.dataset.mode;
      document.querySelectorAll(".segmented button").forEach(x=>x.setAttribute("aria-pressed", x===b?"true":"false"));
      document.getElementById("schedNormal").hidden = mode!=="normal";
      document.getElementById("schedSpecial").hidden = mode!=="special";
      if(mode==="special" && !sel.value){ sel.value="0"; pickedWeek=0; renderWeek(SPECIAL_WEEKS[0]); }
    }));
}

/* What applies today, in Fremont's time zone: null on a weekend; { noSchool, rows:[] } on
   a day with no classes (NO_CLASSES, or summer); else the bell schedule for the day,
   including the dated A/B swaps in SPECIAL_DAYS. */
function todaySchedule(){
  const iso = todayKeyPST(), k = SPECIAL_DAYS[iso] || todayKey();
  if(!k) return null;
  const off = noClassReason(iso);
  if(off) return { noSchool:tr(off[0], off[1]), off:off, rows:[], next:nextClassDay(iso) };
  const label = SPECIAL_DAYS[iso] ? tr(k==="a"?"A day":"B day", k==="a"?"Día A":"Día B") : tr(SCHEDULES[k].label, SCHED_LABEL_ES[k]);
  return { label:label, rows:SCHEDULES[k].rows };
}

let pickedDay="auto";
function renderDay(day){
  const body=document.getElementById("schedBody");
  const rows=day.rows||[];
  const live = pickedDay==="auto";
  if(day.noSchool && !rows.length){
    const off = day.off || [day.noSchool, day.noSchool];
    body.innerHTML='<tr><td colspan="3">'+tr("Today is "+off[0]+", so there are no classes."+(day.next?" Classes start again "+longDayLabel(day.next)+".":""),
      "Hoy no hay clases ("+off[1]+")."+(day.next?" Las clases vuelven el "+longDayLabel(day.next):""))+
      ' '+tr("Pick a day above to see its bell schedule.","Elige un día arriba para ver su horario.")+'</td></tr>';
  } else if(!rows.length){
    body.innerHTML='<tr><td colspan="3">'+tr("No periods listed for this day.","No hay periodos para este día.")+'</td></tr>';
  } else {
    body.innerHTML=rowsHTML(rows, live);
  }
}
function renderToday(){
  const t=todaySchedule();
  if(t) renderDay(t);
  else document.getElementById("schedBody").innerHTML='<tr><td colspan="3">'+tr("It's the weekend, so no school. Pick a day above to preview.","Es fin de semana, así que no hay clases. Elige un día arriba para ver su horario.")+'</td></tr>';
  document.querySelectorAll(".daypick button").forEach(b=>
    b.setAttribute("aria-pressed", b.dataset.day==="auto" ? "true":"false"));
}
document.querySelectorAll(".daypick button").forEach(b=>
  b.addEventListener("click", ()=>{
    if(b.dataset.day==="auto"){ pickedDay="auto"; renderToday(); return; }
    pickedDay=b.dataset.day;
    renderDay({rows:SCHEDULES[pickedDay].rows});
    document.querySelectorAll(".daypick button").forEach(x=>
      x.setAttribute("aria-pressed", x===b ? "true":"false"));
  }));

const RING = 2*Math.PI*66;
function tickClock(){
  const sched = todaySchedule();
  const nowP = document.getElementById("nowPeriod");
  const sub = document.getElementById("nowSub");
  const ringT = document.getElementById("ringTime");
  const ringL = document.getElementById("ringLabel");
  const prog = document.getElementById("ringProg");
  // An empty ring hides its progress cap (a round cap would leave a dot at the top).
  prog.style.opacity = (sched && sched.rows.length) ? "1" : "0";
  if(!sched){
    setText(nowP, tr("No school today","Hoy no hay clases"));
    setText(sub, tr("Enjoy the weekend, Firebird.","Disfruta el fin de semana, Firebird."));
    setText(ringT, "--"); setText(ringL, tr("rest up","descansa"));
    prog.style.strokeDashoffset = RING; return;
  }
  if(sched.noSchool && !sched.rows.length){
    setText(nowP, tr("No classes today","Hoy no hay clases"));
    setText(sub, sched.noSchool+"."+(sched.next ? tr(" Classes start again "+longDayLabel(sched.next)+"."," Las clases vuelven el "+longDayLabel(sched.next)) : ""));
    setText(ringT, "--"); setText(ringL, tr("day off","día libre"));
    prog.style.strokeDashoffset = RING; return;
  }
  const now = nowPST();
  const nowMin = now.getHours()*60 + now.getMinutes() + now.getSeconds()/60;
  // Staff-only blocks (B-day Collaboration) stay in the table but aren't a student's period.
  const rows = sched.rows.filter(function(r){ return !/staff only/i.test(r[0]); });
  let cur=null, next=null;
  for(const r of rows){
    const s=toMin(r[1]), e=toMin(r[2]);
    if(nowMin>=s && nowMin<e){ cur={r,s,e}; break; }
    if(nowMin<s && !next){ next={r,s}; }
  }
  if(cur){
    const left = cur.e - nowMin;
    const mins = Math.floor(left), secs = Math.min(59, Math.round((left-mins)*60));
    setText(nowP, periodName(cur.r[0]));
    setText(sub, tr("Ends at ","Termina a las ")+cur.r[2]+" · "+sched.label);
    ringT.textContent = mins+":"+String(secs).padStart(2,"0");
    setText(ringL, tr("left","restante"));
    prog.style.strokeDashoffset = RING * (1 - left/(cur.e-cur.s));
  } else if(next && next.s === toMin(rows[0][1])){
    // Before the first class: a countdown in the last 90 minutes, never "Passing".
    const until = next.s - nowMin;
    setText(nowP, tr("School hasn't started","Las clases no han empezado"));
    setText(sub, tr(periodName(rows[0][0])+" starts at "+rows[0][1], periodName(rows[0][0])+" empieza a las "+rows[0][1])+" · "+sched.label);
    if(until <= 90){
      ringT.textContent = Math.floor(until)+":"+String(Math.min(59,Math.round((until-Math.floor(until))*60))).padStart(2,"0");
      setText(ringL, tr("until class","para la clase"));
    } else { setText(ringT, "--"); setText(ringL, tr("soon","pronto")); }
    prog.style.strokeDashoffset = RING; prog.style.opacity = "0";
  } else if(next){
    const until = next.s - nowMin;
    setText(nowP, tr("Passing · up next ","Cambio de clase · sigue ")+periodName(next.r[0]));
    setText(sub, tr(periodName(next.r[0])+" starts at "+next.r[1], periodName(next.r[0])+" empieza a las "+next.r[1])+" · "+sched.label);
    ringT.textContent = Math.floor(until)+":"+String(Math.min(59,Math.round((until-Math.floor(until))*60))).padStart(2,"0");
    setText(ringL, tr("until next","para el siguiente"));
    prog.style.strokeDashoffset = RING*0.02;
  } else {
    const first=toMin(rows[0][1]);
    setText(nowP, nowMin < first ? tr("School hasn't started","Las clases no han empezado") : tr("School's out","Terminaron las clases"));
    setText(sub, sched.label);
    setText(ringT, "--"); setText(ringL, nowMin < first ? tr("soon","pronto") : tr("see you","hasta pronto"));
    prog.style.strokeDashoffset = RING; prog.style.opacity = "0";
  }
}

/* =====================================================
   Spirit form (validation + duplicate guard)
===================================================== */
const submittedKeys = new Set(); // session duplicate guard: studentId + day
let fitPassed = false;           // gate: a passing fit check unlocks submit
function setBad(id, bad){ document.getElementById(id).closest(".field").classList.toggle("bad", bad); return !bad; }
document.getElementById("spiritForm").addEventListener("submit", e=>{
  e.preventDefault();
  if(!fitPassed){
    const h=document.getElementById("spSubmitHint"); if(h) h.hidden=false;
    const fb=document.getElementById("fitBtn"); if(fb) fb.focus();
    return;
  }
  const name = document.getElementById("spName");
  const grade = document.getElementById("spGrade");
  const sid = document.getElementById("spId");
  const day = document.getElementById("spDay");
  const photo = document.getElementById("spPhoto");
  let ok = true;
  ok = setBad("spName", name.value.trim().split(/\s+/).length < 2) && ok;
  ok = setBad("spGrade", !grade.value) && ok;
  ok = setBad("spId", !/^\d{5,7}$/.test(sid.value.trim())) && ok;
  ok = setBad("spDay", !day.value) && ok;
  ok = setBad("spPhoto", photo.files.length===0) && ok;
  const msg = document.getElementById("spiritOk");
  if(!ok){
    msg.classList.remove("show");
    const firstBad = document.querySelector("#spiritForm .field.bad input, #spiritForm .field.bad select");
    if(firstBad) firstBad.focus();
    return;
  }
  const key = sid.value.trim()+"|"+day.value;
  if(submittedKeys.has(key)){
    msg.textContent = "Already counted! You've submitted for that day. One dress-up point per day per Firebird.";
    msg.classList.add("show"); msg.focus();
    return;
  }
  submittedKeys.add(key);
  const btn = document.getElementById("spSubmit");
  btn.disabled = true; btn.textContent = "Sending…";
  (async ()=>{
    let text;
    try{
      const res = await apiPost({ action:"spirit", name:name.value.trim(), grade:grade.value,
        sid:sid.value.trim(), day:day.value });
      if(res && !res.ok && /already/i.test(res.error||"")) text = "Already counted! One dress-up point per day per Firebird.";
      else if(res && !res.ok) throw new Error(res.error);
      else text = res ? "Sent! Spirit will verify your photo and post the point."
                      : "Looks good! (Demo mode. ASB Tech deploys the backend to make this real.)";
    }catch(err){ text = "Hmm, that didn’t send. Check your connection and try again."; submittedKeys.delete(key); }
    btn.textContent = "Send it in · +1 pt";
    msg.textContent = text;
    msg.classList.add("show"); msg.focus();
    e.target.reset();
  })();
});

/* =====================================================
   Spirit Fit Check — on-device outfit vs. theme (vision.js)
===================================================== */
(function(){
  const photo = document.getElementById("spPhoto");
  const dayEl = document.getElementById("spDay");
  const gradeEl = document.getElementById("spGrade");
  const wrap = document.getElementById("fitCheck");
  const img  = document.getElementById("fitImg");
  const btn  = document.getElementById("fitBtn");
  const res  = document.getElementById("fitResult");
  const verdict = document.getElementById("fitVerdict");
  const title = document.getElementById("fitTitle");
  const sub   = document.getElementById("fitSub");
  const saw   = document.getElementById("fitSaw");
  const submitBtn = document.getElementById("spSubmit");
  const submitHint = document.getElementById("spSubmitHint");
  if(!photo || !btn || !window.SpiritVision) return;

  let objURL = null;
  const ICON = {
    yes:'<svg viewBox="0 0 24 24" width="21" height="21" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#14532D"/><path d="M7.5 12.5l3 3L16.5 9" stroke="#DCEFE1" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    no:'<svg viewBox="0 0 24 24" width="21" height="21" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#8F1106"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="#FFE0DD" stroke-width="2.5" stroke-linecap="round"/></svg>'
  };
  function setFitPassed(v){
    fitPassed = !!v;
    if(submitBtn) submitBtn.disabled = !fitPassed;
    if(submitHint) submitHint.hidden = fitPassed;
  }
  setFitPassed(false);

  function clearResult(){ res.hidden = true; wrap.classList.remove("has-result"); setFitPassed(false); }

  photo.addEventListener("change", ()=>{
    const f = photo.files && photo.files[0];
    if(!f){ wrap.hidden = true; setFitPassed(false); return; }
    if(objURL) URL.revokeObjectURL(objURL);
    objURL = URL.createObjectURL(f);
    img.src = objURL;
    wrap.hidden = false;
    clearResult();
  });
  dayEl.addEventListener("change", clearResult);
  gradeEl.addEventListener("change", clearResult);

  btn.addEventListener("click", async ()=>{
    if(!(photo.files && photo.files[0])){ setBad("spPhoto", true); return; }
    if(!dayEl.value){ setBad("spDay", true); dayEl.focus(); return; }
    setBad("spDay", false); setBad("spPhoto", false);
    btn.disabled = true;
    const orig = btn.innerHTML;
    btn.textContent = "Reading your photo…";
    try{
      if(img.decode) { try{ await img.decode(); }catch(_){ } }
      const r = await window.SpiritVision.analyzeImage(img, {
        dayId: dayEl.value,
        grade: gradeEl.value,
        onStage: (m)=>{ btn.textContent = m; }
      });
      render(r);
    }catch(e){
      verdict.className = "fitverdict no";
      title.innerHTML = ICON.no + " Couldn't check this one";
      sub.textContent = "The photo couldn't be read. Try another shot, then check again.";
      saw.textContent = "";
      setFitPassed(false);
      res.hidden = false; wrap.classList.add("has-result");
    }finally{
      btn.disabled = false; btn.innerHTML = orig;
    }
  });

  function render(r){
    const lvl = r.band.level;
    verdict.className = "fitverdict " + lvl;
    title.innerHTML = (ICON[lvl]||"") + " " + r.band.title;
    sub.textContent = r.band.sub;
    const bits = (r.saw||[]).slice();
    if(r.engine !== "clip") bits.push("quick color check, vision model offline");
    saw.textContent = bits.length ? "(" + bits.join(" · ") + ")" : "";
    setFitPassed(r.pass);
    res.hidden = false;
    wrap.classList.add("has-result");
    res.focus && res.focus();
  }
})();

/* =====================================================
   Firebird Card · Fire Bucks · QR (student side)
===================================================== */
const cardState = { name:"", grade:"", sid:"" }; // in-memory only (no browser storage)

function countUp(el, target){
  const from = Number(el.textContent) || 0;
  if(matchMedia("(prefers-reduced-motion: reduce)").matches || from===target){ el.textContent = target; return; }
  const t0 = performance.now(), dur = 650;
  (function step(t){
    const p = Math.min(1,(t-t0)/dur), e = 1-Math.pow(1-p,3);
    el.textContent = Math.round(from + (target-from)*e);
    if(p<1) requestAnimationFrame(step);
  })(t0);
}

function qrSVG(text, cell){
  const q = qrcode(0, "M");
  q.addData(text); q.make();
  return q.createSvgTag({ cellSize: cell, margin: 0, scalable: true });
}
function giveLink(){
  const base = location.protocol.startsWith("http") ? location.href.split("#")[0] : "https://fremontasb.org/hub/";
  return base + "#give?sid=" + encodeURIComponent(cardState.sid) +
         "&g=" + encodeURIComponent(cardState.grade) +
         "&n=" + encodeURIComponent(cardState.name);
}

const DEMO_FEED = [
  { when:"Aug 28", amount:20, reason:"BTS Rally" },
  { when:"Aug 26", amount:5,  reason:"Spirit day fit" },
  { when:"Aug 25", amount:5,  reason:"Spirit day fit" }
];
function renderFeed(items){
  const ul = document.getElementById("bbFeed");
  if(!items || !items.length){ ul.innerHTML = '<li class="empty">Nothing yet. Go earn some!</li>'; return; }
  ul.innerHTML = items.map(t =>
    '<li><span class="bb-amt">+'+t.amount+'</span><span class="bb-why">'+t.reason+'</span><span class="bb-when">'+t.when+'</span></li>'
  ).join("");
}

async function refreshCard(){
  const nameEl = document.getElementById("cardName");
  const gradeEl = document.getElementById("cardGrade");
  const qrBtn = document.getElementById("cardQR");
  nameEl.textContent = cardState.name;
  const gword = {9:"Freshman",10:"Sophomore",11:"Junior",12:"Senior"}[cardState.grade] || "";
  gradeEl.textContent = "Grade "+cardState.grade+(gword?" · "+gword:"")+" · #"+cardState.sid;
  qrBtn.innerHTML = qrSVG(giveLink(), 3);
  qrBtn.hidden = false;
  document.getElementById("cardHint").textContent = "Tap the QR on your card so a teacher can scan it and drop you Fire Bucks.";
  try{
    const res = await apiGet({ action:"balance", sid:cardState.sid });
    if(res && res.ok){ countUp(document.getElementById("bbBalance"), res.balance); renderFeed(res.recent); return; }
  }catch(e){ /* fall through to demo */ }
  countUp(document.getElementById("bbBalance"), 30);
  renderFeed(DEMO_FEED);
}

document.getElementById("cardSetup").addEventListener("submit", e=>{
  e.preventDefault();
  const name = document.getElementById("csName").value.trim();
  const grade = document.getElementById("csGrade").value;
  const sid = document.getElementById("csId").value.trim();
  if(name.split(/\s+/).length<2 || !grade || !/^\d{5,7}$/.test(sid)){
    document.getElementById("cardHint").textContent = "Full name, grade, and a 5–7 digit student ID make the card work.";
    return;
  }
  cardState.name = name; cardState.grade = grade; cardState.sid = sid;
  refreshCard();
});

document.getElementById("cardQR").addEventListener("click", ()=>{
  document.getElementById("qrBig").innerHTML = qrSVG(giveLink(), 8);
  document.getElementById("qrSub").textContent = cardState.name+" · have a teacher scan this with their camera.";
  document.getElementById("qrDialog").showModal();
});

/* =====================================================
   Give Fire Bucks (teacher side — opened by scanning a card QR)
===================================================== */
let giveTarget = { sid:"", name:"", grade:"" };
let giveAmt = 5;
function fillGive(p){
  giveTarget = { sid:(p.sid||"").trim(), name:p.n||"Student", grade:p.g||"" };
  document.getElementById("giveName").textContent = giveTarget.name;
  document.getElementById("giveMeta").textContent = giveTarget.sid
    ? "Grade "+(giveTarget.grade||"?")+" · #"+giveTarget.sid
    : "Scan a student’s card QR to fill this in";
  document.getElementById("giveAva").textContent = (giveTarget.name[0]||"F").toUpperCase();
  document.getElementById("giveOk").classList.remove("show");
}
document.querySelectorAll("#giveForm .amt").forEach(b=>
  b.addEventListener("click", ()=>{
    document.querySelectorAll("#giveForm .amt").forEach(x=>x.setAttribute("aria-pressed", x===b?"true":"false"));
    const custom = document.getElementById("giveCustom");
    if(b.dataset.amt==="custom"){ custom.hidden=false; custom.focus(); giveAmt=0; }
    else { custom.hidden=true; giveAmt=+b.dataset.amt; }
  }));
document.getElementById("giveForm").addEventListener("submit", async e=>{
  e.preventDefault();
  const pin = document.getElementById("givePin");
  const custom = document.getElementById("giveCustom");
  const amount = giveAmt || Math.round(+custom.value);
  const msg = document.getElementById("giveOk");
  if(!pin.value.trim()){ setBad("givePin", true); pin.focus(); return; }
  setBad("givePin", false);
  if(!(amount>=1 && amount<=50)){ custom.hidden=false; custom.focus(); return; }
  if(!giveTarget.sid){ msg.textContent="Scan a student’s QR first, then give the bucks."; msg.classList.add("show"); return; }
  const btn = document.getElementById("giveBtn");
  btn.disabled = true; btn.textContent = "Sending…";
  try{
    const res = await apiPost({ action:"grant", sid:giveTarget.sid, name:giveTarget.name,
      grade:giveTarget.grade, amount:amount, reason:document.getElementById("giveReason").value,
      pin:pin.value.trim() });
    if(res && !res.ok) throw new Error(res.error||"grant failed");
    msg.textContent = res
      ? "Done! "+giveTarget.name.split(" ")[0]+" now has "+res.balance+" Fire Bucks."
      : "Done! +"+amount+" Fire Bucks for "+giveTarget.name.split(" ")[0]+". (Demo mode. Deploy the backend and set CONFIG.apiUrl to make grants real.)";
    msg.classList.add("show"); msg.focus();
    pin.value="";
  }catch(err){
    msg.textContent = /PIN/i.test(err.message) ? "That PIN isn’t right. Ask ASB for the staff PIN." : "Couldn’t send that grant: "+err.message;
    msg.classList.add("show"); msg.focus();
  }finally{
    btn.disabled=false; btn.textContent="Give Fire Bucks";
  }
});

/* Feedback form — posts name/email/message in the background to the ASB contact
   Google Form. Google's reply can't be read (no-cors), so success means the request went
   out; a network failure or block keeps the typed message and asks to try again. */
const FEEDBACK_FORM = "https://docs.google.com/forms/d/e/1FAIpQLScNFE8IoooVpQER65d2GIse6ru1nLIp03EHcBjeGBVpsOJMZQ/viewform?usp=pp_url";
const FEEDBACK_ENTRY = { name:"entry.1253423822", email:"entry.2023794996", message:"entry.548009737" };
const FEEDBACK_ACTION = FEEDBACK_FORM.replace("/viewform?usp=pp_url","/formResponse");
document.getElementById("fbForm").addEventListener("submit", function(e){
  e.preventDefault();
  const nameEl=document.getElementById("fbName"), emailEl=document.getElementById("fbEmail"), msgEl=document.getElementById("fbMsg");
  const name=nameEl.value.trim(), email=emailEl.value.trim(), msg=msgEl.value.trim();
  const emailOk=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  let bad=false;
  if(!name){ setBad("fbName",true); bad=true; } else setBad("fbName",false);
  if(!emailOk){ setBad("fbEmail",true); bad=true; } else setBad("fbEmail",false);
  if(!msg){ setBad("fbMsg",true); bad=true; } else setBad("fbMsg",false);
  if(bad){ (!name?nameEl:(!emailOk?emailEl:msgEl)).focus(); return; }
  const btn=e.target.querySelector('button[type="submit"]');
  const ok=document.getElementById("fbOk");
  const body=new URLSearchParams();
  body.append(FEEDBACK_ENTRY.name, name);
  body.append(FEEDBACK_ENTRY.email, email);
  body.append(FEEDBACK_ENTRY.message, msg);
  if(btn){ btn.disabled=true; btn.dataset.label=btn.dataset.label||btn.textContent; btn.textContent=tr("Sending…","Enviando…"); }
  ok.classList.remove("show","retry");
  const ctrl = typeof AbortController!=="undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(function(){ ctrl.abort(); }, 15000) : null;
  function done(sent){
    if(timer) clearTimeout(timer);
    if(btn){ btn.disabled=false; btn.textContent=btn.dataset.label||"Send to ASB"; }
    if(sent){
      e.target.reset();
      ok.textContent=tr("Thanks! Your message is on its way to ASB, and they'll reply to your school email.","¡Gracias! Tu mensaje va en camino a ASB y te responderán a tu correo escolar.");
    } else {
      ok.classList.add("retry");
      ok.textContent=tr("That didn't send. Your message is still here, so check your connection and try again.","No se pudo enviar. Tu mensaje sigue aquí, así que revisa tu conexión e inténtalo de nuevo.");
    }
    ok.classList.add("show"); ok.focus();
  }
  fetch(FEEDBACK_ACTION, { method:"POST", mode:"no-cors", headers:{"Content-Type":"application/x-www-form-urlencoded"}, body: body.toString(), signal: ctrl ? ctrl.signal : undefined })
    .then(function(){ done(true); }, function(){ done(false); });
});
["fbName","fbEmail","fbMsg"].forEach(function(id){ document.getElementById(id).addEventListener("input", function(e){ if(e.target.value.trim()) setBad(id,false); }); });

/* =====================================================
   Clubs — search + filter
===================================================== */
let clubCat = "all";
var CLUB_PREVIEW = 6;      // clubs shown before "Show all"
var clubsExpanded = false; // toggled by the Show all button
function clubEsc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(m){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m];});}
function clubCap(s){s=String(s||"");return s?s[0].toUpperCase()+s.slice(1):"";}
function clubMeetingLine(c){
  const dt=[c.day,c.time].filter(Boolean).map(clubEsc);
  let where="";
  if(c.room){ const r=String(c.room).trim(); where = /^\d+$/.test(r) ? "Rm "+clubEsc(r) : clubEsc(r); }
  return dt.concat(where?[where]:[]).join(" &middot; ");
}
/* ---- Clubs directory: search + A-Z sections + jump bar + expandable cards ---- */
function clubT(en, es){ return (typeof fhLang!=="undefined" && fhLang==="es") ? es : en; }
var CLUB_CATS = ['STEM','Arts & Media','Culture & Language','Service & Advocacy','Academics & Business','Sports & Games','Special Interest'];
var CLUB_CAT_SET = {}; CLUB_CATS.forEach(function(c){ CLUB_CAT_SET[c]=1; });
var CLUB_CAT_ES = {'STEM':'STEM','Arts & Media':'Arte y medios','Culture & Language':'Cultura e idiomas','Service & Advocacy':'Servicio y causas','Academics & Business':'Académico y negocios','Sports & Games':'Deportes y juegos','Special Interest':'Interés especial'};
function clubCatLabel(cat){ return clubT(cat, CLUB_CAT_ES[cat]||cat); }
var CLUB_CAT_RULES = [
  ['STEM', /\b(stem|science|scientific|physics|astro|astronom|robot|engineer|coding|code|computer|cs|technolog|tech|math|biolog|chem|medic|aerospace|aviation|uav|rocket|data|ai|neuro|research|cyber|hack)\b/i],
  ['Arts & Media', /\b(art|paint|draw|anim|music|band|orchestra|choir|sing|dance|film|movie|photo|media|design|creativ|drama|theat|writ|poetry|journal|craft|fashion|sculpt)\b/i],
  ['Culture & Language', /\b(cultur|language|chinese|mandarin|spanish|french|korean|japanese|hindi|indian|desi|asian|latin|hispanic|black|african|muslim|islam|jewish|christ|hindu|faith|religio|heritage|bsu|international|diversity)\b/i],
  ['Service & Advocacy', /\b(service|volunteer|communit|charit|advoca|awareness|mental health|environment|green|sustain|equit|justice|change|outreach|red cross|key club|interact|unicef|kindness|donat|fundrais|nonprofit|activis)\b/i],
  ['Academics & Business', /\b(business|entrepreneur|fbla|deca|debate|speech|model un|mun|scholar|academ|finance|econ|invest|law|mock trial|honor societ|csf|nhs|quiz|decathlon|olympiad|competition|spelling)\b/i],
  ['Sports & Games', /\b(sport|basketball|soccer|tennis|volleyball|badminton|cricket|chess|game|gaming|esport|ping pong|table tennis|fitness|yoga|climb|martial|karate|spikeball|frisbee|dodgeball|pickleball|weightlift)\b/i]
];
function guessClubCategory(name, purpose){
  var t = String(name||"")+" "+String(purpose||"");
  for(var i=0;i<CLUB_CAT_RULES.length;i++){ if(CLUB_CAT_RULES[i][1].test(t)) return CLUB_CAT_RULES[i][0]; }
  return 'Special Interest';
}
function clubCatOf(c){ return (c.category && CLUB_CAT_SET[c.category]) ? c.category : guessClubCategory(c.name, c.purpose||c.other||c.desc); }
var clubsReady = false;
const CLUBS_CACHE_KEY = "fh_clubs_v1";
try{
  const c = JSON.parse(localStorage.getItem(CLUBS_CACHE_KEY)||"null");
  if(c && Array.isArray(c.clubs) && c.clubs.length){ CLUBS = c.clubs; clubsReady = true; }
}catch(e){}
function saveClubsCache(){ try{ localStorage.setItem(CLUBS_CACHE_KEY, JSON.stringify({ t:Date.now(), clubs:CLUBS })); }catch(e){} }
var CLUB_SKELETON = '<div class="card club skel"><span class="skl w80" style="height:16px"></span><span class="skl w60"></span><span class="skl w40"></span><span class="skl w80"></span><span class="skl w60"></span></div>'.repeat(6);
var CLUB_ICON = {
  meet:'<svg class="ci" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2v3M17 2v3M3.5 8.5h17M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5V19A1.5 1.5 0 0 1 19 20.5H5A1.5 1.5 0 0 1 3.5 19V6A1.5 1.5 0 0 1 5 4.5Z"/></svg>',
  adv:'<svg class="ci" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.4"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/></svg>',
  led:'<svg class="ci" viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="8.5" r="2.7"/><circle cx="16" cy="8.5" r="2.7"/><path d="M2.8 19.5a5.2 5.2 0 0 1 10.4 0M13.2 19.5a5.2 5.2 0 0 1 8-2.6"/></svg>',
  mail:'<svg class="ci" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="1.6"/><path d="m3.6 6.6 8.4 6 8.4-6"/></svg>'
};
var CLUB_CLAMP = 150; // purpose length above which we clamp + offer "Read more"
function clubLetter(name){ var ch=String(name||"").trim().charAt(0).toUpperCase(); return /[A-Z]/.test(ch)?ch:"#"; }
function clubCardHtml(c){
  var meet = c.meetingInfo ? clubEsc(c.meetingInfo) : clubMeetingLine(c);
  var advisor = c.teacherAdvisor || c.advisor || "";
  var leaders = c.studentAdvisors || "";
  var emails = Array.isArray(c.emails) ? c.emails.slice() : [];
  if(!emails.length){ var ct=String(c.contact||"").trim(); if(/@/.test(ct)&&ct[0]!=="@") emails=[ct]; }
  var desc = String(c.purpose||c.desc||"").trim();
  var cat = c._cat || clubCatOf(c);
  var meta = '<p class="cmeta cpill"><span>'+clubEsc(clubCatLabel(cat))+'</span></p>';
  meta += meet
    ? '<p class="cmeta">'+CLUB_ICON.meet+'<span>'+meet+'</span></p>'
    : '<p class="cmeta soon">'+CLUB_ICON.meet+'<span>'+clubT("Meeting info coming soon","Horario próximamente")+'</span></p>';
  if(advisor) meta += '<p class="cmeta">'+CLUB_ICON.adv+'<span><b>'+clubT("Advisor:","Asesor:")+'</b> '+clubEsc(advisor)+'</span></p>';
  if(leaders) meta += '<p class="cmeta">'+CLUB_ICON.led+'<span><b>'+clubT("Led by:","Liderado por:")+'</b> '+clubEsc(leaders)+'</span></p>';
  var body = desc ? '<p class="cdesc clamp">'+clubEsc(desc)+'</p>' : "";
  var mailBtn = emails.length
    ? '<a class="cbtn gold" href="https://mail.google.com/mail/?view=cm&fs=1&to='+encodeURIComponent(emails.join(","))+'" target="_blank" rel="noopener">'+CLUB_ICON.mail+'<span>'+clubT("Email","Correo")+'</span></a>'
    : "";
  return '<article class="card club">'+
    '<h3>'+clubEsc(c.name)+'</h3>'+
    '<div class="cmetas">'+meta+'</div>'+
    body+
    '<div class="cactions">'+mailBtn+'</div>'+
  '</article>';
}
function renderClubs(){
  var grid = document.getElementById("clubGrid");
  if(!grid) return;
  if(!clubsReady){
    grid.innerHTML = CLUB_SKELETON;
    var ce0 = document.getElementById("clubCount"); if(ce0) ce0.textContent = clubT("Loading clubs…","Cargando clubes…");
    var ee0 = document.getElementById("clubEmpty"); if(ee0) ee0.hidden = true;
    return;
  }
  var catSel = document.getElementById("clubCat");
  var countEl = document.getElementById("clubCount");
  var all = CLUBS.filter(function(c){ return c && c.name && !c.disbanded; });
  all.forEach(function(c){ c._cat = clubCatOf(c); });
  var total = all.length;
  if(!total){
    // Nothing loaded and nothing saved: a calm note, never an error banner or sample clubs.
    grid.innerHTML = '<p class="note">'+clubT("The clubs list will show here soon. The full official clubs list is linked above.","La lista de clubes aparecerá aquí pronto. La lista oficial completa está en el enlace de arriba.")+'</p>';
    if(countEl) countEl.textContent = "";
    var ch0 = document.getElementById("clubChips"); if(ch0) ch0.innerHTML = "";
    var mw0 = document.getElementById("clubMoreWrap"); if(mw0) mw0.hidden = true;
    var em0 = document.getElementById("clubEmpty"); if(em0) em0.hidden = true;
    return;
  }
  // Dropdown reflects the categories actually present, in the fixed order.
  var present = CLUB_CATS.filter(function(cat){ return all.some(function(c){ return c._cat===cat; }); });
  if(clubCat!=="all" && present.indexOf(clubCat)<0) clubCat="all";
  var chipsEl = document.getElementById("clubChips");
  if(chipsEl){
    chipsEl.innerHTML = '<button type="button" data-cat="all" aria-pressed="'+(clubCat==="all")+'">'+clubEsc(clubT("All","Todos"))+'</button>' +
      present.map(function(cat){ return '<button type="button" data-cat="'+clubEsc(cat)+'" aria-pressed="'+(clubCat===cat)+'">'+clubEsc(clubCatLabel(cat))+'</button>'; }).join("");
  }
  var searchEl = document.getElementById("clubSearch");
  var q = (searchEl ? searchEl.value : "").trim().toLowerCase();
  var list = all.filter(function(c){
    if(clubCat!=="all" && c._cat!==clubCat) return false;
    if(!q) return true;
    var hay = [c.name, c.purpose||c.desc, c.studentAdvisors, c.teacherAdvisor||c.advisor, c.meetingInfo].join(" ").toLowerCase();
    return hay.indexOf(q) >= 0;
  }).sort(function(a,b){ return String(a.name||"").localeCompare(String(b.name||"")); });

  var browsing = !q && clubCat==="all";        // default landing view (no search, no category)
  var previewing = browsing && !clubsExpanded;
  var shown = previewing ? list.slice(0, CLUB_PREVIEW) : list;

  if(countEl){
    var filtered = q || clubCat!=="all";
    countEl.textContent = filtered
      ? (clubT("Showing","Mostrando")+" "+list.length+" "+clubT("of","de")+" "+total+" "+clubT("clubs","clubes"))
      : (total+" "+clubT("clubs","clubes"));
  }

  grid.innerHTML = shown.map(clubCardHtml).join("");
  grid.classList.remove("ready");

  var moreWrap = document.getElementById("clubMoreWrap");
  var moreBtn = document.getElementById("clubShowAll");
  if(moreWrap && moreBtn){
    if(browsing && list.length > CLUB_PREVIEW){
      moreWrap.hidden = false;
      moreBtn.textContent = clubsExpanded
        ? clubT("Show fewer","Ver menos")
        : (clubT("Show all","Ver los")+" "+list.length+" "+clubT("clubs","clubes"));
      moreBtn.setAttribute("aria-expanded", String(clubsExpanded));
    } else { moreWrap.hidden = true; }
  }

  var empty = document.getElementById("clubEmpty");
  if(empty) empty.hidden = list.length > 0;
}
async function syncClubs(){
  // Primary: the website API (Gemini-cleaned + categorized), fetched through its CDN cache so
  // it loads instantly. NOTE: no per-request "?_cb" buster — that forced a cache MISS every
  // time, so every open re-ran the slow LLM pipeline and the seed list lingered on screen.
  // Fallback: raw gviz sheet. Else: the last good copy on this device. Either way we end clubs-ready.
  try{
    const res=await fetch(CLUBS_API);
    if(!res.ok) throw new Error("HTTP "+res.status);
    const data=await res.json();
    const list=(data.clubs||[]).filter(function(c){ return c && c.name && !c.disbanded; });
    if(list.length){ CLUBS=list; clubsReady=true; saveClubsCache(); renderClubs(); return; }
  }catch(e){ /* fall through to gviz */ }
  if(CLUB_SHEET){
    try{
      const res=await fetch(CLUB_SHEET);
      if(res.ok){
        const rows=parseSheetRows(await res.text());
        if(rows.length>=2){
          const head=rows[0].map(function(h){return String(h).trim().toLowerCase();});
          const gi=function(n){return head.indexOf(n);};
          const col=function(r,names){ for(var k=0;k<names.length;k++){ var i=gi(names[k]); if(i>=0) return String(r[i]||"").trim(); } return ""; };
          const EMAIL_RE=/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
          const list=[];
          for(let i=1;i<rows.length;i++){ const r=rows[i]; const name=col(r,["club","name","club name"]); if(!name||/disband/i.test(name)) continue;
            const emailsRaw=col(r,["email list: student advisor emails","email list","emails","email"]);
            list.push({
              name:name,
              purpose:col(r,["club purpose","purpose","description","desc"]),
              teacherAdvisor:col(r,["teacher advisor","advisor"]),
              studentAdvisors:col(r,["student advisors","student advisor"]),
              meetingInfo:col(r,["meeting location & times","meeting location and times","meeting"]),
              emails:(emailsRaw.match(EMAIL_RE)||[])
            });
          }
          if(list.length){ CLUBS=list; saveClubsCache(); }
        }
      }
    }catch(e){ /* offline or blocked: keep the last good list, if any */ }
  }
  clubsReady=true; renderClubs(); // replace the skeleton with whatever we have (gviz, saved copy, or a calm note)
}

// Morning announcements, pulled from the website's parsed + Gemini-cleaned feed.
// The feed returns every parsed item; we reveal each only after its 8:30 AM Wed/Fri
// morning (same rule as the website), group by day, and show newest first.
// The raw feed is kept so the 8:30 filter can re-run every minute: an app left open (the
// normal case for an installed app) reveals Wednesday's and Friday's items on time.
let annAll = null, annShownKey = "";
async function syncAnnouncements(){
  try{
    const res=await fetch(ANN_API); // CDN-cached by the site (s-maxage=300); never add a cache-buster
    if(!res.ok) throw new Error("HTTP "+res.status);
    const data=await res.json();
    const all=Array.isArray(data.announcements)?data.announcements:[];
    if(all.length){ annAll = all; applyAnnouncements(); }
  }catch(e){ /* offline or blocked: keep what's on screen */ }
}
function applyAnnouncements(){
  if(!annAll) return;
  const now=nowPST();
  const shown=annAll.filter(function(a){
    const m=/^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(a.date||"").trim()); if(!m) return false;
    return new Date(+m[1],+m[2]-1,+m[3],8,30,0,0) <= now;
  });
  const key = JSON.stringify(shown);
  if(key === annShownKey) return; // nothing new to reveal: leave the card alone
  annShownKey = key;
  const byDate=new Map();
  shown.forEach(function(a){ if(!byDate.has(a.date)) byDate.set(a.date,[]); byDate.get(a.date).push(a); });
  const days=[...byDate.keys()].sort().reverse().map(function(date){
    const items=byDate.get(date);
    return { date:date,
      bullets:items.map(function(a){ return a.title||a.text||""; }).filter(Boolean),
      full:items.map(function(a){ return a.text||""; }).filter(Boolean).join("\n\n") };
  });
  if(days.length){ FTV_FEED.length=0; days.forEach(function(d){ FTV_FEED.push(d); }); renderFTV(); }
}
document.getElementById("clubSearch").addEventListener("input", renderClubs);
(function(){
  var grid = document.getElementById("clubGrid");
  var moreBtn0 = document.getElementById("clubShowAll");
  if(moreBtn0) moreBtn0.addEventListener("click", function(){ clubsExpanded = !clubsExpanded; renderClubs(); });
  var az = document.getElementById("azbar");
  if(az) az.addEventListener("click", function(e){
    var b = e.target.closest ? e.target.closest("[data-az]") : null; if(!b) return;
    var t = document.getElementById("az-"+b.getAttribute("data-az"));
    if(t) t.scrollIntoView({behavior:"smooth", block:"start"});
  });
  var chipsEl = document.getElementById("clubChips");
  if(chipsEl) chipsEl.addEventListener("click", function(e){
    var b = e.target.closest ? e.target.closest("[data-cat]") : null; if(!b) return;
    clubCat = b.getAttribute("data-cat"); clubsExpanded = false; renderClubs();
  });
  var clr = document.getElementById("clubClear"), s = document.getElementById("clubSearch");
  if(clr && s){
    s.addEventListener("input", function(){ clr.hidden = !s.value; });
    clr.addEventListener("click", function(){ s.value=""; clr.hidden=true; s.focus(); renderClubs(); });
  }
})();
document.querySelectorAll("[data-cat]").forEach(b=>
  b.addEventListener("click", ()=>{
    clubCat = b.dataset.cat;
    document.querySelectorAll("[data-cat]").forEach(x=>x.setAttribute("aria-pressed", x===b ? "true":"false"));
    renderClubs();
  }));

/* Club filter controls + "Find your club" matcher quiz (#4) */

const MATCH_QS = [
  {q:"What are you most into?", multi:true, opts:[
    {t:"Science, tech & building", cats:["STEM"]},
    {t:"Art, music & performing", cats:["Arts & Media"]},
    {t:"Culture, identity & language", cats:["Culture & Language"]},
    {t:"Service & giving back", cats:["Service & Advocacy"]},
    {t:"Business, debate & academics", cats:["Academics & Business"]},
    {t:"Sports & games", cats:["Sports & Games"]}
  ]},
  {q:"How do you like to get involved?", opts:[
    {t:"Hands-on projects", cats:["STEM","Arts & Media"]},
    {t:"With a team or community", cats:["Service & Advocacy","Culture & Language","Sports & Games"]},
    {t:"Competing & achieving", cats:["Academics & Business","Sports & Games","STEM"]}
  ]},
  {q:"Pick your energy", opts:[
    {t:"Social & group", cats:["Culture & Language","Service & Advocacy","Sports & Games"]},
    {t:"Focused & solo", cats:["STEM","Academics & Business"]}
  ]},
  {q:"Your main goal?", opts:[
    {t:"Meet new people", cats:["Culture & Language","Special Interest"]},
    {t:"Build a skill", cats:["STEM","Arts & Media","Academics & Business"]},
    {t:"Give back", cats:["Service & Advocacy"]},
    {t:"Just have fun", cats:["Sports & Games","Special Interest"]}
  ]}
];
let quizStep=0, quizPrefs={}, quizSel=[];
function openMatch(){ quizStep=0; quizPrefs={}; renderQuizStep(); const d=document.getElementById("matchDialog"); if(d && !d.open) d.showModal(); }
function addCats(cats){ (cats||[]).forEach(function(c){ quizPrefs[c]=(quizPrefs[c]||0)+1; }); }
function advance(){ quizStep++; if(quizStep>=MATCH_QS.length) renderQuizResults(); else renderQuizStep(); }
function renderQuizStep(){
  const body=document.getElementById("quizBody"); if(!body) return;
  const Q=MATCH_QS[quizStep]; quizSel=[];
  const pct=Math.round(quizStep/MATCH_QS.length*100);
  body.innerHTML='<div class="quizhead"><span class="quizprog"><span style="width:'+pct+'%"></span></span><button type="button" class="quizx" id="quizClose" aria-label="Close">&times;</button></div>'+
    '<h2 id="quizTitle" class="quizq">'+clubEsc(Q.q)+'</h2>'+
    (Q.multi?'<p class="quizhint">Pick any that fit</p>':"")+
    '<div class="quizopts">'+Q.opts.map(function(o,i){ return '<button type="button" class="quizopt" data-i="'+i+'">'+clubEsc(o.t)+'</button>'; }).join("")+'</div>'+
    (Q.multi?'<button type="button" class="btn primary quiznext" id="quizNext">Next</button>':"")+
    '<p class="quizstepn">Question '+(quizStep+1)+' of '+MATCH_QS.length+'</p>';
  body.querySelector("#quizClose").onclick=function(){ const d=document.getElementById("matchDialog"); if(d) d.close(); };
  body.querySelectorAll(".quizopt").forEach(function(btn){
    btn.onclick=function(){
      const o=Q.opts[+btn.dataset.i];
      if(Q.multi){ btn.classList.toggle("on"); const idx=quizSel.indexOf(o); if(idx>=0) quizSel.splice(idx,1); else quizSel.push(o); }
      else { addCats(o.cats); advance(); }
    };
  });
  const nx=body.querySelector("#quizNext"); if(nx) nx.onclick=function(){ quizSel.forEach(function(o){ addCats(o.cats); }); advance(); };
}
function scoreClubs(){
  var total=Object.keys(quizPrefs).reduce(function(a,k){return a+quizPrefs[k];},0)||1;
  return CLUBS.filter(function(c){ return c && c.name && !c.disbanded; }).map(function(c){
    var cat=clubCatOf(c);
    var sc=quizPrefs[cat]||0;
    return {club:c, cat:cat, score:sc, pct:Math.max(10,Math.min(99,Math.round(sc/total*100)))};
  }).sort(function(a,b){ return (b.score-a.score) || String(a.club.name||"").localeCompare(String(b.club.name||"")); });
}
function renderQuizResults(){
  const ranked=scoreClubs().filter(function(r){return r.score>0;}).slice(0,3);
  const body=document.getElementById("quizBody"); if(!body) return;
  let html='<div class="quizhead"><span class="quizprog"><span style="width:100%"></span></span><button type="button" class="quizx" id="quizClose" aria-label="Close">&times;</button></div><h2 class="quizq">Your top matches</h2>';
  if(!ranked.length){ html+='<p class="note">No strong match yet. Try browsing all clubs.</p>'; }
  else html+=ranked.map(function(r){
    const c=r.club;
    var emails=Array.isArray(c.emails)?c.emails.filter(Boolean):[];
    var meet=c.meetingInfo?('<p class="matchcat">'+clubEsc(c.meetingInfo)+'</p>'):"";
    var desc=String(c.purpose||c.desc||"").trim();
    return '<div class="matchcard"><div class="matchtop"><h3>'+clubEsc(c.name)+'</h3><span class="matchpct">'+r.pct+'% match</span></div>'+
      '<p class="matchcat"><b>'+clubEsc(clubCatLabel(r.cat))+'</b></p>'+ meet +
      (desc?'<p class="matchwhy">'+clubEsc(desc.slice(0,140))+(desc.length>140?"…":"")+'</p>':"")+
      (emails.length?'<a class="cbtn gold" href="https://mail.google.com/mail/?view=cm&fs=1&to='+encodeURIComponent(emails.join(","))+'" target="_blank" rel="noopener">Email</a>':"")+'</div>';
  }).join("");
  html+='<div class="quizactions"><button type="button" class="btn ghost" id="quizRetake">Retake</button><button type="button" class="btn primary" id="quizDone">Browse all clubs</button></div>';
  body.innerHTML=html;
  body.querySelector("#quizClose").onclick=function(){ const d=document.getElementById("matchDialog"); if(d) d.close(); };
  body.querySelector("#quizRetake").onclick=openMatch;
  body.querySelector("#quizDone").onclick=function(){ const d=document.getElementById("matchDialog"); if(d) d.close(); };
}
(function(){ const b=document.getElementById("findClubBtn"); if(b) b.addEventListener("click", openMatch); })();

/* =====================================================
   Google sign-in (real, via Google Identity Services)
   Works as soon as CONFIG.googleClientId is set — steps in
   backend/README.md. Without it the dialog explains itself.
===================================================== */
const SIGNIN_KEY = "fh_signin_v1";
const signedIn = { name:"", email:"", picture:"" };
let gsiFailed = false; // set when Google's sign-in script is blocked or broken
const _signinBtn = document.getElementById("signinBtn");
const _signinDefaultHTML = _signinBtn ? _signinBtn.innerHTML : "Sign in";
function decodeJwt(tok){
  const part = tok.split(".")[1].replace(/-/g,"+").replace(/_/g,"/");
  return JSON.parse(decodeURIComponent(atob(part).split("").map(c=>"%"+("00"+c.charCodeAt(0).toString(16)).slice(-2)).join("")));
}
function _saveSignin(){ try{ localStorage.setItem(SIGNIN_KEY, JSON.stringify(signedIn)); }catch(e){} }
function _clearSignin(){ try{ localStorage.removeItem(SIGNIN_KEY); }catch(e){} }
function _loadSignin(){ try{ const s=JSON.parse(localStorage.getItem(SIGNIN_KEY)||"null"); if(s&&s.email){ signedIn.name=s.name||""; signedIn.email=s.email||""; signedIn.picture=s.picture||""; return true; } }catch(e){} return false; }
function applySignedInUI(){
  if(!_signinBtn) return;
  if(signedIn.email){
    // Built with DOM nodes: the photo URL and name never go through innerHTML, and only a
    // Google profile-photo URL is used.
    _signinBtn.textContent = "";
    if(/^https:\/\/[a-z0-9.-]+\.googleusercontent\.com\//i.test(signedIn.picture||"")){
      const img = document.createElement("img");
      img.alt = ""; img.referrerPolicy = "no-referrer"; img.src = signedIn.picture;
      _signinBtn.appendChild(img);
    }
    _signinBtn.appendChild(document.createTextNode((signedIn.name||"").split(" ")[0] || tr("Account","Cuenta")));
    _signinBtn.setAttribute("aria-label",tr("Signed in as ","Sesión iniciada como ")+signedIn.email);
  } else {
    _signinBtn.innerHTML = _signinDefaultHTML;
    _signinBtn.setAttribute("aria-label",tr("Sign in","Iniciar sesión"));
  }
}
function refreshSigninDialog(){
  renderSgyStep();
  const blurb=document.getElementById("signinBlurb"), gsi=document.getElementById("gsiBtn"), note=document.getElementById("signinNote"), out=document.getElementById("signoutBtn");
  if(signedIn.email){
    if(blurb) blurb.textContent = tr("Signed in as "+signedIn.email+".","Sesión iniciada como "+signedIn.email+".");
    if(gsi) gsi.hidden = true; if(note) note.hidden = true; if(out) out.hidden = false;
  } else {
    if(blurb) blurb.textContent = tr("Sign in with your school Google account to see your name on the app and connect your Schoology calendar. Everything else works without signing in.","Inicia sesión con tu cuenta escolar de Google para ver tu nombre en la app y conectar tu calendario de Schoology. Todo lo demás funciona sin iniciar sesión.");
    if(out) out.hidden = true;
    // No Google button when the client ID is missing or Google's script didn't load
    // (Securly on school Wi-Fi): the note says why instead of an empty dialog.
    const unavailable = !CONFIG.googleClientId || gsiFailed;
    if(gsi) gsi.hidden = unavailable;
    if(note){
      note.hidden = !unavailable;
      if(unavailable) note.textContent = !CONFIG.googleClientId
        ? tr("Google sign-in isn't set up yet. Everything else in the app still works.","El inicio de sesión con Google todavía no está listo. Todo lo demás en la app sigue funcionando.")
        : tr("Google sign-in isn't reachable on this network right now. Everything else in the app still works.","El inicio de sesión con Google no está disponible en esta red por ahora. Todo lo demás en la app sigue funcionando.");
    }
  }
}
function onGoogleCred(resp){
  try{
    const p = decodeJwt(resp.credential);
    signedIn.name = p.name || ""; signedIn.email = p.email || ""; signedIn.picture = p.picture || "";
    _saveSignin(); applySignedInUI();
    const csName = document.getElementById("csName");
    if(csName && !csName.value) csName.value = signedIn.name;
    if(sgy && sgy.email !== signedIn.email) sgyForget();
    refreshSigninDialog(); renderSchoology(); sgyRefresh(false);
    // A school account that hasn't connected Schoology stays in the dialog for step 2.
    const d=document.getElementById("signinDialog");
    if(d && d.open && (sgyConnected() || !isSchoolEmail(signedIn.email))) d.close();
    else if(d && d.open){ const f=document.getElementById("sgyFeed"); if(f) f.focus(); }
  }catch(e){ /* ignore a bad credential */ }
}
function signOut(){
  signedIn.name=""; signedIn.email=""; signedIn.picture="";
  _clearSignin(); sgyForget();
  try{ if(window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect(); }catch(e){}
  applySignedInUI(); refreshSigninDialog(); renderSchoology();
  const d=document.getElementById("signinDialog"); if(d && d.open) d.close();
}
function initGoogleSignin(){
  if(!CONFIG.googleClientId){ refreshSigninDialog(); return; }
  const s = document.createElement("script");
  s.src = "https://accounts.google.com/gsi/client"; s.async = true; s.defer = true;
  const failed = ()=>{ gsiFailed = true; refreshSigninDialog(); };
  s.onload = ()=>{
    // A filter can answer with its own block page, which "loads" but defines nothing.
    try{
      google.accounts.id.initialize({ client_id: CONFIG.googleClientId, callback: onGoogleCred, auto_select: false,
        hd: "student.fuhsd.org" }); // pre-selects the school account in Google's chooser
      google.accounts.id.renderButton(document.getElementById("gsiBtn"),
        { theme:"filled_black", size:"large", shape:"pill", text:"signin_with" });
    }catch(e){ failed(); }
  };
  s.onerror = failed;
  document.head.appendChild(s);
}
if(_signinBtn) _signinBtn.addEventListener("click", ()=>{ refreshSigninDialog(); document.getElementById("signinDialog").showModal(); });
(function(){ const out=document.getElementById("signoutBtn"); if(out) out.addEventListener("click", signOut); })();
/* =====================================================
   Schoology calendar (step 2 of sign-in)
   A student signs in with their school Google account, then pastes their personal
   Schoology iCal link once (Schoology: Settings > Share your Schoology Calendar).
   /api/schoology reads it and returns the next 60 days. The link and the last good
   list stay only in this browser (localStorage fh_schoology_v1), tied to the signed-in
   email, and are cleared on sign-out. A failed refresh keeps the last good list.
===================================================== */
const SGY_KEY = "fh_schoology_v1";
const SGY_API = "/api/schoology";
const SGY_SETTINGS_URL = "https://fuhsd.schoology.com/settings/account";
const SGY_HIDE_INVITE = "fh_schoology_invite_hidden";
const SGY_REFRESH_MS = 10*60*1000;
const SGY_FEED_RE = /^(?:webcal|https?):\/\/[a-z0-9-]+\.schoology\.com\/calendar\/feed\/ical\/\d{4,20}\/[0-9a-f]{16,64}\/ical\.ics$/i;
let sgy = null;            // { email, feed, items, fetchedAt, dead }
let sgyBusy = false, sgyLastTry = 0, sgyFilter = "all", sgyQuery = "", sgyShowAll = false;
let sgyStepMsg = { text:"", bad:false };

function isSchoolEmail(e){ return /@(student\.)?fuhsd\.org$/i.test(String(e||"")); }
function sgyConnected(){ return !!(sgy && sgy.feed && signedIn.email && sgy.email === signedIn.email); }
function sgyLoad(){ try{ const v=JSON.parse(localStorage.getItem(SGY_KEY)||"null"); if(v && v.feed && v.email) sgy=v; }catch(e){} }
function sgySave(){ try{ if(sgy) localStorage.setItem(SGY_KEY, JSON.stringify(sgy)); }catch(e){} }
function sgyForget(){ sgy=null; sgyStepMsg={text:"",bad:false}; try{ localStorage.removeItem(SGY_KEY); }catch(e){} }
function sgyClean(raw){ return String(raw||"").trim().replace(/^["'<]+|["'>]+$/g,""); }

async function sgyFetch(feed){
  const ctrl = typeof AbortController!=="undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(function(){ ctrl.abort(); }, 15000) : null;
  try{
    const res = await fetch(SGY_API, { method:"POST", headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ feed: feed }), signal: ctrl ? ctrl.signal : undefined });
    let body = null; try{ body = await res.json(); }catch(e){}
    if(res.ok && body && body.ok && Array.isArray(body.items)) return { items: body.items, fetchedAt: body.fetchedAt };
    return { error: (body && body.error) || "unreachable" };
  }catch(e){ return { error:"unreachable" }; }
  finally{ if(timer) clearTimeout(timer); }
}

async function sgyConnect(raw){
  const feed = sgyClean(raw);
  if(!SGY_FEED_RE.test(feed)){
    sgyStepMsg = { bad:true, text: tr("That doesn't look like a Schoology calendar link. It starts with webcal:// and ends with ical.ics.",
      "Eso no parece un enlace de calendario de Schoology. Empieza con webcal:// y termina con ical.ics.") };
    renderSgyStep(); return;
  }
  sgyBusy = true; sgyStepMsg = { bad:false, text: tr("Connecting to Schoology…","Conectando con Schoology…") }; renderSgyStep();
  const r = await sgyFetch(feed);
  sgyBusy = false;
  if(r.items){
    sgy = { email: signedIn.email, feed: feed, items: r.items, fetchedAt: r.fetchedAt || new Date().toISOString(), dead:false };
    sgySave(); sgyLastTry = Date.now();
    sgyStepMsg = { bad:false, text:"" };
    renderSchoology(); renderSgyStep();
    const d=document.getElementById("signinDialog"); if(d && d.open) d.close();
    return;
  }
  sgyStepMsg = { bad:true, text: r.error==="dead-link"
    ? tr("Schoology didn't accept that link. It may have been reset. Copy the link again from Schoology and paste it here.",
         "Schoology no aceptó ese enlace. Puede que se haya restablecido. Copia el enlace otra vez desde Schoology y pégalo aquí.")
    : r.error==="bad-link"
    ? tr("That doesn't look like a Schoology calendar link. It starts with webcal:// and ends with ical.ics.",
         "Eso no parece un enlace de calendario de Schoology. Empieza con webcal:// y termina con ical.ics.")
    : tr("We couldn't reach Schoology just now. Please try again in a minute.",
         "No pudimos conectar con Schoology en este momento. Inténtalo de nuevo en un minuto.") };
  renderSgyStep();
}

// Quiet background refresh: on load, on return to the app and with the live-data timer,
// at most every 10 minutes. Failures keep the last good list; only a link Schoology no
// longer accepts is shown (with a Reconnect button), since only the student can fix it.
async function sgyRefresh(force){
  if(!sgyConnected() || sgyBusy || !navigator.onLine) return;
  const age = Date.now() - (Date.parse(sgy.fetchedAt||"")||0);
  if(!force && (age < SGY_REFRESH_MS || Date.now()-sgyLastTry < 60000)) return;
  sgyLastTry = Date.now(); sgyBusy = true;
  const r = await sgyFetch(sgy.feed);
  sgyBusy = false;
  if(!sgyConnected()) return;
  if(r.items){ sgy.items = r.items; sgy.fetchedAt = r.fetchedAt || new Date().toISOString(); sgy.dead = false; sgySave(); renderSchoology(); }
  else if(r.error==="dead-link"){ sgy.dead = true; sgySave(); renderSchoology(); }
}

/* ---------- helpers for the lists ---------- */
const SGY_ICONS = {
  assignment:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 3h7l5 5v13H7z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M14 3v5h5M10 13h6M10 17h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  quiz:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 4h14v16H5z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8.5 9l1.5 1.5L13 7.5M8.5 15l1.5 1.5L13 13.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  discussion:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 5h16v10H9l-5 4z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  event:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" stroke-width="2"/><path d="M4 10h16M9 3v4M15 3v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
};
const SGY_OUT = '<svg class="go" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14 5h5v5M19 5l-8 8M10 6H5v13h13v-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function sgyTypeName(t, n){
  const many = n!==1;
  if(t==="assignment") return many ? tr("Assignments","Tareas") : tr("Assignment","Tarea");
  if(t==="quiz") return many ? tr("Quizzes and tests","Pruebas y exámenes") : tr("Quiz or test","Prueba o examen");
  if(t==="discussion") return many ? tr("Discussions","Debates") : tr("Discussion","Debate");
  return many ? tr("Events","Eventos") : tr("Event","Evento");
}
function sgyDayLabel(key){
  const today = todayKeyPST();
  const t = new Date(+today.slice(0,4), +today.slice(5,7)-1, +today.slice(8,10));
  const d = new Date(+key.slice(0,4), +key.slice(5,7)-1, +key.slice(8,10));
  const diff = Math.round((d - t)/86400000);
  const long = d.toLocaleDateString(tr("en-US","es-US"), { weekday:"long", month:"short", day:"numeric" });
  if(diff===0) return { main: tr("Today","Hoy"), sub: long };
  if(diff===1) return { main: tr("Tomorrow","Mañana"), sub: long };
  return { main: d.toLocaleDateString(tr("en-US","es-US"), { weekday:"long" }), sub: d.toLocaleDateString(tr("en-US","es-US"), { month:"short", day:"numeric" }) };
}
function sgyUpcoming(){
  if(!sgyConnected() || !Array.isArray(sgy.items)) return [];
  const today = todayKeyPST();
  return sgy.items.filter(function(e){ return e && e.date >= today; });
}
function sgyTimeText(e){
  if(e.allDay) return tr("All day","Todo el día");
  return (e.type==="event" ? "" : tr("Due ","Para las ")) + e.time;
}
function sgyRow(e, withDay){
  const day = withDay ? sgyDayLabel(e.date).main + ", " : "";
  let when = sgyTimeText(e);
  if(withDay) when = when.charAt(0).toLowerCase() + when.slice(1);
  const meta = clubEsc(day + when) + " &middot; " + clubEsc(sgyTypeName(e.type,1));
  const inner = '<span class="ico '+clubEsc(e.type)+'">'+(SGY_ICONS[e.type]||SGY_ICONS.event)+'</span>'+
    '<span class="txt"><b>'+clubEsc(e.title)+'</b><span class="m">'+meta+'</span>'+
    (e.desc && !withDay ? '<span class="d">'+clubEsc(e.desc)+'</span>' : '')+'</span>';
  if(/^https:\/\/[a-z0-9-]+\.schoology\.com\//i.test(e.url||""))
    return '<a class="sgyrow" href="'+clubEsc(e.url)+'" target="_blank" rel="noopener" aria-label="'+clubEsc(e.title+", "+day+when+". "+tr("Opens in Schoology","Se abre en Schoology"))+'">'+inner+SGY_OUT+'</a>';
  return '<div class="sgyrow">'+inner+'</div>';
}
function sgyInviteHTML(where){
  const school = signedIn.email && !isSchoolEmail(signedIn.email);
  return '<div class="card sgyinvite">'+
    '<span class="ico" aria-hidden="true">'+SGY_ICONS.assignment+'</span>'+
    '<div class="txt"><h3>'+clubEsc(tr("See your Schoology calendar here","Ve tu calendario de Schoology aquí"))+'</h3>'+
    '<p>'+clubEsc(school
      ? tr("To connect Schoology, sign in with your @student.fuhsd.org account.","Para conectar Schoology, inicia sesión con tu cuenta @student.fuhsd.org.")
      : tr("Your assignments, quizzes and class events, sorted by day. Sign in with your school Google account and connect Schoology once. It takes about a minute.",
           "Tus tareas, pruebas y eventos de clase, ordenados por día. Inicia sesión con tu cuenta escolar de Google y conecta Schoology una vez. Toma más o menos un minuto."))+'</p>'+
    '<div class="btnrow"><button type="button" class="btn primary" data-sgy="open">'+clubEsc(tr("Connect Schoology","Conectar Schoology"))+'</button>'+
    (where==="home" ? '<button type="button" class="btn ghost" data-sgy="hide">'+clubEsc(tr("Not now","Ahora no"))+'</button>' : '')+
    '</div></div></div>';
}
function sgyDeadHTML(){
  return '<div class="card sgynote" role="status"><p>'+clubEsc(tr("Your Schoology link stopped working, so this list may be out of date. Schoology may have reset it. Copy the link again to reconnect.",
    "Tu enlace de Schoology dejó de funcionar, así que esta lista puede estar desactualizada. Puede que Schoology lo haya restablecido. Copia el enlace otra vez para reconectar."))+'</p>'+
    '<button type="button" class="btn gold" data-sgy="open">'+clubEsc(tr("Reconnect","Reconectar"))+'</button></div>';
}

/* ---------- Home: the next few things due ---------- */
function renderSgyHome(){
  const el = document.getElementById("sgyHome"); if(!el) return;
  let hidden = false; try{ hidden = localStorage.getItem(SGY_HIDE_INVITE)==="1"; }catch(e){}
  if(!sgyConnected()){
    if(hidden){ el.hidden = true; el.innerHTML = ""; return; }
    el.hidden = false;
    el.innerHTML = sgyInviteHTML("home");
    return;
  }
  const list = sgyUpcoming(), soon = list.slice(0,4);
  let html = '<div class="sechead"><h2 id="h-sgyhome">'+clubEsc(tr("Coming up in Schoology","Próximamente en Schoology"))+'</h2><span class="rule" aria-hidden="true"></span></div>';
  if(sgy.dead) html += sgyDeadHTML();
  if(!soon.length) html += '<div class="card sgyempty"><p>'+clubEsc(tr("You're all caught up. Nothing is due in Schoology in the next 2 months.","Estás al día. No tienes nada pendiente en Schoology en los próximos 2 meses."))+'</p></div>';
  else{
    html += '<div class="sgylist">'+soon.map(function(e){ return sgyRow(e,true); }).join("")+'</div>';
    html += '<div class="btnrow"><a class="btn ghost" href="#schedule" data-nav="schedule">'+
      clubEsc(list.length>soon.length ? tr("See all "+list.length+" on the Schedule tab","Ver los "+list.length+" en Horario") : tr("Open the Schedule tab","Abrir Horario"))+'</a></div>';
  }
  el.hidden = false;
  if(el.innerHTML !== html) el.innerHTML = html;
}

/* ---------- Schedule tab: the full list, grouped by day ---------- */
function renderSgySched(){
  const el = document.getElementById("sgySched"); if(!el) return;
  let head = '<div class="sechead"><h2 id="h-sgysched">'+clubEsc(tr("Your Schoology calendar","Tu calendario de Schoology"))+'</h2><span class="rule" aria-hidden="true"></span></div>';
  if(!sgyConnected()){ el.innerHTML = head + sgyInviteHTML("sched"); return; }
  const all = sgyUpcoming();
  const counts = {}; all.forEach(function(e){ counts[e.type]=(counts[e.type]||0)+1; });
  const types = ["assignment","quiz","discussion","event"].filter(function(t){ return counts[t]; });
  if(sgyFilter!=="all" && !counts[sgyFilter]) sgyFilter = "all";
  const q = sgyQuery.trim().toLowerCase();
  const shown = all.filter(function(e){
    return (sgyFilter==="all" || e.type===sgyFilter) && (!q || (e.title+" "+(e.desc||"")).toLowerCase().indexOf(q)>=0);
  });
  let html = head;
  if(sgy.dead) html += sgyDeadHTML();
  if(all.length){
    html += '<div class="sgytools">';
    if(all.length > 8) html += '<input type="text" id="sgySearch" placeholder="'+clubEsc(tr("Search your Schoology items","Busca en tu Schoology"))+'" aria-label="'+clubEsc(tr("Search your Schoology items","Busca en tu Schoology"))+'" value="'+clubEsc(sgyQuery)+'">';
    if(types.length > 1){
      html += '<div class="chips" role="group" aria-label="'+clubEsc(tr("Show","Mostrar"))+'">'+
        '<button type="button" data-sgyf="all" aria-pressed="'+(sgyFilter==="all")+'">'+clubEsc(tr("All","Todo"))+' ('+all.length+')</button>'+
        types.map(function(t){ return '<button type="button" data-sgyf="'+t+'" aria-pressed="'+(sgyFilter===t)+'">'+clubEsc(sgyTypeName(t,2))+' ('+counts[t]+')</button>'; }).join("")+'</div>';
    }
    html += '</div>';
  }
  html += '<p class="note sgycount" role="status" aria-live="polite">'+clubEsc(
    !all.length ? tr("You're all caught up. Nothing is due in Schoology in the next 2 months.","Estás al día. No tienes nada pendiente en Schoology en los próximos 2 meses.")
    : shown.length===all.length ? tr(all.length+(all.length===1?" item":" items")+" in the next 2 months.",all.length+(all.length===1?" elemento":" elementos")+" en los próximos 2 meses.")
    : tr(shown.length+" of "+all.length+" items.",shown.length+" de "+all.length+" elementos."))+'</p>';
  if(all.length && !shown.length) html += '<div class="card sgyempty"><p>'+clubEsc(tr("Nothing matches that. Try another word or show All.","No hay coincidencias. Prueba otra palabra o elige Todo."))+'</p></div>';
  // Group by day; the first 7 days show at once, the rest behind "Show more".
  const groups = []; let cur = null;
  shown.forEach(function(e){ if(!cur || cur.key!==e.date){ cur={ key:e.date, items:[] }; groups.push(cur); } cur.items.push(e); });
  const limit = sgyShowAll || q ? groups.length : 7;
  groups.slice(0,limit).forEach(function(g){
    const lab = sgyDayLabel(g.key);
    html += '<div class="sgylist sgyday"><h3 class="sgydayh"><span>'+clubEsc(lab.main)+' <small>'+clubEsc(lab.sub)+'</small></span><span class="n">'+g.items.length+'</span></h3>'+
      g.items.map(function(e){ return sgyRow(e,false); }).join("")+'</div>';
  });
  if(groups.length > limit) html += '<button type="button" class="btn ghost" data-sgy="more">'+clubEsc(tr("Show "+(groups.length-limit)+" more days","Mostrar "+(groups.length-limit)+" días más"))+'</button>';
  const upd = Date.parse(sgy.fetchedAt||"");
  if(upd) html += '<p class="note">'+clubEsc(tr("From your Schoology calendar. Updated ","De tu calendario de Schoology. Actualizado a las ")+new Date(upd).toLocaleTimeString(tr("en-US","es-US"),{hour:"numeric",minute:"2-digit",timeZone:"America/Los_Angeles"})+".")+
    ' <button type="button" class="linkbtn" data-sgy="disconnect">'+clubEsc(tr("Disconnect Schoology","Desconectar Schoology"))+'</button></p>';
  // Keep the search box focused (and the caret in place) while typing.
  const active = document.activeElement && document.activeElement.id==="sgySearch";
  const caret = active ? document.activeElement.selectionStart : 0;
  el.innerHTML = html;
  if(active){ const s=document.getElementById("sgySearch"); if(s){ s.focus(); try{ s.setSelectionRange(caret,caret); }catch(e){} } }
}
function renderSchoology(){ try{ renderSgyHome(); renderSgySched(); }catch(e){} }

/* ---------- Step 2 inside the sign-in dialog ---------- */
function renderSgyStep(){
  const el = document.getElementById("sgyStep"); if(!el) return;
  if(!signedIn.email){ el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;
  if(!isSchoolEmail(signedIn.email)){
    el.innerHTML = '<p class="note">'+clubEsc(tr("To connect Schoology, sign out and sign in with your @student.fuhsd.org account.","Para conectar Schoology, cierra sesión e inicia sesión con tu cuenta @student.fuhsd.org."))+'</p>';
    return;
  }
  if(sgyConnected() && !sgy.dead){
    const n = sgyUpcoming().length;
    el.innerHTML = '<div class="sgyok"><b>'+clubEsc(tr("Schoology is connected","Schoology está conectado"))+'</b>'+
      '<span>'+clubEsc(tr(n+(n===1?" thing":" things")+" coming up in the next 2 months. They show on Home and on the Schedule tab.",
        n+(n===1?" cosa pendiente":" cosas pendientes")+" en los próximos 2 meses. Aparecen en Inicio y en Horario."))+'</span>'+
      '<button type="button" class="linkbtn" data-sgy="disconnect">'+clubEsc(tr("Disconnect Schoology","Desconectar Schoology"))+'</button></div>';
    return;
  }
  const keep = document.getElementById("sgyFeed") ? document.getElementById("sgyFeed").value : "";
  const canPaste = !!(navigator.clipboard && navigator.clipboard.readText);
  el.innerHTML =
    '<h4>'+clubEsc(tr("Connect Schoology","Conectar Schoology"))+'</h4>'+
    '<ol class="sgysteps">'+
      '<li>'+clubEsc(tr("Open Schoology settings. You can also click the arrow next to your name at the top right of Schoology and choose Settings.",
        "Abre la configuración de Schoology. También puedes hacer clic en la flecha junto a tu nombre, arriba a la derecha en Schoology, y elegir Configuración."))+
        '<br><a class="btn ghost sgyopen" href="'+SGY_SETTINGS_URL+'" target="_blank" rel="noopener">'+clubEsc(tr("Open Schoology settings","Abrir configuración de Schoology"))+'</a></li>'+
      '<li>'+clubEsc(tr("Scroll down to Share your Schoology Calendar and click Enable. Copy the link under Use this iCal link.",
        "Baja hasta Share your Schoology Calendar y haz clic en Enable. Copia el enlace que aparece en Use this iCal link."))+'</li>'+
      '<li>'+clubEsc(tr("Paste it here. You only do this once on each device.","Pégalo aquí. Solo lo haces una vez en cada dispositivo."))+'</li>'+
    '</ol>'+
    '<div class="field'+(sgyStepMsg.bad?' bad':'')+'"><label for="sgyFeed">'+clubEsc(tr("Your Schoology calendar link","Tu enlace del calendario de Schoology"))+'</label>'+
      '<div class="sgypaste"><input type="text" id="sgyFeed" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="webcal://fuhsd.schoology.com/calendar/feed/ical/…" value="'+clubEsc(keep)+'"'+(sgyStepMsg.bad?' aria-invalid="true" aria-describedby="sgyMsg"':' aria-describedby="sgyMsg"')+'>'+
      (canPaste ? '<button type="button" class="btn ghost" data-sgy="paste">'+clubEsc(tr("Paste","Pegar"))+'</button>' : '')+'</div></div>'+
    '<button type="button" class="btn primary sgygo" data-sgy="connect"'+(sgyBusy?' disabled':'')+'>'+clubEsc(sgyBusy?tr("Connecting…","Conectando…"):tr("Connect Schoology","Conectar Schoology"))+'</button>'+
    '<p class="sgymsg'+(sgyStepMsg.bad?' bad':'')+'" id="sgyMsg" role="status" aria-live="polite">'+clubEsc(sgyStepMsg.text)+'</p>'+
    '<p class="note">'+clubEsc(tr("Your link stays on this device. Firebird Hub only uses it to read your Schoology calendar and never stores it anywhere else.",
      "Tu enlace se queda en este dispositivo. Firebird Hub solo lo usa para leer tu calendario de Schoology y nunca lo guarda en otro lugar."))+'</p>';
}

function sgyOpenDialog(){
  const d = document.getElementById("signinDialog"); if(!d) return;
  sgyStepMsg = { bad:false, text:"" };
  refreshSigninDialog();
  if(!d.open) d.showModal();
  const f = document.getElementById("sgyFeed"); if(f) f.focus();
}
document.addEventListener("click", function(ev){
  const b = ev.target.closest("[data-sgy],[data-sgyf]"); if(!b) return;
  const f = b.getAttribute("data-sgyf");
  if(f){ sgyFilter = f; renderSgySched(); return; }
  const a = b.getAttribute("data-sgy");
  if(a==="open") sgyOpenDialog();
  else if(a==="hide"){ try{ localStorage.setItem(SGY_HIDE_INVITE,"1"); }catch(e){} renderSgyHome(); }
  else if(a==="more"){ sgyShowAll = true; renderSgySched(); }
  else if(a==="connect"){ const i=document.getElementById("sgyFeed"); sgyConnect(i ? i.value : ""); }
  else if(a==="paste"){
    navigator.clipboard.readText().then(function(t){ const i=document.getElementById("sgyFeed"); if(i){ i.value = sgyClean(t); i.focus(); } })
      .catch(function(){ const i=document.getElementById("sgyFeed"); if(i) i.focus(); });
  }
  else if(a==="disconnect"){ sgyForget(); renderSchoology(); renderSgyStep(); }
});
document.addEventListener("input", function(ev){
  if(ev.target && ev.target.id==="sgySearch"){ sgyQuery = ev.target.value; renderSgySched(); }
});
document.addEventListener("keydown", function(ev){
  if(ev.key==="Enter" && ev.target && ev.target.id==="sgyFeed"){ ev.preventDefault(); sgyConnect(ev.target.value); }
});

_loadSignin(); sgyLoad(); applySignedInUI(); initGoogleSignin(); renderSchoology(); sgyRefresh(false);

/* =====================================================
   Spirit scoreboard — live pull from the Google Sheet
===================================================== */
function parseSheetRows(text){
  const rows=[]; let row=[],cell="",q=false;
  for(let i=0;i<text.length;i++){ const c=text[i];
    if(q){ if(c==='"'&&text[i+1]==='"'){cell+='"';i++;} else if(c==='"')q=false; else cell+=c; }
    else if(c==='"')q=true;
    else if(c===",")
      {row.push(cell);cell="";}
    else if(c==="\n"||c==="\r"){ if(c==="\r"&&text[i+1]==="\n")i++; row.push(cell);rows.push(row);row=[];cell=""; }
    else cell+=c;
  }
  if(cell.length||row.length){row.push(cell);rows.push(row);}
  return rows;
}
const CLSVAR = { "Seniors":"--cls-sr","Juniors":"--cls-jr","Sophomores":"--cls-so","Freshmen":"--cls-fr" };
const CLS_ES = { "Seniors":"Cuarto año","Juniors":"Tercer año","Sophomores":"Segundo año","Freshmen":"Primer año" };
// No made-up numbers: the board paints the last good standings saved on this device, or
// skeleton bars until the sheet answers. If it never does, a calm note takes their place.
const SPIRIT_CACHE_KEY = "fh_spirit_v1";
let spiritStandings = null, spiritFailed = false;
try{
  const c = JSON.parse(localStorage.getItem(SPIRIT_CACHE_KEY)||"null");
  if(c && Array.isArray(c.standings) && c.standings.length) spiritStandings = c.standings;
}catch(e){}
let prevLeaderCls = null;
function confettiBurst(el){
  if(matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const colors=["#8F1106","#FFC91F","#2A6F4E","#3B5BA5"];
  for(let i=0;i<16;i++){ const p=document.createElement("span"); p.className="confetti";
    p.style.setProperty("--x",(Math.random()*160-80)+"px"); p.style.setProperty("--r",(Math.random()*360)+"deg");
    p.style.background=colors[i%4]; p.style.left=(20+Math.random()*60)+"%"; el.appendChild(p);
    setTimeout(function(){ p.remove(); },1100); }
}
function renderBarRace(){
  const box=document.getElementById("barRace");
  if(!box) return;
  if(!spiritStandings || !spiritStandings.length){
    if(spiritFailed){
      box.removeAttribute("aria-busy");
      box.innerHTML='<p class="note barnote">'+tr("Standings will show here soon.","La clasificación aparecerá aquí pronto.")+'</p>';
    } else {
      box.setAttribute("aria-busy","true");
      box.innerHTML='<p class="sr">'+tr("Loading the standings…","Cargando la clasificación…")+'</p>'+
        '<div class="brow skel" aria-hidden="true"><div class="binfo"><span class="skl w40"></span><span class="skl bskl-pts"></span></div><div class="btrack"><span class="skl bskl-fill"></span></div></div>'.repeat(4);
    }
    return;
  }
  box.removeAttribute("aria-busy");
  const list=spiritStandings.slice().sort(function(a,b){ return b.pts-a.pts; });
  const max=Math.max(1, list[0].pts), leader=list[0];
  box.innerHTML=list.map(function(s,i){
    const lead = list[1] && list[0].pts>list[1].pts ? list[0].pts-list[1].pts : 0;
    const gap = i===0
      ? (lead ? tr("Leading by "+lead,"Adelante por "+lead) : tr("Leading","Adelante"))
      : tr((leader.pts-s.pts)+" behind","A "+(leader.pts-s.pts)+" puntos");
    const cvar=CLSVAR[s.cls]||"--cardinal";
    return '<div class="brow'+(i===0?" lead":"")+'" style="--c:var('+cvar+')">'+
      '<div class="binfo"><span class="bcls">'+clubEsc(tr(s.cls, CLS_ES[s.cls]||s.cls))+(i===0?' <span class="crown">'+tr("Projected winner","Ganador proyectado")+'</span>':'')+'</span><span class="bpts">'+s.pts+'</span></div>'+
      '<div class="btrack"><div class="bfill" data-w="'+Math.round(s.pts/max*100)+'"></div></div>'+
      '<div class="bgap">'+gap+'</div>'+
    '</div>';
  }).join("");
  requestAnimationFrame(function(){ box.querySelectorAll(".bfill").forEach(function(f){ f.style.width=f.dataset.w+"%"; }); });
  if(prevLeaderCls && prevLeaderCls!==leader.cls){ const L=box.querySelector(".brow.lead"); if(L){ L.classList.add("flash"); confettiBurst(L); } }
  prevLeaderCls=leader.cls;
}
let scoreboardPainted = false;
async function syncScoreboard(){
  if(!scoreboardPainted){ scoreboardPainted = true; renderBarRace(); } // later refreshes re-render only on a change
  try{
    const rows=parseSheetRows(await fetchCsv(SPIRIT_SHEET, 10000));
    const GRADES=["Seniors","Juniors","Sophomores","Freshmen"];
    const standings=GRADES.map(function(label){
      const r=rows.find(function(x){ return (x[0]||"").trim().toLowerCase()===label.toLowerCase(); });
      if(!r) return null;
      const pts=r.slice(1).reduce(function(sum,c){ const n=Number(String(c).replace(/[^\d.-]/g,"")); return sum+(Number.isFinite(n)?n:0); },0);
      return {cls:label, pts:pts};
    }).filter(Boolean);
    if(!standings.length) throw new Error("no classes in the Spirit Points tab");
    spiritFailed = false;
    try{ localStorage.setItem(SPIRIT_CACHE_KEY, JSON.stringify({ t:Date.now(), standings:standings })); }catch(e){}
    if(JSON.stringify(standings)!==JSON.stringify(spiritStandings)){ spiritStandings=standings; renderBarRace(); }
  }catch(e){
    // Offline or blocked: keep the last good standings. With none, swap the skeleton for a calm note.
    if(!spiritStandings && !spiritFailed){ spiritFailed = true; renderBarRace(); }
  }
}

/* =====================================================
   Boot
===================================================== */
/* Home "right now" chip — what period it is, at a glance */
function tickNowChip(){
  const chip = document.getElementById("nowChip");
  const sched = todaySchedule();
  if(!sched || !sched.rows.length){ chip.hidden = true; return; }
  const nowMin = nowMinPST();
  const cur = sched.rows.find(r=> !/staff only/i.test(r[0]) && nowMin>=toMin(r[1]) && nowMin<toMin(r[2]));
  if(cur){ setText(chip, tr("Now: ","Ahora: ")+periodName(cur[0])+tr(" · ends "," · termina a las ")+cur[2]); chip.hidden = false; }
  else chip.hidden = true;
}

renderClubs();
initSchedule();
renderToday();
syncScoreboard();
syncClubs();
renderEvents();
syncEventsSheet();
tickClock(); tickCountdown(); tickNowChip();
let lastMin = nowPST().getMinutes();
setInterval(()=>{
  tickClock(); tickCountdown();
  const m = nowPST().getMinutes();
  if(m!==lastMin){ lastMin=m; tickNowChip(); if(pickedDay==="auto") renderToday(); applyAnnouncements(); }
}, 1000);
// Keep live data current while the app is open: refetch when it comes back to the
// screen (if the last refresh is over a minute old) and every 2 minutes while visible.
// These all hit the website's CDN, not Apps Script directly.
let lastLiveRefresh = Date.now();
function refreshLive(){ lastLiveRefresh = Date.now(); syncEventsSheet(); syncScoreboard(); loadSports(true); syncAnnouncements(); sgyRefresh(false); }
document.addEventListener("visibilitychange", function(){
  if(document.visibilityState==="visible" && Date.now()-lastLiveRefresh > 60000) refreshLive();
});
setInterval(function(){ if(document.visibilityState==="visible") refreshLive(); }, 2*60*1000);
/* =====================================================
   #9 Announcements — priority banner + modal (ASB-editable seed).
   priority: "high" => modal (once per session); "med"/"low" => top banner.
   Dismissable; dismissal holds for the session. */
const ANNOUNCEMENTS = [
  { id:"welcome-2627", title:"Welcome back, Firebirds!", body:"Tap around for events, the bell schedule, spirit points, and clubs.", link:"", priority:"low", start:"2026-08-20", end:"2026-09-15", audience:"all" }
  // { id:"homecoming", title:"Homecoming is coming!", body:"Get your tickets before Friday.", link:"", priority:"high", start:"2026-10-20", end:"2026-10-31", audience:"all" }
];
const announceDismissed = new Set();
let announceShown = false;
function anPrio(p){ return p==="high"?3:(p==="med"||p==="medium")?2:1; }
function activeAnnounce(){
  const now = nowPST();
  return ANNOUNCEMENTS.filter(function(a){
    if(!a.id || announceDismissed.has(a.id)) return false;
    const st = a.start?parseEvDate(a.start,false):null, en = a.end?parseEvDate(a.end,true):null;
    if(st && now < st) return false;
    if(en && now > en) return false;
    return true;
  }).sort(function(a,b){ return anPrio(b.priority)-anPrio(a.priority); });
}
function renderAnnounce(){
  const list = activeAnnounce(); if(!list.length) return;
  const a = list[0];
  if(a.priority==="high" && !announceShown){ announceShown = true; showAnnounceModal(a); return; }
  showAnnounceBanner(a);
}
function anLink(a){ return /^https?:\/\//.test(a.link||"") ? '<a class="btn gold" href="'+clubEsc(a.link)+'" target="_blank" rel="noopener">Learn more</a>' : ""; }
function showAnnounceBanner(a){
  const b = document.getElementById("announceBanner"); if(!b) return;
  b.innerHTML = '<div class="announce-in"><span class="announce-dot" aria-hidden="true"></span>'+
    '<div class="announce-copy"><b>'+clubEsc(a.title)+'</b>'+(a.body?' <span>'+clubEsc(a.body)+'</span>':"")+'</div>'+
    anLink(a)+'<button type="button" class="announce-x" aria-label="Dismiss announcement">&times;</button></div>';
  b.hidden = false;
  b.querySelector(".announce-x").onclick = function(){ announceDismissed.add(a.id); b.hidden = true; b.innerHTML=""; renderAnnounce(); };
}
function showAnnounceModal(a){
  const d = document.getElementById("announceDialog"); if(!d){ showAnnounceBanner(a); return; }
  d.querySelector("#anTitle").textContent = a.title;
  d.querySelector("#anBody").textContent = a.body||"";
  const foot = d.querySelector("#anFoot"); foot.innerHTML = anLink(a)+'<button type="button" class="btn primary" id="anClose">Got it</button>';
  foot.querySelector("#anClose").onclick = function(){ announceDismissed.add(a.id); d.close(); };
  d.querySelector("#anDismiss").onclick = function(){ announceDismissed.add(a.id); d.close(); };
  if(!d.open) d.showModal();
}

/* =====================================================
   #7 FTV morning announcement summaries — home card + archive. Newest first. */
const FTV_FEED = [
  // { date:"2026-09-02", bullets:["Rally Friday during Tutorial","Club Rush in the quad"], full:"Full text." }
];
function ftvDateLabel(d){ const m=String(d).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if(!m) return d; const MO=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]; return tr(MO[+m[2]-1]+" "+(+m[3]), (+m[3])+" de "+MO_ES[+m[2]-1]+"."); }
function renderFTV(){
  const card = document.getElementById("ftvCard"); if(!card) return;
  if(!FTV_FEED.length){
    card.hidden = false;
    card.innerHTML = '<div class="sechead"><h2 id="h-ftv">FTV morning announcements</h2><span class="rule" aria-hidden="true"></span></div>'+
      '<div class="card"><p class="note" style="margin:0">Today&rsquo;s FTV recap will show here once ASB posts it.</p></div>';
    return;
  }
  const t = FTV_FEED[0];
  const bullets = (t.bullets||[]).map(function(x){ return '<li>'+clubEsc(x)+'</li>'; }).join("");
  const rest = FTV_FEED.slice(1,15).map(function(d){
    const bl = (d.bullets||[]).map(function(x){ return '<li>'+clubEsc(x)+'</li>'; }).join("");
    return '<details class="ftv-day"><summary>'+ftvDateLabel(d.date)+'</summary><ul>'+bl+'</ul></details>';
  }).join("");
  card.hidden = false;
  card.innerHTML = '<div class="sechead"><h2 id="h-ftv">FTV morning announcements</h2><span class="rule" aria-hidden="true"></span></div>'+
    '<div class="card ftv-today"><p class="ftv-date">'+ftvDateLabel(t.date)+'</p><ul class="ftv-bullets">'+bullets+'</ul>'+
    (rest?'<details class="ftv-archive"><summary>Past days</summary>'+rest+'</details>':"")+'</div>';
}

/* =====================================================
   #3 Motion mode — revertable. OFF by default keeps the current look. */
let motionOn = false;
function initMotion(){
  const btn = document.getElementById("motionToggle");
  if(btn) btn.addEventListener("click", function(){ setMotion(!motionOn); });
  var saved=false; try{ saved = localStorage.getItem("fhMotion")==="1"; }catch(e){}
  setMotion(saved);
}
function setMotion(on){
  motionOn = on;
  document.body.classList.toggle("motion", on);
  try{ localStorage.setItem("fhMotion", on ? "1" : "0"); }catch(e){}
  var b1 = document.getElementById("motionToggle");
  if(b1){ b1.setAttribute("aria-pressed", String(on)); b1.textContent = on ? "Motion mode: On" : "Motion mode: Off"; }
  var b2 = document.getElementById("motionToggle2");
  if(b2){ b2.setAttribute("aria-pressed", String(on)); b2.textContent = on ? "On" : "Off"; }
  if(on) observeReveals();
}
function observeReveals(){
  if(!motionOn || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const els = document.querySelectorAll("body.motion .ticket:not(.in), body.motion .reveal:not(.in)");
  if(!("IntersectionObserver" in window)){ els.forEach(function(el){ el.classList.add("in"); }); return; }
  const io = new IntersectionObserver(function(es){ es.forEach(function(en){ if(en.isIntersecting){ en.target.classList.add("in"); io.unobserve(en.target); } }); }, { threshold:0.1 });
  els.forEach(function(el){ io.observe(el); });
}

const boot = parseHash();
if(boot.view==="give") fillGive(boot.params);
show(boot.view || "home", false);
renderAnnounce();
renderFTV();
syncAnnouncements();
initMotion();
loadSports(); /* preload sports */

// Fire Bucks off: hide the Firebird Card section in More (code kept in the repo).
if(!FEATURES.fireBucks){
  const fbSection = document.querySelector('section[aria-labelledby="h-card"]');
  if(fbSection) fbSection.hidden = true;
}

/* =====================================================
   Settings + Language (EN/ES) — saved per device
===================================================== */
var I18N_EN_ES = {
  "until class":"para la clase",
  // Sports view
  "★ Featured":"★ Destacados","★ Senior Night":"★ Noche de los seniors","Senior Night":"Noche de los seniors",
  "Teams in season":"Equipos en temporada","This week":"Esta semana","Coming up":"Próximamente","All upcoming":"Todos los próximos",
  "Recent results":"Resultados recientes","Upcoming games":"Próximos partidos","Upcoming meets":"Próximas competencias","Upcoming matches":"Próximos encuentros",
  "Away":"Visitante","League":"Liga","Scrimmage":"Amistoso","NEXT":"PRÓXIMO",
  "Score coming soon":"Marcador próximamente","Score not posted yet":"Marcador aún no publicado","Results on the team page":"Resultados en la página del equipo",
  "View games →":"Ver partidos →","View meets →":"Ver competencias →","View matches →":"Ver encuentros →",
  "Team page & roster →":"Página y plantilla del equipo →",
  "No upcoming games are listed right now.":"Por ahora no hay partidos próximos.",
  "No upcoming games are listed right now":"Por ahora no hay partidos próximos",
  "The schedule will show here in a moment. Every team's full schedule is also on":"El horario aparecerá aquí en un momento. El horario completo de cada equipo también está en",
  "Advisor:":"Asesor:",
  "Featured":"Destacado","View photos":"Ver fotos","Photos coming soon":"Fotos próximamente",
  "FTV morning announcements":"Anuncios matutinos de FTV","Past days":"Días anteriores",
  "Today’s FTV recap will show here once ASB posts it.":"El resumen de FTV de hoy aparecerá aquí cuando ASB lo publique.",
  "Full schedules, rosters & live updates at fremonthsathletics.org →":"Horarios completos, plantillas y novedades en fremonthsathletics.org →",
  "Pick a week…":"Elige una semana…",
  "Rally Week":"Semana de rally","Labor Day Week":"Semana del Día del Trabajo","Homecoming Week":"Semana de Homecoming",
  "Non-Duty Day Week":"Semana del día sin clases","Veterans Day Week":"Semana del Día de los Veteranos","Thanksgiving Week":"Semana de Acción de Gracias",
  "1st Semester Finals":"Finales del 1.er semestre","MLK Week":"Semana de MLK","Career Day Week":"Semana del Día de Carreras",
  "CAASPP Testing Week":"Semana de exámenes CAASPP","March Non-Duty Day Week":"Semana del día sin clases de marzo",
  "Senior Finals Week":"Semana de finales de seniors","2nd Semester Finals":"Finales del 2.º semestre",
  "Mon":"Lun","Tue":"Mar","Wed":"Mié","Thu":"Jue","Fri":"Vie",
  "B day + Rally":"Día B + Rally","B day + Homecoming Rally":"Día B + Rally de Homecoming","B day + Senior Goodbye Rally":"Día B + Rally de despedida de seniors",
  "Blocks 1–7":"Bloques 1–7","Career Day":"Día de Carreras",
  "Finals: 4th & 7th":"Finales: 4.º y 7.º","Finals: 5th & 6th":"Finales: 5.º y 6.º","Finals: 1st & 3rd":"Finales: 1.º y 3.º","Finals: 1st & 2nd":"Finales: 1.º y 2.º",
  "Finals: 2nd (min day)":"Finales: 2.º (día corto)","Finals: 3rd (last day)":"Finales: 3.º (último día)",
  "Labor Day":"Día del Trabajo","Teacher Non-Duty Day":"Día sin clases para maestros","Veterans Day":"Día de los Veteranos",
  "Thanksgiving Break":"Vacaciones de Acción de Gracias","Thanksgiving":"Acción de Gracias","MLK Jr. Day":"Día de MLK Jr.",
  "Non-Duty Day":"Día sin clases","Memorial Day":"Día de los Caídos","Teacher Work Day":"Día de trabajo para maestros",
  "Rally week template":"Plantilla de semana de rally","early September":"principios de septiembre","Oct 5–9, 2026":"5–9 de oct. de 2026",
  "Oct 12–16, 2026":"12–16 de oct. de 2026","Nov 9–13, 2026":"9–13 de nov. de 2026","Nov 23–27, 2026":"23–27 de nov. de 2026",
  "mid-December":"mediados de diciembre","mid-January":"mediados de enero","early February":"principios de febrero",
  "early March · 11th graders test":"principios de marzo · examen de 11.º grado","Mar 15–19, 2027":"15–19 de mar. de 2027",
  "late May":"finales de mayo","early June · 9th–11th":"principios de junio · 9.º a 11.º",
  "A regular week, but Friday's Tutorial becomes the Rally (10:10–10:50).":"Una semana normal, pero la Tutoría del viernes se convierte en el Rally (10:10–10:50).",
  "Friday runs a B day with the Homecoming Rally replacing Tutorial.":"El viernes es Día B y el Rally de Homecoming reemplaza la Tutoría.",
  "Veterans Day is a Wednesday this year. The other days follow last year's pattern, so check the morning announcements for the final A and B days.":"Este año el Día de los Veteranos cae en miércoles. Los demás días siguen el patrón del año pasado, así que revisa los anuncios de la mañana para confirmar los días A y B.",
  "This follows last year's pattern, so check the morning announcements for the final A and B days.":"Esto sigue el patrón del año pasado, así que revisa los anuncios de la mañana para confirmar los días A y B.",
  "Monday is a custom all-blocks Career Day; Tue–Fri are normal A/B.":"El lunes es el Día de Carreras con todos los bloques; de martes a viernes son días A y B normales.",
  "11th graders test Tue–Thu; other grades have a delayed start, so check announcements.":"Los de 11.º grado tienen examen de martes a jueves; los demás grados empiezan más tarde, así que revisa los anuncios.",
  "Senior finals happen in class. Friday closes with the Senior Goodbye Rally.":"Los finales de seniors son en clase. El viernes cierra con el Rally de despedida de seniors.",
  "Led by:":"Liderado por:",
  "Home":"Inicio","Schedule":"Horario","Spirit":"Espíritu","Clubs":"Clubes","Sports":"Deportes","More":"Más",
  "Sign in":"Iniciar sesión","Skip to main content":"Saltar al contenido principal",
  "The One Nest for":"El nido central para","Everything FHS":"Todo lo de FHS",
  "Every event, every bell, every club, in one place, for every Firebird. No app to download, and no login needed to look around.":"Cada evento, cada campana, cada club, en un solo lugar, para cada Firebird. No hay que descargar ninguna app ni iniciar sesión para explorar.",
  "Bell schedule":"Horario de campanas","Browse clubs":"Explorar clubes","Next up":"Próximo","Upcoming events":"Próximos eventos",
  "left":"restante","Loading…":"Cargando…","Normal week":"Semana normal","Special weeks":"Semanas especiales",
  "Today":"Hoy","Monday":"Lunes","Tuesday":"Martes","Wednesday":"Miércoles","Thursday":"Jueves","Friday":"Viernes",
  "A day":"Día A","B day":"Día B","Period":"Periodo","Starts":"Empieza","Ends":"Termina",
  "Choose a special week":"Elige una semana especial","Bell schedule for the selected day":"Horario de campanas para el día seleccionado",
  "Official 2026–27 FHS bell schedule. The special weeks (rallies, finals, CAASPP, holidays) are built right in. Dates shift a little year to year, so for the exact week trust the announcements. Go Firebirds!":"Horario oficial de campanas de FHS 2026–27. Las semanas especiales (rallies, finales, CAASPP, días feriados) ya están incluidas. Las fechas cambian un poco cada año, así que para la semana exacta confía en los anuncios. ¡Vamos Firebirds!",
  "Spirit points":"Puntos de espíritu","How points work":"Cómo funcionan los puntos",
  "Dress up on a spirit day (submit a photo below)":"Vístete en un día de espíritu (envía una foto abajo)",
  "Your grade wins the rally":"Tu grado gana el rally","Your grade takes second at the rally":"Tu grado queda en segundo lugar en el rally",
  "Your grade wins an Olympia (3v3 hoops, soccer, chess…)":"Tu grado gana una Olympia (básquetbol 3v3, fútbol, ajedrez…)",
  "Teacher bonus, awarded by staff and added by Spirit":"Bono del maestro, otorgado por el personal y añadido por Espíritu",
  "One dress-up submission per student per day, and duplicates are removed before points post. Photos are only seen by ASB Spirit & Tech and your advisor.":"Un envío de atuendo por estudiante por día, y los duplicados se eliminan antes de sumar puntos. Las fotos solo las ven ASB Espíritu y Tecnología y tu consejero.",
  "Submit your Spirit Wear!":"¡Envía tu Spirit Wear!","Full name":"Nombre completo","Enter your first and last name.":"Escribe tu nombre y apellido.",
  "Grade":"Grado","Choose your grade…":"Elige tu grado…","9 · Freshman":"9 · Primer año","10 · Sophomore":"10 · Segundo año","11 · Junior":"11 · Tercer año","12 · Senior":"12 · Cuarto año",
  "Pick your grade so points go to the right class.":"Elige tu grado para que los puntos vayan a la clase correcta.",
  "Student ID":"Identificación estudiantil","Used only to prevent duplicate submissions.":"Se usa solo para evitar envíos duplicados.",
  "Enter your student ID (numbers only, 5–7 digits).":"Escribe tu ID estudiantil (solo números, 5–7 dígitos).",
  "Spirit day":"Día de espíritu","Which day is this for?":"¿Para qué día es esto?",
  "Mon · Island (beach)":"Lun · Isla (playa)","Tue · Outwit (nerd)":"Mar · Outwit (nerd)","Wed · Outlast (camo)":"Mié · Outlast (camuflaje)","Thu · Outplay (jersey)":"Jue · Outplay (jersey)","Fri · Tribe (class colors)":"Vie · Tribu (colores de clase)",
  "Choose the spirit day you dressed up for.":"Elige el día de espíritu para el que te vestiste.",
  "Photo of your fit":"Foto de tu atuendo","Attach a photo, since that’s how Spirit verifies the point.":"Adjunta una foto, ya que así es como Espíritu verifica el punto.",
  "Check my fit":"Revisa mi atuendo",
  "On-device check that reads your photo and tells you if the outfit matches the spirit day. Nothing leaves your phone, and Spirit still confirms every point.":"Revisión en tu dispositivo que lee tu foto y te dice si el atuendo coincide con el día de espíritu. Nada sale de tu teléfono, y Espíritu confirma cada punto.",
  "Send it in · +1 pt":"Envíalo · +1 pt","Add your photo and day, then tap":"Agrega tu foto y el día, luego toca","to unlock this.":"para desbloquear esto.",
  "All":"Todos","Arts":"Artes","Service":"Servicio","Athletics":"Atletismo","Culture":"Cultura",
  "Find your club":"Encuentra tu club","Search clubs":"Buscar clubes",
  "No clubs match that search. Try a different name or clear the search.":"Ningún club coincide con esa búsqueda. Prueba otro nombre o borra la búsqueda.",
  "Club events this year":"Eventos de clubes este año","Clubs Day":"Día de Clubes","Multicultural Night":"Noche Multicultural","Club Trivia Night":"Noche de Trivia de Clubes","Club Grub Day":"Día de Comida de Clubes","Clubs":"Clubes",
  "The fall club fair. Walk the quad, meet the clubs, and sign up in person.":"La feria de clubes de otoño. Recorre el quad, conoce los clubes e inscríbete en persona.",
  "Wed Sep 16 · the quad · lunch":"Mié 16 de sep. · el quad · almuerzo","Wed Oct 28 · evening":"Mié 28 de oct. · noche",
  "Wed Jan 27 · evening":"Mié 27 de ene. · noche","Wed Apr 21 · the quad · lunch":"Mié 21 de abr. · el quad · almuerzo",
  "Follow":"Sigue a","on Instagram for the latest club info.":"en Instagram para lo último de los clubes.",
  "View the full official clubs list ↗":"Ver la lista oficial completa de clubes ↗",
  "New club interviews":"Entrevistas para clubes nuevos","Clubs list finalized":"Lista de clubes finalizada",
  "Clubs Day sign-ups (for clubs)":"Inscripciones para el Día de Clubes (para clubes)","First monthly check-in due, 11:59 PM":"Vence la primera revisión mensual, 11:59 PM",
  "Second-round new club applications open":"Abre la segunda ronda de solicitudes para clubes nuevos","Club renewals":"Renovación de clubes",
  "Sep 2–9":"2–9 de sep.","Sep 9–10":"9–10 de sep.","Sep 9–13":"9–13 de sep.","Sep 16":"16 de sep.","Sep 30":"30 de sep.","Oct 28":"28 de oct.",
  "January":"Enero","Jan 27":"27 de ene.","Apr 21":"21 de abr.","May":"Mayo","Jan":"Ene","Apr":"Abr","Aug":"Ago","Dec":"Dic",
  "A night celebrating Fremont’s cultures with performances and food from our culture and identity clubs.":"Una noche que celebra las culturas de Fremont con presentaciones y comida de nuestros clubes de cultura e identidad.",
  "Team trivia hosted by the Clubs Commission. Bring your club and test what you know.":"Trivia por equipos organizada por la Comisión de Clubes. Trae tu club y pon a prueba lo que sabes.",
  "Clubs sell food on campus. Come hungry and support your favorite clubs.":"Los clubes venden comida en el campus. Ven con hambre y apoya a tus clubes favoritos.",
  "Key dates & deadlines":"Fechas y plazos clave","Fall semester":"Semestre de otoño","Spring semester":"Semestre de primavera",
  "A monthly check-in form goes out on the 1st of every month and is due at the end of that month.":"Un formulario de revisión mensual se envía el día 1 de cada mes y vence al final de ese mes.",
  "Club info meeting slides":"Diapositivas de la reunión informativa de clubes",
  "The full Clubs Commission info deck, with everything above in more detail.":"La presentación completa de la Comisión de Clubes, con todo lo anterior en más detalle.",
  "Open the slides in a new tab":"Abrir las diapositivas en una pestaña nueva",
  "How clubs work":"Cómo funcionan los clubes","Starting a new club":"Iniciar un club nuevo","Staying official":"Mantenerse oficial","Strikes":"Faltas",
  "Find a teacher advisor who can be at every meeting.":"Encuentra a un maestro consejero que pueda asistir a cada reunión.",
  "Get 10+ interested students. All 10 type their own names from their own accounts so signatures can be verified.":"Reúne a 10 o más estudiantes interesados. Los 10 escriben su propio nombre desde su propia cuenta para poder verificar las firmas.",
  "Write a club constitution in a Google Doc (purpose, membership requirements and obligations, officer roles) and share it with the clubs account.":"Escribe la constitución del club en un Google Doc (propósito, requisitos y obligaciones de los miembros, cargos de la directiva) y compártela con la cuenta de clubes.",
  "Submit the new-club application form, then complete your club interview.":"Envía el formulario de solicitud para club nuevo y luego completa la entrevista de tu club.",
  "If you pass, you get a confirmation email from fremontclubs@gmail.com.":"Si te aprueban, recibirás un correo de confirmación de fremontclubs@gmail.com.",
  "Missed this round? A second application round opens in January.":"¿Te perdiste esta ronda? Una segunda ronda de solicitudes abre en enero.",
  "Complete the monthly check-in: a photo of your meeting with 10 members and your advisor.":"Completa la revisión mensual: una foto de tu reunión con 10 miembros y tu consejero.",
  "Keep your club’s Google Drive folder updated.":"Mantén al día la carpeta de Google Drive de tu club.",
  "Strike 1 is a warning, strike 2 is a meeting with you and your advisor, and strike 3 means the club is disbanded. You can appeal a strike within the same school year.":"La falta 1 es una advertencia, la falta 2 es una reunión contigo y tu consejero, y la falta 3 significa que el club se disuelve. Puedes apelar una falta dentro del mismo año escolar.",
  "No School":"Sin clases",
  "Hold at least one meeting a month.":"Realiza al menos una reunión al mes.",
  "Take part in at least 2 club events a year.":"Participa en al menos 2 eventos de clubes al año.",
  "Questions & links":"Preguntas y enlaces","Get in touch":"Ponte en contacto","on Instagram":"en Instagram",
  "Handbook, tracker & clubs list":"Manual, registro y lista de clubes",
  "The club handbook, accountability tracker, and the full clubs list live on the ASB site.":"El manual de clubes, el registro de responsabilidad y la lista completa de clubes están en el sitio de ASB.",
  "Open the clubs page":"Abrir la página de clubes",
  "Register":"Registro","Team shop":"Tienda del equipo","Donate":"Donar","News":"Noticias","Calendar":"Calendario","Contact":"Contacto",
  "Sport":"Deporte","Level":"Nivel","All sports":"Todos los deportes","All levels":"Todos los niveles","Loading Fremont Athletics…":"Cargando Fremont Athletics…",
  "Settings":"Ajustes","Language":"Idioma","Text size":"Tamaño de texto","Normal":"Normal","Large":"Grande","Motion mode":"Modo movimiento","Off":"Apagado","On":"Encendido",
  "Your choices are saved on this device. Menus and buttons switch to Spanish; live listings stay in the language they were entered.":"Tus preferencias se guardan en este dispositivo. Los menús y botones cambian a español; las listas en vivo permanecen en el idioma en que se ingresaron.",
  "Feedback & more":"Comentarios y más","Tell ASB anything":"Dile lo que sea a ASB",
  "Event ideas, questions, or shout-outs. Add your name and school email so ASB can follow up. It comes straight to us, with no extra steps.":"Ideas de eventos, preguntas o saludos. Agrega tu nombre y tu correo escolar para que ASB pueda responderte. Nos llega directamente, sin pasos extra.",
  "Your name":"Tu nombre","Add your first and last name.":"Agrega tu nombre y apellido.","School email":"Correo escolar",
  "Add a valid email so ASB can reply.":"Agrega un correo válido para que ASB pueda responder.","Message":"Mensaje",
  "Write a message first. Even one sentence helps.":"Escribe un mensaje primero. Incluso una oración ayuda.","Send to ASB":"Enviar a ASB","Sending…":"Enviando…",
  "Find ASB":"Encuentra a ASB","for photos, FTV, resources, and store links":"para fotos, FTV, recursos y enlaces de la tienda",
  "ASB Leadership · Fremont High School, Sunnyvale (FUHSD)":"Liderazgo de ASB · Fremont High School, Sunnyvale (FUHSD)",
  "About this app":"Acerca de esta app",
  "Built by the ASB Tech Commission. Spirit submissions go only to ASB Spirit, Tech, and the advisor. They’re never shared publicly, and student IDs are used solely to remove duplicate entries. Questions? Drop a note in the feedback box.":"Creada por la Comisión de Tecnología de ASB. Los envíos de espíritu van solo a ASB Espíritu, Tecnología y el consejero. Nunca se comparten públicamente, y los IDs estudiantiles se usan únicamente para eliminar entradas duplicadas. ¿Preguntas? Deja una nota en la caja de comentarios.",
  "Motion mode: Off":"Modo movimiento: Apagado","Motion mode: On":"Modo movimiento: Encendido",
  "Motion mode swaps the card layout for scroll animations and a swipeable events row. Off keeps the classic look.":"El modo movimiento cambia el diseño de tarjetas por animaciones de desplazamiento y una fila de eventos deslizable. Apagado mantiene el estilo clásico.",
  "Ask Felipe":"Pregúntale a Felipe","Hi! Ask me about the bell schedule, clubs, events, or sports.":"¡Hola! Pregúntame sobre el horario de campanas, clubes, eventos o deportes.",
  // Fixed replies from /api/ask (api/ask.js MSG)
  "Ask Felipe isn't set up yet. For now, please check the Schedule, Clubs, Sports and More tabs.":"Pregúntale a Felipe todavía no está listo. Por ahora, revisa las pestañas Horario, Clubes, Deportes y Más.",
  "Felipe needs a short break. Please wait a minute and ask again, or check the Schedule, Clubs and Sports tabs in the meantime.":"Felipe necesita un breve descanso. Espera un minuto y vuelve a preguntar, o mientras tanto revisa las pestañas Horario, Clubes y Deportes.",
  "I couldn't answer that one. Try asking about the bell schedule, clubs, events or sports.":"No pude responder esa pregunta. Intenta preguntar sobre el horario de campanas, los clubes, los eventos o los deportes.",
  "Felipe is having a moment. Please try again in a bit, or check the Schedule, Clubs and Sports tabs.":"Felipe tiene un pequeño problema en este momento. Inténtalo de nuevo en un rato, o revisa las pestañas Horario, Clubes y Deportes.",
  "Send":"Enviar","School questions only · answers aren't monitored live":"Solo preguntas escolares · las respuestas no se supervisan en vivo","Close":"Cerrar",
  "Google sign-in":"Iniciar sesión con Google",
  "Sign in with your school Google account to see your name on the app. Photos and points still only go where you send them.":"Inicia sesión con tu cuenta escolar de Google para ver tu nombre en la app. Las fotos y los puntos solo van a donde tú los envías.",
  "Google sign-in isn't reachable on this network right now. Everything else in the app still works.":"El inicio de sesión con Google no está disponible en esta red por ahora. Todo lo demás en la app sigue funcionando.",
  "Sign out":"Cerrar sesión",
  "Go Firebirds. Built with care by the Tech Commission at Fremont High School, FUHSD.":"¡Vamos Firebirds! Hecho con dedicación por la Comisión de Tecnología de Fremont High School, FUHSD.",
  "Accessibility issues? Tell us in the feedback box. We fix those first.":"¿Problemas de accesibilidad? Dinos en la caja de comentarios. Esos los arreglamos primero."
};
var I18N_ATTR = {
  "Search clubs by name…":"Busca clubes por nombre…",
  "Ask about schedule, clubs, sports…":"Pregunta sobre horario, clubes, deportes…",
  "Your name":"Tu nombre","Student ID":"Identificación estudiantil"
};
var fhLang = "en", fhTextSize = "normal";
try{ fhLang = localStorage.getItem("fhLang") || "en"; }catch(e){}
try{ fhTextSize = localStorage.getItem("fhTextSize") || "normal"; }catch(e){}
function fhT(key, fallback){ return fallback; }
var _i18nOrig = (typeof WeakMap!=="undefined") ? new WeakMap() : null;
function walkI18n(root, es){
  if(!root || !_i18nOrig || !document.createTreeWalker) return;
  var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  var n;
  while(n = w.nextNode()){
    var p = n.parentNode; if(!p) continue;
    var tag = p.nodeName;
    if(tag==="SCRIPT"||tag==="STYLE"||tag==="TEXTAREA") continue;
    if(!_i18nOrig.has(n)) _i18nOrig.set(n, n.nodeValue);
    var orig = _i18nOrig.get(n);
    var key = orig.trim();
    if(!key){ continue; }
    if(es && I18N_EN_ES[key]!==undefined){ n.nodeValue = orig.replace(key, I18N_EN_ES[key]); }
    else { n.nodeValue = orig; }
  }
}
function applyAttrI18n(es){
  document.querySelectorAll("[placeholder]").forEach(function(el){
    if(!el.hasAttribute("data-ph-en")) el.setAttribute("data-ph-en", el.getAttribute("placeholder")||"");
    var en = el.getAttribute("data-ph-en");
    el.setAttribute("placeholder", (es && I18N_ATTR[en]) || en);
  });
}
var _i18nObserver = null;
function startI18nObserver(){
  if(_i18nObserver || typeof MutationObserver==="undefined") return;
  _i18nObserver = new MutationObserver(function(muts){
    if(fhLang!=="es") return;
    for(var i=0;i<muts.length;i++){
      var added = muts[i].addedNodes;
      for(var j=0;j<added.length;j++){
        var node = added[j];
        if(node.nodeType===1) walkI18n(node, true);
        else if(node.nodeType===3){
          if(!_i18nOrig.has(node)) _i18nOrig.set(node, node.nodeValue);
          var key=node.nodeValue.trim();
          if(key && I18N_EN_ES[key]!==undefined) node.nodeValue = node.nodeValue.replace(key, I18N_EN_ES[key]);
        }
      }
    }
  });
  try{ _i18nObserver.observe(document.body, {childList:true, subtree:true}); }catch(e){}
}
function applyLang(){
  var es = (fhLang==="es");
  walkI18n(document.body, es);
  applyAttrI18n(es);
  document.documentElement.setAttribute("lang", fhLang);
  document.querySelectorAll("[data-lang]").forEach(function(b){ b.setAttribute("aria-pressed", String(b.getAttribute("data-lang")===fhLang)); });
  startI18nObserver();
  if(typeof renderSports==="function" && document.getElementById("sportsBody")) { try{ renderSports(); }catch(e){} }
  if(typeof renderClubs==="function" && document.getElementById("clubGrid")) { try{ renderClubs(); }catch(e){} }
  // Text the app builds itself (tr) is redrawn in the new language.
  try{
    renderBarRace(); tickClock(); tickNowChip(); tickCountdown(); renderFTV(); updateSportsStamp();
    if(pickedDay==="auto") renderToday(); else renderDay({rows:SCHEDULES[pickedDay].rows});
    if(pickedWeek>=0) renderWeek(SPECIAL_WEEKS[pickedWeek]);
    applySignedInUI(); refreshSigninDialog(); renderSchoology();
  }catch(e){}
}
function setLang(l){ fhLang = (l==="es"?"es":"en"); try{ localStorage.setItem("fhLang", fhLang); }catch(e){} applyLang(); }
function applyTextSize(){
  document.documentElement.classList.toggle("bigtext", fhTextSize==="large");
  document.querySelectorAll("[data-textsize]").forEach(function(b){ b.setAttribute("aria-pressed", String(b.getAttribute("data-textsize")===fhTextSize)); });
}
function setTextSize(v){ fhTextSize = (v==="large"?"large":"normal"); try{ localStorage.setItem("fhTextSize", fhTextSize); }catch(e){} applyTextSize(); }
(function initSettings(){
  document.addEventListener("click", function(e){
    var l = e.target.closest && e.target.closest("[data-lang]");
    if(l){ setLang(l.getAttribute("data-lang")); return; }
    var t = e.target.closest && e.target.closest("[data-textsize]");
    if(t){ setTextSize(t.getAttribute("data-textsize")); return; }
    if(e.target.closest && e.target.closest("#motionToggle2") && typeof setMotion==="function"){ setMotion(!(typeof motionOn!=="undefined"&&motionOn)); }
  });
  applyLang(); applyTextSize();
})();

/* =====================================================
   Ask Firebird — chatbot UI (calls /api/ask, Gemini-backed)
===================================================== */
(function(){
  var fab=document.getElementById("askFab"), panel=document.getElementById("askPanel");
  if(!fab||!panel) return;
  var log=document.getElementById("askLog"), form=document.getElementById("askForm"), input=document.getElementById("askInput");
  var close=document.getElementById("askClose");
  var lastSend=0, busy=false;
  var back=document.getElementById("askBack");
  function open(){ panel.hidden=false; if(back) back.hidden=false; setTimeout(function(){ input && input.focus(); },50); }
  function hide(){ panel.hidden=true; if(back) back.hidden=true; }
  if(back) back.addEventListener("click", hide);
  fab.addEventListener("click", function(){ panel.hidden ? open() : hide(); });
  close && close.addEventListener("click", hide);
  function add(text, who){ var d=document.createElement("div"); d.className="askmsg "+who; d.textContent=text; log.appendChild(d); log.scrollTop=log.scrollHeight; return d; }
  form.addEventListener("submit", function(e){
    e.preventDefault();
    var q=(input.value||"").trim(); if(!q||busy) return;
    var now=Date.now(); if(now-lastSend<1500){ return; } lastSend=now;
    add(q,"me"); input.value=""; busy=true;
    var t=add("Felipe is thinking…","bot typing");
    fetch("/api/ask",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({question:q})})
      .then(function(r){return r.json();})
      .then(function(d){ t.remove(); add((d&&d.answer)||"Hmm, try asking that a different way.","bot"); })
      .catch(function(){ t.remove(); add("Couldn't reach Felipe right now. Check the Schedule, Clubs, Sports, or More tabs.","bot"); })
      .finally(function(){ busy=false; });
  });
})();

/* Ask Firebird: dismiss on outside-click or Escape */
(function(){
  document.addEventListener("click", function(e){
    var panel=document.getElementById("askPanel");
    if(!panel) return;
    // X button (delegated so it works even if the direct binding missed)
    var back=document.getElementById("askBack");
    if(e.target.closest && e.target.closest("#askClose")){ panel.hidden = true; if(back) back.hidden=true; return; }
    if(panel.hidden) return;
    // outside-click closes
    if(e.target.closest && (e.target.closest("#askPanel") || e.target.closest("#askFab"))) return;
    panel.hidden = true; if(back) back.hidden=true;
  });
  document.addEventListener("keydown", function(e){
    if(e.key==="Escape"){ var p=document.getElementById("askPanel"); if(p && !p.hidden){ p.hidden=true; var b=document.getElementById("askBack"); if(b) b.hidden=true; } }
  });
})();
