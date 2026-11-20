#!/usr/bin/env node
// Build step of the Vercel project "firebirdhub-review" ONLY (root directory FirebirdHub,
// build command `node ../marker/build.mjs`). It turns the checkout into the public review copy:
//   - copies the comment overlay to /marker-overlay.js and loads it on every page,
//   - adds /api/marker (comments saved as GitHub issues, see api-marker.js),
//   - marks the copy noindex and "Review copy" in the tab title,
//   - lets this copy's own address call /api/ask and /api/schoology.
// The real app (project "app") has no build command, so none of this reaches it.
import { promises as fs } from "node:fs";
import path from "node:path";

const APP = process.cwd(); // FirebirdHub/
const HERE = import.meta.dirname; // marker/

await fs.copyFile(path.join(HERE, "annotate.js"), path.join(APP, "marker-overlay.js"));
await fs.copyFile(path.join(HERE, "api-marker.js"), path.join(APP, "api", "marker.js"));

const v = (process.env.VERCEL_GIT_COMMIT_SHA || String(Date.now())).slice(0, 8);
for (const page of ["index.html", "teacher.html"]) {
  const file = path.join(APP, page);
  let html = await fs.readFile(file, "utf8").catch(() => null);
  if (!html) continue;
  html = html
    .replace(/<title>/i, '<meta name="robots" content="noindex, nofollow">\n<title>Review copy · ')
    .replace(/<\/body>/i, `<script src="/marker-overlay.js?v=${v}" defer></script>\n</body>`);
  await fs.writeFile(file, html);
}

// The functions only answer the app's own origins; add this copy's addresses.
const origins = [process.env.MARKER_ORIGIN, process.env.VERCEL_PROJECT_PRODUCTION_URL && "https://" + process.env.VERCEL_PROJECT_PRODUCTION_URL,
  process.env.VERCEL_URL && "https://" + process.env.VERCEL_URL].filter(Boolean);
for (const fn of ["ask.js", "schoology.js"]) {
  const file = path.join(APP, "api", fn);
  const js = await fs.readFile(file, "utf8").catch(() => null);
  if (!js || !origins.length) continue;
  await fs.writeFile(file, js.replace(/const ALLOWED_ORIGINS = \[/, `const ALLOWED_ORIGINS = [${origins.map((o) => JSON.stringify(o)).join(", ")}, `));
}
console.log(`[marker] review copy built (overlay v${v}; origins: ${origins.join(", ") || "none"})`);
