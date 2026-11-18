/**
 * Vercel-style req/res for Node handlers ("export default function handler(req, res)").
 *
 * adaptNode(req, res): augments a real node:http pair (dev-server.mjs):
 *   req.query, req.body (parsed JSON when the content type says JSON, else the raw string),
 *   res.status(code) (chainable), res.json(obj), res.send(body). setHeader/write/end are Node's own.
 *
 * fakePair({ method, headers, body }): an in-process pair for run.mjs --inproc. It records
 *   status, headers, every chunk with its arrival time, and when the response ended.
 */
import { EventEmitter } from "node:events";

export async function readBody(req, limit = 1e6){
  const chunks = []; let size = 0;
  for await (const c of req){ size += c.length; if(size > limit) throw new Error("body too large"); chunks.push(c); }
  return Buffer.concat(chunks).toString("utf8");
}

export async function adaptNode(req, res){
  const url = new URL(req.url, "http://localhost");
  req.query = Object.fromEntries(url.searchParams);
  const raw = (req.method === "GET" || req.method === "HEAD") ? "" : await readBody(req);
  const ct = String(req.headers["content-type"] || "");
  if(raw && /json/i.test(ct)){ try{ req.body = JSON.parse(raw); }catch(e){ req.body = raw; } }
  else req.body = raw || undefined;
  req.cookies = {};
  res.status = function(code){ this.statusCode = code; return this; };
  res.json = function(obj){
    if(!this.getHeader("Content-Type")) this.setHeader("Content-Type", "application/json; charset=utf-8");
    this.end(JSON.stringify(obj));
    return this;
  };
  res.send = function(body){
    if(body !== null && typeof body === "object" && !Buffer.isBuffer(body)) return this.json(body);
    if(!this.getHeader("Content-Type")) this.setHeader("Content-Type", "text/html; charset=utf-8");
    this.end(body == null ? "" : body);
    return this;
  };
  return { req, res };
}

export function fakePair({ method = "POST", headers = {}, body } = {}){
  const t0 = performance.now();
  const req = new EventEmitter();
  Object.assign(req, { method, url: "/api/ask", headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
    body, query: {}, cookies: {}, socket: { remoteAddress: headers["x-vercel-forwarded-for"] || "127.0.0.1" } });
  const res = new EventEmitter();
  const out = { status: 200, headers: {}, chunks: [], firstByteMs: null, endMs: null };
  let resolveDone; const done = new Promise(r => { resolveDone = r; });
  const mark = (c) => {
    if(c == null || c === "") return;
    const s = Buffer.isBuffer(c) ? c.toString("utf8") : String(c);
    const ms = performance.now() - t0;
    if(out.firstByteMs == null) out.firstByteMs = ms;
    out.chunks.push({ ms, s });
  };
  Object.assign(res, {
    statusCode: 200, headersSent: false, writableEnded: false,
    status(code){ this.statusCode = code; return this; },
    setHeader(k, v){ out.headers[String(k).toLowerCase()] = v; return this; },
    getHeader(k){ return out.headers[String(k).toLowerCase()]; },
    removeHeader(k){ delete out.headers[String(k).toLowerCase()]; },
    writeHead(code, h){ this.statusCode = code; if(h && typeof h === "object") for(const k in h) this.setHeader(k, h[k]); this.headersSent = true; return this; },
    flushHeaders(){ this.headersSent = true; },
    write(c){ this.headersSent = true; mark(c); return true; },
    end(c){ if(this.writableEnded) return this; mark(c); this.writableEnded = true; out.status = this.statusCode; out.endMs = performance.now() - t0; this.emit("finish"); this.emit("close"); resolveDone(out); return this; },
    json(obj){ if(!this.getHeader("content-type")) this.setHeader("Content-Type", "application/json; charset=utf-8"); return this.end(JSON.stringify(obj)); },
    send(b){ if(b !== null && typeof b === "object" && !Buffer.isBuffer(b)) return this.json(b); return this.end(b == null ? "" : b); }
  });
  out.text = () => out.chunks.map(c => c.s).join("");
  return { req, res, out, done, t0 };
}
