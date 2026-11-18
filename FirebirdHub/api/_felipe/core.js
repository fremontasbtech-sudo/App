/**
 * Ask Felipe: the shared classifier (FirebirdHub/felipe-core.js, the same file the app loads
 * in the browser), wrapped so the server never fails because of it. If the classifier
 * throws or answers something unexpected, the question goes to Gemini ("llm"), which has
 * its own rules for off-topic and safety questions.
 */
import FelipeCoreDefault from "../../felipe-core.js";

const Core = (FelipeCoreDefault && FelipeCoreDefault.classify) ? FelipeCoreDefault
  : (FelipeCoreDefault && FelipeCoreDefault.default) || FelipeCoreDefault || {};

const ROUTES = new Set(["local","llm","cannot","crisis"]);

// Last-resort replies, used only if felipe-core.js doesn't return one.
const BACKUP = {
  cannot: { en:"Sorry, I can't help with that one. I can help with school life at Fremont, like the schedule, events, sports, clubs, your assignments or study tips.",
            es:"Lo siento, no puedo ayudar con eso. Puedo ayudarte con la vida escolar en Fremont, como el horario, los eventos, los deportes, los clubes, tus tareas o consejos para estudiar." },
  crisis: { en:"I'm really sorry you're going through this. Please reach out to a trusted adult right now. You can call or text 988 any time to reach the Suicide and Crisis Lifeline, or text HOME to 741741. The school counselors are here for you too.",
            es:"Siento mucho que estés pasando por esto. Por favor, habla ahora con un adulto de confianza. Puedes llamar o enviar un mensaje de texto al 988 en cualquier momento, o enviar HOME al 741741. Los consejeros de la escuela también están aquí para ti." }
};

export function classify(question, ctx){
  const t = Date.now();
  try{
    const r = Core.classify(question, ctx);
    if(r && ROUTES.has(r.route)) return { route:r.route, intent:String(r.intent||""), reason:r.reason ? String(r.reason) : "", ms: typeof r.ms === "number" ? r.ms : Date.now()-t,
      lang: r.lang === "es" ? "es" : "", resolved: typeof r.resolved === "string" ? r.resolved.slice(0, 1200) : "" };
  }catch(e){ /* fall through */ }
  return { route:"llm", intent:"", reason:"", ms:Date.now()-t, lang:"", resolved:"", failed:true };
}
// The data sections FelipeCore says an intent needs (INTENT_SECTIONS), or [] if unknown.
export function intentSections(intent){
  try{ const m = Core.INTENT_SECTIONS && Core.INTENT_SECTIONS[intent]; return Array.isArray(m) ? m.map(String) : []; }catch(e){ return []; }
}
const textOf = r=> typeof r === "string" ? r : (r && typeof r.text === "string" ? r.text : "");
export function cannotReply(reason, lang){
  try{ const s = textOf(Core.cannotReply(reason, lang)).trim(); if(s) return s; }catch(e){}
  return BACKUP.cannot[lang==="es"?"es":"en"];
}
export function crisisReply(lang, reason){
  try{ const s = textOf(Core.crisisReply(lang, reason)).trim(); if(s) return s; }catch(e){}
  return BACKUP.crisis[lang==="es"?"es":"en"];
}
