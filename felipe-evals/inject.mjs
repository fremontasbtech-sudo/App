/**
 * Ask Felipe: does it answer from the data, or from facts typed into the code?
 *
 *   node felipe-evals/inject.mjs [--verbose] [--keep]
 *
 * Copies fixtures/ to a temp folder (the real fixtures and the live sheets are never touched),
 * adds brand-new items that no code, prompt or test has ever seen, and moves one existing
 * event, then asks about each one through all three paths:
 *   1. on the phone: FelipeCore.classify + answerLocal with app data built from the copy
 *   2. the server with a mocked AI: the prompt sent to the model must hold the new item
 *      (and not the old value)
 *   3. the server with no AI at all: the answer made from the data (dataanswer.js)
 * Every check names the new value that must appear and the old one that must not.
 * Exit code 1 when any check fails.
 */
import { mkdtempSync, cpSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2), VERBOSE = argv.includes("--verbose"), KEEP = argv.includes("--keep");
process.env.TZ = "America/Los_Angeles";

/* ---------- 1. a copy of the fixtures with new data ---------- */
const DIR = mkdtempSync(path.join(os.tmpdir(), "felipe-inject-"));
cpSync(path.join(HERE, "fixtures"), DIR, { recursive: true });
const NOW = "2026-11-20T10:00:00-08:00";          // Friday, a B day, after the 8:30 announcement reveal
const q = s => '"' + String(s).replace(/"/g, '""') + '"';
const csvLine = cells => cells.map(q).join(",");
const edit = (file, fn) => { const p = path.join(DIR, file); writeFileSync(p, fn(readFileSync(p, "utf8"))); };

// Events: a new event, and Club Trivia Night moved from 2027-01-27 to 2027-02-03.
edit("sheet_Events.csv", t => {
  if(!/"Club Trivia Night","2027-01-27","2027-01-27"/.test(t)) throw new Error("fixture changed: Club Trivia Night row not found");
  t = t.replace(/"Club Trivia Night","2027-01-27","2027-01-27"/, '"Club Trivia Night","2027-02-03","2027-02-03"');
  return t.replace(/\n?$/, "\n") + csvLine(["Winter Formal: Starlight", "2027-01-16", "2027-01-16", "7:00 PM", "Large Gym",
    "The winter dance. Tickets are $25 at the ASB window.", "dance;social", ""]) + "\n";
});
// Sports: a brand-new Boys Soccer Varsity home game against Mountain View next week.
edit("sheet_Sports.csv", t => t.replace(/\n?$/, "\n") + csvLine(["", "Boys Soccer", "2026-11-24", "Tue", "3:30 PM", "Varsity", "Home", "Mountain View",
  "Fremont", "Non-League", "Game", "upcoming", "", "", "Boys Soccer Varsity Home vs Mountain View", "", ""]) + "\n");
// Spirit Points: the Freshmen take the lead (they had 29; the Juniors led with 444).
edit("sheet_Spirit_Points.csv", t => t.replace(/^"Freshmen",(.*)$/m, (m, rest) => {
  const cells = rest.split(","); cells[cells.length - 1] = '"600"'; return '"Freshmen",' + cells.join(",");
}));
// Performing Arts: a new Jazz Night.
edit("sheet_Performing_Arts.csv", t => t.replace(/\n?$/, "\n") + csvLine(["", "2026-12-12", "Sat", "6:30 PM", "Jazz Night", "Concert", "Jazz Band",
  "Shannon Theatre", "Yes", ""]) + "\n" + csvLine(["", "2026-11-21", "Sat", "2:00 PM", "Winter Choir Showcase", "Choir", "Choir", "Student Center", "", ""]) + "\n");
// Clubs: a new club.
edit("clubs.json", t => { const j = JSON.parse(t);
  j.clubs.push({ name: "Origami Society", purpose: "We fold paper cranes, boxes and modular origami, and teach beginners.", teacherAdvisor: "Ms. Rivera",
    meetingInfo: "Room B-112 · Tuesdays at lunch", disbanded: false, category: "Arts" });
  return JSON.stringify(j); });
// Announcements: a new one for today.
edit("announcements.json", t => { const j = JSON.parse(t);
  // Placed first among today's items, as the newest one posted.
  const at = j.announcements.findIndex(a => a.date === "2026-11-20");
  if(at < 0) throw new Error("fixture changed: no 2026-11-20 announcements");
  j.announcements.splice(at, 0, { date: "2026-11-20", title: "Canned Food Drive", xtitle: "",
    text: "The Canned Food Drive starts today. Bring canned food to your 4th period class through December 4; the class with the most cans wins a pizza party." },
    { date: "2026-11-20", title: "Girls Golf Interest Meeting", xtitle: "",
      text: "Thinking about playing golf this spring? Come to the Girls Golf interest meeting on Thursday, December 3 in Room D-104 at lunch. See Coach Alvarez with questions." });
  return JSON.stringify(j); });

process.env.FELIPE_FIXTURES_DIR = DIR;
process.env.FELIPE_FIXTURES = "1";
process.env.FELIPE_MOCK = "1";
process.env.FELIPE_CACHE = "0";               // no shared answers between the paths
process.env.FELIPE_DUMP_PROMPT_DIR = path.join(DIR, "_prompts");

/* ---------- 2. the questions ---------- */
// new: every alternative group must appear; old: none may appear. Checked in each path's text.
// core: "answer" (must answer on the phone), "either" (phone or server is fine), "server" (must
// go to the server). prompt / data: what the model's prompt and the no-AI answer must hold.
const CASES = [
  { id: "formal-when", q: "when is winter formal", core: "either", new: [["January 16", "Jan 16", "2027-01-16"]], data: true },
  { id: "formal-tickets", q: "how much are tickets for the starlight dance?", core: "either", new: [["$25"]], prompt: [["Starlight"], ["$25"]], data: [["$25", "Starlight"]] },
  { id: "formal-where-es", q: "¿dónde es el baile Winter Formal?", core: "either", new: [["Large Gym"]], data: true },
  { id: "trivia-moved", q: "when is club trivia night", core: "answer", new: [["February 3", "Feb 3", "3 de febrero", "2027-02-03"]], old: ["January 27", "Jan 27", "2027-01-27"], data: true },
  { id: "trivia-moved-typo", q: "wen is trivia nite", core: "either", new: [["February 3", "Feb 3", "2027-02-03"]], old: ["January 27", "Jan 27", "2027-01-27"], data: true },
  { id: "soccer-next", q: "when is the next boys soccer game?", core: "answer", new: [["Mountain View"]], data: true },
  { id: "soccer-next-week", q: "do we have any soccer games next week", core: "either", new: [["Mountain View"]], data: true },
  { id: "soccer-es", q: "¿cuándo juega el equipo de fútbol de chicos?", core: "either", new: [["Mountain View"]], data: true },
  { id: "spirit-lead", q: "which class is winning spirit points?", core: "answer", new: [["Freshmen", "freshman"]], old: ["Juniors are in first", "Juniors are in the lead"], prompt: [["Freshmen"]], data: true },
  { id: "spirit-lead-es", q: "¿quién va ganando en puntos de espíritu?", core: "answer", new: [["Primer año", "Freshmen"]], old: ["Tercer año va en primer lugar"], data: true },
  { id: "club-origami-when", q: "when does the origami society meet?", core: "server", new: [["Tuesday", "Tuesdays"]], prompt: [["Origami Society"], ["B-112"]], data: [["Tuesday"], ["B-112"]] },
  { id: "club-origami-advisor", q: "who's the advisor for origami club", core: "server", new: [["Rivera"]], prompt: [["Rivera"]], data: [["Rivera"]] },
  { id: "club-origami-es", q: "¿hay un club de origami?", core: "server", new: [["Origami"]], prompt: [["Origami Society"]], data: [["Origami"]] },
  { id: "ann-today", q: "what are today's announcements", core: "answer", new: [["Canned Food Drive"]], data: true },
  { id: "ann-food-drive", q: "is there a food drive going on?", core: "either", new: [["Canned Food Drive", "canned food"]], prompt: [["Canned Food Drive"]], data: [["Canned Food", "canned food"]] },
  { id: "arts-jazz", q: "when is jazz night?", core: "either", new: [["December 12", "Dec 12", "2026-12-12"]], prompt: [["Jazz Night"], ["2026-12-12", "Dec 12"]], data: true },
  { id: "soccer-opp-named", q: "do we play mountain view in soccer?", core: "answer", new: [["Mountain View"], ["Nov 24", "November 24"]], data: true },
  { id: "club-origami-es-where", q: "¿dónde se reúne el club de origami?", core: "server", new: [["B-112"]], prompt: [["B-112"]], data: [["B-112"]] },
  { id: "golf-meeting", q: "when is the girls golf meeting", core: "server", new: [["D-104"]], prompt: [["D-104"]], data: [["D-104"]], old: ["don't see any upcoming"] },
  { id: "choir-weekend", q: "is the choir performing this weekend?", core: "either", new: [["Winter Choir Showcase"]], prompt: [["Winter Choir Showcase"]], data: true, old: ["already happened"] },
  { id: "arts-jazz-where", q: "where is the jazz night concert", core: "either", new: [["Shannon Theatre", "Shannon Theater"]], prompt: [["Jazz Night"], ["Shannon"]], data: true }
];

/* ---------- 3. run ---------- */
const { install, als, newRecord } = await import("./lib/instrument.mjs");
const { fakePair } = await import("./lib/vercel.mjs");
const { buildAppData } = await import("./lib/appdata.mjs");
const Core = createRequire(import.meta.url)(path.join(HERE, "..", "FirebirdHub", "felipe-core.js"));
install();
const handler = (await import(pathToFileURL(path.join(HERE, "..", "FirebirdHub", "api", "ask.js")).href)).default;

const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
function check(text, need, old){
  const t = norm(text), fails = [];
  for(const g of need || []) if(!g.some(a => t.includes(norm(a)))) fails.push("missing " + g.join(" | "));
  for(const o of old || []) if(t.includes(norm(o))) fails.push("still has old " + o);
  return fails;
}
const AI_KEYS = ["GEMINI_API_KEY", "GROQ_API_KEY", "CEREBRAS_API_KEY", "OPENROUTER_API_KEY"];
let seq = 0;
async function ask(question, noAI){
  const id = "inject-" + (++seq);
  newRecord(id);
  const headers = { "content-type": "application/json", "x-eval-id": id, "x-felipe-now": NOW, "x-vercel-forwarded-for": "10.88.0." + (seq % 250 + 1) };
  const body = { question, history: [], lang: "en", stream: false, v: 2 };
  const saved = {};
  if(noAI) for(const k of AI_KEYS){ saved[k] = process.env[k]; delete process.env[k]; }
  const { req, res, out, done } = fakePair({ method: "POST", headers, body });
  try{
    await als.run({ rec: newRecord(id), clockOffset: Date.parse(NOW) - Date.now() }, async () => { await handler(req, res); });
    await done;
  }finally{ if(noAI) for(const k of AI_KEYS){ if(saved[k] !== undefined) process.env[k] = saved[k]; } }
  const all = out.chunks.map(c => c.s).join("");
  let j = null; try{ j = JSON.parse(all); }catch(e){}
  const dumps = readdirSync(process.env.FELIPE_DUMP_PROMPT_DIR, { withFileTypes: true }).filter(d => d.isFile() && d.name.includes(id + "-")).map(d => d.name);
  const prompt = dumps.length ? readFileSync(path.join(process.env.FELIPE_DUMP_PROMPT_DIR, dumps[dumps.length - 1]), "utf8") : "";
  return { status: out.status, answer: j && j.answer || "", route: out.headers["x-felipe-route"] || (j && j.route) || "", prompt };
}
try{ readdirSync(process.env.FELIPE_DUMP_PROMPT_DIR); }catch(e){ (await import("node:fs")).mkdirSync(process.env.FELIPE_DUMP_PROMPT_DIR, { recursive: true }); }

let failed = 0;
const rows = [];
for(const c of CASES){
  const now = new Date(NOW), lines = [];
  // Path 1: on the phone.
  const cls = Core.classify(c.q, { history: [], lang: "en" });
  let local = null;
  if(cls.route === "local") local = Core.answerLocal(cls.intent, cls.resolved || c.q, buildAppData(now, cls.lang), cls.lang);
  let coreFails = [];
  if(local) coreFails = check(local.text, c.new, c.old);
  else if(c.core === "answer") coreFails = ["expected an answer on the phone, got route " + cls.route + (cls.route === "local" ? " (answerLocal returned null)" : "")];
  if(local && c.core === "server") coreFails.push("answered on the phone, expected the server");
  lines.push(["phone", local ? "answered" : "to server (" + cls.route + "/" + cls.intent + ")", coreFails, local && local.text]);
  // Path 2: the server, AI mocked. The prompt must hold the new item and not the old value.
  if(!local){
    const r = await ask(c.q, false);
    const pf = r.prompt ? check(r.prompt, c.prompt || c.new, c.old) : (r.answer ? check(r.answer, c.new, c.old) : ["no prompt and no answer (status " + r.status + ")"]);
    lines.push(["server+AI", r.prompt ? "prompt " + r.prompt.length + " chars" : "answered without AI: " + r.route, pf, r.prompt ? "" : r.answer]);
  }
  // Path 3: the server with no AI: the answer made from the data.
  if(c.data){
    const r = await ask(c.q, true);
    const df = check(r.answer, c.data === true ? c.new : c.data, c.old);
    lines.push(["server, no AI", r.route || String(r.status), df, r.answer]);
  }
  const bad = lines.filter(l => l[2].length);
  failed += bad.length;
  console.log((bad.length ? "FAIL " : "PASS ") + c.id.padEnd(22) + " " + c.q);
  for(const l of lines) if(VERBOSE || l[2].length) console.log("     " + l[0].padEnd(14) + l[1] + (l[2].length ? "  -> " + l[2].join("; ") : "") + (l[3] ? "\n" + " ".repeat(20) + String(l[3]).slice(0, 300) : ""));
  rows.push({ id: c.id, q: c.q, paths: lines.map(l => ({ path: l[0], how: l[1], fails: l[2], text: l[3] ? String(l[3]).slice(0, 600) : "" })) });
}
writeFileSync(path.join(HERE, "results", "inject-latest.json"), JSON.stringify({ now: NOW, rows }, null, 1));
console.log("\n" + (failed ? failed + " check(s) failed" : "All checks passed") + " across " + CASES.length + " questions. Details: felipe-evals/results/inject-latest.json" + (KEEP ? "\nData copy kept at " + DIR : ""));
if(!KEEP) rmSync(DIR, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
