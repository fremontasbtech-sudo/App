/**
 * Review comments for the public review copy of Firebird Hub (Vercel serverless function).
 *
 * Only the review copy deploys this file: marker/build.mjs copies it to api/marker.js at build
 * time. The real app never runs that build, so it has no /api/marker.
 *
 * Every comment is a GitHub issue on the App repo with the label "marker". The issue body holds
 * a readable summary plus a hidden JSON block (what was clicked, the page, the screen size), so
 * Claude can find the element and fix it. Closing the issue as completed marks the pin done;
 * closing it as "not planned" removes it from the page.
 *
 * Anyone with the link can comment. There is no sign-in, so:
 *  - a new comment gets a random edit key that only that browser keeps; editing or deleting needs it;
 *  - text is capped and each IP may post 12 comments per 10 minutes (per warm instance);
 *  - the GitHub token stays here (env GITHUB_TOKEN, issues read/write on the App repo).
 *
 * GET              { notes:[...] }
 * POST   {kind,what,why,fix,name,page,target}          201 { note, key }
 * PATCH  ?n=12  header x-edit-key  {kind,what,why,fix,target}   200 { note }
 * DELETE ?n=12  header x-edit-key                                200 { ok:true }
 */
import crypto from "node:crypto";

const REPO = process.env.MARKER_REPO || "fremontasbtech-sudo/App";
const LABEL = "marker";
const KINDS = ["edit", "bug", "keep"];
const KIND_NAME = { edit: "Edit", bug: "Bug", keep: "Keep" };
const MAX_TEXT = 2000;
const POSTS_PER_WINDOW = 12;
const WINDOW_MS = 10 * 60 * 1000;
const posts = new Map();
let cache = { at: 0, notes: null };

const META_RE = /<!-- marker-meta\n([\s\S]*?)\n-->/;

function ip(req) {
  const h = req.headers || {};
  return String(h["x-vercel-forwarded-for"] || h["x-forwarded-for"] || h["x-real-ip"] || "unknown").split(",")[0].trim();
}
function limited(addr) {
  const now = Date.now();
  const list = (posts.get(addr) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= POSTS_PER_WINDOW) { posts.set(addr, list); return true; }
  list.push(now); posts.set(addr, list);
  return false;
}
const clip = (s, n = MAX_TEXT) => String(s == null ? "" : s).slice(0, n).trim();
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

async function gh(path, opts = {}) {
  const r = await fetch("https://api.github.com/repos/" + REPO + path, {
    ...opts,
    headers: {
      Authorization: "Bearer " + process.env.GITHUB_TOKEN,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "firebird-hub-review",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!r.ok) { const e = new Error("github " + r.status); e.status = r.status; throw e; }
  return r.status === 204 ? null : r.json();
}

// Only the parts of the clicked element Claude needs; the browser sends more than that.
function cleanTarget(t) {
  if (!t || typeof t !== "object") return {};
  const out = {
    selector: clip(t.selector, 600), label: clip(t.label, 120), text: clip(t.text, 200), html: clip(t.html, 1000),
  };
  if (t.rect) out.rect = { x: +t.rect.x || 0, y: +t.rect.y || 0, w: +t.rect.w || 0, h: +t.rect.h || 0 };
  if (t.region) out.region = { x: +t.region.x || 0, y: +t.region.y || 0, w: +t.region.w || 0, h: +t.region.h || 0 };
  if (t.styles && typeof t.styles === "object") out.styles = Object.fromEntries(Object.entries(t.styles).slice(0, 30).map(([k, v]) => [clip(k, 40), clip(v, 160)]));
  if (Array.isArray(t.rules)) out.rules = t.rules.slice(-14).map((r) => ({ file: clip(r.file, 80), selector: clip(r.selector, 200), ...(r.media ? { media: clip(r.media, 120) } : {}) }));
  return out;
}
function cleanPage(p) {
  if (!p || typeof p !== "object") return {};
  return {
    route: clip(p.route, 80) || "#/", url: clip(p.url, 300),
    viewport: p.viewport ? { w: +p.viewport.w || 0, h: +p.viewport.h || 0 } : undefined,
    scrollY: +p.scrollY || 0, dpr: +p.dpr || 1, ua: clip(p.ua, 200),
  };
}

function render(meta) {
  const t = meta.target || {}, p = meta.page || {};
  const lines = [
    `**${KIND_NAME[meta.kind] || "Edit"}** on \`${p.route || "#/"}\`${p.viewport ? ` (screen ${p.viewport.w}×${p.viewport.h})` : ""}${meta.name ? ` from ${meta.name}` : ""}`,
    "",
    meta.what && `**What:** ${meta.what}`,
    meta.why && `**Details:** ${meta.why}`,
    meta.fix && `**How it should be:** ${meta.fix}`,
    "",
    `Element: \`${t.selector || "?"}\`${t.text ? ` "${t.text.slice(0, 90)}"` : ""}`,
    "",
    "Left on the Firebird Hub review copy. Claude reads the block below to find the element.",
    "",
    "<!-- marker-meta\n" + JSON.stringify(meta).replace(/-->/g, "--\\>") + "\n-->",
  ];
  return lines.filter((l) => typeof l === "string").join("\n");
}
function title(meta) {
  const s = (meta.what || meta.why || meta.fix || "comment").replace(/\s+/g, " ");
  return `[${KIND_NAME[meta.kind] || "Edit"}] ${s.length > 70 ? s.slice(0, 70) + "…" : s}`;
}
function parse(issue) {
  const m = (issue.body || "").match(META_RE);
  if (!m) return null;
  let meta; try { meta = JSON.parse(m[1].replace(/--\\>/g, "-->")); } catch { return null; }
  return { issue, meta };
}
function toNote({ issue, meta }) {
  return {
    n: issue.number, created: issue.created_at, updated: issue.updated_at,
    status: issue.state === "closed" ? "done" : "open",
    kind: meta.kind, what: meta.what || "", why: meta.why || "", fix: meta.fix || "", name: meta.name || "",
    reply: meta.reply || "", page: meta.page || {}, target: meta.target || {},
  };
}

async function listNotes(fresh) {
  if (!fresh && cache.notes && Date.now() - cache.at < 15000) return cache.notes;
  const out = [];
  for (let page = 1; page <= 5; page++) {
    const batch = await gh(`/issues?labels=${LABEL}&state=all&per_page=100&page=${page}&sort=created&direction=asc`);
    for (const issue of batch) {
      if (issue.pull_request || issue.state_reason === "not_planned") continue;
      const p = parse(issue); if (p) out.push(toNote(p));
    }
    if (batch.length < 100) break;
  }
  cache = { at: Date.now(), notes: out };
  return out;
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  return {};
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const send = (code, body) => res.status(code).json(body);
  if (!process.env.GITHUB_TOKEN) return send(503, { error: "not-set-up" });
  const n = Number((req.query && req.query.n) || 0);
  try {
    if (req.method === "GET") return send(200, { notes: await listNotes(req.query && req.query.fresh) });

    const body = await readBody(req).catch(() => null);
    if (body === null) return send(400, { error: "bad-json" });

    if (req.method === "POST" && !n) {
      if (limited(ip(req))) return send(429, { error: "slow-down" });
      const meta = {
        kind: KINDS.includes(body.kind) ? body.kind : "edit",
        what: clip(body.what), why: clip(body.why), fix: clip(body.fix), name: clip(body.name, 60),
        page: cleanPage(body.page), target: cleanTarget(body.target), reply: "",
      };
      if (!meta.what && !meta.why && !meta.fix) return send(400, { error: "empty" });
      const key = crypto.randomBytes(18).toString("base64url");
      meta.keyHash = sha(key);
      const issue = await gh("/issues", { method: "POST", body: JSON.stringify({ title: title(meta), body: render(meta), labels: [LABEL] }) });
      const note = toNote({ issue, meta });
      if (cache.notes) cache.notes = [...cache.notes.filter((x) => x.n !== note.n), note];
      return send(201, { note, key });
    }

    if (n && (req.method === "PATCH" || req.method === "DELETE")) {
      const p = parse(await gh("/issues/" + n));
      if (!p || !(p.issue.labels || []).some((l) => l.name === LABEL)) return send(404, { error: "no-such-note" });
      const key = req.headers["x-edit-key"];
      if (!key || sha(key) !== p.meta.keyHash) return send(403, { error: "not-yours" });
      cache.at = 0;
      if (req.method === "DELETE") {
        await gh("/issues/" + n, { method: "PATCH", body: JSON.stringify({ state: "closed", state_reason: "not_planned" }) });
        return send(200, { ok: true });
      }
      const meta = { ...p.meta };
      if (KINDS.includes(body.kind)) meta.kind = body.kind;
      for (const k of ["what", "why", "fix"]) if (k in body) meta[k] = clip(body[k]);
      if (body.target) meta.target = cleanTarget(body.target);
      const issue = await gh("/issues/" + n, { method: "PATCH", body: JSON.stringify({ title: title(meta), body: render(meta) }) });
      return send(200, { note: toNote({ issue, meta }) });
    }
    return send(405, { error: "method" });
  } catch (e) {
    return send(e.status === 404 ? 404 : 502, { error: "github" });
  }
}
