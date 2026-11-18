/**
 * Ask Felipe: dates, the FUHSD calendar and the bell schedule (Pacific time).
 * Files under api/_felipe/ are helpers, not routes (Vercel skips underscore folders).
 *
 * FUHSD 2026-27 calendar (fuhsd.org/about-us/general-information/calendar, checked 2026-10-12).
 * [first day, last day, reason]. Update every August with the new year's dates, and keep the
 * same tables in app.js (NO_CLASSES, SPECIAL_DAYS) in step. From NEXT_FIRST_DAY on, Felipe
 * says the new calendar isn't loaded yet instead of calling it summer.
 */
export const TZ = "America/Los_Angeles";
export const FIRST_DAY = "2026-08-17", LAST_DAY = "2027-06-03";
export const NEXT_YEAR = "2027-28", NEXT_FIRST_DAY = "2027-08-16";   // already on fuhsd.org
export const NO_CLASSES = [
  ["2026-09-07", "2026-09-07", "Labor Day"],
  ["2026-10-12", "2026-10-12", "Teacher Non-Duty Day"],
  ["2026-11-11", "2026-11-11", "Veterans Day"],
  ["2026-11-25", "2026-11-27", "Thanksgiving Break"],
  ["2026-12-21", "2027-01-01", "Mid-Year Break"],
  ["2027-01-18", "2027-01-18", "Martin Luther King Day"],
  ["2027-02-15", "2027-02-19", "Presidents' Week"],
  ["2027-03-15", "2027-03-15", "Non-Duty Day"],
  ["2027-04-12", "2027-04-16", "Spring Break"],
  ["2027-05-31", "2027-05-31", "Memorial Day"]
];
/* Days a mid-week day off shifts the A/B pattern (FHS bell-schedule pattern rule: the days
   left alternate A, B from Monday). Same dates as SPECIAL_DAYS in app.js. Finals week and
   rally Fridays go here once FHS posts the 2026-27 dates. */
const VETS_WEEK = "Veterans Day week: with Wednesday off, Monday runs A and Tuesday runs B";
const THANKS_WEEK = "Thanksgiving week: Monday runs A and Tuesday runs B before the break";
export const SPECIAL_DAYS = {
  "2026-11-09": ["A day", VETS_WEEK], "2026-11-10": ["B day", VETS_WEEK],
  "2026-11-23": ["A day", THANKS_WEEK], "2026-11-24": ["B day", THANKS_WEEK]
};
const CAVEAT = "Special weeks (rallies, finals, testing) can change this; the Schedule tab shows the exact day.";

export const BELL_SCHEDULE = `BELL SCHEDULE (regular weeks; school starts 8:30 AM):
- Monday (all 7 periods): P1 8:30-9:15, P2 9:20-10:05, Tutorial 10:10-10:35, P3 10:40-11:25, Brunch 11:25-11:40, P4 11:50-12:35, P5 12:40-1:25, Lunch 1:25-2:05, P6 2:15-3:00, P7 3:05-3:50.
- A day (Tue and Thu): P1 8:30-10:00, P2 10:05-11:35, Brunch 11:35-11:50, P3 12:00-1:30, Lunch 1:30-2:10, P7 2:20-3:50.
- B day (Wed and Fri): P4 8:30-10:05, Tutorial 10:10-10:50, Brunch 10:50-11:05, P5 11:15-12:45, Lunch 12:45-1:25, P6 1:35-3:05.
Special weeks (rally, finals, CAASPP testing, Career Day) change these; the Schedule tab shows the exact day and a live "current period / time left" clock.`;

export const WD_LONG = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
export const WD_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
export function isoDate(s){ const m=String(s||"").trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); return m?(m[1]+"-"+("0"+m[2]).slice(-2)+"-"+("0"+m[3]).slice(-2)):""; }
export function weekday(iso){ return new Date(iso+"T12:00:00Z").getUTCDay(); }
export function addDays(iso,n){ const d=new Date(iso+"T12:00:00Z"); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); }
export function timeMin(t){ const m=String(t||"").match(/(\d+):(\d+)\s*(AM|PM)/i); if(!m) return 9999; let h=+m[1]%12; if(/PM/i.test(m[3])) h+=12; return h*60+(+m[2]); }

// Now, in Pacific time: { iso:"2026-10-12", wd:1, time:"2:35 PM", min:875 }.
// `at` (a Date) is for tests; the handler always uses the real clock.
export function nowPT(at){
  const p={}; new Intl.DateTimeFormat("en-US",{ timeZone:TZ, year:"numeric", month:"2-digit", day:"2-digit", hour:"numeric", minute:"2-digit", hour12:true })
    .formatToParts(at || new Date()).forEach(x=>{ p[x.type]=x.value; });
  const iso = p.year+"-"+p.month+"-"+p.day, time = p.hour+":"+p.minute+" "+String(p.dayPeriod||"").toUpperCase();
  return { iso, wd:weekday(iso), time, min:timeMin(time) };
}

// { off:"reason" } on a day with no classes, else { sched:"Monday" | "A day" | "B day" },
// plus why:"..." on a SPECIAL_DAYS swap, or unknown:true once the calendar runs out.
export const dayName = iso=> WD_LONG[weekday(iso)]+", "+iso;
export function dayInfo(iso){
  if(iso < FIRST_DAY) return { off:"summer break; the first day of school is "+dayName(FIRST_DAY) };
  if(iso > LAST_DAY && iso < NEXT_FIRST_DAY) return { off:"summer break; the last day of school was "+dayName(LAST_DAY)+", and the "+NEXT_YEAR+" school year starts "+dayName(NEXT_FIRST_DAY) };
  const wd = weekday(iso);
  if(wd===0 || wd===6) return { off:"weekend" };
  const sched = {1:"Monday",2:"A day",3:"B day",4:"A day",5:"B day"}[wd];
  if(iso >= NEXT_FIRST_DAY) return { sched, unknown:true };
  const hit = NO_CLASSES.find(n=> iso>=n[0] && iso<=n[1]);
  if(hit) return { off:hit[2]+" (FUHSD calendar)" };
  const sp = SPECIAL_DAYS[iso];
  return sp ? { sched:sp[0], why:sp[1] } : { sched };
}
function schedText(d){
  if(d.unknown) return "probably the "+d.sched+" bell schedule, but the "+NEXT_YEAR+" FUHSD calendar isn't loaded here yet, so days off and special schedules are unknown. Say so and point to the Schedule tab and fuhsd.org.";
  return (d.why ? "the "+d.sched+" bell schedule ("+d.why+")" : "the regular "+d.sched+" bell schedule")+". "+CAVEAT;
}
function dayText(iso){
  const d = dayInfo(iso);
  return d.off ? ("no classes, "+d.off+".") : ("classes, "+schedText(d));
}
// TODAY / TOMORROW / NEXT SCHOOL DAY lines. withYear adds the full no-class list for the
// year (only when the question is about days off or the calendar; otherwise the next 3
// weeks digest already names the days off that are coming up).
export function todayLines(now, withYear){
  const today = now.iso, d = dayInfo(today), tomorrow = addDays(today,1);
  const lines = [];
  lines.push("TODAY: "+WD_LONG[now.wd]+", "+today+", "+now.time+" Pacific time. " + (d.off
    ? "There are NO classes today: "+d.off+"."
    : "Classes today: "+schedText(d)+(d.unknown?"":" Times are in BELL SCHEDULE.")));
  lines.push("TOMORROW: "+dayName(tomorrow)+": "+dayText(tomorrow));
  if(d.off || dayInfo(tomorrow).off){
    let n = tomorrow; for(let i=0;i<120 && dayInfo(n).off;i++) n = addDays(n,1);
    if(n!==tomorrow && !dayInfo(n).off) lines.push("NEXT SCHOOL DAY: "+dayName(n)+": "+dayText(n));
  }
  // The next 9 days by name, so "what schedule is Monday" uses the real date (a Thanksgiving-week
  // Monday runs an A day, not the usual Monday schedule).
  const week = [];
  for(let i=2;i<=9;i++){ const iso = addDays(today,i), w = weekday(iso); if(w===0 || w===6) continue;
    const x = dayInfo(iso); week.push(WD_SHORT[w]+" "+iso+": "+(x.off ? "no classes ("+x.off+")" : x.sched+(x.why?" ("+x.why+")":""))); }
  if(week.length) lines.push("COMING SCHOOL DAYS (a weekday name means the next one of these): "+week.join("; ")+".");
  if(withYear){
    const left = NO_CLASSES.filter(n=> n[1]>=today).map(n=> (n[0]===n[1] ? (WD_SHORT[weekday(n[0])]+" "+n[0]) : (n[0]+" to "+n[1]))+" "+n[2]);
    if(left.length) lines.push("NO-CLASS DAYS LEFT IN 2026-27 (FUHSD calendar): "+left.join("; ")+". The last day of school is "+dayName(LAST_DAY)+".");
  }
  return lines.join("\n");
}
// No-class days that overlap [from, to], as short strings.
export function noClassBetween(from, to){
  return NO_CLASSES.filter(n=> n[1]>=from && n[0]<=to)
    .map(n=> (n[0]===n[1] ? (WD_SHORT[weekday(n[0])]+" "+n[0]) : (WD_SHORT[weekday(n[0])]+" "+n[0]+" to "+WD_SHORT[weekday(n[1])]+" "+n[1]))+": no classes, "+n[2]);
}
