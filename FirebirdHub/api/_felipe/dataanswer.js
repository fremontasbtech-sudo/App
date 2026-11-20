/**
 * Ask Felipe without AI: short, plain answers built straight from the live data, for when every
 * AI provider is out of quota or failing, or the daily budget (FELIPE_DAILY_CAP) is used up.
 * A student asking about events, games, clubs, announcements, spirit, the schedule or their own
 * Schoology items still gets the facts; only truly generative requests (write an email, explain
 * a concept) get a polite "please try again later"; any other question the data can't answer
 * gets a plain "I can't answer that one right now".
 *
 * Answers end with one line saying fuller answers are back soon, unless the caller shows that
 * note itself (note:false; the app since 2026-11-18). English and Spanish.
 * Nothing here calls the network: it reads the data context.js already parsed.
 */
import { helpers, matchingAnnouncements, withEnglish } from "./context.js";
import { BELL_SCHEDULE, NO_CLASSES, SPECIAL_DAYS, FIRST_DAY, LAST_DAY, TZ, addDays, weekday, isoDate, dayInfo } from "./calendar.js";
import FelipeCoreDefault from "../../felipe-core.js";

const Core = (FelipeCoreDefault && FelipeCoreDefault.answerLocal) ? FelipeCoreDefault
  : (FelipeCoreDefault && FelipeCoreDefault.default) || FelipeCoreDefault || {};
const { sportFilter, isPlayed, byWhen, words, EV_STOP, revealed } = helpers;
// "coding" and "code", "robotics" and "robot": a light stem so word forms still match.
const stem = w=> w.length > 3 ? w.replace(/(ings?|ers?|ies|es|ed|s|e)$/, "") : w;
// Results carry strong:true when the data really matched the question (a named club, event,
// game or announcement), so general questions only get an answer when one exists.
const R = (text, strong, cov)=> text ? { text, strong: !!strong, cov: cov || 0 } : null;
// How much of the question's own words a piece of data covers (0 to 1), to choose between an
// event and an announcement that both match ("color guard auditions": the audition notice).
const keyWords = text=> [...new Set(words(text).filter(w=> w.length >= 4 && !EV_STOP.has(w) && !EV_GENERIC.has(w)).map(stem))];
function coverage(text, hay){ const k = keyWords(text); if(!k.length) return 0; const h = new Set(words(hay).map(stem)); return k.filter(w=> h.has(w)).length / k.length; }
const ARTS_RE = /\b(band|marching|orchestra|choir|choral|theat(er|re)|drama|color guard|winter guard|percussion|musical|concert|recital|banda|orquesta|coro|teatro)\b/;

export const BACK_SOON = {
  en: "I'm answering straight from the school's data right now. Fuller answers will be back soon.",
  es: "Por ahora respondo directamente con los datos de la escuela. Las respuestas completas volverán pronto."
};
export const CANT_WRITE = {
  en: "I can't write that right now. Please try again in a little while. In the meantime, I can still answer questions about the schedule, events, sports, clubs and announcements.",
  es: "No puedo escribir eso en este momento. Inténtalo de nuevo en un rato, por favor. Mientras tanto, todavía puedo responder preguntas sobre el horario, los eventos, los deportes, los clubes y los anuncios."
};
// For a question (not a writing request) the data has no answer to.
export const CANT_ANSWER = {
  en: "I can't answer that one right now. Please try again in a little while. In the meantime, I can still answer questions about the schedule, events, sports, clubs and announcements.",
  es: "No puedo responder esa pregunta en este momento. Inténtalo de nuevo en un rato, por favor. Mientras tanto, todavía puedo responder preguntas sobre el horario, los eventos, los deportes, los clubes y los anuncios."
};

/* ---------- dates in words ---------- */
const fmtDate = (iso, lang)=> new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" })
  .format(new Date(iso + "T12:00:00Z"));
const cap = s=> s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const L = (lang, en, es)=> lang === "es" ? es : en;
const clipTo = (s, n)=>{ s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "..." : s; };
const dot = s=> /[.!?]$/.test(s) ? s : s + ".";

/* ---------- "today", "this weekend", "next week", "this month", "December" ---------- */
const MONTH_EN = ["january","february","march","april","may","june","july","august","september","october","november","december"];
const MONTH_ES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const lastOfMonth = (y, m)=> y + "-" + String(m).padStart(2, "0") + "-" + String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0");
// A whole month: from today (this month) or its first day, to its last day. A month name with no
// day number; "may" only when it reads as the month ("in may", "en mayo").
function monthWindow(n, today){
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const mk = (yy, mm, from)=>{ const i = mm - 1; return { from: from || (yy + "-" + String(mm).padStart(2, "0") + "-01"), to: lastOfMonth(yy, mm), en: "in " + cap(MONTH_EN[i]), es: "en " + MONTH_ES[i] }; };
  if(/\b(this month|este mes)\b/.test(n)) return { ...mk(y, m, today), en: "this month", es: "este mes" };
  if(/\b(next month|proximo mes|el mes que viene|mes que viene)\b/.test(n)){ const nm = m % 12 + 1, ny = m === 12 ? y + 1 : y; return { ...mk(ny, nm), en: "next month", es: "el próximo mes" }; }
  for(let i = 0; i < 12; i++){
    const re = i === 4 ? /\b(in|during|en|de|this|next|late|early) may\b|\bmayo\b/ : new RegExp("\\b(" + MONTH_EN[i] + "|" + MONTH_ES[i] + (MONTH_EN[i].length > 4 ? "|" + MONTH_EN[i].slice(0, 3) : "") + ")\\b(?!\\s*\\d)");
    if(!re.test(n) || new RegExp("\\b(" + MONTH_EN[i] + "|" + MONTH_ES[i] + ")\\s+\\d|\\d+\\s+de\\s+" + MONTH_ES[i]).test(n)) continue;
    const mm = i + 1, yy = (mm < m && (m - mm) > 2) || (mm < 8 && m >= 8) ? y + 1 : y;
    if(yy === y && mm === m) return { ...mk(y, m, today) };
    return mk(yy, mm);
  }
  return null;
}
function windowOf(n, today){
  const wd = weekday(today);
  if(/\b(tonight|today|hoy|esta noche)\b/.test(n)) return { from: today, to: today, en: "today", es: "hoy" };
  if(/\b(tomorrow|manana)\b/.test(n)) return { from: addDays(today, 1), to: addDays(today, 1), en: "tomorrow", es: "mañana" };
  if(/\b(this weekend|weekend|fin de semana)\b/.test(n)){ const sat = addDays(today, (6 - wd + 7) % 7); return { from: wd === 0 ? today : addDays(sat, -1), to: wd === 0 ? today : addDays(sat, 1), en: "this weekend", es: "este fin de semana" }; }
  if(/\b(next week|proxima semana|semana que viene)\b/.test(n)){ const mon = addDays(today, 8 - (wd || 7)); return { from: mon, to: addDays(mon, 6), en: "next week", es: "la próxima semana" }; }
  if(/\b(this week|esta semana)\b/.test(n)) return { from: today, to: addDays(today, 7 - (wd || 7)), en: "this week", es: "esta semana" };
  return monthWindow(n, today);
}
const normQ = s=> String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’'`]/g, "");

/* ---------- sports ---------- */
const LEVEL_RE = [[/\bvarsity\b(?!.*\bjv\b)/, /^varsity$/i], [/\b(jv|junior varsity)\b/, /^jv$/i], [/\b(frosh|freshman|fs|frosh soph)\b/, /frosh|fs/i]];
function matchupText(g, lang){
  if(/cross country|track|swim|dive/i.test(g.sport)) return L(lang, "meet", "competencia") + (g.opp ? ": " + g.opp : "");
  if(/wrestl/i.test(g.sport) && !/dual/i.test(g.type)) return L(lang, "tournament", "torneo") + (g.opp ? ": " + g.opp : "");
  if(/away/i.test(g.ha)) return L(lang, "away at ", "de visita en ") + (g.opp || L(lang, "an opponent to be announced", "un rival por anunciar"));
  if(/home/i.test(g.ha)) return L(lang, "home vs ", "en casa contra ") + (g.opp || L(lang, "an opponent to be announced", "un rival por anunciar"));
  return "vs " + (g.opp || L(lang, "an opponent to be announced", "un rival por anunciar"));
}
const teamName = g=> g.sport + (g.level && !/^all$/i.test(g.level) ? " " + g.level : "");
const sameWords = (a, b)=>{ const x = words(a).join(" "), y = words(b).join(" "); return !!x && !!y && (x.includes(y) || y.includes(x)); };
function gameText(g, lang){
  return teamName(g) + ": " + fmtDate(g.date, lang) + (g.time ? ", " + g.time : "") + ", " + matchupText(g, lang)
    + (g.loc && !sameWords(g.loc, g.opp) ? ", " + L(lang, "at ", "en ") + g.loc : "") + (g.bell ? L(lang, " (the Bell Game)", " (el Bell Game)") : "") + (g.senior ? L(lang, " (Senior Night)", " (Senior Night)") : "");
}
function sportsAnswer(games, now, text, lang){
  const n = normQ(text), f = sportFilter(text);
  let pool = games;
  if(f.pats.length){
    pool = pool.filter(g=> f.pats.some(p=> p.test(g.sport)));
    if(f.gender) pool = pool.filter(g=> !/^(boys|girls)\b/i.test(g.sport) || new RegExp("^" + f.gender, "i").test(g.sport));
  }
  for(const [q, lv] of LEVEL_RE) if(q.test(n)){ const p = pool.filter(g=> lv.test(g.level)); if(p.length) pool = p; break; }
  // An opponent the question names ("against Homestead").
  const qw = new Set(words(text).filter(w=> w.length >= 4 && !EV_STOP.has(w)));
  const vsOpp = pool.filter(g=> g.opp && words(g.opp).some(w=> qw.has(w)));
  if(vsOpp.length) pool = vsOpp;
  if(/\bbell game\b/.test(n)){
    // Only the Varsity row is the Bell Game itself; "JV score in the bell game" means the JV
    // game against the same school that week.
    const bells = games.filter(g=> g.bell), b = pool.filter(g=> g.bell);
    pool = b.length ? b : pool.filter(g=> bells.some(x=> x.opp === g.opp && Math.abs(Date.parse(x.date) - Date.parse(g.date)) <= 3 * 864e5));
  }
  if(/\bhome\b|\ben casa\b/.test(n)) { const p = pool.filter(g=> /home/i.test(g.ha)); if(p.length) pool = p; }
  if(!f.pats.length && ARTS_RE.test(n)) return null;   // "how did marching band do": not a sport
  if(!pool.length) return f.pats.length
    ? R(L(lang, "I don't see any games or meets for that sport on the schedule right now. The Sports tab has every team's full schedule.",
             "No veo partidos ni competencias de ese deporte en el calendario ahora mismo. La pestaña Deportes tiene el calendario completo de cada equipo."))
    : null;
  // Results.
  if(/\b(score|scores|result|results|won|win|lose|lost|beat|how did|how'?d|did .* do|did we|what happened|last (game|match|meet)|final|marcador|marcadores|resultados?|gano|ganaron|ganamos|perdio|perdieron|perdimos|(le|les) fue|que paso)\b/.test(n)){
    const played = pool.filter(g=> isPlayed(g, now) && g.score && g.date <= now.iso).sort((a, b)=> byWhen(b, a)).slice(0, 3);
    if(played.length) return R(L(lang, "Latest posted results:", "Últimos resultados publicados:") + "\n" + played.map(g=> "- " + teamName(g) + ", " + fmtDate(g.date, lang) + ", " + matchupText(g, lang) + (g.bell ? L(lang, " (the Bell Game)", " (el Bell Game)") : "") + ": " + g.score).join("\n")
      + "\n" + L(lang, "Scores are as posted by Fremont Athletics, with Fremont's score first.", "Los marcadores son los que publica Fremont Athletics, con el de Fremont primero."), f.pats.length || vsOpp.length);
    return f.pats.length ? R(L(lang, "I don't see a posted score for that yet. The Sports tab shows results as soon as athletics posts them.",
             "Todavía no veo un marcador publicado para eso. La pestaña Deportes muestra los resultados en cuanto atletismo los publica.")) : null;
  }
  // Senior nights.
  if(/\bsenior nights?\b/.test(n)){
    const s = pool.filter(g=> g.senior).sort(byWhen);
    if(s.length) return R(L(lang, "Senior Nights:", "Senior Nights:") + "\n" + s.slice(0, 6).map(g=> "- " + teamName(g) + ", " + fmtDate(g.date, lang) + (g.time ? ", " + g.time : "") + ", " + matchupText(g, lang) + (isPlayed(g, now) ? L(lang, " (already played" + (g.score ? ", " + g.score : "") + ")", " (ya se jugó" + (g.score ? ", " + g.score : "") + ")") : "")).join("\n"), true);
  }
  const upcoming = pool.filter(g=> !isPlayed(g, now)).sort(byWhen);
  if(!upcoming.length) return R(L(lang, "I don't see any more games or meets for that on the schedule right now. The Sports tab has the full schedule and results.",
                                     "No veo más partidos ni competencias de eso en el calendario ahora mismo. La pestaña Deportes tiene el calendario completo y los resultados."));
  const win = windowOf(n, now.iso);
  // One per team when a sport is named (every team or level gets its next game), else the next 3.
  const pickNext = list=>{ if(!f.pats.length) return list.slice(0, 3); const seen = new Set(), out = []; for(const g of list){ const k = (g.sport + "|" + g.level).toLowerCase(); if(seen.has(k)) continue; seen.add(k); out.push(g); if(out.length >= 4) break; } return out; };
  if(win){
    const inWin = upcoming.filter(g=> g.date >= win.from && g.date <= win.to);
    if(inWin.length) return R(cap(L(lang, win.en, win.es)) + ":\n" + inWin.slice(0, 5).map(g=> "- " + gameText(g, lang)).join("\n"), true);
    return R(L(lang, "I don't see any games " + win.en + ". Coming up next:", "No veo partidos " + win.es + ". Lo próximo:") + "\n" + pickNext(upcoming).slice(0, 2).map(g=> "- " + gameText(g, lang)).join("\n"), f.pats.length);
  }
  const next = pickNext(upcoming);
  return R(next.length === 1 ? L(lang, "Next up: ", "Lo próximo: ") + gameText(next[0], lang) + "."
    : L(lang, "Coming up:", "Lo próximo:") + "\n" + next.map(g=> "- " + gameText(g, lang)).join("\n"), f.pats.length || vsOpp.length);
}

/* ---------- events and the performing arts calendar ---------- */
const EV_SYN = { teatro: ["theater", "theatre", "play"], obra: ["play"], otono: ["fall"], concierto: ["concert"], banda: ["band"], coro: ["choir"],
  orquesta: ["orchestra"], baile: ["dance", "formal", "prom"], feria: ["fair"], fiesta: ["party"], rally: ["rally"], musical: ["musical"], show: ["show"] };
const EV_GENERIC = new Set(["coming", "upcoming", "happening", "anything", "there", "this", "year", "will", "going", "next", "soon", "proximo", "proxima", "cuando", "donde", "evento", "eventos",
  "meet", "meets", "meeting", "does", "room", "their", "they", "them", "your", "much", "many", "stuff", "things", "drop", "find", "help", "today", "tonight", "tomorrow", "week", "weekend",
  "month", "mes", "este", "esta", "estos", "hay", "vienen", "pasando", "semana", ...MONTH_EN, ...MONTH_ES]);
function eventsAnswer(d, now, text, lang){
  const today = now.iso, n = normQ(text);
  if(/\bfirebird football\b/.test(n)) return R(L(lang, "Firebird Football is a Homecoming-week class-vs-class football spirit competition run by ASB. It isn't one of the Football team's games.",
    "Firebird Football es una competencia de espíritu de fútbol americano entre clases durante la semana de Homecoming, organizada por ASB. No es un partido del equipo de fútbol americano."), true);
  const qw = new Set();
  for(const w of words(text)) if(w.length >= 4 && !EV_STOP.has(w) && !EV_GENERIC.has(w)){ qw.add(w); (EV_SYN[w] || []).forEach(x=> qw.add(x)); }
  const yearStart = (Number(today.slice(5, 7)) >= 8 ? today.slice(0, 4) : String(Number(today.slice(0, 4)) - 1)) + "-08-01";
  const items = [];
  for(const e of d.events || []) if(e.start >= yearStart) items.push({ start: e.start, end: e.end, name: e.name, time: e.time, loc: /^(tba|tbd)$/i.test(e.loc) ? "" : e.loc, desc: e.desc, hay: e.name + " " + e.desc });
  // A Performing Arts row that repeats an Events row (same day, a shared name word) is left out.
  for(const a of d.arts || []) if(a.date >= yearStart && !items.some(x=> a.date >= x.start && a.date <= x.end && words(x.name).some(w=> w.length >= 4 && words(a.name).includes(w))))
    items.push({ start: a.date, end: a.date, name: a.name, time: /^tbd$/i.test(a.time) ? "" : a.time, loc: /^(tba|tbd)$/i.test(a.loc) ? "" : a.loc, desc: a.note, hay: a.name + " " + a.cat + " " + a.who });
  const line = e=> e.name + ", " + (e.start === e.end ? fmtDate(e.start, lang) : L(lang, "from ", "del ") + fmtDate(e.start, lang) + L(lang, " to ", " al ") + fmtDate(e.end, lang))
    + (e.time ? ", " + e.time : "") + (e.loc ? ", " + (/^online$/i.test(e.loc) ? L(lang, "online", "en línea") : L(lang, "at ", "en ") + e.loc) : "");
  const win = windowOf(n, today);
  if(qw.size){
    const scored = items.map(e=>{ const nw = new Set(words(e.name).map(stem)), hw = new Set(words(e.hay).map(stem)); let s = 0; for(const w of qw){ const x = stem(w); if(nw.has(x)) s += 3; else if(hw.has(x)) s += 1; } return { e, s }; })
      .filter(x=> x.s >= 2).sort((a, b)=> b.s - a.s || a.e.start.localeCompare(b.e.start));
    // "is marching band competing this weekend": among the name matches, the ones in that window.
    const inWin = win ? scored.filter(x=> x.e.start <= win.to && x.e.end >= win.from) : [];
    if(inWin.length) return R(cap(L(lang, win.en, win.es)) + ":\n" + inWin.sort((a, b)=> a.e.start.localeCompare(b.e.start)).slice(0, 4).map(x=> "- " + line(x.e)).join("\n"), true,
      coverage(text, inWin.map(x=> x.e.hay).join(" ")));
    if(scored.length){
      const top = scored.filter(x=> x.s === scored[0].s).map(x=> x.e);
      const up = top.filter(e=> e.end >= today).sort((a, b)=> a.start.localeCompare(b.start)), past = top.filter(e=> e.end < today).sort((a, b)=> b.start.localeCompare(a.start));
      const cov = coverage(text, (top[0].name || "") + " " + (top[0].hay || ""));
      // Only part of what was asked matches ("winter formal" vs "Winter Percussion"): say so.
      if(up.length && keyWords(text).length >= 2 && cov < 0.6)
        return R(L(lang, "I don't see exactly that on the school calendar. Related:", "No veo exactamente eso en el calendario de la escuela. Relacionado:") + "\n"
          + up.slice(0, 3).map(e=> "- " + line(e)).join("\n"), true, cov);
      if(up.length) return R(up.slice(0, 3).map(e=> dot(line(e)) + (e.desc ? " " + dot(clipTo(e.desc, 220)) : "")).join("\n"), true, cov);
      const e = past[0];
      const again = /\b(next|upcoming|coming|another|proximo|proxima)\b/.test(n);
      return R(L(lang, e.name + " already happened on " + fmtDate(e.start, lang) + "." + (again ? " I don't see another one on the calendar yet." : ""),
                   e.name + " ya pasó, fue el " + fmtDate(e.start, lang) + "." + (again ? " Todavía no veo otro en el calendario." : "")), true, cov);
    }
  }
  const upcoming = items.filter(e=> e.end >= today).sort((a, b)=> a.start.localeCompare(b.start));
  if(win){
    const inWin = upcoming.filter(e=> e.start <= win.to && e.end >= win.from);
    if(inWin.length) return R(cap(L(lang, win.en, win.es)) + ":\n" + inWin.slice(0, 5).map(e=> "- " + line(e)).join("\n"), true);
  }
  const next = upcoming.slice(0, 3);
  const lead = qw.size ? L(lang, "I don't see that on the school calendar right now. Coming up next:", "No veo eso en el calendario de la escuela ahora mismo. Lo próximo:")
    : win ? L(lang, "I don't see anything listed " + win.en + ". Coming up next:", "No veo nada " + win.es + ". Lo próximo:")
    : L(lang, "Coming up:", "Lo próximo:");
  if(!next.length) return qw.size ? R(L(lang, "I don't see that on the school calendar right now. The Home tab lists every upcoming event.", "No veo eso en el calendario de la escuela ahora mismo. La pestaña Inicio tiene todos los próximos eventos.")) : null;
  return R(lead + "\n" + next.map(e=> "- " + line(e)).join("\n"), !qw.size && !win);
}

/* ---------- clubs ---------- */
function scoreClubs(clubs, text){
  const q = words(text).filter(w=> !helpers.STOP.has(w)), low = String(text || "").toLowerCase();
  return clubs.map(c=>{
    const nameW = words(c.name), nameS = new Set(nameW.map(stem)), purS = new Set(words(c.purpose).map(stem));
    let s = 0;
    if(c.name.length >= 3 && low.includes(c.name.toLowerCase())) s += 10;
    for(const w of q){ const x = stem(w); if(x.length < 3) continue; if(nameS.has(x)) s += 3; else if(nameW.some(n=> n.length >= 5 && x.length >= 5 && (n.startsWith(x) || x.startsWith(stem(n))))) s += 2; if(purS.has(x)) s += 1; }
    return { c, s };
  }).filter(x=> x.s >= 2).sort((a, b)=> b.s - a.s);
}
function clubsAnswer(clubs, text, lang){
  const n = normQ(text);
  if(/\b(start|create|found|make|new club|run a club|empezar|crear|fundar)\b/.test(n))
    return R(L(lang, "The Clubs tab has a \"Start or run a club\" section with the steps and the application. Second-round club applications open in January.",
                   "La pestaña Clubes tiene una sección \"Crear o dirigir un club\" con los pasos y la solicitud. La segunda ronda de solicitudes de clubes abre en enero."), true);
  const scored = scoreClubs(clubs, text);
  if(!scored.length && /\b(join|sign up|unirme|unirse|inscribirme)\b/.test(n))
    return R(L(lang, "Each club on the Clubs tab says when and where it meets, so you can go to a meeting or contact the club from there. The \"Find your club\" quiz on the Clubs tab can help you choose.",
                   "Cada club en la pestaña Clubes dice cuándo y dónde se reúne, así que puedes ir a una reunión o contactar al club desde ahí. La prueba \"Encuentra tu club\" en la pestaña Clubes te puede ayudar a elegir."), true);
  if(scored.length && scored[0].s >= 2){
    const top = scored[0].s >= 10 ? [scored[0]] : scored.filter(x=> x.s >= Math.max(2, scored[0].s - 2)).slice(0, 3);
    return R(top.map(({ c })=> dot(c.name + (c.meeting ? meetsText(c.meeting, lang) : "") + (c.advisor ? L(lang, ". Advisor: ", ". Asesor: ") + c.advisor : ""))
      + (top.length === 1 && firstSentence(c.purpose) ? " " + firstSentence(c.purpose) : "")).join("\n"), true);
  }
  const topic = words(text).filter(w=> w.length >= 4 && !helpers.STOP.has(w) && !/^(club|clubs|clubes|there|official|which|what)$/.test(w))[0];
  return R(L(lang, "I don't see " + (topic ? "a " + topic + " club" : "a club like that") + " in the official list of " + clubs.length + " clubs. The Clubs tab has every club with search and a \"Find your club\" quiz.",
                 "No veo " + (topic ? "un club de " + topic : "un club así") + " en la lista oficial de " + clubs.length + " clubes. La pestaña Clubes tiene todos los clubes con búsqueda y la prueba \"Encuentra tu club\"."));
}
// "Fieldhouse · Mon & Wed 6:30-9:30pm" -> " meets in Fieldhouse (Mon & Wed 6:30-9:30pm)".
function meetsText(meeting, lang){
  const parts = String(meeting).replace(/\.$/, "").split(/\s+·\s+/).map(x=> x.trim()).filter(Boolean);
  if(parts.length >= 2){
    const place = parts[0], rest = parts.slice(1).join(", ");
    const placeWords = /^(room|rm|library|gym|fieldhouse|field|cafeteria|theater|theatre|quad|portable|online|zoom|[a-z]?\d{1,4}[a-z]?\b|[a-z]-?\d)/i.test(place);
    if(placeWords) return L(lang, " meets in " + place + " (" + rest + ")", " se reúne en " + place + " (" + rest + ")");
  }
  return L(lang, " meets: ", " se reúne: ") + parts.join(", ");
}
// The purpose's first sentence if it is short enough to read whole, else nothing.
function firstSentence(t){
  let s = String(t || "").replace(/\s+/g, " ").trim();
  // The club list clips long purposes with "..."; then only a whole sentence before it is used.
  if(/(\.\.\.|\u2026)$/.test(s)){ s = s.replace(/\s*(\.\.\.|\u2026)$/, ""); const m = s.match(/^.{20,200}?[.!?](?=\s)/); return m ? m[0] : ""; }
  if(!s) return "";
  const m = s.match(/^.{20,200}?[.!?](?=\s|$)/);
  if(m) return m[0];
  return s.length <= 200 ? dot(s) : "";
}

/* ---------- announcements ---------- */
function announcementsAnswer(list, now, text, lang, onlyMatches){
  const hits = matchingAnnouncements(list, now, text);
  // The best match in full (about 700 characters), a second one shorter.
  if(hits.length) return R(L(lang, "From the morning announcements:", "De los anuncios de la mañana:") + "\n" + hits.slice(0, 2).map((h, i)=> {
    const m = h.match(/^- \w+ (\d{4}-\d{2}-\d{2}): ([\s\S]*)$/);
    return m ? "- " + cap(fmtDate(m[1], lang)) + ": " + clipTo(m[2], i ? 260 : 700) : clipTo(h, 700);
  }).join("\n"), true, coverage(text, hits[0]));
  if(onlyMatches) return null;
  const r = revealed(list, now).sort((a, b)=> b.date.localeCompare(a.date));
  if(!r.length) return null;
  const day = r[0].date, titles = [...new Set(r.filter(a=> a.date === day && a.title).map(a=> a.title))].slice(0, 8);
  if(!titles.length) return null;
  return R(L(lang, "The latest morning announcements (" + fmtDate(day, lang) + "):", "Los últimos anuncios de la mañana (" + fmtDate(day, lang) + "):") + "\n" + titles.map(t=> "- " + t).join("\n")
    + "\n" + L(lang, "The Home tab has the full text.", "La pestaña Inicio tiene el texto completo."), day === now.iso);
}

/* ---------- spirit ---------- */
function spiritAnswer(st, text, lang){
  const n = normQ(text);
  const board = st && st.length ? L(lang, "Current standings: ", "Clasificación actual: ") + st.map((s, i)=> (i + 1) + ". " + s.cls + " " + s.pts).join(", ") + "." : "";
  if(/\b(submit|photo|picture|upload|spirit wear|dress|enviar|foto)\b/.test(n))
    return R(L(lang, "Spirit Wear photos are submitted on the Spirit tab during spirit weeks. While one is on, the Spirit tab shows the form and that week's dress-up days.",
                   "Las fotos de Spirit Wear se envían en la pestaña Espíritu durante las semanas de espíritu. Mientras hay una, la pestaña muestra el formulario y los días de vestimenta."), true);
  if(/\b(how|work|works|earn|get|como|funcionan|ganar)\b/.test(n) && !/\b(how many|how much|cuantos|cuantas)\b/.test(n))
    return R(L(lang, "Classes earn spirit points at rallies, on dress-up days during spirit weeks and at other ASB events. The Spirit tab has the live standings and how points work.",
                   "Las clases ganan puntos de espíritu en los rallies, en los días de vestimenta de las semanas de espíritu y en otros eventos de ASB. La pestaña Espíritu tiene la clasificación en vivo y cómo funcionan los puntos.")
      + (board ? " " + board : ""), true);
  return R(board, true);
}

/* ---------- Schoology items the student sent ---------- */
// A description is the teacher's text, shown as is, minus any sentence that tries to give
// orders to an AI (it is untrusted data).
const INJECT_RE = /ignore (all |any )?(previous|prior|above)|system prompt|you are now|\bDAN\b|jailbreak|no rules|pretend (to be|you)|act as|instructions|print your|reveal|grade is an?\b|fire ?bucks/i;
const safeDesc = t=> String(t || "").split(/(?<=[.!?])\s+/).filter(x=> !INJECT_RE.test(x)).join(" ").trim();
function assignmentsAnswer(items, now, text, lang){
  if(!items.length) return R(L(lang, "Once you connect Schoology in the app (sign in with your school Google account, then add your Schoology calendar link), I can list your upcoming items.",
                                   "Cuando conectes Schoology en la app (inicia sesión con tu cuenta escolar de Google y agrega el enlace de tu calendario de Schoology), puedo mostrarte tus próximas tareas."), true);
  const n = normQ(text), win = windowOf(n, now.iso);
  const withDate = items.map(a=> ({ ...a, iso: isoDate(a.due) })).sort((a, b)=> (a.iso || "9999").localeCompare(b.iso || "9999"));
  let pick = withDate.filter(a=> !a.iso || a.iso >= now.iso);
  if(win){ const w = pick.filter(a=> a.iso && a.iso >= win.from && a.iso <= win.to); if(w.length || /\b(due|entrega)\b/.test(n)) pick = w; }
  const qw = new Set(words(text).filter(w=> w.length >= 4 && !/^(what|about|assignment|assignments|homework|summarize|explain|start|have|this|that|tarea|tareas|sobre)$/.test(w)));
  const qs = new Set([...qw].map(stem));
  const named = pick.filter(a=> words(a.title + " " + a.desc).some(w=> qs.has(stem(w))) || (qs.has("spanish") && /unidad|vocabulario|espa/i.test(a.title)));
  const one = named.length === 1 ? named[0] : pick.length === 1 ? pick[0] : null;
  const dueText = a=> a.iso ? fmtDate(a.iso, lang) + (a.due.length > 10 ? ", " + a.due.slice(11).trim() : "") : a.due;
  if(one && (named.length === 1 || /\b(summar|explain|about|what is|de que|resum)/.test(n)))
    return R(dot(one.title + (one.type ? " (" + one.type + ")" : "") + ", " + L(lang, "due ", "para el ") + dueText(one))
      + (safeDesc(one.desc) ? " " + L(lang, "The short description from the calendar feed says: ", "La descripción corta del calendario dice: ") + dot(clipTo(safeDesc(one.desc), 300)) : "")
      + " " + L(lang, "Open it in Schoology for the full assignment.", "Ábrela en Schoology para ver la tarea completa."), true);
  if(!pick.length) return win ? R(L(lang, "I don't see anything in your Schoology calendar due " + win.en + ".", "No veo nada en tu calendario de Schoology para " + win.es + "."), true) : null;
  return R(L(lang, "From your Schoology calendar:", "De tu calendario de Schoology:") + "\n" + pick.slice(0, 6).map(a=> "- " + a.title + (a.type ? " (" + a.type + ")" : "") + ", " + L(lang, "due ", "para el ") + dueText(a)).join("\n")
    + "\n" + L(lang, "Open each one in Schoology for the full details.", "Abre cada una en Schoology para ver los detalles."), true);
}

/* ---------- app help (fixed facts) ---------- */
function appAnswer(text, lang){
  const n = normQ(text);
  if(/schoology/.test(n) && /\b(connect|link|add|sync|set ?up|conectar|vincular)\b/.test(n))
    return L(lang, "Sign in with your school Google account in the app, then paste your Schoology calendar link. In Schoology, open the arrow by your name, go to Settings, choose Share your Schoology Calendar, turn it on and copy the iCal link.",
                   "Inicia sesión en la app con tu cuenta escolar de Google y pega el enlace de tu calendario de Schoology. En Schoology, abre la flecha junto a tu nombre, ve a Settings, elige Share your Schoology Calendar, actívalo y copia el enlace iCal.");
  if(/\b(switch|change|set|turn|use|put|show|cambiar|cambio|poner)\b.*\b(spanish|espanol|ingles|english)\b|\b(language|idioma)\b/.test(n) && !/\b(assignment|homework|vocab|class|quiz|test|teacher|tarea|clase)\b/.test(n))
    return L(lang, "Open the More tab, then Settings, and choose Spanish.", "Abre la pestaña Más, luego Ajustes, y elige español.");
  return "";
}

/* ---------- schedule (with felipe-core's own answers when it has one) ---------- */
const SCHED_KEYS = { "- Monday": "mon", "- A day": "a", "- B day": "b" };
let SCHEDULES = null;
function schedules(){
  if(SCHEDULES) return SCHEDULES;
  SCHEDULES = {};
  for(const l of BELL_SCHEDULE.split("\n")){
    const k = Object.keys(SCHED_KEYS).find(x=> l.startsWith(x)); if(!k) continue;
    const rows = [...l.slice(l.indexOf(":") + 1).matchAll(/(P\d|Tutorial|Brunch|Lunch)\s+(\d{1,2}:\d{2})-(\d{1,2}:\d{2})/g)].map(m=> [m[1].replace(/^P(\d)$/, "Period $1"), m[2], m[3]]);
    SCHEDULES[SCHED_KEYS[k]] = { label: k.slice(2), rows };
  }
  return SCHEDULES;
}
// What app.js holds in memory, built from the server's data, for FelipeCore.answerLocal.
function appData(d, now, lang, wall){
  const specialDays = {}; for(const iso in SPECIAL_DAYS) specialDays[iso] = /^a/i.test(SPECIAL_DAYS[iso][0]) ? "a" : "b";
  const games = (d.sports || []).map(g=> ({ sport: g.sport, level: g.level, date: g.date, time: g.time, homeAway: g.ha, opponent: g.opp, location: g.loc, type: g.type, senior: !!g.senior, seniorNight: g.senior, score: g.score, title: g.bell ? "Bell Game" : (g.senior ? "Senior Night" : ""), _g: g }));
  const ann = d.announcements ? revealed(d.announcements, now) : [];
  return {
    now: wall, lang, schedules: schedules(), specialDays, noSchoolDays: NO_CLASSES.map(r=> [r[0], r[1], r[2], r[2]]), schoolYear: { first: FIRST_DAY, last: LAST_DAY },
    nextEvents: (d.events || []).filter(e=> e.end >= now.iso).sort((a, b)=> a.start.localeCompare(b.start)).map(e=> ({ name: e.name, date: e.start, endDate: e.end, time: e.time, location: e.loc, description: e.desc })),
    nextGames: games.filter(g=> !isPlayed(g._g, now)).sort((a, b)=> byWhen(a._g, b._g)),
    recentResults: games.filter(g=> isPlayed(g._g, now) && g.score).sort((a, b)=> byWhen(b._g, a._g)),
    spiritStandings: d.spirit || [],
    announcementsToday: ann.filter(a=> a.date === now.iso),
    announcements: ann.filter(a=> a.date >= addDays(now.iso, -14)).sort((a, b)=> b.date.localeCompare(a.date)),
    clubs: (d.clubs || []).map(c=> ({ name: c.name, meetingInfo: c.meeting, teacherAdvisor: c.advisor, purpose: c.purpose }))
  };
}
const ptWall = ()=>{ try{ return new Date(new Date().toLocaleString("en-US", { timeZone: TZ })); }catch(e){ return new Date(); } };
const WD_WORDS = [["sunday","domingo"],["monday","lunes"],["tuesday","martes"],["wednesday","miercoles"],["thursday","jueves"],["friday","viernes"],["saturday","sabado"]];
function scheduleAnswer(now, text, lang){
  const n = normQ(text), tm = addDays(now.iso, 1);
  const say = (iso, x)=> x.off ? L(lang, "No classes on " + fmtDate(iso, lang) + " (" + x.off.replace(/ \(FUHSD calendar\)/, "") + ").", "No hay clases el " + fmtDate(iso, lang) + " (" + x.off.replace(/ \(FUHSD calendar\)/, "") + ").")
    : L(lang, cap(fmtDate(iso, lang)) + " is " + (/^a/i.test(x.sched) ? "an " : "a ") + x.sched + (/^monday/i.test(x.sched) ? " schedule" : "") + (x.why ? " (" + x.why + ")" : "") + ".",
        cap(fmtDate(iso, lang)) + " es " + (/^monday/i.test(x.sched) ? "horario de lunes" : "día " + x.sched.charAt(0)) + ".");
  // A date ("November 25", "11/25", "the 30th") or a weekday name ("Monday", "next tuesday").
  let iso = "";
  const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"], MES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  const md = n.match(/\b([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\b/) || n.match(/\b(\d{1,2})\s+de\s+([a-z]+)\b/);
  if(md){
    const name = isNaN(md[1]) ? md[1] : md[2], day = Number(isNaN(md[1]) ? md[2] : md[1]);
    const mi = Math.max(MONTHS.findIndex(m=> m.startsWith(name.slice(0, 3)) && name.length >= 3), MES.indexOf(name));
    if(mi >= 0 && day >= 1 && day <= 31){ let y = Number(now.iso.slice(0, 4)); let c = y + "-" + String(mi + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0"); if(c < addDays(now.iso, -60)) c = (y + 1) + c.slice(4); iso = c; }
  }
  if(!iso){ const slash = n.match(/\b(\d{1,2})\/(\d{1,2})\b/); if(slash){ const y = now.iso.slice(0, 4); iso = y + "-" + slash[1].padStart(2, "0") + "-" + slash[2].padStart(2, "0"); if(iso < addDays(now.iso, -60)) iso = (Number(y) + 1) + iso.slice(4); } }
  if(!iso){ const th = n.match(/\bthe (\d{1,2})(?:st|nd|rd|th)\b/); if(th){ for(let k = 0; k < 40; k++){ const c = addDays(now.iso, k); if(Number(c.slice(8)) === Number(th[1])){ iso = c; break; } } } }
  if(!iso){
    const wi = WD_WORDS.findIndex(w=> new RegExp("\\b(" + w[0] + "|" + w[1] + ")\\b").test(n));
    if(wi >= 0){ let k = (wi - weekday(now.iso) + 7) % 7; if(k === 0 && /\bnext\b|\bproximo\b/.test(n)) k = 7; iso = addDays(now.iso, k); }
  }
  if(!iso && /\b(tomorrow|manana)\b/.test(n)) iso = tm;
  if(/\b(next day off|next break|day off|days off|break|vacation|holiday|vacaciones|feriado)\b/.test(n) && !iso){
    const next = NO_CLASSES.find(r=> r[1] >= now.iso);
    if(next) return R(L(lang, "The next day off is " + next[2] + ": " + (next[0] === next[1] ? fmtDate(next[0], lang) : "from " + fmtDate(next[0], lang) + " to " + fmtDate(next[1], lang)) + ".",
      "El próximo día sin clases es " + next[2] + ": " + (next[0] === next[1] ? fmtDate(next[0], lang) : "del " + fmtDate(next[0], lang) + " al " + fmtDate(next[1], lang)) + "."), true);
  }
  const day = iso || now.iso, x = dayInfo(day);
  const about = !!iso || /\b(school|class|classes|schedule|a day|b day|bell|period|lunch|brunch|tutorial|start|end|out|clases|escuela|horario|dia a|dia b)\b/.test(n);
  if(!about) return R(L(lang, "I don't have that detail right now. The Schedule tab has the bell schedule, and special weeks show there once the school posts them.",
                            "No tengo ese dato ahora mismo. La pestaña Horario tiene el horario de campanas, y las semanas especiales aparecen ahí cuando la escuela las publica."));
  return R(say(day, x) + (x.off ? "" : " " + L(lang, "The Schedule tab shows every bell time and a live period clock.", "La pestaña Horario muestra todas las horas y el reloj del periodo en vivo.")), about);
}

/* ---------- the entry point ---------- */
const CANT = new Set(["study", "writing"]);                     // always need the AI
const MAYBE = new Set(["general", "guidance", "planning", "app_help", "capabilities"]); // only a strong data match
/**
 * dataAnswer({ intent, text, lang, sections, data, now, assignments })
 *  text: the question (or FelipeCore's resolved follow-up). data: buildLive().data. now: nowPT().
 * Returns { text, kind:"data" } (with the "back soon" line added unless note is false),
 * { text, kind:"cant" } for generative requests and questions the data can't answer, or null
 * when nothing useful can be said.
 */
export function dataAnswer({ intent, text, lang, sections, data, now, assignments, note }){
  lang = lang === "es" ? "es" : "en";
  const d = data || {}, s = sections || new Set(), i = String(intent || "");
  const done = t=> ({ text: t.trim() + (note === false ? "" : "\n\n" + BACK_SOON[lang]), kind: "data" });
  const cant = { text: CANT_WRITE[lang], kind: "cant" };
  const cantAnswer = { text: CANT_ANSWER[lang], kind: "cant" };
  try{
    const orig = text;   // felipe-core gets the student's own words
    text = withEnglish(text);
    const n = normQ(text);
    const writeReq = /\b(write|draft|rewrite|make it|make me|study plan|shorter|longer|explain|quiz me|ideas?|tips?|escribe|redacta|explica|ideas|consejos|hazme)\b/.test(n);
    // 1. The student's own Schoology items.
    if(assignments && assignments.length && !writeReq){ const r = assignmentsAnswer(assignments, now, text, lang); if(r) return done(r.text); }
    if(CANT.has(i) || (writeReq && !/\b(when|where|what time|who)\b/.test(n))) return cant;
    // Requests to make something (a plan, ideas, tips) get the "can't write" text at the end.
    const making = writeReq || i === "planning";
    // 2. felipe-core's own instant answers (the same ones the app gives on the phone).
    if(Core.answerLocal && (Core.LOCAL_INTENTS || []).includes(i)){
      const r = Core.answerLocal(i, orig, appData(d, now, lang, ptWall()), lang);
      if(r && r.text) return done(r.text);
    }
    // 3. Fixed facts about the app.
    const app = appAnswer(text, lang); if(app) return done(app);
    if(/assign|homework/.test(i) || /\b(assignments?|homework|tareas?)\b/.test(n)){
      // "when are UC apps due", "where is the interact service project": the school's own
      // announcements or calendar may answer it before the "connect Schoology" reply.
      if(!/\b(my|mis|mi)\b/.test(n)){
        const a = d.announcements ? announcementsAnswer(d.announcements, now, text, lang, true) : null;
        if(a && a.strong) return done(a.text);
        const e = eventsAnswer(d, now, text, lang);
        if(e && e.strong && e.cov >= 0.5) return done(e.text);
      }
      const r = assignmentsAnswer([], now, text, lang); if(r) return done(r.text);
    }
    // 4. Topics: the intent's own first, then whatever the question's words point at.
    const order = [];
    const add = k=>{ if(!order.includes(k)) order.push(k); };
    if(/sport|game|meet|score|senior|athlet/.test(i)) add("sports");
    if(/spirit|standing/.test(i)) add("spirit");
    if(/announce|news/.test(i)) add("announcements");
    // A club name in the question goes to clubs; otherwise "club grub day" and "club check-in" are events.
    const clubHit = d.clubs ? scoreClubs(d.clubs, text) : [];
    if(/club/.test(i) && clubHit.length && clubHit[0].s >= 3) add("clubs");
    if(/event|happen|week|club/.test(i)) add("events");
    if(/club/.test(i)) add("clubs");
    if(/sched|bell|period|day|school|time|no_?school/.test(i)) add("schedule");
    for(const k of ["sports", "events", "arts", "clubs", "spirit", "announcements", "schedule"]) if(s.has(k)) add(k === "arts" ? "events" : k);
    const strongOnly = MAYBE.has(i) || !i;
    // When nothing matches strongly, the intent's own topic gives the "I don't see that" reply.
    const primary = /sport|game|meet|score|senior|athlet/.test(i) ? "sports" : /club/.test(i) ? "clubs" : /spirit|standing/.test(i) ? "spirit"
      : /announce|news/.test(i) ? "announcements" : /event|happen|week/.test(i) ? "events" : /sched|bell|period|day|school|time/.test(i) ? "schedule" : "";
    const weakBy = {};
    let weak = null;
    for(const k of order){
      let r = null;
      if(k === "sports" && d.sports) r = sportsAnswer(d.sports, now, text, lang);
      else if(k === "clubs" && d.clubs) r = clubsAnswer(d.clubs, text, lang);
      else if(k === "spirit") r = spiritAnswer(d.spirit, text, lang);
      // The day's headline list only for announcement questions or "today"/"lunch" ones; for any
      // other topic, only an announcement that matches the question's words.
      else if(k === "announcements" && d.announcements) r = announcementsAnswer(d.announcements, now, text, lang, !(/announce|news/.test(i) || /\b(today|lunch|brunch|this morning|hoy|almuerzo)\b/.test(n)));
      else if(k === "events"){
        r = eventsAnswer(d, now, text, lang);
        if(d.announcements){
          // Something the morning announcements cover better, or "what's happening at lunch today".
          const a = announcementsAnswer(d.announcements, now, text, lang, true)
            || (!(r && r.strong) && /\b(today|tonight|lunch|brunch|tutorial|hoy|almuerzo)\b/.test(n) ? announcementsAnswer(d.announcements, now, text, lang, false) : null);
          if(a && (!(r && r.strong) || (a.strong && a.cov > r.cov))) r = a;
        }
      }
      else if(k === "schedule") r = scheduleAnswer(now, text, lang);
      if(r && r.strong) return done(r.text);
      // A sports question never falls through to the schedule or the calendar.
      if(r && k === "sports" && primary === "sports"){
        const a = !r.strong && d.announcements ? announcementsAnswer(d.announcements, now, text, lang, true) : null;
        return done((a && a.strong ? a : r).text);
      }
      if(r && !weakBy[k]) weakBy[k] = r;
      if(r && !weak) weak = r;
    }
    // 5. A question only the announcements answer ("college application help today?").
    if(d.announcements){ const a = announcementsAnswer(d.announcements, now, text, lang, true); if(a) return done(a.text); }
    if((weakBy[primary] || weak) && !strongOnly) return done((weakBy[primary] || weak).text);
    if(strongOnly && d.clubs){ const sc = scoreClubs(d.clubs, text); if(sc.length && sc[0].s >= 3) return done(clubsAnswer(d.clubs, text, lang).text); }
    return making ? cant : cantAnswer;
  }catch(e){ return null; }
}
