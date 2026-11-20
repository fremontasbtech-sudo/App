#!/usr/bin/env node
// Read and resolve the comments left on the Firebird Hub review copy (GitHub issues, label "marker").
//
//   node marker/notes.mjs                 open comments, compact
//   node marker/notes.mjs all             every comment (done ones too)
//   node marker/notes.mjs show 12         one comment in full (selector, CSS rules, styles, html)
//   node marker/notes.mjs done 12 "reply" fixed: the reply shows on the pin, the issue closes
//   node marker/notes.mjs reply 12 "text" answer without closing (a question back)
//   node marker/notes.mjs reopen 12
//   node marker/notes.mjs skip 12 "why"   won't do: replies, closes as not planned, the pin goes away
//
// Run from the App repo. The token comes from .git/.sudo-credentials (never printed).
import { promises as fs } from "node:fs";
import path from "node:path";

const REPO = "fremontasbtech-sudo/App";
const ROOT = path.resolve(import.meta.dirname, "..");
const cred = (await fs.readFile(path.join(ROOT, ".git", ".sudo-credentials"), "utf8")).trim();
const TOKEN = (cred.match(/^https:\/\/[^:]+:([^@]+)@/) || [])[1];
if (!TOKEN) { console.error("no token in .git/.sudo-credentials"); process.exit(1); }
const META_RE = /<!-- marker-meta\n([\s\S]*?)\n-->/;

async function gh(p, opts = {}) {
  const r = await fetch("https://api.github.com/repos/" + REPO + p, {
    ...opts,
    headers: { Authorization: "Bearer " + TOKEN, Accept: "application/vnd.github+json", "User-Agent": "firebird-hub-review",
      ...(opts.body ? { "Content-Type": "application/json" } : {}) },
  });
  if (!r.ok) { console.error(`GitHub ${r.status} on ${p}`); process.exit(1); }
  return r.json();
}
const parse = (issue) => { const m = (issue.body || "").match(META_RE); return m ? JSON.parse(m[1].replace(/--\\>/g, "-->")) : null; };

function line(issue, meta) {
  const t = meta.target || {};
  const state = issue.state === "closed" ? (issue.state_reason === "not_planned" ? ", skipped" : ", done") : "";
  return [
    `#${issue.number} [${meta.kind}${state}] ${(meta.page || {}).route || "#/"}  ${t.label || ""}${t.region ? ` (area ${t.region.w}x${t.region.h})` : ""}${meta.page && meta.page.viewport ? `  screen ${meta.page.viewport.w}x${meta.page.viewport.h}` : ""}${meta.name ? `  from ${meta.name}` : ""}`,
    meta.what && `   what:    ${meta.what}`, meta.why && `   details: ${meta.why}`, meta.fix && `   should:  ${meta.fix}`,
    meta.reply && `   reply:   ${meta.reply}`,
  ].filter(Boolean).join("\n");
}

const [cmd = "open", idArg, ...rest] = process.argv.slice(2);
const text = rest.join(" ").trim();

if (cmd === "open" || cmd === "all") {
  const issues = [];
  for (let page = 1; page <= 10; page++) {
    const b = await gh(`/issues?labels=marker&state=${cmd === "all" ? "all" : "open"}&per_page=100&page=${page}&sort=created&direction=asc`);
    issues.push(...b.filter((i) => !i.pull_request));
    if (b.length < 100) break;
  }
  const out = issues.map((i) => [i, parse(i)]).filter(([, m]) => m).map(([i, m]) => line(i, m));
  console.log(out.length ? out.join("\n\n") : "no comments");
} else if (["show", "done", "reply", "reopen", "skip"].includes(cmd)) {
  const n = Number(idArg);
  const issue = await gh("/issues/" + n);
  const meta = parse(issue);
  if (!meta) { console.error(`#${n} is not a review comment`); process.exit(1); }
  if (cmd === "show") {
    const { keyHash, ...shown } = meta;
    console.log(JSON.stringify({ n, state: issue.state, url: issue.html_url, ...shown }, null, 2));
    process.exit(0);
  }
  if ((cmd === "done" || cmd === "reply" || cmd === "skip") && text) {
    meta.reply = text;
    await gh(`/issues/${n}/comments`, { method: "POST", body: JSON.stringify({ body: text }) });
  }
  const body = issue.body.replace(META_RE, "<!-- marker-meta\n" + JSON.stringify(meta).replace(/-->/g, "--\\>") + "\n-->");
  const patch = { body };
  if (cmd === "done") Object.assign(patch, { state: "closed", state_reason: "completed" });
  if (cmd === "skip") Object.assign(patch, { state: "closed", state_reason: "not_planned" });
  if (cmd === "reopen") Object.assign(patch, { state: "open" });
  const updated = await gh("/issues/" + n, { method: "PATCH", body: JSON.stringify(patch) });
  console.log(line(updated, meta));
} else {
  console.error("usage: notes.mjs [open|all|show N|done N reply|reply N text|reopen N|skip N why]");
  process.exit(1);
}
