#!/usr/bin/env node
/**
 * Fact coverage: for each case that reaches the server (per a --core run) and has
 * must_include, does every required fact (any alternative) appear in the prompt Gemini got?
 * The question text itself is removed first, so a fact only counts if the data carries it.
 *
 *   node coverage.mjs --dumps <FELIPE_DUMP_PROMPT_DIR> --core results/core-repair.json [--out results/x.json]
 * Dump files are named prompt-run-<case id>-... (lib/instrument.mjs) or prompt-<case id>-...
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2), opt = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const cases = JSON.parse(readFileSync(path.join(here, "cases.json"), "utf8")).cases;
const core = JSON.parse(readFileSync(path.resolve(here, opt("--core") || "results/core-repair.json"), "utf8"));
const K = Object.fromEntries(core.rows.map(r => [r.id, r]));
const dir = opt("--dumps"), files = readdirSync(dir);
const norm = s => String(s || "").toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ");
const out = [];
for(const c of cases){
  const k = K[c.id]; if(!k || !(c.must_include || []).length) continue;
  const server = k.route === "llm" || (k.route === "local" && k.localFellThrough);
  if(!server) continue;
  const esc = c.id.replace(/[-]/g, "\\-");
  const f = files.find(n => new RegExp("^prompt-(?:[a-z]+-){0,2}?" + esc + "-\\d").test(n));
  if(!f){ out.push({ id: c.id, found: false }); continue; }
  const text = norm(readFileSync(path.join(dir, f), "utf8")).split(norm(c.question)).join(" ");
  const missing = c.must_include.map(x => Array.isArray(x) ? x : [x]).filter(alts => !alts.some(a => text.includes(norm(a))));
  out.push({ id: c.id, found: true, covered: !missing.length, missing: missing.map(a => a.join(" | ")) });
}
const found = out.filter(x => x.found);
const summary = { serverCasesWithFacts: out.length, dumped: found.length, covered: found.filter(x => x.covered).length, missing: found.filter(x => !x.covered).map(x => x.id + ": " + x.missing.join("; ")) };
console.log(JSON.stringify(summary, null, 2));
if(opt("--out")) writeFileSync(path.resolve(here, opt("--out")), JSON.stringify({ summary, rows: out }, null, 2));
