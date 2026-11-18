/**
 * Ask Felipe: Gemini calls, streaming (SSE) and plain, with the retry rules in
 * App/CLAUDE.md section 5 (all learned the hard way):
 *  - thinkingLevel "low" for speed; NEVER thinkingBudget 0 (it returns empty answers).
 *  - maxOutputTokens 2048; thought parts are filtered out; partial text is kept.
 *  - Empty answer on the first call: retry once without thinkingConfig.
 *  - 429, 5xx or a fast network error: wait 700 ms, retry once with the last config Gemini
 *    accepted, then once on the lighter model without thinkingConfig. Only while under 12 s,
 *    at most 3 calls, and a config that got a 400 is never resent. A timeout is not retried.
 *  - Streaming adds one rule: once any text has reached the student, never retry (the
 *    student would see the answer twice); a broken stream keeps the text it already sent.
 * The key is sent only in the x-goog-api-key header and is never logged.
 */
export const MODEL = "gemini-3.6-flash";
export const FALLBACK_MODEL = "gemini-flash-lite-latest";
const BASE = "https://generativelanguage.googleapis.com/v1beta/models/";
export const GEMINI_TIMEOUT_MS = 12000;   // until the first text (or the whole answer, non-streaming)
const STREAM_IDLE_MS = 10000;            // between chunks once text is flowing
const STREAM_TOTAL_MS = 30000;           // a whole streamed answer
const RETRY_WINDOW_MS = 12000, RETRY_BACKOFF_MS = 700, MAX_CALLS = 3;

const SAFETY = [
  {category:"HARM_CATEGORY_HARASSMENT", threshold:"BLOCK_MEDIUM_AND_ABOVE"},
  {category:"HARM_CATEGORY_HATE_SPEECH", threshold:"BLOCK_MEDIUM_AND_ABOVE"},
  {category:"HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold:"BLOCK_MEDIUM_AND_ABOVE"},
  {category:"HARM_CATEGORY_DANGEROUS_CONTENT", threshold:"BLOCK_MEDIUM_AND_ABOVE"}
];

/* House copy rule: no em dashes anywhere Felipe speaks. */
export function noEmDash(s){
  return String(s||"").replace(/^[ \t]*\u2014[ \t]*/gm,"").replace(/\s*\u2014\s*/g,", ").replace(/,\s*([.,!?;:])/g,"$1");
}
/* The same rule for a stream: a chunk can end in the middle of " \u2014 ", so trailing
   whitespace and dashes are held back until the next chunk shows what follows them. */
export function dashFilter(){
  let pending = "", started = false;
  const run = seg=>{ const out = started ? noEmDash("x"+seg).slice(1) : noEmDash(seg); if(seg) started = true; return out; };
  return {
    push(chunk){
      const s = pending + chunk, m = s.match(/[\s\u2014,]*$/), k = s.length - m[0].length;
      pending = s.slice(k);
      return k ? run(s.slice(0,k)) : "";
    },
    end(){ const s = pending; pending = ""; return s ? run(s).replace(/[,\s]+$/,"") : ""; }
  };
}

const partsText = data=>{
  try{ return (data.candidates[0].content.parts||[]).filter(p=>!p.thought).map(p=>p.text||"").join(""); }catch(e){ return ""; }
};

/* One call. Returns { text, ok, status, retry, emitted }.
   retry: Gemini answered (200 or 400), so a different config may help.
   With onDelta, the call streams and hands each new piece of text to onDelta. */
async function callOnce({ key, model, system, contents, useThinking, temperature, onDelta, signal }){
  const generationConfig = { temperature, maxOutputTokens:2048 };
  if(useThinking) generationConfig.thinkingConfig = { thinkingLevel:"low" };
  const body = JSON.stringify({ systemInstruction:{ parts:[{ text:system }] }, contents, generationConfig, safetySettings:SAFETY });
  const url = BASE + model + (onDelta ? ":streamGenerateContent?alt=sse" : ":generateContent");
  const ctrl = new AbortController();
  // The student closing the chat (signal) stops the call too, so no tokens are spent on nobody.
  const stop = ()=> ctrl.abort();
  if(signal){ if(signal.aborted) stop(); else signal.addEventListener("abort", stop, { once:true }); }
  let timer = setTimeout(()=> ctrl.abort(), GEMINI_TIMEOUT_MS);
  const total = onDelta ? setTimeout(()=> ctrl.abort(), STREAM_TOTAL_MS) : null;
  let text = "", emitted = false;
  try{
    const r = await fetch(url, { method:"POST", headers:{ "Content-Type":"application/json", "x-goog-api-key":key }, body, signal:ctrl.signal });
    if(!r.ok){
      await r.text().catch(()=>"");   // drain; the body can echo the request, so it is never logged
      return { text:"", ok:false, status:r.status, retry:r.status===400, emitted:false };
    }
    if(!onDelta){
      const data = await r.json().catch(()=> ({}));
      return { text:partsText(data).trim(), ok:true, status:200, retry:true, emitted:false };
    }
    // Server-sent events: "data: {GenerateContentResponse}" blocks separated by blank lines.
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = "", status = 200;
    const handle = block=>{
      const json = block.split(/\r?\n/).filter(l=> l.startsWith("data:")).map(l=> l.slice(5).trim()).join("");
      if(!json || json === "[DONE]") return;
      let data; try{ data = JSON.parse(json); }catch(e){ return; }
      if(data.error){ status = Number(data.error.code) || 500; return; }
      const piece = partsText(data);
      if(piece){ text += piece; emitted = true; onDelta(piece); }
    };
    for(;;){
      const { value, done } = await reader.read();
      if(done) break;
      clearTimeout(timer); timer = setTimeout(()=> ctrl.abort(), emitted ? STREAM_IDLE_MS : GEMINI_TIMEOUT_MS);
      buf += dec.decode(value, { stream:true });
      let i;
      while((i = buf.search(/\r?\n\r?\n/)) >= 0){
        const m = buf.slice(i).match(/^\r?\n\r?\n/);
        handle(buf.slice(0,i)); buf = buf.slice(i + m[0].length);
      }
    }
    buf += dec.decode();
    if(buf.trim()) handle(buf);
    if(status !== 200 && !text) return { text:"", ok:false, status, retry:false, emitted:false };
    return { text:text.trim(), ok:true, status:200, retry:true, emitted };
  }catch(e){
    // Timeout or network failure. Text already streamed is kept (status 0 = transient).
    return { text:text.trim(), ok:false, status:0, retry:false, emitted, aborted:ctrl.signal.aborted };
  }finally{ clearTimeout(timer); if(total) clearTimeout(total); if(signal) signal.removeEventListener("abort", stop); }
}

const sleep = ms=> new Promise(r=> setTimeout(r, ms));
const transient = st=> st===429 || st>=500 || st===0;

/* Ask Gemini with the retry rules above. Returns { text, ok, status, calls, model, emitted }. */
export async function askGemini({ key, system, contents, temperature = 0.3, onDelta, signal }){
  const started = Date.now(), fresh = ()=> Date.now()-started < RETRY_WINDOW_MS;
  const call = (useThinking, model)=> callOnce({ key, model:model||MODEL, system, contents, useThinking, temperature, onDelta, signal });
  let calls = 1, thinking = true, model = MODEL;
  let out = await call(true);
  if(!out.text && !out.emitted && out.retry){ thinking = false; calls++; out = await call(false); }
  if(!out.text && !out.emitted && transient(out.status) && fresh() && !out.aborted && !(signal && signal.aborted)){
    console.warn("ask: Gemini HTTP "+out.status+", retrying");
    await sleep(RETRY_BACKOFF_MS);
    if(calls < 2){ calls++; out = await call(thinking); }
    if(!out.text && !out.emitted && transient(out.status) && fresh() && calls < MAX_CALLS && !out.aborted){ calls++; model = FALLBACK_MODEL; out = await call(false, FALLBACK_MODEL); }
  }
  if(!out.text && !out.ok) console.warn("ask: Gemini HTTP "+out.status);
  return { ...out, calls, model };
}
