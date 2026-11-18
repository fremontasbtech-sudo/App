/**
 * Loads GEMINI_API_KEY from App/.env (gitignored) into process.env, if it is there.
 * The value is never printed, logged or written anywhere. Returns true when a key is set.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { APP_DIR } from "./instrument.mjs";

export function loadGeminiKey(){
  if(process.env.GEMINI_API_KEY) return true;
  let text = "";
  try{ text = readFileSync(path.join(APP_DIR, ".env"), "utf8"); }catch(e){ return false; }
  for(const line of text.split(/\r?\n/)){
    const m = line.match(/^\s*(?:export\s+)?GEMINI_API_KEY\s*=\s*(.*)\s*$/);
    if(!m) continue;
    const v = m[1].replace(/^["']|["']$/g, "").trim();
    if(v){ process.env.GEMINI_API_KEY = v; return true; }
  }
  return false;
}
