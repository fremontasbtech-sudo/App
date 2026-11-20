/**
 * Builds the "data" object that run.mjs --core passes to FelipeCore.answerLocal, from the
 * fixtures snapshot (2026-11-18) at a given moment. It mirrors what app.js holds in memory.
 * Times are Pacific; run.mjs sets TZ=America/Los_Angeles so Date math matches a phone at FHS.
 *
 * Shape (every field is plain data; scheduleFor is the only function):
 * {
 *   now: Date, lang: "en"|"es",
 *   today: { iso, weekday:0-6, type:"mon"|"a"|"b"|null, label, off:null|[reason, reasonEs], why:null|string,
 *            bells:[{ name, start:"8:30", end:"10:05", startMin, endMin }] },
 *   scheduleFor(iso) -> same shape as today,
 *   schedules: { mon|a|b: { label, rows:[[name,start,end]] } },     // copied from app.js SCHEDULES
 *   specialDays: { "2026-11-23":"a", ... },                          // app.js SPECIAL_DAYS
 *   noSchoolDays: [[from, to, reason, reasonEs]],                    // app.js NO_CLASSES
 *   schoolYear: { first, last },
 *   nextEvents: [{ name, date, endDate, time, location, description, tags }]   // end >= today, soonest first
 *   nextGames: [{ sport, level, date, time, homeAway, opponent, location, type, kind, seniorNight, title }]  // not played, soonest first
 *   recentResults: [{ ...game, score }]                               // played with a score, newest first
 *   spiritStandings: [{ cls, pts }]                                   // highest first
 *   announcementsToday: [{ date, title, text }]                       // today's, once revealed (8:30 AM)
 *   announcements: [{ date, title, text }]                            // last 14 days, newest first
 *   clubs: [{ name, meetingInfo, teacherAdvisor, purpose, category }]
 * }
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { EVALS_DIR } from "./instrument.mjs";

// FELIPE_FIXTURES_DIR: same override as lib/instrument.mjs.
const FX = process.env.FELIPE_FIXTURES_DIR ? path.resolve(process.env.FELIPE_FIXTURES_DIR) : path.join(EVALS_DIR, "fixtures");
const read = f => readFileSync(path.join(FX, f), "utf8");

// Copied from FirebirdHub/app.js (2026-11-18).
export const SCHEDULES = {
  mon: { label: "Monday", rows: [
    ["Period 1","8:30","9:15"],["Period 2","9:20","10:05"],["Tutorial","10:10","10:35"],
    ["Period 3","10:40","11:25"],["Brunch","11:25","11:40"],["Period 4","11:50","12:35"],
    ["Period 5","12:40","1:25"],["Lunch","1:25","2:05"],["Period 6","2:15","3:00"],["Period 7","3:05","3:50"] ]},
  a: { label: "A day · Tue & Thu", rows: [
    ["Period 1","8:30","10:00"],["Period 2","10:05","11:35"],["Brunch","11:35","11:50"],
    ["Period 3","12:00","1:30"],["Lunch","1:30","2:10"],["Period 7","2:20","3:50"] ]},
  b: { label: "B day · Wed & Fri", rows: [
    ["Collaboration (staff only)","7:35","8:25"],["Period 4","8:30","10:05"],["Tutorial","10:10","10:50"],
    ["Brunch","10:50","11:05"],["Period 5","11:15","12:45"],["Lunch","12:45","1:25"],["Period 6","1:35","3:05"] ]}
};
export const SCHOOL_YEAR = { first: "2026-08-17", last: "2027-06-03" };
export const NO_CLASSES = [
  ["2026-09-07","2026-09-07","Labor Day","Día del Trabajo"],
  ["2026-10-12","2026-10-12","Teacher Non-Duty Day","Día sin clases"],
  ["2026-11-11","2026-11-11","Veterans Day","Día de los Veteranos"],
  ["2026-11-25","2026-11-27","Thanksgiving Break","Vacaciones de Acción de Gracias"],
  ["2026-12-21","2027-01-01","Mid-Year Break","Vacaciones de mitad de año"],
  ["2027-01-18","2027-01-18","Martin Luther King Jr. Day","Día de Martin Luther King Jr."],
  ["2027-02-15","2027-02-19","Presidents' Week","Semana de los Presidentes"],
  ["2027-03-15","2027-03-15","Non-Duty Day","Día sin clases"],
  ["2027-04-12","2027-04-16","Spring Break","Vacaciones de primavera"],
  ["2027-05-31","2027-05-31","Memorial Day","Día de los Caídos"]
];
export const SPECIAL_DAYS = { "2026-11-09":"a", "2026-11-10":"b", "2026-11-23":"a", "2026-11-24":"b" };
const WHY = { "2026-11-09":"Veterans Day week", "2026-11-10":"Veterans Day week", "2026-11-23":"Thanksgiving week", "2026-11-24":"Thanksgiving week" };

function parseCSV(text){
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
const pad = n => String(n).padStart(2, "0");
const isoOf = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const wdOf = iso => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d).getDay(); };
// "1:25" in a school day: 1 to 6 is PM.
const toMin = t => { const [h, m] = t.split(":").map(Number); return ((h < 7 ? h + 12 : h) * 60) + m; };
const clockMin = t => { const m = String(t || "").match(/(\d+):(\d+)\s*(AM|PM)/i); if(!m) return 9999; let h = +m[1] % 12; if(/PM/i.test(m[3])) h += 12; return h * 60 + (+m[2]); };

export function scheduleFor(iso){
  const weekday = wdOf(iso);
  const hit = NO_CLASSES.find(r => iso >= r[0] && iso <= r[1]);
  let off = null;
  if(iso < SCHOOL_YEAR.first || iso > SCHOOL_YEAR.last) off = ["Summer Break", "Vacaciones de verano"];
  else if(hit) off = [hit[2], hit[3]];
  else if(weekday === 0 || weekday === 6) off = ["Weekend", "Fin de semana"];
  const type = off ? null : (SPECIAL_DAYS[iso] || { 1: "mon", 2: "a", 3: "b", 4: "a", 5: "b" }[weekday]);
  const bells = type ? SCHEDULES[type].rows.filter(r => !/staff only/i.test(r[0])).map(r => ({ name: r[0], start: r[1], end: r[2], startMin: toMin(r[1]), endMin: toMin(r[2]) })) : [];
  return { iso, weekday, type, label: type ? SCHEDULES[type].label : null, off, why: WHY[iso] || null, bells };
}

let cache = null;
function load(){
  if(cache) return cache;
  const ev = parseCSV(read("sheet_Events.csv")), sp = parseCSV(read("sheet_Sports.csv")), pts = parseCSV(read("sheet_Spirit_Points.csv"));
  const head = r => r.map(h => String(h).trim().toLowerCase());
  const eh = head(ev[0]), ec = (r, n) => String(r[eh.indexOf(n)] || "").trim();
  const events = ev.slice(1).filter(r => ec(r, "name") && ec(r, "date")).map(r => ({ name: ec(r, "name"), date: ec(r, "date"), endDate: ec(r, "enddate") || ec(r, "date"),
    time: ec(r, "time"), location: ec(r, "location"), description: ec(r, "description"), tags: ec(r, "tags") }));
  const sh = head(sp[0]), sc = (r, n) => String(r[sh.indexOf(n)] || "").trim();
  const games = sp.slice(1).filter(r => sc(r, "sport") && /^\d{4}-\d{2}-\d{2}$/.test(sc(r, "date")) && !/rancho\s*san\s*antonio/i.test(r.join(" "))).map(r => ({
    sport: sc(r, "sport"), level: sc(r, "level"), date: sc(r, "date"), time: sc(r, "time"), homeAway: sc(r, "homeaway"), opponent: sc(r, "opponent"),
    location: sc(r, "location"), type: sc(r, "type"), kind: sc(r, "kind"), section: sc(r, "section"), score: sc(r, "score"), seniorNight: !!sc(r, "seniornight"), title: sc(r, "title") }));
  const spirit = ["Seniors", "Juniors", "Sophomores", "Freshmen"].map(cls => {
    const r = pts.find(x => String(x[0] || "").trim().toLowerCase() === cls.toLowerCase());
    return r ? { cls, pts: r.slice(1).reduce((s, c) => { const n = Number(String(c).replace(/[^\d.-]/g, "")); return s + (Number.isFinite(n) ? n : 0); }, 0) } : null;
  }).filter(Boolean).sort((a, b) => b.pts - a.pts);
  const ann = JSON.parse(read("announcements.json")).announcements || [];
  const clubs = (JSON.parse(read("clubs.json")).clubs || []).filter(c => c && c.name && !c.disbanded)
    .map(c => ({ name: c.name, meetingInfo: c.meetingInfo || "", teacherAdvisor: c.teacherAdvisor || "", purpose: c.purpose || "", category: c.category || "" }));
  cache = { events, games, spirit, ann, clubs };
  return cache;
}

export function buildAppData(now, lang = "en"){
  const d = now instanceof Date ? now : new Date(now);
  const { events, games, spirit, ann, clubs } = load();
  const today = isoOf(d), nowMin = d.getHours() * 60 + d.getMinutes();
  const played = g => g.section === "result" || !!g.score || g.date < today || (g.date === today && clockMin(g.time) < 9999 && nowMin >= clockMin(g.time) + 180);
  const byWhen = (a, b) => a.date.localeCompare(b.date) || clockMin(a.time) - clockMin(b.time) || a.sport.localeCompare(b.sport);
  const revealed = nowMin >= 8 * 60 + 30;
  const twoWeeksAgo = isoOf(new Date(d.getTime() - 14 * 864e5));
  return {
    now: d, lang,
    today: scheduleFor(today),
    scheduleFor,
    schedules: SCHEDULES, specialDays: SPECIAL_DAYS, noSchoolDays: NO_CLASSES, schoolYear: SCHOOL_YEAR,
    nextEvents: events.filter(e => e.endDate >= today).sort((a, b) => a.date.localeCompare(b.date)),
    nextGames: games.filter(g => !played(g)).sort(byWhen),
    recentResults: games.filter(g => played(g) && g.score).sort((a, b) => byWhen(b, a)),
    spiritStandings: spirit,
    announcementsToday: ann.filter(a => a.date === today && revealed).map(a => ({ date: a.date, title: a.title, text: a.text })),
    announcements: ann.filter(a => a.date <= today && a.date >= twoWeeksAgo && (a.date < today || revealed)).map(a => ({ date: a.date, title: a.title, text: a.text })),
    clubs
  };
}
