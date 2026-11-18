#!/usr/bin/env node
/**
 * Compares a baseline server run with the new code, from the student's point of view.
 *
 *   node compare.mjs --before results/baseline-fixtures.json --after results/after-stream-mock-fixtures.json --core results/core-after.json
 *
 * "Student first text" for the new code is built per case the way app.js decides it:
 *   - classify says cannot or crisis      -> canned reply in the page: classify time only (no network)
 *   - classify says local and answerLocal  -> classify + answerLocal time (no network)
 *   - otherwise (llm, or local that fell through) -> the server's first SSE delta from the --after run
 * Node timings are used for the in-page part; the browser probe measured 1 to 8 ms for the same paths.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const argv = process.argv.slice(2);
const opt = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const here = path.dirname(fileURLToPath(import.meta.url));
const load = f => JSON.parse(readFileSync(path.resolve(here, f), "utf8"));
const before = load(opt("--before") || "results/baseline-fixtures.json");
const after = load(opt("--after") || "results/after-stream-mock-fixtures.json");
const core = load(opt("--core") || "results/core-after.json");
const cases = load("cases.json").cases;

const pct = (arr, p) => { const a = arr.filter(Number.isFinite).sort((x, y) => x - y); if(!a.length) return null; return a[Math.min(a.length - 1, Math.floor(p / 100 * a.length))]; };
const r = x => x == null ? null : Math.round(x * 10) / 10;
const st = a => ({ n: a.length, p50: r(pct(a, 50)), p95: r(pct(a, 95)), max: r(pct(a, 100)) });
const by = (rows) => Object.fromEntries(rows.map(x => [x.id, x]));
const B = by(before.rows), A = by(after.rows), K = by(core.rows);

const rows = cases.map(c => {
  const k = K[c.id], a = A[c.id], b = B[c.id];
  let path_, first;
  if(k.route === "cannot" || k.route === "crisis"){ path_ = k.route + " (in page)"; first = k.classifyP50; }
  else if(k.route === "local" && !k.localFellThrough){ path_ = "local (in page)"; first = k.classifyP50 + (k.answerLocalMs || 0); }
  else { path_ = "server stream"; first = a.firstVisibleMs; }
  return { id: c.id, expected: c.expected_route, coreRoute: k.route, path: path_, beforeFirst: b.firstVisibleMs, beforeTotal: b.totalMs, afterFirst: first,
    afterServerFirst: a.firstVisibleMs, afterServerTotal: a.totalMs, beforePrompt: b.promptChars, afterPrompt: a.promptChars, beforeGemini: b.geminiCalls, afterGemini: path_ === "server stream" ? a.geminiCalls : 0 };
});
const inPage = rows.filter(x => x.path !== "server stream"), viaServer = rows.filter(x => x.path === "server stream");
const pairedPrompt = rows.filter(x => x.afterPrompt > 0 && x.beforePrompt > 0);
const out = {
  before: { label: before.label, mock: before.mock, fixtures: before.fixtures },
  after: { label: after.label, mock: after.mock, fixtures: after.fixtures, stream: after.stream },
  studentFirstText: { before: st(rows.map(x => x.beforeFirst)), after: st(rows.map(x => x.afterFirst)),
    afterInPage: st(inPage.map(x => x.afterFirst)), afterViaServer: st(viaServer.map(x => x.afterFirst)),
    beforeSameCasesAsInPage: st(inPage.map(x => x.beforeFirst)) },
  wholeAnswer: { before: st(rows.map(x => x.beforeTotal)), afterViaServer: st(viaServer.map(x => x.afterServerTotal)) },
  answeredInPage: { total: inPage.length, local: inPage.filter(x => x.path.startsWith("local")).length,
    canned: inPage.filter(x => !x.path.startsWith("local")).length, of: rows.length },
  geminiCalls: { before: rows.reduce((s, x) => s + (x.beforeGemini || 0), 0), after: rows.reduce((s, x) => s + (x.afterGemini || 0), 0) },
  promptChars: { before: st(rows.map(x => x.beforePrompt).filter(Boolean)), after: st(rows.map(x => x.afterPrompt).filter(Boolean)),
    pairedMeanBefore: r(pairedPrompt.reduce((s, x) => s + x.beforePrompt, 0) / pairedPrompt.length),
    pairedMeanAfter: r(pairedPrompt.reduce((s, x) => s + x.afterPrompt, 0) / pairedPrompt.length), pairedN: pairedPrompt.length },
  rows
};
const file = path.resolve(here, opt("--out") || "results/compare.json");
writeFileSync(file, JSON.stringify(out, null, 2));
const { rows: _, ...summary } = out;
console.log(JSON.stringify(summary, null, 2));
console.log("saved " + path.relative(here, file));
