
document.documentElement.classList.add('js');

/* =====================================================
   CONFIG — ASB Tech edits live here
===================================================== */
const CONFIG = {
  // Paste the Apps Script web-app /exec URL (see App/backend/README.md).
  // While empty, the app runs in demo mode (everything confirmed locally only).
  apiUrl: "",
  // Paste the school Google OAuth client ID to enable real sign-in.
  googleClientId: ""
};

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
const EVENTS = [
  { name: "BTS Spirit Week", when: new Date(2026,7,24,8,30) },
  { name: "BTS Rally", when: new Date(2026,7,28,8,30) },
  { name: "Beach Bash Social", when: new Date(2026,7,28,18,15) },
  { name: "Firebird Football", when: new Date(2026,9,12,8,30) },
  { name: "Homecoming Week", when: new Date(2026,9,19,8,30) }
];

/* SAMPLE club list — replace with the real Club Database export. */
const CLUBS = [
  { name:"Robotics", cat:"STEM", meets:"Wed lunch · Rm 210", recruiting:true },
  { name:"Key Club", cat:"Service", meets:"Thu lunch · Rm 118", recruiting:true },
  { name:"Art & Mural Collective", cat:"Arts", meets:"Tue after school · Art wing", recruiting:false },
  { name:"Chess Club", cat:"STEM", meets:"Fri lunch · Library", recruiting:true },
  { name:"Dance Crew", cat:"Arts", meets:"Mon after school · Small gym", recruiting:true },
  { name:"Red Cross Club", cat:"Service", meets:"Wed lunch · Rm 305", recruiting:false },
  { name:"Ultimate Frisbee", cat:"Athletics", meets:"Tue/Thu after school · Field", recruiting:true },
  { name:"Math Club", cat:"STEM", meets:"Mon lunch · Rm 402", recruiting:false },
  { name:"Badminton Club", cat:"Athletics", meets:"Fri after school · Main gym", recruiting:false }
];

/* =====================================================
   Tab navigation (hash deep-links, focus management)
===================================================== */
const VIEWS = ["home","schedule","spirit","clubs","more","give"]; // "give" is reached by QR scan, not the nav
function parseHash(){
  const h = location.hash.replace(/^#/,"");
  const [view, qs] = h.split("?");
  const params = {};
  if(qs) qs.split("&").forEach(kv=>{
    const i = kv.indexOf("=");
    if(i>0) params[kv.slice(0,i)] = decodeURIComponent(kv.slice(i+1).replace(/\+/g," "));
  });
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
function tickCountdown(){
  const now = new Date();
  const next = EVENTS.find(e=> e.when > now);
  const nameEl = document.getElementById("nextupName");
  const timeEl = document.getElementById("nextupTime");
  if(!next){ nameEl.textContent = "More events coming soon"; timeEl.textContent = ""; return; }
  const ms = next.when - now;
  const d = Math.floor(ms/86400000), h = Math.floor(ms/3600000)%24, m = Math.floor(ms/60000)%60, s = Math.floor(ms/1000)%60;
  nameEl.textContent = "Next up: " + next.name;
  timeEl.dateTime = next.when.toISOString();
  timeEl.textContent = d>0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m ${s}s`;
}

/* =====================================================
   Live bell-schedule clock + special-schedule sync
===================================================== */
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

/* Feedback form */
document.getElementById("fbForm").addEventListener("submit", async e=>{
  e.preventDefault();
  const m = document.getElementById("fbMsg");
  if(!m.value.trim()){ setBad("fbMsg", true); m.focus(); return; }
  setBad("fbMsg", false);
  const ok = document.getElementById("fbOk");
  let text;
  try{
    const res = await apiPost({ action:"feedback", message:m.value.trim(),
      name:document.getElementById("fbName").value.trim() });
    text = res ? "Thanks! Your note went straight to ASB."
               : "Thanks, Firebird! (Demo mode. ASB Tech deploys the backend to deliver these for real.)";
  }catch(err){ text = "Hmm, that didn’t send. Check your connection and try again."; }
  ok.textContent = text;
  ok.classList.add("show"); ok.focus();
  e.target.reset();
});
document.getElementById("fbMsg").addEventListener("input", e=>{ if(e.target.value.trim()) setBad("fbMsg", false); });

/* =====================================================
   Clubs — search + filter
===================================================== */
let clubCat = "all";
function renderClubs(){
  const q = document.getElementById("clubSearch").value.trim().toLowerCase();
  const grid = document.getElementById("clubGrid");
  const list = CLUBS.filter(c=>{
    const catOk = clubCat==="all" || (clubCat==="recruiting" ? c.recruiting : c.cat===clubCat);
    return catOk && c.name.toLowerCase().includes(q);
  });
  grid.innerHTML = list.map(c=>`
    <div class="card club">
      <div class="row1"><h3>${c.name}</h3>${c.recruiting?'<span class="recruit">Recruiting</span>':""}</div>
      <span class="cat">${c.cat}</span>
      <span class="meets">${c.meets}</span>
    </div>`).join("");
  document.getElementById("clubEmpty").hidden = list.length>0;
}
document.getElementById("clubSearch").addEventListener("input", renderClubs);
document.querySelectorAll(".chips button").forEach(b=>
  b.addEventListener("click", ()=>{
    clubCat = b.dataset.cat;
    document.querySelectorAll(".chips button").forEach(x=>x.setAttribute("aria-pressed", x===b ? "true":"false"));
    renderClubs();
  }));

/* =====================================================
   Google sign-in (real, via Google Identity Services)
   Works as soon as CONFIG.googleClientId is set — steps in
   backend/README.md. Without it the dialog explains itself.
===================================================== */
const signedIn = { name:"", email:"", picture:"" }; // in-memory only
function decodeJwt(tok){
  const part = tok.split(".")[1].replace(/-/g,"+").replace(/_/g,"/");
  return JSON.parse(decodeURIComponent(atob(part).split("").map(c=>"%"+("00"+c.charCodeAt(0).toString(16)).slice(-2)).join("")));
}
function onGoogleCred(resp){
  try{
    const p = decodeJwt(resp.credential);
    signedIn.name = p.name || ""; signedIn.email = p.email || ""; signedIn.picture = p.picture || "";
    const btn = document.getElementById("signinBtn");
    btn.innerHTML = (signedIn.picture ? '<img src="'+signedIn.picture+'" alt="" referrerpolicy="no-referrer">' : "") +
      (signedIn.name.split(" ")[0] || "Signed in");
    const csName = document.getElementById("csName");
    if(csName && !csName.value) csName.value = signedIn.name;   // prefill the card
    document.getElementById("signinDialog").close();
    document.getElementById("signinBlurb").textContent = "Signed in as "+signedIn.email+". Your name is on the app and your card is prefilled.";
  }catch(e){ /* ignore a bad credential */ }
}
function initGoogleSignin(){
  const note = document.getElementById("signinNote");
  if(!CONFIG.googleClientId){ note.hidden = false; return; }
  const s = document.createElement("script");
  s.src = "https://accounts.google.com/gsi/client"; s.async = true; s.defer = true;
  s.onload = ()=>{
    google.accounts.id.initialize({ client_id: CONFIG.googleClientId, callback: onGoogleCred, auto_select: true });
    google.accounts.id.renderButton(document.getElementById("gsiBtn"),
      { theme:"filled_black", size:"large", shape:"pill", text:"signin_with" });
  };
  s.onerror = ()=>{ note.hidden = false; };
  document.head.appendChild(s);
}
document.getElementById("signinBtn").addEventListener("click", ()=>{
  document.getElementById("signinDialog").showModal();
});
initGoogleSignin();

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
async function syncScoreboard(){
  const board=document.querySelector(".scoreboard");
  if(!board) return;
  const GRADES=["Seniors","Juniors","Sophomores","Freshmen"];
  try{
    const res=await fetch(SPIRIT_SHEET);
    if(!res.ok) throw new Error("HTTP "+res.status);
    const rows=parseSheetRows(await res.text());
    const standings=GRADES.map(label=>{
      const r=rows.find(x=>(x[0]||"").trim().toLowerCase()===label.toLowerCase());
      if(!r) return null;
      const pts=r.slice(1).reduce((sum,c)=>{ const n=Number(String(c).replace(/[^\d.-]/g,"")); return sum+(Number.isFinite(n)?n:0); },0);
      return {label,pts};
    }).filter(Boolean);
    if(!standings.length) return;           // sheet unreadable/empty → keep placeholders
    standings.sort((a,b)=>b.pts-a.pts);
    board.innerHTML=standings.map((s,i)=>
      '<div class="score'+(i===0?" lead":"")+'"><div class="cls">'+s.label+'</div><div class="pts">'+s.pts+'</div></div>'
    ).join("");
  }catch(e){ /* offline / blocked → leave the hardcoded standings in place */ }
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
tickClock(); tickCountdown(); tickNowChip();
let lastMin = new Date().getMinutes();
setInterval(()=>{
  tickClock(); tickCountdown();
  const m = new Date().getMinutes();
  if(m!==lastMin){ lastMin=m; tickNowChip(); if(pickedDay==="auto") renderToday(); }
}, 1000);
const boot = parseHash();
if(boot.view==="give") fillGive(boot.params);
show(boot.view || "home", false);
