#!/usr/bin/env node
/**
 * Local dev server for Firebird Hub: serves FirebirdHub/ as static files and mounts
 * FirebirdHub/api/*.js Vercel-style (req.query, parsed JSON req.body, res.status().json()/send()).
 *
 *   node dev-server.mjs [port]                      # default 8787
 *   FELIPE_MOCK=1 node dev-server.mjs 8787          # Gemini replaced by a fake streamed answer
 *   FELIPE_FIXTURES=1 ...                           # fremontasb.org/api/* served from ./fixtures
 *   node dev-server.mjs 8788 --api-file ask=/abs/path/ask.js   # mount another copy (the baseline)
 *   node dev-server.mjs 8787 --root /abs/FirebirdHub            # serve another static root
 *
 * GEMINI_API_KEY is loaded from App/.env when present (never printed). Without a key and
 * without FELIPE_MOCK=1, /api/ask behaves like production with no key (its "not set up" reply).
 *
 * Eval hooks (local only):
 *   - "x-eval-id: <id>" on a request collects its timings, Gemini payload size and source fetches.
 *     GET /__felipe/metrics?id=<id> returns that record; GET /__felipe/global returns fetches made
 *     outside any request (background refreshes); GET /__felipe/health says mock/fixtures/key.
 *   - "x-felipe-now: <ISO time>" makes new Date() inside the handler return that moment
 *     (per request; Date.now() stays real so rate limits and cache TTLs still work).
 * Each server process is one "warm instance": restart it to measure a cold start.
 */
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { install, als, newRecord, getRecord, globalLog, clockOffsetFor, MOCK, USE_FIXTURES, MOCK_CFG, APP_DIR } from "./lib/instrument.mjs";
import { loadGeminiKey } from "./lib/env.mjs";
import { adaptNode } from "./lib/vercel.mjs";

const args = process.argv.slice(2);
const port = Number(args.find(a => /^\d+$/.test(a))) || 8787;
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const ROOT = path.resolve(opt("--root") || path.join(APP_DIR, "FirebirdHub"));
const API_DIR = path.join(ROOT, "api");
const overrides = {};
args.forEach((a, i) => { if(a === "--api-file" && args[i + 1]){ const [k, v] = args[i + 1].split("="); overrides[k] = path.resolve(v); } });

const hasKey = loadGeminiKey();
install();

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain" };

const handlers = new Map();
async function loadHandler(name){
  if(handlers.has(name)) return handlers.get(name);
  const file = overrides[name] || path.join(API_DIR, name + ".js");
  if(!/^[a-z0-9_-]+$/i.test(name)) return null;
  try{ await stat(file); }catch(e){ return null; }
  const t = performance.now();
  const mod = await import(pathToFileURL(file).href);
  const h = mod.default || mod.handler;
  const entry = { fn: h, file, importMs: Math.round(performance.now() - t) };
  handlers.set(name, entry);
  return entry;
}

async function serveStatic(req, res, pathname){
  let rel = decodeURIComponent(pathname);
  if(rel.endsWith("/")) rel += "index.html";
  const file = path.resolve(ROOT, "." + rel);
  if(!file.startsWith(ROOT + path.sep) && file !== ROOT){ res.statusCode = 403; res.end("forbidden"); return; }
  if(file.startsWith(API_DIR + path.sep)){ res.statusCode = 404; res.end("not found"); return; }   // never serve handler source
  try{
    const s = await stat(file);
    if(s.isDirectory()){ res.statusCode = 302; res.setHeader("Location", pathname.replace(/\/?$/, "/")); res.end(); return; }
    res.setHeader("Content-Type", TYPES[path.extname(file).toLowerCase()] || "application/octet-stream");
    res.setHeader("Cache-Control", "max-age=0, must-revalidate");
    res.end(await readFile(file));
  }catch(e){ res.statusCode = 404; res.end("not found"); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if(url.pathname === "/__felipe/health"){
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, mock: MOCK, fixtures: USE_FIXTURES, geminiKey: hasKey, mockCfg: MOCK ? MOCK_CFG : null, root: ROOT, overrides, loaded: [...handlers].map(([k, v]) => ({ name: k, file: v.file, importMs: v.importMs })) }));
    return;
  }
  if(url.pathname === "/__felipe/metrics"){
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(getRecord(url.searchParams.get("id") || "") || null));
    return;
  }
  if(url.pathname === "/__felipe/global"){
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(globalLog.slice(-200)));
    return;
  }
  const m = url.pathname.match(/^\/api\/([a-z0-9_-]+)\/?$/i);
  if(!m){ await serveStatic(req, res, url.pathname); return; }
  const h = await loadHandler(m[1]);
  if(!h || typeof h.fn !== "function"){ res.statusCode = 404; res.end("no such function"); return; }
  const evalId = String(req.headers["x-eval-id"] || "");
  const rec = evalId ? newRecord(evalId) : null;
  const store = { rec, clockOffset: clockOffsetFor(req.headers["x-felipe-now"]) };
  if(rec){
    { const rel = path.relative(APP_DIR, h.file); rec.handler = rel.startsWith("..") ? h.file : rel; }
    const ow = res.write.bind(res), oe = res.end.bind(res), wh = res.writeHead.bind(res);
    res.writeHead = (...a) => { if(rec.headersMs == null) rec.headersMs = Math.round(performance.now() - rec.t0); return wh(...a); };
    res.write = (c, ...a) => { if(rec.firstWriteMs == null && c != null && String(c).length) rec.firstWriteMs = Math.round(performance.now() - rec.t0); return ow(c, ...a); };
    res.end = (c, ...a) => {
      const ms = Math.round(performance.now() - rec.t0);
      if(rec.firstWriteMs == null && c != null && String(c).length) rec.firstWriteMs = ms;
      rec.endMs = ms; rec.status = res.statusCode;
      rec.headers = { route: res.getHeader("x-felipe-route") || null, promptChars: res.getHeader("x-felipe-prompt-chars") || null, contentType: res.getHeader("content-type") || null };
      return oe(c, ...a);
    };
  }
  await als.run(store, async () => {
    try{
      await adaptNode(req, res);
      if(rec) rec.bodyParsedMs = Math.round(performance.now() - rec.t0);
      await h.fn(req, res);
    }catch(e){
      console.error("handler error in /api/" + m[1] + ":", e && e.message);
      if(!res.headersSent){ res.statusCode = 500; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ error: "handler threw" })); }
      else if(!res.writableEnded) res.end();
    }
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Firebird Hub dev server on http://127.0.0.1:${port}  root=${path.relative(APP_DIR, ROOT) || ROOT}`);
  console.log(`  Gemini: ${MOCK ? "MOCK (no network calls to Gemini)" : hasKey ? "real (key loaded from .env)" : "no key (handler returns its not-set-up reply)"}; fremontasb.org: ${USE_FIXTURES ? "fixtures" : "live"}`);
  for(const k in overrides) console.log(`  /api/${k} -> ${overrides[k]}`);
});
