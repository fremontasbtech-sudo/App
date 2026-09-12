
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

/* Spirit-points scoreboard auto-syncs from this Google Sheet (view-shared).
   Sheet is a matrix: col A = class, each next column = an event; a class's
   total is the sum of its row. Add an event = add a column, nothing else. */
const SPIRIT_SHEET = "https://docs.google.com/spreadsheets/d/1gS0bbOGgpjMpCfeYOUBI4B39oPEtNU-1Y2n1nEWkZ7o/gviz/tq?tqx=out:csv&gid=0";

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
  { id:"homecoming", name:"Homecoming Week", dates:"mid-October",
    note:"Friday runs a B day with the Homecoming Rally replacing Tutorial.",
    days:[ OFF("Mon","District SAT Testing"), D("Tue","A day",A), D("Wed","B day",B), D("Thu","A day",A), D("Fri","B day + Homecoming Rally",RALLY_B) ] },
  { id:"veterans", name:"Veteran's Day Week", dates:"mid-November",
    days:[ D("Mon","A day",A), OFF("Tue","Veteran's Day"), D("Wed","B day",B), D("Thu","A day",A), D("Fri","B day",B) ] },
  { id:"thanksgiving", name:"Thanksgiving Week", dates:"late November",
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
  { id:"march", name:"March SAT Week", dates:"mid-March",
    days:[ OFF("Mon","SAT Testing"), D("Tue","A day",A), D("Wed","B day",B), D("Thu","A day",A), D("Fri","B day",B) ] },
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
  { name:"Clubs Day", when:new Date(2026,8,16,12,0), end:new Date(2026,8,16,23,59), time:"Lunch", loc:"The quad", desc:"Fall club fair - meet all 80+ clubs and sign up in person.", tags:["Clubs"] },
  { name:"Firebird Football", when:new Date(2026,9,12,8,30), end:new Date(2026,9,16,23,59), time:"Week of Oct 12-16", loc:"Fields", desc:"Class vs class football all week; Homecoming Court nominations open Monday.", tags:["Class comp","Spirit"] },
  { name:"Homecoming Week", when:new Date(2026,9,19,8,30), end:new Date(2026,9,23,23,59), time:"All week", loc:"Campus", desc:"Hallway decorations, spirit days, royalty vote, Friday rally, game, and dance.", tags:["Homecoming","Dance"] },
  { name:"Multicultural Night", when:new Date(2026,9,28,18,0), end:new Date(2026,9,28,23,59), time:"Evening", loc:"TBA", desc:"Performances and food celebrating Fremont's cultures, hosted with culture and identity clubs.", tags:["Clubs","Culture"] },
  { name:"Club Trivia Night", when:new Date(2027,0,27,18,0), end:new Date(2027,0,27,23,59), time:"Evening", loc:"TBA", desc:"Team trivia hosted by the Clubs Commission.", tags:["Clubs"] },
  { name:"Club Grub Day", when:new Date(2027,3,21,12,0), end:new Date(2027,3,21,23,59), time:"Lunch", loc:"The quad", desc:"Clubs sell food on campus - come hungry and support your favorite clubs.", tags:["Clubs","Food"] }
];

/* SAMPLE club list — replace with the real Club Database export. */
// Clubs + morning announcements come from the ASB website's Gemini-cleaned API
// (fremontasb.org). Raw gviz is the fallback if the API is unreachable.
const CLUBS_API = "https://www.fremontasb.org/api/clubs";
const ANN_API = "https://www.fremontasb.org/api/announcements";
const CLUB_SHEET = "https://docs.google.com/spreadsheets/d/1IQo9QG0ubONWAeaZfwPQ2GJH7zpBr_QexsH9o0XTOLg/gviz/tq?tqx=out:csv&gid=0";
let CLUBS = [
  { name:"Robotics", cat:"STEM", day:"Wednesday", time:"Lunch", room:"210", advisor:"", desc:"Design, build, and code competition robots. Beginners welcome, no experience needed.", interestUrl:"https://www.fremontasb.org/clubs", contactType:"instagram", contact:"@fremontclubs", recruiting:true, commitment:"high", tags:"coding,build,competition,stem,hands-on" },
  { name:"Key Club", cat:"Service", day:"Thursday", time:"Lunch", room:"118", advisor:"", desc:"The biggest service club on campus. Volunteer around Sunnyvale and log community hours.", interestUrl:"https://www.fremontasb.org/clubs", contactType:"instagram", contact:"@fremontclubs", recruiting:true, commitment:"medium", tags:"service,volunteer,community,social,leadership" },
  { name:"Art & Mural Collective", cat:"Arts", day:"Tuesday", time:"After school", room:"Art wing", advisor:"", desc:"Paint campus murals and make art together. All skill levels welcome.", interestUrl:"", contactType:"", contact:"", recruiting:false, commitment:"low", tags:"art,creative,paint,chill,hands-on" },
  { name:"Chess Club", cat:"STEM", day:"Friday", time:"Lunch", room:"Library", advisor:"", desc:"Casual and ranked games every week. Learn openings or just play.", interestUrl:"", contactType:"", contact:"", recruiting:true, commitment:"low", tags:"strategy,games,chill,solo,competition" },
  { name:"Dance Crew", cat:"Arts", day:"Monday", time:"After school", room:"Small gym", advisor:"", desc:"Learn choreography and perform at rallies and Multicultural Night.", interestUrl:"https://www.fremontasb.org/clubs", contactType:"instagram", contact:"@fremontclubs", recruiting:true, commitment:"high", tags:"dance,performance,arts,social,active" },
  { name:"Red Cross Club", cat:"Service", day:"Wednesday", time:"Lunch", room:"305", advisor:"", desc:"Run blood drives and health drives that help the wider community.", interestUrl:"", contactType:"", contact:"", recruiting:false, commitment:"medium", tags:"service,health,volunteer,community" },
  { name:"Ultimate Frisbee", cat:"Athletics", day:"Tue/Thu", time:"After school", room:"Field", advisor:"", desc:"Pickup and league ultimate. Come run around, no tryouts.", interestUrl:"", contactType:"", contact:"", recruiting:true, commitment:"medium", tags:"sports,active,team,outdoor,chill" },
  { name:"Math Club", cat:"STEM", day:"", time:"", room:"", advisor:"", desc:"Contest math and problem-solving sessions.", interestUrl:"", contactType:"", contact:"", recruiting:false, commitment:"medium", tags:"math,competition,stem,solo,academic" },
  { name:"Badminton Club", cat:"Athletics", day:"Friday", time:"After school", room:"Main gym", advisor:"", desc:"Doubles and singles for all levels. Rackets provided.", interestUrl:"", contactType:"", contact:"", recruiting:false, commitment:"low", tags:"sports,active,team,chill" }
];

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
  const next = future.length ? future.reduce(function(a,b){ return a.when<b.when?a:b; }) : null;
  const nameEl = document.getElementById("nextupName");
  const timeEl = document.getElementById("nextupTime");
  if(!next){ nameEl.textContent = "More events coming soon"; timeEl.textContent = ""; return; }
  const ms = next.when - now;
  const d = Math.floor(ms/86400000), h = Math.floor(ms/3600000)%24, m = Math.floor(ms/60000)%60, s = Math.floor(ms/1000)%60;
  nameEl.textContent = "Next up: " + next.name;
  timeEl.dateTime = next.when.toISOString();
  timeEl.textContent = d>0 ? (d+"d "+h+"h "+m+"m") : (h+"h "+m+"m "+s+"s");
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
  const MO = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const horizon = new Date(now.getTime()+21*86400000); // only the next 3 weeks
  let list = EVENTS.filter(function(e){ return e.end >= now && e.when <= horizon; });
  // merge featured (push=y) upcoming sports games so they show on Home too
  try{
    if(typeof sportsGames!=="undefined" && sportsGames){
      const tks = todayKeyPST();
      sportsGames.forEach(function(g){
        if(!g.push) return;
        if(g.section==="result" || (g.date && g.date < tks)) return;
        const m=String(g.date||"").match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if(!m) return;
        const when=new Date(+m[1],+m[2]-1,+m[3],8,0); if(when>horizon) return;
        list.push({ name:(g.sport+(g.level?(" "+g.level):"")+(g.opponent?((/away/i.test(g.homeAway)?" at ":" vs ")+g.opponent):"")),
          when:when, end:new Date(+m[1],+m[2]-1,+m[3],23,59), time:g.time, loc:g.location, desc:"", tags:["Sports","Featured"], photos:"" });
      });
    }
  }catch(e){}
  list = list.sort(function(a,b){ return a.when-b.when; });
  if(!list.length){ grid.innerHTML = '<p class="note">More events coming soon.</p>'; return; }
  grid.innerHTML = list.map(function(e){
    const meta = [e.time,e.loc].filter(Boolean).map(clubEsc).join(" &middot; ");
    const tags = (e.tags||[]).map(function(t){ return '<span class="tag">'+clubEsc(t)+'</span>'; }).join("");
    return '<article class="ticket">'+
      '<div class="stub" aria-hidden="true"><span class="mo">'+MO[e.when.getMonth()]+'</span><span class="day">'+e.when.getDate()+'</span></div>'+
      '<div class="body"><h3>'+clubEsc(e.name)+'</h3>'+
      (meta?'<p class="meta">'+meta+'</p>':"")+
      (e.desc?'<p>'+clubEsc(e.desc)+'</p>':"")+
      tags+eventPhotos(e,now)+'</div></article>';
  }).join("");
  staggered.delete("eventList"); staggerOnce("eventList");
}
/* Live events feed — a live read straight from the events spreadsheet (not a static
   file), so any edit shows up on the app. Ava highlights an event RED in the sheet;
   a bound Apps Script trigger (App/backend/FeaturedEvents.gs) writes a "featured"
   column from the red cells, and the app shows ONLY featured events. The sheet must
   be shared "Anyone with the link: Viewer" for this public read. */
const EVENTS_SHEET = "https://docs.google.com/spreadsheets/d/11Pm2zUc_O40E0oTZekYvsD_D8FenH9s7PiJ43m7JCH0/gviz/tq?tqx=out:csv&gid=0";
function parseEvDate(s,isEnd){
  const m = String(s||"").trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if(!m) return null;
  return isEnd ? new Date(+m[1],+m[2]-1,+m[3],23,59) : new Date(+m[1],+m[2]-1,+m[3],8,0);
}
async function syncEventsSheet(){
  if(!EVENTS_SHEET) return;
  try{
    const res = await fetch(EVENTS_SHEET); if(!res.ok) throw new Error("HTTP "+res.status);
    const rows = parseSheetRows(await res.text()); if(rows.length<2) return;
    const head = rows[0].map(function(h){ return String(h).trim().toLowerCase(); });
    const gi = function(n){ return head.indexOf(n); };
  for(let c=0;c<rows[0].length;c++){ const m0=String(rows[0][c]||"").match(/Auto-updated\s+(.*)/); if(m0){ sportsUpdatedLabel = m0[1].replace(/\s+—.*/,"").trim(); } }
    const col = function(r,n){ const i=gi(n); return i>=0?String(r[i]||"").trim():""; };
    const hasFeat = gi("featured")>=0;
    const list = [];
    for(let i=1;i<rows.length;i++){ const r=rows[i]; const name=col(r,"name"); const when=parseEvDate(col(r,"date"),false); if(!name||!when) continue;
      const end = parseEvDate(col(r,"enddate"),true) || new Date(when.getFullYear(),when.getMonth(),when.getDate(),23,59);
      const tags = col(r,"tags").split(/[;,]/).map(function(t){return t.trim();}).filter(Boolean).map(clubCap);
      const feat = /^(yes|true|1|x|red|y)$/i.test(col(r,"featured"));
      list.push({ name:name, when:when, end:end, time:col(r,"time"), loc:col(r,"location")||col(r,"place"), desc:col(r,"description")||col(r,"desc"), tags:tags, featured:feat, photos:col(r,"photos")||col(r,"flickr") });
    }
    if(!list.length) return;
    eventsCurated = true;
    EVENTS = (hasFeat ? list.filter(function(e){ return e.featured; }) : list).sort(function(a,b){ return a.when-b.when; });
    renderEvents(); tickCountdown();
  }catch(e){ /* sheet not public yet or offline: keep the seed events */ }
}

/* =====================================================
   Live bell-schedule clock + special-schedule sync
===================================================== */
/* =====================================================
   Sports — in-season teams, full season from the Sports tab.
   Only the sports currently in season show in the app; the rest
   stay in the spreadsheet as data for later. Featured (push=y)
   games surface regardless of season.
===================================================== */
const SPORTS_SHEET = "https://docs.google.com/spreadsheets/d/11Pm2zUc_O40E0oTZekYvsD_D8FenH9s7PiJ43m7JCH0/gviz/tq?tqx=out:csv&sheet=Sports";
const SPORTS_FEED = "https://script.google.com/macros/s/AKfycby_2RTRuFEiIRdoNQtzbuUQzSGCGJ3G_p7CxNrqcqOcQiPk268kXu63uLf21GIT5RfQ/exec";
let sportsGames = null, sportsUpdatedLabel = "", sportFilter = "all", sportLevel = "all", sportsLoaded = false; let sportsShowAll = false;

const SPORT_ORDER = ["Football","Cross Country","Field Hockey","Flag Football","Girls Tennis","Girls Volleyball","Boys Water Polo","Girls Water Polo","Boys Basketball","Girls Basketball","Boys Soccer","Girls Soccer","Wrestling","Badminton","Baseball","Softball","Golf","Swimming & Diving","Boys Tennis","Track & Field","Boys Volleyball"];
function sportRank(s){ const i = SPORT_ORDER.indexOf(s); return i<0 ? 900 : i; }
function levelRank(l){ return /varsity/i.test(l)?0 : /jv/i.test(l)?1 : /frosh|fresh/i.test(l)?2 : 3; }
function eventNoun(sport, plural){
  const s = String(sport||"");
  if(/cross country|track|swim|dive|wrestl/i.test(s)) return plural?"meets":"meet";
  if(/tennis|badminton|golf/i.test(s)) return plural?"matches":"match";
  return plural?"games":"game";
}
function isMeetSport(s){ return /cross country|track|swim|dive|wrestl/i.test(String(s||"")); }
function oppText(sport, opponent, homeAway){ if(!opponent) return "TBA"; return isMeetSport(sport) ? clubEsc(opponent) : ((/away/i.test(homeAway)?"at ":"vs ")+clubEsc(opponent)); }
function sportTimeMin(t){ const m=String(t||"").match(/(\d+):(\d+)\s*(AM|PM)/i); if(!m) return 9999; let h=+m[1]%12; if(/PM/i.test(m[3])) h+=12; return h*60+(+m[2]); }
function todayKeyPST(){ const d=nowPST(); const mm=("0"+(d.getMonth()+1)).slice(-2), dd=("0"+d.getDate()).slice(-2); return d.getFullYear()+"-"+mm+"-"+dd; }

/* Season handling — show only in-season sports; keep the rest as data. */
const SEASON_OF = {};
[["fall",["Football","Cross Country","Field Hockey","Flag Football","Girls Tennis","Girls Volleyball","Boys Water Polo","Girls Water Polo"]],
 ["winter",["Boys Basketball","Girls Basketball","Boys Soccer","Girls Soccer","Wrestling"]],
 ["spring",["Badminton","Baseball","Softball","Golf","Swimming & Diving","Boys Tennis","Track & Field","Boys Volleyball"]]
].forEach(function(pair){ pair[1].forEach(function(s){ SEASON_OF[s]=pair[0]; }); });
function currentSeason(){ const m=nowPST().getMonth()+1; if(m>=8&&m<=10) return "fall"; if(m>=11||m<=2) return "winter"; return "spring"; }
function sportSeason(s){ return SEASON_OF[s]||"other"; }
const SPORT_SLUG = {"Football":"football","Cross Country":"cross-country","Field Hockey":"field-hockey","Flag Football":"flag-football","Girls Tennis":"girls-tennis","Girls Volleyball":"girls-volleyball","Boys Water Polo":"boys-water-polo","Girls Water Polo":"girlswaterpolo","Boys Basketball":"boys-basketball","Girls Basketball":"girls-basketball","Boys Soccer":"boys-soccer","Girls Soccer":"girls-soccer","Wrestling":"wrestling","Badminton":"badminton","Baseball":"baseball","Softball":"softball","Golf":"golf","Swimming & Diving":"swimming-and-diving","Boys Tennis":"boys-tennis","Track & Field":"track-and-field","Boys Volleyball":"boys-volleyball"};
function sportPage(s){ return "https://www.fremonthsathletics.org/" + (SPORT_SLUG[s]||""); }

function fhsBestResult(x){
  if(x.score && !/scrimmage/i.test(x.score) && !x.noScore) return x.score;
  if(x.note && /(\d+\s*[-–]\s*\d+)|\bwin\b|\bloss\b|\btie\b|\bW\b|\bL\b/i.test(x.note)) return x.note;
  if(x.wlWord && !/no score/i.test(x.wlWord)) return x.wlWord;
  if(x.score && !/scrimmage/i.test(x.score)) return x.score;
  return "";
}
function fhsOverlayScores(feed){
  if(!feed || !feed.programs || !sportsGames) return;
  const map={};
  feed.programs.forEach(function(p){
    (p.results||[]).forEach(function(x){
      const r=fhsBestResult(x); if(!r) return;
      const sp=(x.sport||p.sport||"");
      map[(sp+"|"+(x.date||"")+"|"+(x.level||"")).toLowerCase()]=r;
      map[(sp+"|"+(x.date||"")).toLowerCase()]=r;
    });
  });
  sportsGames.forEach(function(g){
    const r=map[(g.sport+"|"+g.date+"|"+g.level).toLowerCase()] || map[(g.sport+"|"+g.date).toLowerCase()];
    if(r){ g.score=r; g.section="result"; }
  });
}
function loadSportsScores(){
  const cb="fhsScoreCb_"+Math.random().toString(36).slice(2);
  window[cb]=function(data){ try{ fhsOverlayScores(data); renderSports(); if(typeof renderEvents==="function") renderEvents(); }catch(e){} try{delete window[cb];}catch(e){} };
  const s=document.createElement("script");
  s.src=SPORTS_FEED+"?view=results&callback="+cb;
  s.onerror=function(){};
  document.head.appendChild(s);
}
const EVENTS_API = "https://www.fremontasb.org/api/events";
var SPORTS_SKELETON = '<div class="grid cols2">' +
  '<div class="ticket skel"><div class="stub"></div><div class="body"><span class="skl w60"></span><span class="skl w40"></span><span class="skl w80"></span></div></div>'.repeat(4) +
  '</div>';
// Fast recent scores: the website already merges the athletics feed server-side and CDN-caches
// it, so pull those before the slow direct feed. Recent/featured games get a final score in ~1s.
async function loadSportsScoresFast(){
  try{
    const res = await fetch(EVENTS_API + "?_cb=" + Date.now()); if(!res.ok) return;
    const data = await res.json();
    const games = Array.isArray(data.games) ? data.games : [];
    if(!games.length || !sportsGames) return;
    const map = {};
    games.forEach(function(x){ if(!x.score) return; var sp=x.sport||"";
      map[(sp+"|"+(x.date||"")+"|"+(x.level||"")).toLowerCase()] = x.score;
      map[(sp+"|"+(x.date||"")).toLowerCase()] = x.score;
    });
    var hit=false;
    sportsGames.forEach(function(g){
      if(g.score) return;
      var r = map[(g.sport+"|"+g.date+"|"+g.level).toLowerCase()] || map[(g.sport+"|"+g.date).toLowerCase()];
      if(r){ g.score=r; g.section="result"; hit=true; }
    });
    if(hit){ renderSports(); if(typeof renderEvents==="function") renderEvents(); }
  }catch(e){}
}
async function loadSports(){
  if(sportsLoaded){
    if(!sportsGames){ var bb=document.getElementById("sportsBody"); if(bb && !/ticket/.test(bb.innerHTML)) bb.innerHTML = SPORTS_SKELETON; }
    return;
  }
  sportsLoaded = true;
  var b0=document.getElementById("sportsBody"); if(b0) b0.innerHTML = SPORTS_SKELETON;
  try{
    const res = await fetch(SPORTS_SHEET + "&_cb=" + Date.now()); if(!res.ok) throw new Error("HTTP "+res.status);
    const rows = parseSheetRows(await res.text());
    sportsGames = rowsToGames(rows);
    renderSports();
    if(typeof renderEvents==="function") renderEvents();
    loadSportsScoresFast(); // fast, CDN-cached recent scores
    loadSportsScores();     // background top-up from the athletics feed (slower, may add more)
  }catch(e){
    sportsLoaded = false;
    const g=document.getElementById("sportsBody");
    if(g) g.innerHTML = '<p class="note">Could not load the sports schedule right now. Try again later.</p>';
  }
}
function rowsToGames(rows){
  sportsUpdatedLabel = "";
  if(!rows || rows.length<2) return [];
  const head = rows[0].map(function(h){ return String(h).trim().toLowerCase(); });
  const gi = function(n){ return head.indexOf(n); };
  const col = function(r,n){ const i=gi(n); return i>=0?String(r[i]||"").trim():""; };
  const out=[];
  for(let i=1;i<rows.length;i++){ const r=rows[i];
    for(let c=0;c<r.length;c++){ const m=String(r[c]||"").match(/Auto-updated\s+(.*)/); if(m){ sportsUpdatedLabel = m[1].replace(/\s+—.*/,"").trim(); } }
    const sport=col(r,"sport"), date=col(r,"date");
    if(!sport || !/^\d{4}-\d{1,2}-\d{1,2}/.test(date)) continue;
    if(/rancho\s*san\s*antonio/i.test(r.join(" "))) continue; // Rancho San Antonio = XC practice, not an event
    out.push({
      sport:sport, date:date, time:col(r,"time"), level:col(r,"level"),
      home:/home/i.test(col(r,"homeaway")), homeAway:col(r,"homeaway"),
      opponent:(function(o){o=String(o||"").replace(/^\s*(vs\.?|at)\s+/i,"").trim(); return /^opponent$/i.test(o)?"":o;})(col(r,"opponent")), location:col(r,"location"), type:col(r,"type"),
      section:col(r,"section").toLowerCase(), score:col(r,"score"),
      senior:/^(yes|true|1|y)$/i.test(col(r,"seniornight")),
      push:/^\s*y(es)?\s*$/i.test( (gi("push")>=0?col(r,"push"):String(r[0]||"").trim()) ),
      kind:col(r,"kind") || (/scrimmage/i.test(col(r,"type"))?"Scrimmage":"Game"),
      league:/league/i.test(col(r,"type"))
    });
  }
  // defensive dedup: collapse same sport|date|level|time (meets: ignore time), keep richer row
  var seen={}, dd=[];
  out.forEach(function(g){
    var base=[g.sport,g.date,g.level].join("|").toLowerCase();
    var k=isMeetSport(g.sport)?base:(base+"|"+String(g.time||"").toLowerCase());
    if(!(k in seen)){ seen[k]=dd.length; dd.push(g); return; }
    var cur=dd[seen[k]];
    var score=function(x){ return (x.opponent?2:0)+(x.score?1:0)+String(x.opponent||"").length*0.001; };
    var keep=score(g)>score(cur)?g:cur;
    keep.push=cur.push||g.push; keep.senior=cur.senior||g.senior; if(!keep.score) keep.score=cur.score||g.score;
    dd[seen[k]]=keep;
  });
  return dd;
}
const SENIOR_NIGHTS = [
  { sport:"Football", date:"2026-10-22", opponent:"Los Altos" },
  { sport:"Field Hockey", date:"2026-10-26" },
  { sport:"Girls Tennis", date:"2026-10-29" },
];
function isSeniorNight(g){
  if(!g) return false;
  if(g.senior) return true;
  const txt = [g.title, g.status, g.matchup, g.opponent].filter(Boolean).join(" ");
  if(/senior\s*(night|day)/i.test(txt)) return true;
  const d = String(g.date||"");
  return SENIOR_NIGHTS.some(function(s){ return s.date===d && (!s.sport || s.sport===g.sport); });
}
const SP_MO=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtDateShort(date){ const m=String(date||"").match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); return m?(SP_MO[+m[2]-1]+" "+(+m[3])):"TBA"; }
function isResultGame(g,today){ return g.section==="result" || (g.date && g.date < today); }
function sportSummary(sport){
  const today=todayKeyPST();
  const gs=sportsGames.filter(function(g){ return g.sport===sport; });
  const ups=gs.filter(function(g){ return !isResultGame(g,today); }).sort(function(a,b){ return String(a.date).localeCompare(String(b.date))||sportTimeMin(a.time)-sportTimeMin(b.time); });
  const res=gs.filter(function(g){ return isResultGame(g,today); });
  let w=0,l=0,t=0;
  res.forEach(function(g){ const sc=String(g.score||""); if(/\bwin\b|(^|[^a-z])W([^a-z]|$)/i.test(sc))w++; else if(/\bloss\b|(^|[^a-z])L([^a-z]|$)/i.test(sc))l++; else if(/\btie\b|(^|[^a-z])T([^a-z]|$)/i.test(sc))t++; });
  return { next: ups[0]||null, wins:w, losses:l, ties:t, upcomingCount:ups.length, levels: Array.from(new Set(gs.map(function(g){return g.level;}).filter(Boolean))).sort(function(a,b){return levelRank(a)-levelRank(b);}) };
}
function recordStr(s){ return (s.wins+s.losses+s.ties)>0 ? (s.wins+"-"+s.losses+(s.ties?("-"+s.ties):"")) : ""; }

function renderSports(){
  const body = document.getElementById("sportsBody");
  if(!body) return;
  if(!sportsGames){ body.innerHTML='<p class="note">Loading…</p>'; return; }
  if(!sportsGames.length){ body.innerHTML='<p class="note">No sports schedule available right now.</p>'; return; }
  const today = todayKeyPST();
  const season = currentSeason();

  // in-season sports only (data for other seasons stays in the sheet)
  const allSports = Array.from(new Set(sportsGames.map(function(g){return g.sport;})));
  const seasonSports = allSports.filter(function(s){ return sportSeason(s)===season; })
    .sort(function(a,b){ return sportRank(a)-sportRank(b) || a.localeCompare(b); });
  const pickable = seasonSports.slice();
  if(sportFilter!=="all" && pickable.indexOf(sportFilter)<0) sportFilter="all";

  // dropdowns
  const sportSel = document.getElementById("sportSelect");
  if(sportSel){
    sportSel.innerHTML = '<option value="all">All sports</option>' +
      pickable.map(function(s){ return '<option value="'+clubEsc(s)+'"'+(sportFilter===s?' selected':'')+'>'+clubEsc(s)+'</option>'; }).join("");
    sportSel.value = sportFilter;
  }
  const levelPool = sportsGames.filter(function(g){ return (sportFilter==="all"? sportSeason(g.sport)===season : g.sport===sportFilter); });
  const levels = Array.from(new Set(levelPool.map(function(g){return g.level;}).filter(Boolean))).sort(function(a,b){ return levelRank(a)-levelRank(b) || a.localeCompare(b); });
  const lvlSel = document.getElementById("levelSelect");
  if(lvlSel){
    if(sportLevel!=="all" && levels.indexOf(sportLevel)<0) sportLevel="all";
    lvlSel.innerHTML = '<option value="all">All levels</option>' +
      levels.map(function(l){ return '<option value="'+clubEsc(l)+'"'+(sportLevel===l?' selected':'')+'>'+clubEsc(l)+'</option>'; }).join("");
    lvlSel.value = sportLevel;
  }
  const upd = document.getElementById("sportsUpdated");
  if(upd) upd.textContent = sportsUpdatedLabel ? ("Updated "+sportsUpdatedLabel) : "";

  function gameCard(g, isResult){
    const sr = isSeniorNight(g);
    const m = String(g.date||"").match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    const mo = m?SP_MO[+m[2]-1]:"TBA", day = m?+m[3]:"";
    const tags = ['<span class="tag'+(g.home?' free':'')+'">'+(g.home?'Home':'Away')+'</span>'];
    if(g.league) tags.push('<span class="tag">League</span>');
    if(/scrimmage/i.test(g.kind||g.type||"")) tags.push('<span class="tag">Scrimmage</span>');
    if(g.push) tags.unshift('<span class="tag sr">&#9733; Featured</span>');
    if(sr) tags.unshift('<span class="tag sr">&#9733; Senior Night</span>');
    let line2;
    if(isResult){ const sc = g.score||""; line2 = sc ? ('Final: '+clubEsc(sc)) : 'Final score pending'; }
    else { line2 = [g.time, g.location].filter(Boolean).map(clubEsc).join(" &middot; "); }
    const vs = g.opponent ? oppText(g.sport, g.opponent, g.homeAway) : "";
    return '<article class="ticket'+(sr?' sr':'')+'"><div class="stub" aria-hidden="true"><span class="mo">'+mo+'</span><span class="day">'+day+'</span></div>'+
      '<div class="body"><h3>'+clubEsc(g.sport||"")+(g.level?(' &middot; '+clubEsc(g.level)):"")+'</h3>'+
      (vs?('<p class="meta">'+vs+'</p>'):"")+
      (line2?('<p>'+line2+'</p>'):"")+
      tags.join(" ")+'</div></article>';
  }

  let html = "";

  // Featured (push=y) — any season
  const pushed = sportsGames.filter(function(g){ return g.push; });
  if(pushed.length){
    var puAll = pushed.filter(function(g){ return !isResultGame(g,today); }).sort(function(a,b){ return String(a.date).localeCompare(String(b.date))||sportTimeMin(a.time)-sportTimeMin(b.time); });
    var puSeen={}, pu=[]; puAll.forEach(function(g){ if(!puSeen[g.sport]){ puSeen[g.sport]=1; pu.push(g); } }); // one upcoming per sport; next y appears once this one's day ends
    const pr = pushed.filter(function(g){ return isResultGame(g,today); }).sort(function(a,b){ return String(b.date).localeCompare(String(a.date)); });
    const pcards = pu.map(function(g){return gameCard(g,false);}).concat(pr.map(function(g){return gameCard(g,true);})).join("");
    html += '<section aria-labelledby="h-featured" style="margin-bottom:var(--space-5)"><div class="sechead"><h2 id="h-featured" style="font-size:20px">&#9733; Featured</h2><span class="rule" aria-hidden="true"></span></div><div class="grid cols2">'+pcards+'</div></section>';
  }

  if(sportFilter==="all"){
    // Welcoming season overview — varied sport cards
    const seasonLabel = season.charAt(0).toUpperCase()+season.slice(1);
    html += '<section aria-labelledby="h-inseason"><div class="sechead"><h2 id="h-inseason" style="font-size:20px">'+seasonLabel+' teams</h2><span class="rule" aria-hidden="true"></span></div>';
    if(seasonSports.length){
      html += '<div class="sportgrid">'+seasonSports.map(function(sp){
        const s=sportSummary(sp); const rec=recordStr(s);
        const nx = s.next ? (fmtDateShort(s.next.date)+' &middot; '+oppText(sp, s.next.opponent, s.next.homeAway)) : ('No upcoming '+eventNoun(sp,true));
        return '<button type="button" class="sportcard" data-sportpick="'+clubEsc(sp)+'">'+
          '<div class="sportcard-top"><span class="sportcard-name">'+clubEsc(sp)+'</span>'+(rec?('<span class="sportcard-rec">'+rec+'</span>'):'')+'</div>'+
          '<div class="sportcard-next"><span class="sportcard-lbl">NEXT</span> '+nx+'</div>'+
          '<span class="sportcard-cta">View '+eventNoun(sp,true)+' &rarr;</span></button>';
      }).join("")+'</div>';
    } else {
      html += '<p class="note">No '+seasonLabel.toLowerCase()+' teams are posted yet — check back when the season starts.</p>';
    }
    html += '</section>';

    // This week across in-season sports
    const nowS = nowPST(); const weekEnd = new Date(nowS.getTime()+7*86400000);
    const evd = function(g){ const mm=String(g.date||"").match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); return mm?new Date(+mm[1],+mm[2]-1,+mm[3],23,59):null; };
    let up = sportsGames.filter(function(g){ return sportSeason(g.sport)===season && !isResultGame(g,today) && (sportLevel==="all"||g.level===sportLevel); })
      .sort(function(a,b){ return String(a.date).localeCompare(String(b.date))||sportTimeMin(a.time)-sportTimeMin(b.time); });
    const week = up.filter(function(g){ const d=evd(g); return d && d<=weekEnd; });
    const shown = sportsShowAll ? up : (week.length?week:up.slice(0,6));
    html += '<section style="margin-top:var(--space-5)" aria-labelledby="h-thisweek"><div class="sechead"><h2 id="h-thisweek" style="font-size:20px">This week</h2><span class="rule" aria-hidden="true"></span></div>';
    if(up.length){
      html += '<div class="grid cols2">'+shown.map(function(g){return gameCard(g,false);}).join("")+'</div>';
      if(!sportsShowAll && up.length>shown.length) html += '<div style="text-align:center;margin-top:var(--space-3)"><button type="button" class="btn ghost" id="sportsViewAll">View all '+up.length+' upcoming</button></div>';
    } else html += '<p class="note">No upcoming games this week.</p>';
    html += '</section>';
  } else {
    // Single sport — header with info, then schedule + results
    const s=sportSummary(sportFilter); const rec=recordStr(s);
    html += '<section class="sporthero"><div class="sporthero-top"><h2>'+clubEsc(sportFilter)+'</h2>'+(rec?('<span class="sportcard-rec big">'+rec+'</span>'):'')+'</div>'+
      '<p class="sporthero-meta">'+(currentSeason().charAt(0).toUpperCase()+currentSeason().slice(1))+' season'+(s.levels.length?(' &middot; '+s.levels.map(clubEsc).join(", ")):'')+'</p>'+
      (s.next?('<p class="sporthero-next"><b>Next '+eventNoun(sportFilter,false)+':</b> '+fmtDateShort(s.next.date)+(s.next.time?(' at '+clubEsc(s.next.time)):'')+' &middot; '+oppText(sportFilter, s.next.opponent, s.next.homeAway)+(s.next.location?(' &middot; '+clubEsc(s.next.location)):'')+'</p>'):'')+
      '<p style="margin:10px 0 0"><a class="btn ghost" style="font-size:13px" href="'+sportPage(sportFilter)+'" target="_blank" rel="noopener">Team page &amp; roster &rarr;</a></p></section>';

    const inFilter = function(g){ return g.sport===sportFilter && (sportLevel==="all"||g.level===sportLevel); };
    let upcoming=[], results=[];
    sportsGames.filter(inFilter).forEach(function(g){ if(isResultGame(g,today)) results.push(g); else upcoming.push(g); });
    upcoming.sort(function(a,b){ return String(a.date).localeCompare(String(b.date))||sportTimeMin(a.time)-sportTimeMin(b.time); });
    results.sort(function(a,b){ return String(b.date).localeCompare(String(a.date))||sportTimeMin(b.time)-sportTimeMin(a.time); });
    const nounP = eventNoun(sportFilter, true);
    const nowS = nowPST(); const weekEnd = new Date(nowS.getTime()+7*86400000);
    const evd = function(g){ const mm=String(g.date||"").match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); return mm?new Date(+mm[1],+mm[2]-1,+mm[3],23,59):null; };
    const week = upcoming.filter(function(g){ const d=evd(g); return d && d<=weekEnd; });
    const shown = sportsShowAll ? upcoming : (week.length?week:upcoming.slice(0,4));
    html += '<section style="margin-top:var(--space-5)" aria-labelledby="h-upsp"><div class="sechead"><h2 id="h-upsp" style="font-size:20px">Upcoming '+nounP+'</h2><span class="rule" aria-hidden="true"></span></div>';
    if(upcoming.length){
      html += '<div class="grid cols2">'+shown.map(function(g){return gameCard(g,false);}).join("")+'</div>';
      if(!sportsShowAll && upcoming.length>shown.length) html += '<div style="text-align:center;margin-top:var(--space-3)"><button type="button" class="btn ghost" id="sportsViewAll">View all '+upcoming.length+' '+nounP+'</button></div>';
    } else html += '<p class="note">No upcoming '+nounP+' listed right now.</p>';
    html += '</section>';
    if(results.length){
      html += '<section style="margin-top:var(--space-5)" aria-labelledby="h-resp"><div class="sechead"><h2 id="h-resp" style="font-size:20px">Recent results</h2><span class="rule" aria-hidden="true"></span></div>';
      html += '<div class="grid cols2">'+results.slice(0,12).map(function(g){return gameCard(g,true);}).join("")+'</div></section>';
    }
  }
  body.innerHTML = html;
}
document.addEventListener("change", function(e){
  if(e.target && e.target.id==="sportSelect"){ sportFilter = e.target.value; sportLevel="all"; sportsShowAll = false; renderSports(); }
  else if(e.target && e.target.id==="levelSelect"){ sportLevel = e.target.value; sportsShowAll = false; renderSports(); }
});
document.getElementById("sportsBody").addEventListener("click", function(e){
  var pick = e.target.closest && e.target.closest("[data-sportpick]");
  if(pick){ sportFilter = pick.getAttribute("data-sportpick"); sportLevel="all"; sportsShowAll=false; renderSports(); var sv=document.getElementById("view-sports"); if(sv) window.scrollTo(0,0); return; }
  if(e.target.closest("#sportsViewAll")){ sportsShowAll = true; renderSports(); }
});

function todayKey(){
  const wd = new Date().getDay(); // 0 Sun … 6 Sat
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

/* --- render a table body of [name,start,end] rows (live-highlights now) --- */
function rowsHTML(rows, live){
  const now=new Date(); const nowMin=now.getHours()*60+now.getMinutes();
  return rows.map(r=>{
    const isLive = live && nowMin>=toMin(r[1]) && nowMin<toMin(r[2]);
    return "<tr"+(isLive?' class="live"':"")+"><td>"+r[0]+(isLive?' <span class="sr">(happening now)</span>':"")+
      '</td><td class="t">'+r[1]+'</td><td class="t">'+r[2]+"</td></tr>";
  }).join("");
}
/* --- render a full special week (all five days) --- */
function renderWeek(week){
  const host=document.getElementById("weekView");
  const note=document.getElementById("weekNote");
  note.textContent = (week.dates ? week.dates+". " : "") + (week.note||"");
  host.innerHTML = week.days.map(day=>{
    const head='<div class="schedday-h"><b>'+day.d+'</b><span>'+day.label+'</span></div>';
    const body = (day.off || !day.rows)
      ? '<p class="schedday-off">No school · '+(day.off||"")+'</p>'
      : '<div class="schedwrap"><table><caption class="sr">'+day.d+' '+day.label+'</caption>'+
        '<thead><tr><th scope="col">Period</th><th scope="col">Starts</th><th scope="col">Ends</th></tr></thead>'+
        '<tbody>'+rowsHTML(day.rows,false)+'</tbody></table></div>';
    return '<div class="schedday">'+head+body+'</div>';
  }).join("");
}
/* --- wire the Normal/Special toggle + week picker --- */
function initSchedule(){
  const sel=document.getElementById("weekPick");
  sel.innerHTML='<option value="">Pick a week…</option>'+
    SPECIAL_WEEKS.map((w,i)=>'<option value="'+i+'">'+w.name+'</option>').join("");
  sel.addEventListener("change",e=>{
    const v=e.target.value;
    if(v===""){ document.getElementById("weekView").innerHTML=""; document.getElementById("weekNote").textContent=""; return; }
    renderWeek(SPECIAL_WEEKS[+v]);
  });
  document.querySelectorAll(".segmented button").forEach(b=>
    b.addEventListener("click", ()=>{
      const mode=b.dataset.mode;
      document.querySelectorAll(".segmented button").forEach(x=>x.setAttribute("aria-pressed", x===b?"true":"false"));
      document.getElementById("schedNormal").hidden = mode!=="normal";
      document.getElementById("schedSpecial").hidden = mode!=="special";
      if(mode==="special" && !sel.value){ sel.value="0"; renderWeek(SPECIAL_WEEKS[0]); }
    }));
}

/* What applies today — the regular weekly schedule by weekday. */
function todaySchedule(){
  const k=todayKey();
  return k ? { label:SCHEDULES[k].label, rows:SCHEDULES[k].rows } : null;
}

let pickedDay="auto";
function renderDay(day){
  const body=document.getElementById("schedBody");
  const rows=day.rows||[];
  const now=new Date(); const nowMin=now.getHours()*60+now.getMinutes();
  const live = pickedDay==="auto";
  if(day.noSchool && !rows.length){
    body.innerHTML='<tr><td colspan="3">'+day.noSchool+' · no school.</td></tr>';
  } else if(!rows.length){
    body.innerHTML='<tr><td colspan="3">No periods listed for this day.</td></tr>';
  } else {
    body.innerHTML=rows.map(r=>{
      const isLive = live && nowMin>=toMin(r[1]) && nowMin<toMin(r[2]);
      return "<tr"+(isLive?' class="live"':"")+"><td>"+r[0]+(isLive?' <span class="sr">(happening now)</span>':"")+'</td><td class="t">'+r[1]+'</td><td class="t">'+r[2]+"</td></tr>";
    }).join("");
  }
}
function renderToday(){
  const t=todaySchedule();
  if(t) renderDay({rows:t.rows, noSchool:t.noSchool});
  else document.getElementById("schedBody").innerHTML='<tr><td colspan="3">It\'s the weekend, so no school. Pick a day above to preview.</td></tr>';
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
  if(!sched){
    nowP.textContent = "No school today";
    sub.textContent = "Enjoy the weekend, Firebird.";
    ringT.textContent = "—"; ringL.textContent = "rest up";
    prog.style.strokeDashoffset = RING; return;
  }
  if(sched.noSchool && !sched.rows.length){
    nowP.textContent = "No school today";
    sub.textContent = sched.noSchool;
    ringT.textContent = "—"; ringL.textContent = "holiday";
    prog.style.strokeDashoffset = RING; return;
  }
  const now = new Date();
  const nowMin = now.getHours()*60 + now.getMinutes() + now.getSeconds()/60;
  let cur=null, next=null;
  for(const r of sched.rows){
    const s=toMin(r[1]), e=toMin(r[2]);
    if(nowMin>=s && nowMin<e){ cur={r,s,e}; break; }
    if(nowMin<s && !next){ next={r,s}; }
  }
  if(cur){
    const left = cur.e - nowMin;
    const mins = Math.floor(left), secs = Math.min(59, Math.round((left-mins)*60));
    nowP.textContent = cur.r[0];
    sub.textContent = "Ends at "+cur.r[2]+" · "+sched.label;
    ringT.textContent = mins+":"+String(secs).padStart(2,"0");
    ringL.textContent = "left";
    prog.style.strokeDashoffset = RING * (1 - left/(cur.e-cur.s));
  } else if(next && next.s - nowMin > 90 && next.s === toMin(sched.rows[0][1])){
    nowP.textContent = "School hasn't started";
    sub.textContent = sched.rows[0][0]+" starts at "+sched.rows[0][1]+" · "+sched.label;
    ringT.textContent = "—"; ringL.textContent = "soon";
    prog.style.strokeDashoffset = RING;
  } else if(next){
    const until = next.s - nowMin;
    nowP.textContent = "Passing · up next "+next.r[0];
    sub.textContent = next.r[0]+" starts at "+next.r[1]+" · "+sched.label;
    ringT.textContent = Math.floor(until)+":"+String(Math.min(59,Math.round((until-Math.floor(until))*60))).padStart(2,"0");
    ringL.textContent = "until next";
    prog.style.strokeDashoffset = RING*0.02;
  } else {
    const first=toMin(sched.rows[0][1]);
    nowP.textContent = nowMin < first ? "School hasn't started" : "School's out";
    sub.textContent = sched.label;
    ringT.textContent = "—"; ringL.textContent = nowMin < first ? "soon" : "see you";
    prog.style.strokeDashoffset = RING;
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

/* Feedback form — collects name/email/message, then opens the ASB contact
   Google Form in a new tab with those fields pre-filled. */
const FEEDBACK_FORM = "https://docs.google.com/forms/d/e/1FAIpQLScNFE8IoooVpQER65d2GIse6ru1nLIp03EHcBjeGBVpsOJMZQ/viewform?usp=pp_url";
const FEEDBACK_ENTRY = { name:"entry.1253423822", email:"entry.2023794996", message:"entry.548009737" };
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
  const url = FEEDBACK_FORM
    + "&"+FEEDBACK_ENTRY.name+"="+encodeURIComponent(name)
    + "&"+FEEDBACK_ENTRY.email+"="+encodeURIComponent(email)
    + "&"+FEEDBACK_ENTRY.message+"="+encodeURIComponent(msg);
  const w = window.open(url, "_blank", "noopener");
  const ok=document.getElementById("fbOk");
  if(w){ ok.textContent="Opening the contact form in a new tab with your info filled in — hit Submit there to send it to ASB."; }
  else{ ok.innerHTML='Your info is ready. <a href="'+url+'" target="_blank" rel="noopener"><b>Tap here to open the contact form</b></a>, then hit Submit.'; }
  ok.classList.add("show"); ok.focus();
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
var CLUB_CAT_ES = {'STEM':'STEM','Arts & Media':'Arte y medios','Culture & Language':'Cultura e idiomas','Service & Advocacy':'Servicio y causas','Academics & Business':'Academico y negocios','Sports & Games':'Deportes y juegos','Special Interest':'Interes especial'};
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
    : '<p class="cmeta soon">'+CLUB_ICON.meet+'<span>'+clubT("Meeting info coming soon","Horario proximamente")+'</span></p>';
  if(advisor) meta += '<p class="cmeta">'+CLUB_ICON.adv+'<span><b>'+clubT("Advisor:","Asesor:")+'</b> '+clubEsc(advisor)+'</span></p>';
  if(leaders) meta += '<p class="cmeta">'+CLUB_ICON.led+'<span><b>'+clubT("Led by:","Liderado por:")+'</b> '+clubEsc(leaders)+'</span></p>';
  var body = desc ? '<p class="cdesc clamp">'+clubEsc(desc)+'</p>' : "";
  var mailBtn = emails.length
    ? '<a class="cbtn gold" href="mailto:'+clubEsc(emails.join(","))+'">'+CLUB_ICON.mail+'<span>'+clubT("Email","Correo")+'</span></a>'
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
  // Fallback: raw gviz sheet. Else: the built-in seed. Either way we end clubs-ready.
  try{
    const res=await fetch(CLUBS_API);
    if(!res.ok) throw new Error("HTTP "+res.status);
    const data=await res.json();
    const list=(data.clubs||[]).filter(function(c){ return c && c.name && !c.disbanded; });
    if(list.length){ CLUBS=list; clubsReady=true; renderClubs(); return; }
  }catch(e){ /* fall through to gviz */ }
  if(CLUB_SHEET){
    try{
      const res=await fetch(CLUB_SHEET+"&_cb="+Date.now());
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
          if(list.length){ CLUBS=list; }
        }
      }
    }catch(e){ /* offline or blocked: keep the seed list */ }
  }
  clubsReady=true; renderClubs(); // replace the skeleton with whatever we have (gviz or seed)
}

// Morning announcements, pulled from the website's parsed + Gemini-cleaned feed.
// The feed returns every parsed item; we reveal each only after its 8:30 AM Wed/Fri
// morning (same rule as the website), group by day, and show newest first.
async function syncAnnouncements(){
  try{
    const res=await fetch(ANN_API+"?_cb="+Date.now());
    if(!res.ok) throw new Error("HTTP "+res.status);
    const data=await res.json();
    const all=Array.isArray(data.announcements)?data.announcements:[];
    const now=new Date();
    const shown=all.filter(function(a){
      const m=/^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(a.date||"").trim()); if(!m) return false;
      return new Date(+m[1],+m[2]-1,+m[3],8,30,0,0) <= now;
    });
    const byDate=new Map();
    shown.forEach(function(a){ if(!byDate.has(a.date)) byDate.set(a.date,[]); byDate.get(a.date).push(a); });
    const days=[...byDate.keys()].sort().reverse().map(function(date){
      const items=byDate.get(date);
      return { date:date,
        bullets:items.map(function(a){ return a.title||a.text||""; }).filter(Boolean),
        full:items.map(function(a){ return a.text||""; }).filter(Boolean).join("\n\n") };
    });
    if(days.length){ FTV_FEED.length=0; days.forEach(function(d){ FTV_FEED.push(d); }); renderFTV(); }
  }catch(e){ /* offline or blocked: keep the placeholder */ }
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
["fDay","fCommit"].forEach(function(id){ const el=document.getElementById(id); if(el) el.addEventListener("change", renderClubs); });
(function(){ const r=document.getElementById("fRecruit"); if(r) r.addEventListener("click", function(){ r.setAttribute("aria-pressed", r.getAttribute("aria-pressed")==="true"?"false":"true"); renderClubs(); }); })();

const MATCH_QS = [
  {q:"What are you most into?", multi:true, opts:[
    {t:"Making things & tech", tags:["stem","coding","build","hands-on"]},
    {t:"Art & performance", tags:["art","creative","arts","dance","performance"]},
    {t:"Helping the community", tags:["service","volunteer","community"]},
    {t:"Sports & staying active", tags:["sports","active","team","outdoor"]},
    {t:"Culture & identity", tags:["culture","community"]},
    {t:"Games & strategy", tags:["games","strategy","competition"]}
  ]},
  {q:"How much time can you give?", opts:[
    {t:"A little", tags:["chill"], commit:"low"},
    {t:"A solid amount", tags:[], commit:"medium"},
    {t:"I'm all in", tags:["competition"], commit:"high"}
  ]},
  {q:"Pick your energy", opts:[
    {t:"Social & group", tags:["social","team","community"]},
    {t:"Focused & solo", tags:["solo","strategy","academic"]}
  ]},
  {q:"Competitive or chill?", opts:[
    {t:"Competitive", tags:["competition","team"]},
    {t:"Keep it chill", tags:["chill"]}
  ]},
  {q:"How do you like to spend time?", opts:[
    {t:"Hands-on making", tags:["hands-on","build","creative","paint"]},
    {t:"Talking & ideas", tags:["academic","strategy","community"]}
  ]},
  {q:"Your main goal?", opts:[
    {t:"Meet new people", tags:["social","community"]},
    {t:"Build a skill", tags:["stem","build","academic","skill"]},
    {t:"Give back", tags:["service","volunteer"]},
    {t:"Just have fun", tags:["chill","games","fun"]}
  ]}
];
let quizStep=0, quizPrefs={}, quizCommit="", quizSel=[];
function openMatch(){ quizStep=0; quizPrefs={}; quizCommit=""; renderQuizStep(); const d=document.getElementById("matchDialog"); if(d && !d.open) d.showModal(); }
function addTags(tags,commit){ (tags||[]).forEach(function(t){ quizPrefs[t]=(quizPrefs[t]||0)+1; }); if(commit) quizCommit=commit; }
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
      else { addTags(o.tags,o.commit); advance(); }
    };
  });
  const nx=body.querySelector("#quizNext"); if(nx) nx.onclick=function(){ quizSel.forEach(function(o){ addTags(o.tags,o.commit); }); advance(); };
}
function scoreClubs(){
  const total=Object.keys(quizPrefs).reduce(function(a,k){return a+quizPrefs[k];},0)||1;
  return CLUBS.map(function(c){
    const tags=String(c.tags||"").split(/[;,]/).map(function(t){return t.trim().toLowerCase();}).filter(Boolean);
    let sc=0, hits=[];
    tags.forEach(function(t){ if(quizPrefs[t]){ sc+=quizPrefs[t]; hits.push(t); } });
    if(quizCommit && String(c.commitment||"").toLowerCase()===quizCommit) sc+=1.5;
    return {club:c, score:sc, pct:Math.max(10,Math.min(99,Math.round(sc/total*100))), hits:hits};
  }).sort(function(a,b){ return b.score-a.score; });
}
function renderQuizResults(){
  const ranked=scoreClubs().filter(function(r){return r.score>0;}).slice(0,3);
  const body=document.getElementById("quizBody"); if(!body) return;
  let html='<div class="quizhead"><span class="quizprog"><span style="width:100%"></span></span><button type="button" class="quizx" id="quizClose" aria-label="Close">&times;</button></div><h2 class="quizq">Your top matches</h2>';
  if(!ranked.length){ html+='<p class="note">No strong match yet — browse all clubs, more are being added.</p>'; }
  else html+=ranked.map(function(r){
    const c=r.club;
    const reason=r.hits.length?("Matches your interest in "+r.hits.slice(0,3).map(clubCap).join(", ")+"."):"A solid all-round pick.";
    return '<div class="matchcard"><div class="matchtop"><h3>'+clubEsc(c.name)+'</h3><span class="matchpct">'+r.pct+'% match</span></div>'+
      '<p class="matchcat">'+clubEsc(c.cat)+(c.commitment?" &middot; "+clubEsc(clubCap(c.commitment))+" commitment":"")+'</p>'+
      '<p class="matchwhy">'+clubEsc(reason)+'</p>'+
      (/^https?:\/\//i.test(c.interestUrl||"")?'<a class="cbtn gold" href="'+clubEsc(c.interestUrl)+'" target="_blank" rel="noopener">Interest form</a>':"")+'</div>';
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
    _signinBtn.innerHTML = (signedIn.picture ? '<img src="'+signedIn.picture+'" alt="" referrerpolicy="no-referrer">' : "") + (clubEsc((signedIn.name||"").split(" ")[0]) || "Account");
    _signinBtn.setAttribute("aria-label","Signed in as "+signedIn.email);
  } else {
    _signinBtn.innerHTML = _signinDefaultHTML;
    _signinBtn.setAttribute("aria-label","Sign in");
  }
}
function refreshSigninDialog(){
  const blurb=document.getElementById("signinBlurb"), gsi=document.getElementById("gsiBtn"), note=document.getElementById("signinNote"), out=document.getElementById("signoutBtn");
  if(signedIn.email){
    if(blurb) blurb.textContent = "Signed in as "+signedIn.email+". Your name is on the app and your Firebird Card is prefilled.";
    if(gsi) gsi.hidden = true; if(note) note.hidden = true; if(out) out.hidden = false;
  } else {
    if(blurb) blurb.textContent = "Sign in with Google to put your name on the app and prefill your Firebird Card. Photos and points still only go where you send them.";
    if(gsi) gsi.hidden = false; if(out) out.hidden = true;
    if(note) note.hidden = !!CONFIG.googleClientId;
  }
}
function onGoogleCred(resp){
  try{
    const p = decodeJwt(resp.credential);
    signedIn.name = p.name || ""; signedIn.email = p.email || ""; signedIn.picture = p.picture || "";
    _saveSignin(); applySignedInUI();
    const csName = document.getElementById("csName");
    if(csName && !csName.value) csName.value = signedIn.name;
    refreshSigninDialog();
    const d=document.getElementById("signinDialog"); if(d && d.open) d.close();
  }catch(e){ /* ignore a bad credential */ }
}
function signOut(){
  signedIn.name=""; signedIn.email=""; signedIn.picture="";
  _clearSignin();
  try{ if(window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect(); }catch(e){}
  applySignedInUI(); refreshSigninDialog();
  const d=document.getElementById("signinDialog"); if(d && d.open) d.close();
}
function initGoogleSignin(){
  const note = document.getElementById("signinNote");
  if(!CONFIG.googleClientId){ if(note) note.hidden = false; return; }
  if(note) note.hidden = true;
  const s = document.createElement("script");
  s.src = "https://accounts.google.com/gsi/client"; s.async = true; s.defer = true;
  s.onload = ()=>{
    google.accounts.id.initialize({ client_id: CONFIG.googleClientId, callback: onGoogleCred, auto_select: false });
    google.accounts.id.renderButton(document.getElementById("gsiBtn"),
      { theme:"filled_black", size:"large", shape:"pill", text:"signin_with" });
  };
  s.onerror = ()=>{ if(note) note.hidden = false; };
  document.head.appendChild(s);
}
if(_signinBtn) _signinBtn.addEventListener("click", ()=>{ refreshSigninDialog(); document.getElementById("signinDialog").showModal(); });
(function(){ const out=document.getElementById("signoutBtn"); if(out) out.addEventListener("click", signOut); })();
_loadSignin(); applySignedInUI(); initGoogleSignin();

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
let spiritStandings = [{cls:"Seniors",pts:318},{cls:"Juniors",pts:276},{cls:"Sophomores",pts:231},{cls:"Freshmen",pts:204}];
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
  const list=spiritStandings.slice().sort(function(a,b){ return b.pts-a.pts; });
  const max=Math.max(1, list[0].pts), leader=list[0];
  box.innerHTML=list.map(function(s,i){
    const gap = i===0
      ? ("Leading"+(list[1] && list[0].pts>list[1].pts ? " by "+(list[0].pts-list[1].pts) : ""))
      : ((leader.pts-s.pts)+" behind");
    const cvar=CLSVAR[s.cls]||"--cardinal";
    return '<div class="brow'+(i===0?" lead":"")+'" style="--c:var('+cvar+')">'+
      '<div class="binfo"><span class="bcls">'+clubEsc(s.cls)+(i===0?' <span class="crown">Projected winner</span>':'')+'</span><span class="bpts">'+s.pts+'</span></div>'+
      '<div class="btrack"><div class="bfill" data-w="'+Math.round(s.pts/max*100)+'"></div></div>'+
      '<div class="bgap">'+gap+'</div>'+
    '</div>';
  }).join("");
  requestAnimationFrame(function(){ box.querySelectorAll(".bfill").forEach(function(f){ f.style.width=f.dataset.w+"%"; }); });
  if(prevLeaderCls && prevLeaderCls!==leader.cls){ const L=box.querySelector(".brow.lead"); if(L){ L.classList.add("flash"); confettiBurst(L); } }
  prevLeaderCls=leader.cls;
}
async function syncScoreboard(){
  renderBarRace();
  try{
    const res=await fetch(SPIRIT_SHEET); if(!res.ok) throw new Error("HTTP "+res.status);
    const rows=parseSheetRows(await res.text());
    const GRADES=["Seniors","Juniors","Sophomores","Freshmen"];
    const standings=GRADES.map(function(label){
      const r=rows.find(function(x){ return (x[0]||"").trim().toLowerCase()===label.toLowerCase(); });
      if(!r) return null;
      const pts=r.slice(1).reduce(function(sum,c){ const n=Number(String(c).replace(/[^\d.-]/g,"")); return sum+(Number.isFinite(n)?n:0); },0);
      return {cls:label, pts:pts};
    }).filter(Boolean);
    if(standings.length){ spiritStandings=standings; renderBarRace(); }
  }catch(e){ /* offline or blocked: keep the current standings */ }
}

/* =====================================================
   Boot
===================================================== */
/* Home "right now" chip — what period it is, at a glance */
function tickNowChip(){
  const chip = document.getElementById("nowChip");
  const sched = todaySchedule();
  if(!sched){ chip.hidden = true; return; }
  const nowMin = new Date().getHours()*60 + new Date().getMinutes();
  const cur = sched.rows.find(r=> nowMin>=toMin(r[1]) && nowMin<toMin(r[2]));
  if(cur){ chip.textContent = "Now: "+cur[0]+" · ends "+cur[2]; chip.hidden = false; }
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
let lastMin = new Date().getMinutes();
setInterval(()=>{
  tickClock(); tickCountdown();
  const m = new Date().getMinutes();
  if(m!==lastMin){ lastMin=m; tickNowChip(); if(pickedDay==="auto") renderToday(); }
}, 1000);
setInterval(syncEventsSheet, 5*60*1000);
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
function ftvDateLabel(d){ const m=String(d).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if(!m) return d; const MO=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]; return MO[+m[2]-1]+" "+(+m[3]); }
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
    return '<details class="ftv-day"><summary>'+ftvDateLabel(d.date)+'</summary><ul>'+bl+'</ul>'+(d.full?'<p>'+clubEsc(d.full)+'</p>':"")+'</details>';
  }).join("");
  card.hidden = false;
  card.innerHTML = '<div class="sechead"><h2 id="h-ftv">FTV morning announcements</h2><span class="rule" aria-hidden="true"></span></div>'+
    '<div class="card ftv-today"><p class="ftv-date">'+ftvDateLabel(t.date)+'</p><ul class="ftv-bullets">'+bullets+'</ul>'+
    (t.full?'<details class="ftv-full"><summary>Full announcements</summary><p>'+clubEsc(t.full)+'</p></details>':"")+
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
  "Advisor:":"Asesor:",
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
  "All":"Todos","Arts":"Artes","Service":"Servicio","Athletics":"Atletismo","Culture":"Cultura","Recruiting now":"Reclutando ahora",
  "Any day":"Cualquier día","Any commitment":"Cualquier compromiso","Low commitment":"Compromiso bajo","Medium commitment":"Compromiso medio","High commitment":"Compromiso alto",
  "Recruiting only":"Solo reclutando","Find your club":"Encuentra tu club","Search clubs":"Buscar clubes",
  "No clubs match that search. Try a different name or clear the filters.":"Ningún club coincide con esa búsqueda. Prueba otro nombre o borra los filtros.",
  "Club events this year":"Eventos de clubes este año","Clubs Day":"Día de Clubes","Multicultural Night":"Noche Multicultural","Club Trivia Night":"Noche de Trivia de Clubes","Club Grub Day":"Día de Comida de Clubes","Clubs":"Clubes",
  "The fall club fair. Walk the quad, meet all 80+ clubs, and sign up in person.":"La feria de clubes de otoño. Recorre el quad, conoce los más de 80 clubes e inscríbete en persona.",
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
  "Event ideas, questions, or shout-outs. Add your name and school email so ASB can follow up. Submitting opens our contact form in a new tab with everything already filled in.":"Ideas de eventos, preguntas o menciones. Agrega tu nombre y correo escolar para que ASB pueda dar seguimiento. Al enviar se abre nuestro formulario de contacto en una pestaña nueva con todo ya completado.",
  "Your name":"Tu nombre","Add your first and last name.":"Agrega tu nombre y apellido.","School email":"Correo escolar",
  "Add a valid email so ASB can reply.":"Agrega un correo válido para que ASB pueda responder.","Message":"Mensaje",
  "Write a message first. Even one sentence helps.":"Escribe un mensaje primero. Incluso una oración ayuda.","Open the contact form":"Abrir el formulario de contacto",
  "Find ASB":"Encuentra a ASB","for photos, FTV, resources, and store links":"para fotos, FTV, recursos y enlaces de la tienda",
  "ASB Leadership · Fremont High School, Sunnyvale (FUHSD)":"Liderazgo de ASB · Fremont High School, Sunnyvale (FUHSD)",
  "About this app":"Acerca de esta app",
  "Built by the ASB Tech Commission. Spirit submissions go only to ASB Spirit, Tech, and the advisor. They’re never shared publicly, and student IDs are used solely to remove duplicate entries. Questions? Drop a note in the feedback box.":"Creada por la Comisión de Tecnología de ASB. Los envíos de espíritu van solo a ASB Espíritu, Tecnología y el consejero. Nunca se comparten públicamente, y los IDs estudiantiles se usan únicamente para eliminar entradas duplicadas. ¿Preguntas? Deja una nota en la caja de comentarios.",
  "Motion mode: Off":"Modo movimiento: Apagado","Motion mode: On":"Modo movimiento: Encendido",
  "Motion mode swaps the card layout for scroll animations and a swipeable events row. Off keeps the classic look.":"El modo movimiento cambia el diseño de tarjetas por animaciones de desplazamiento y una fila de eventos deslizable. Apagado mantiene el estilo clásico.",
  "Ask Felipe":"Pregúntale a Felipe","Hi! Ask me about the bell schedule, clubs, events, or sports.":"¡Hola! Pregúntame sobre el horario de campanas, clubes, eventos o deportes.",
  "Send":"Enviar","School questions only · answers aren't monitored live":"Solo preguntas escolares · las respuestas no se supervisan en vivo","Close":"Cerrar",
  "Google sign-in":"Iniciar sesión con Google",
  "Sign in with Google to put your name on the app and prefill your Firebird Card. Photos and points still only go where you send them.":"Inicia sesión con Google para poner tu nombre en la app y precargar tu Firebird Card. Las fotos y los puntos solo van a donde tú los envías.",
  "Google sign-in is being finished setting up — it will be live shortly.":"El inicio de sesión con Google se está terminando de configurar; estará disponible pronto.",
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
