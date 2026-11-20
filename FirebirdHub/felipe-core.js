/* felipe-core.js: Ask Felipe's instant brain, shared by the app (browser) and api/ask.js (Node).
 *
 * No dependencies, no network, no DOM. Browser: <script src="felipe-core.js?v=1"> before
 * app.js gives window.FelipeCore. Node: const FelipeCore = require("../felipe-core.js").
 *
 *   classify(question, ctx) -> { route, intent, reason?, ms, lang, resolved?, followUp?, needsAssignments }
 *     route "local"  : answerLocal can answer from data the app already holds (instant).
 *     route "llm"    : send it to /api/ask (Gemini). intent says which context sections matter
 *                      (see INTENT_SECTIONS).
 *     route "cannot" : Felipe truly can't help (off-topic, private data, unsafe). Reply at once
 *                      with cannotReply(reason, lang). No network call.
 *     route "crisis" : self-harm, suicide, abuse or danger wording. Reply at once with
 *                      crisisReply(lang, reason). No network call.
 *     ctx = { history?: [{ role:"user"|"model", text }], lang?: "en"|"es" }.
 *     When a short follow-up ("Girls", "what about Friday") borrows the last user question,
 *     result.resolved holds the merged question: pass resolved (not the raw text) to
 *     answerLocal, and to the server if you like.
 *     result.lang is "es" when the question itself reads as Spanish, else ctx.lang or "en".
 *     result.needsAssignments is true when the student's Schoology items would help (attach
 *     pickAssignments(question, items) to the request as context.assignments).
 *
 *   answerLocal(intent, question, data, lang) -> { text, source:"app" } | null
 *     Deterministic answers for the local intents. Returns null whenever it is not sure (no
 *     data, nothing matched), so the caller falls through to the server.
 *     data (all optional; the names match app.js, so the client glue is one object literal):
 *       now          Date whose LOCAL getters read Fremont wall-clock time. Pass app.js nowPST().
 *                    Default: computed from the real clock in America/Los_Angeles.
 *       schedules    SCHEDULES   { mon|a|b: { label, rows: [[name, "8:30", "9:15"], ...] } }
 *                    Times are "h:mm" with no AM/PM; hours below 7 are PM (same as app.js toMin).
 *       specialDays  SPECIAL_DAYS { "2026-11-23": "a" | "b" }  dated A/B swaps
 *       noClasses    NO_CLASSES  [[fromIso, toIso, reasonEn, reasonEs], ...]
 *       schoolYear   SCHOOL_YEAR { first: "2026-08-17", last: "2027-06-03" }
 *       events       EVENTS      [{ name, when: Date, end: Date, time, loc, desc, tags }]
 *                    (when/end may also be ms numbers or ISO strings)
 *       games        sportsGames [{ sport, date:"YYYY-MM-DD", time:"7:00 PM", level, home,
 *                    homeAway, opponent, location, title, score, senior }]
 *       spirit       spiritStandings [{ cls: "Seniors", pts: 1240 }]
 *       announcements annAll [{ date:"YYYY-MM-DD", title, text }] or FTV_FEED
 *                    [{ date, bullets: [..], full }]. Items are revealed at 8:30 AM on their date,
 *                    the same rule as the app.
 *       clubs        CLUBS (accepted for completeness; no local answer uses it today)
 *     Aliases also accepted: SCHEDULES, SPECIAL_DAYS, NO_CLASSES, SCHOOL_YEAR, EVENTS,
 *     sportsGames, spiritStandings, annAll, nextEvents, nextGames, noSchoolDays, announcementsToday.
 *     Client glue:
 *       FelipeCore.answerLocal(c.intent, c.resolved || q, { now: nowPST(), schedules: SCHEDULES,
 *         specialDays: SPECIAL_DAYS, noClasses: NO_CLASSES, schoolYear: SCHOOL_YEAR, events: EVENTS,
 *         games: sportsGames || [], spirit: spiritStandings || [], announcements: annAll || FTV_FEED,
 *         clubs: CLUBS }, c.lang)
 *
 *   cannotReply(reason, lang) -> string      crisisReply(lang, reason?) -> string
 *   pickAssignments(question, items, max?) -> [{ title, type, due, desc, url }]  (for context.assignments)
 *   norm(text) -> normalized text (lowercase, no accents, typos fixed), exported for tests.
 *
 * Copy rules for every reply: plain full sentences, numerals, no em dashes, no emoji, polite
 * school register, English and Spanish.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FelipeCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var VERSION = "2";
  var clock = (typeof performance !== "undefined" && performance && typeof performance.now === "function")
    ? function () { return performance.now(); } : function () { return Date.now(); };

  /* =====================================================================
     1. Normalizing: lowercase, no accents, no punctuation, contractions
        expanded, common typos and texting shorthand fixed.
     ===================================================================== */
  var TYPO = {
    // contractions (apostrophes are already gone)
    whats: "what is", whens: "when is", wheres: "where is", whos: "who is", hows: "how is",
    thats: "that is", theres: "there is", whatre: "what are", isnt: "is not", arent: "are not",
    dont: "do not", doesnt: "does not", didnt: "did not", cant: "can not", wont: "will not",
    im: "i am", ive: "i have", youre: "you are", todays: "today", tomorrows: "tomorrow",
    // texting shorthand
    wat: "what", wut: "what", wht: "what", whta: "what", wen: "when", wehn: "when", whn: "when",
    wher: "where", u: "you", ur: "your", r: "are", pls: "please", plz: "please", rn: "right now",
    abt: "about", bc: "because", cuz: "because", nxt: "next", tho: "though",
    tmrw: "tomorrow", tmr: "tomorrow", tmrow: "tomorrow", tmw: "tomorrow", tomorow: "tomorrow",
    tommorow: "tomorrow", tommorrow: "tomorrow", tomorrw: "tomorrow", tomrrow: "tomorrow",
    "2moro": "tomorrow", "2morrow": "tomorrow", "2day": "today", tdy: "today",
    tn: "tonight", "2nite": "tonight", tonite: "tonight",
    ther: "there", thr: "there", thier: "there", sckool: "school", skewl: "school",
    wed: "wednesday", weds: "wednesday", thur: "thursday", thu: "thursday", tue: "tuesday", mon: "monday",
    skool: "school", schol: "school", shcool: "school", scool: "school", schoo: "school",
    lnch: "lunch", luch: "lunch", lucnh: "lunch", lunh: "lunch", lunc: "lunch", brnch: "brunch", bruch: "brunch",
    peroid: "period", preiod: "period", perod: "period", peiod: "period", prd: "period",
    skedule: "schedule", schedual: "schedule", schedle: "schedule", shedule: "schedule",
    scedule: "schedule", schdule: "schedule", sched: "schedule",
    gm: "game", gme: "game", gmae: "game", footbal: "football", fooball: "football", futball: "football",
    bball: "basketball", basketbal: "basketball", baskeball: "basketball",
    vball: "volleyball", voleyball: "volleyball", volleybal: "volleyball", socer: "soccer", soccor: "soccer",
    hw: "homework", hwk: "homework", homwork: "homework", homewrk: "homework",
    assigment: "assignment", assignmnet: "assignment", asignment: "assignment", assingment: "assignment",
    assignemnt: "assignment", assigments: "assignments", asignments: "assignments",
    spirt: "spirit", sprit: "spirit", pts: "points", evnt: "event", evnts: "events",
    felip: "felipe", felipee: "felipe", thx: "thanks", ty: "thanks", tysm: "thanks",
    // Spanish shorthand
    q: "que", xq: "porque", pq: "porque", tb: "tambien", anucios: "anuncios", clse: "clase", ola: "hola"
  };

  // Fuzzy fixes (one typo, two for long words) only toward these words, and never from the
  // real words in FUZZY_SKIP that sit one letter away from them.
  var FUZZY_VOCAB = ("lunch brunch period periods schedule school tomorrow tutorial assignment assignments homework " +
    "standings spirit announcement announcements football basketball volleyball soccer wrestling badminton " +
    "baseball softball thanksgiving schoology summarize explain counselor homecoming varsity monday tuesday " +
    "wednesday thursday friday saturday sunday tonight today events points holiday vacation weekend upcoming " +
    "almuerzo horario escuela partido anuncios tareas viernes miercoles jueves martes espiritu").split(" ");
  var FUZZY_SKIP = {};
  ("close closes closed closer launch launched branch bunch punch crunch hunch james names games gamer watch " +
    "match short shorts paint pints joints spits spite merit tonights todays schools holidays periods events " +
    "points expect exclaim explains peoples tutorials scholar scholars mondays fridays weekends").split(" ")
    .forEach(function (w) { FUZZY_SKIP[w] = 1; });
  var VOCAB_SET = {};
  FUZZY_VOCAB.forEach(function (w) { VOCAB_SET[w] = 1; });
  // Real words (mostly Spanish) that sit near a vocab word and must stay as typed.
  ("periodo periodos clase clases horarios partidos tarea evento eventos lunes sabado domingo puntos semana " +
    "manana cuando donde espiritus anuncio escuelas almuerzos").split(" ").forEach(function (w) { VOCAB_SET[w] = 1; });
  var fuzzyMemo = {};

  // Damerau-Levenshtein distance with an early exit once it passes max.
  function editDistance(a, b, max) {
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > max) return max + 1;
    var prev2 = null, prev = new Array(lb + 1), cur, i, j;
    for (j = 0; j <= lb; j++) prev[j] = j;
    for (i = 1; i <= la; i++) {
      cur = new Array(lb + 1); cur[0] = i;
      var rowMin = cur[0];
      for (j = 1; j <= lb; j++) {
        var cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        var v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (prev2 && i > 1 && j > 1 && a.charCodeAt(i - 1) === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === b.charCodeAt(j - 1))
          v = Math.min(v, prev2[j - 2] + 1);
        cur[j] = v; if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      prev2 = prev; prev = cur;
    }
    return prev[lb];
  }
  function fuzzyFix(tok) {
    if (tok.length < 5 || VOCAB_SET[tok] || FUZZY_SKIP[tok] || !/^[a-z]+$/.test(tok)) return tok;
    if (Object.prototype.hasOwnProperty.call(fuzzyMemo, tok)) return fuzzyMemo[tok];
    var max = tok.length >= 8 ? 2 : 1, best = tok, bestD = max + 1;
    for (var i = 0; i < FUZZY_VOCAB.length; i++) {
      var w = FUZZY_VOCAB[i];
      if (Math.abs(w.length - tok.length) > max || w.charCodeAt(0) !== tok.charCodeAt(0) && max < 2) continue;
      var d = editDistance(tok, w, max);
      if (d < bestD) { bestD = d; best = w; if (d === 1) break; }
    }
    fuzzyMemo[tok] = best;
    return best;
  }

  var normMemo = {}, normMemoSize = 0;
  function norm(s) {
    s = String(s == null ? "" : s);
    if (s.length > 600) s = s.slice(0, 600);
    if (Object.prototype.hasOwnProperty.call(normMemo, s)) return normMemo[s];
    var t = s.toLowerCase();
    if (t.normalize) t = t.normalize("NFD").replace(/[̀-ͯ]/g, "");
    t = t.replace(/[’'`´]/g, "")
      .replace(/[^a-z0-9:\/ ]+/g, " ")
      .replace(/\/(?!\d)|(^|[^\d])\//g, "$1 ")          // keep "/" only inside dates like 11/20
      .replace(/:(?!\d)|(^|[^\d]):/g, "$1 ")            // keep ":" only inside times like 3:05
      .replace(/([a-z])\1{2,}/g, "$1");                 // "lunchhh" -> "lunch", "soooo" -> "so"
    var toks = t.split(/\s+/), out = [];
    for (var i = 0; i < toks.length; i++) {
      var k = toks[i]; if (!k) continue;
      if (Object.prototype.hasOwnProperty.call(TYPO, k)) { out.push(TYPO[k]); continue; }
      out.push(fuzzyFix(k));
    }
    var r = out.join(" ");
    if (normMemoSize > 500) { normMemo = {}; normMemoSize = 0; }
    normMemo[s] = r; normMemoSize++;
    return r;
  }

  /* =====================================================================
     2. Lexicon (built once). Every pattern runs on " " + norm(text) + " ".
     ===================================================================== */
  function alt(list) { return "(?:" + list.join("|") + ")"; }
  var WD_EN = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  var WD_ES = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"];
  var WD = alt(WD_EN.concat(WD_ES, ["tues", "thurs", "fri"]));
  var DAYW = alt(["today", "tonight", "tomorrow", "yesterday", "this week", "next week", "this weekend", "weekend",
    "hoy", "manana", "esta semana", "proxima semana", "fin de semana", WD, "\\d{1,2}/\\d{1,2}",
    alt(["jan", "january", "feb", "february", "mar", "march", "apr", "april", "may", "jun", "june", "jul", "july",
      "aug", "august", "sep", "sept", "september", "oct", "october", "nov", "november", "dec", "december"]) + " \\d{1,2}"]);

  var SPORTW = alt(["football", "flag football", "basketball", "hoops", "soccer", "futbol", "volleyball", "water polo",
    "waterpolo", "tennis", "tenis", "cross country", "xc", "field hockey", "hockey", "wrestling", "badminton", "baseball",
    "softball", "golf", "swim", "swimming", "diving", "track", "track and field", "lacrosse", "game", "games", "match",
    "matches", "meets", "(?:the|next|a|our|xc|swim|track) meet", "sports?", "varsity", "jv", "senior night", "bell game",
    "home game", "away game", "partido", "partidos", "juego", "juegos", "deportes?", "baloncesto", "basquetbol",
    "basquet", "voleibol", "voley", "beisbol", "natacion", "lucha", "atletismo"]);
  var EVENTNOUN = alt(["dance", "dances", "rally", "rallies", "play", "musical", "concert", "fair", "trivia", "trivia night",
    "grub day", "homecoming", "prom", "formal", "winter formal", "sadies", "social", "assembly", "festival",
    "talent show", "show", "movie night", "carnival", "fundraiser", "bake sale", "clubs day", "club day", "check in",
    "baile", "asamblea", "feria", "obra", "concierto", "festival"]);
  var SCHOOLS = alt(["homestead", "lynbrook", "monta vista", "mvhs", "cupertino", "los altos", "mountain view", "palo alto",
    "gunn", "saratoga", "los gatos", "wilcox", "santa clara", "milpitas", "harker", "bellarmine", "prospect", "leigh",
    "westmont", "lincoln", "mitty", "santa teresa", "piedmont hills"]);
  var GEN = new RegExp("\\b" + alt(["explain", "write", "draft", "plan", "summarize", "summary", "summarise", "help me",
    "why", "compare", "ideas?", "suggest", "recommend", "tips", "advice", "should i", "how (?:do|can|should) i", "teach",
    "quiz me", "make me", "create", "brainstorm", "resumen", "resume", "resumir", "explica", "explicame", "escribe",
    "redacta", "ayudame", "planea", "consejos", "por que", "deberia"]) + "\\b");
  var ANCHOR = new RegExp("\\b" + alt(["school", "fremont", "fhs", "firebird", "firebirds", "felipe", "asb", "class",
    "classes", "teacher", "teachers", "homework", "assignment", "assignments", "club", "clubs", "period", "lunch",
    "brunch", "rally", "spirit", "campus", "counselor", "counselors", "principal", "test", "quiz", "exam", "finals",
    "semester", "study", "studying", "essay", "project", "dance", "homecoming", "prom", "tutorial", "schoology", "app",
    "escuela", "clase", "clases", "maestro", "maestra", "profesor", "profesora", "tarea", "tareas", "examen", "clubes"]) + "\\b");
  var OFFTOPIC = new RegExp("\\b" + alt(["nfl", "nba", "mlb", "nhl", "mls", "wnba", "premier league", "champions league",
    "la liga", "super bowl", "superbowl", "world series", "stanley cup", "world cup", "march madness", "fantasy football",
    "fantasy league", "49ers", "niners", "warriors", "lakers", "celtics", "dodgers", "yankees", "sharks", "raiders",
    "chiefs", "cowboys", "real madrid", "barcelona", "barca", "manchester united", "man united", "lebron", "steph curry",
    "stephen curry", "messi", "ronaldo", "mahomes", "ohtani", "taylor swift", "kardashians?", "kanye", "drake",
    "beyonce", "bieber", "selena gomez", "travis kelce", "mrbeast", "mr beast", "ishowspeed", "kai cenat", "celebrity",
    "celebrities", "celeb", "celebs", "gossip", "met gala", "oscars", "grammys", "bitcoin", "btc", "crypto",
    "cryptocurrency", "ethereum", "dogecoin", "nfts?", "stock market", "stocks", "stock price", "day trading", "forex",
    "gambling", "casino", "sports betting", "lottery", "trump", "biden", "kamala", "democrats?", "republicans?",
    "congress", "presidential", "fortnite", "minecraft", "roblox", "valorant", "call of duty", "gta",
    "league of legends", "netflix", "anime", "recipe", "recipes", "horoscope", "zodiac", "elon musk", "famosos?",
    "farandula", "criptomonedas?", "apuestas"]) + "\\b");
  var WEATHER = /\b(?:weather|forecast|temperature outside|going to rain|gonna rain|will it rain|clima|va a llover)\b/;

  // Self-harm and abuse wording, split by kind (the reply differs) and by language (the
  // reply comes in the language the student wrote in, whatever the app is set to).
  var SELF_EN = new RegExp("\\b" + alt(["kill myself", "killing myself", "kms", "suicide", "suicidal", "end my life",
    "ending my life", "end it all", "take my (?:own )?life", "want to die", "wanna die", "want to be dead",
    "wish i (?:was|were) dead", "better off dead", "do not want to (?:live|be alive|exist|wake up)",
    "do not want to be here (?:anymore|any more)", "(?:dont|do not) wanna be here (?:anymore|any more)",
    "no reason to live", "hurt myself", "hurting myself", "harm myself", "self harm", "self harming", "cut myself",
    "cutting myself", "cutting again", "cut again", "started cutting", "(?:been|keep|kept|i am|i was|i have been) cutting(?! (?:class|classes|school|it close|onions?|hair|the line|weight|paper|corners|back|out))",
    "(?:nobody|no one|noone) would (?:care|notice|miss me)", "better off without me",
    "(?:want|wanna|wish i could) (?:to )?disappear", "overdose", "overdosed", "hang myself", "unalive",
    "(?:dont|do not|can not|cant|cannot) see (?:the|any) points? (?:in|of) (?:living|life|going on|anything|being alive)",
    "no points? (?:in |to )?(?:living|life|going on|being alive)", "(?:cant|can not|cannot) go on", "(?:want|wanna) (?:to )?end (?:it|everything)",
    "took (?:a bunch of|a lot of|too many|all (?:my|the|of my)|a handful of) (?:pills|meds|medicine|tylenol|advil)", "swallowed (?:a bunch of |too many |all (?:my|the) )?pills",
    "(?:friend|she|he|they|someone|somebody|my (?:sister|brother|friend|bf|gf|boyfriend|girlfriend)) (?:said|says|told me|keeps saying|is talking about) (?:she|he|they|that (?:she|he|they))? ?(?:wants? to die|wanna die|wants? to kill (?:herself|himself|themselves|themself)|is going to kill (?:herself|himself|themselves)|is suicidal|wants? to end (?:it|her life|his life|their life))",
    "(?:wants? to|going to|gonna) kill (?:herself|himself|themselves|themself)", "talking about (?:suicide|killing (?:herself|himself|themselves))"]) + "\\b");
  var SELF_ES = new RegExp("\\b" + alt(["suicidio", "suicidarme", "suicida", "matarme", "me quiero matar", "quiero morir(?:me)?",
    "me quiero morir", "no quiero vivir", "quitarme la vida", "hacerme dano", "lastimarme",
    "(?:cortarme|me estoy cortando|me sigo cortando|me corto)(?! (?:el|los|las|la) (?:pelo|cabello|unas|flequillo|fleco|dedo))", "autolesion(?:es)?", "(?:ya )?no quiero estar aqui", "quiero desaparecer",
    "nadie me extranaria", "a nadie le importaria", "nadie se daria cuenta", "no (?:le )?veo (?:el )?sentido a (?:la vida|vivir|nada)",
    "me tome (?:un monton de |muchas |todas (?:mis|las) )?pastillas", "(?:quiere|se quiere) (?:morir|matar)", "se va a matar", "no puedo mas"]) + "\\b");
  var ABUSE_EN = new RegExp("\\b" + alt(["abuse", "abused", "abusing me", "abusive", "molest", "molested", "touched me",
    "touches me", "raped", "rape", "(?:hits|beats|chokes|slaps|kicks) me", "(?:hitting|beating|choking) me",
    "someone is hurting me", "(?:not|dont feel) safe at home", "unsafe at home", "(?:scared|afraid) to go home"]) + "\\b");
  var ABUSE_ES = new RegExp("\\b" + alt(["me pegan", "me pega", "me golpean", "me golpea", "me lastiman", "me lastima",
    "abuso", "abusan", "abusaron", "abusando", "me tocaron", "me violaron", "violacion",
    "no estoy (?:segura?|a salvo) en (?:mi )?casa", "miedo de (?:ir|volver) a (?:mi )?casa"]) + "\\b");
  var CRISIS_OK = /\b(?:prevention|awareness|week|month|walk|club|drug abuse|substance abuse|prevencion|abuso de (?:drogas|sustancias))\b/;
  var DANGER = new RegExp("\\b" + alt(["threat", "threats", "threaten", "threatened", "threatening", "going to",
    "gonna", "plans? to", "said (?:he|she|they)", "will", "bring", "brought", "bringing", "has a", "have a", "amenazo",
    "amenaza", "va a", "trajo"]) + "\\b.*\\b" + alt(["gun", "guns", "knife", "weapon", "bomb", "shoot", "shooting",
    "shoot up", "stab", "pistola", "arma", "cuchillo", "bomba", "disparar"]) + "\\b");

  var DANGER2 = new RegExp("\\b(?:" + [
    "(?:i|im|i am|ima|i might|i may|i will|i wanna|i want to|i am going to|im going to|im gonna|i could) (?:\\w+ )?(?:hurt|kill|shoot|stab|attack|beat up) (?:someone|somebody|people|everyone|everybody|a kid|a student|a teacher|him|her|them|my (?:teacher|classmate))",
    "(?:gun|guns|knife|weapon|bomb|pistol) (?:at|in|on|to) (?:school|campus|class|the school)",
    "(?:kid|student|someone|somebody|guy|girl|person|he|she) (?:with|has|had|brought|is carrying) (?:a )?(?:gun|knife|weapon|bomb|pistol)",
    "(?:voy a|quiero) (?:lastimar|matar|disparar) a (?:alguien|todos|un maestro)", "(?:pistola|arma|cuchillo|bomba) en (?:la )?escuela"
  ].join("|") + ")\\b");
  var UNSAFE = [
    /\b(?:buy|get|find|sell|score|where can i get|plug|hook me up|conseguir|comprar)\b.*\b(?:weed|drugs|vape|vapes|carts|thc|alcohol|beer|liquor|edibles|pills|xanax|adderall|fake id|drogas|marihuana|alcohol|cerveza)\b/,
    /\bhow (?:to|do i|can i|do you) (?:make|build|get) (?:a |an )?(?:bomb|gun|weapon|explosive|meth|poison)\b/,
    /\b(?:hack|hacking|hacker|ddos|bypass securly|get around securly|bypass the filter|hackear)\b/,
    /\b(?:change|edit|fake|alter) my (?:grade|grades|transcript)\b/,
    /\bhow (?:to|do i|can i) cheat\b|\bcheat (?:on|in) (?:the|my|a)\b|\bcopiar en el examen\b/,
    /\b(?:porn|nudes|nude|horny|hookup|hook up with|onlyfans|boobs|dick|penis|vagina|sexting|sexo)\b/,
    /\bsex\b(?! ed\b| education\b)/,
    // breaking school rules or the law without getting caught
    /\b(?:vape|vaping|vapes|juul|smoke|smoking|weed|drink|drinking|alcohol|drunk|high|drugs|edibles|thc|nicotine|skip|skipping|ditch|ditching|cut class|sneak|steal|shoplift)\b.*\b(?:without (?:getting |being )?caught|not get caught|get away with|so no one (?:sees|knows)|hide it from|where to hide)\b/,
    /\b(?:without (?:getting |being )?caught|get away with)\b.*\b(?:vape|vaping|smoke|smoking|weed|drink|drinking|alcohol|drugs|skip|skipping|ditch)\b/,
    /\bhow (?:to|do i|can i|do you) (?:vape|smoke weed|get high|get drunk|sneak (?:out|in|alcohol|a vape))\b/,
    /\b(?:most illegal|something illegal|illegal things?|commit a crime|how to steal)\b/,
    // bullying or embarrassing someone
    /\b(?:write|send|make|give me|draft|come up with|help me (?:write|make))\b(?:(?!\b(?:about|for|regarding|after|because|from)\b).)*\b(?:mean|rude|nasty|cruel|hurtful|savage|embarrassing|insulting)\b(?: \w+){0,2} (?:message|text|comment|post|note|roast|insult|joke|caption)s?\b/,
    /\broast(?:s|ing)? (?:a|this|that|some|my|the|her|him|them) (?:kid|guy|girl|person|student|classmate|teacher|freshman|freshmen|boy)\b/,
    /\b(?:how (?:do|can|should) i|help me|ways to|best way to|ideas to|write)\b.*\b(?:bully|cyberbully|insult|humiliate|make fun of|roast)\b(?! me\b)/
  ];
  // Answers to a graded quiz or test: Felipe offers practice questions instead.
  var CHEAT = /\b(?:get|give|send|need|want|find|have|share|leak|steal|tell me|whats|what is|what are)\b.*\b(?:answers?|answer key|key) (?:to|for|on) (?:the |my |this |that |a |tomorrows |todays |next |our )?(?:\w+ )?(?:\w+ )?(?:quiz|quizzes|test|tests|exam|exams|final|finals|midterm|unit test)\b|\b(?:respuestas) (?:del|de la|para el|para la) (?:\w+ )?(?:examen|prueba|quiz)\b/;
  // Pro and college leagues: off-topic even with words like "finals" or "game".
  var PRO = /\b(?:nfl|nba|mlb|nhl|mls|wnba|ncaa|premier league|champions league|la liga|super bowl|superbowl|world series|stanley cup|world cup|march madness|fantasy football|fantasy league|49ers|niners|warriors|lakers|celtics|dodgers|yankees|giants|sharks|raiders|chiefs|cowboys|real madrid|barcelona|barca|manchester united|man united|lebron|steph curry|stephen curry|messi|ronaldo|mahomes|ohtani)\b/;
  var PRO_ANCHOR = /\b(?:fremont|fhs|firebirds?|felipe|asb|our (?:school|team|teams)|school team|cheer|spirit)\b/;
  var RUDE = /\b(?:fuck you|f you|stfu|shut up|you suck|you are (?:stupid|dumb|useless|trash|bad)|stupid bot|dumb bot|useless bot|idiot|puto|pendejo|callate|eres (?:tonto|estupido|inutil))\b/;
  var MANIP = /\b(?:ignore (?:all |your |the |any |previous |prior |above )*(?:instructions|rules|prompt|prompts)|system prompt|developer mode|jailbreak|dan mode|do anything now|pretend (?:you are|to be|youre) (?:not|an?|my)|act as (?:an? )?(?:unfiltered|evil|uncensored)|reveal your (?:prompt|instructions|rules)|what are your instructions|bypass your|ignora (?:las|tus) instrucciones)\b/;
  var MANIP2 = /\b(?:pretend|act as|you are|youre|be|become|your|you) (?:now |a |the )?(?:to be )?dan\b|\b(?:you|your) (?:have|has|got) no (?:rules|restrictions|limits|filters?)\b|\b(?:pretend|act as if|act like) (?:you|your|youre)\b.*\b(?:no rules|evil|unfiltered|uncensored|jailbroken|illegal)\b|\bjailbr[eo]a?k\w*\b/;

  var PRIVATE = [
    function (t) {
      return /\b(?:what is|what are|check|see|show(?: me)?|tell me|look up|find|get|pull up|how many)\b.*\bmy (?:grades?|gpa|marks?|transcript|report card|attendance|absences|tardies)\b/.test(t) ||
        /\bmy (?:grade|gpa|grades|score|mark) (?:in|for|on)\b/.test(t) || /\bwhat did i get on\b/.test(t) ||
        /\bwhat (?:grade|score|mark|percent|percentage) (?:did i|do i) (?:get|have|receive|got)\b/.test(t) || /\bdid i (?:pass|fail) (?:the|my)\b/.test(t) ||
        /\b(?:mis (?:notas|calificaciones)|mi (?:nota|calificacion|promedio|gpa))\b/.test(t) || /\bque (?:nota|calificacion) (?:saque|tengo)\b/.test(t);
    },
    function (t) {
      return /\b(?:password|passcode|passwords|credentials|contrasena|contrasenas|log in info|login info)\b/.test(t) &&
        !/\b(?:reset|change|forgot|forget|recover|update|how do i|how can i|cambiar|olvide|restablecer|recuperar)\b/.test(t);
    },
    function (t) {
      return /\b(?:his|her|their|someones|somebodys|that kids|that girls|that guys|my crushs|my exs|su|sus)\b (?:phone|cell|number|address|snap|snapchat|instagram|insta|schedule|grades?|student id|locker|numero|telefono|direccion|horario|notas)\b/.test(t) ||
        /\bwhere does (?!the |a |our |my )\w+ live\b/.test(t) || /\b(?:phone number|home address|cell number|student id) (?:of|for)\b/.test(t) ||
        /\bwho is \w+ (?:dating|going out with)\b|\bis \w+ (?:single|dating)\b|\bwho likes me\b|\bdonde vive\b/.test(t);
    }
  ];
  // "<name>'s schedule/grades/address...", from the raw text. Common nouns that take 's are fine.
  var POSSESSIVE_INFO = /\b([a-z]+)['’]s (?:(?:class|school|bell|home|cell|phone|locker) )?(schedule|classes|grades?|gpa|address|phone|phone number|number|cell|locker(?: combo| combination)?|password|student id|snap|snapchat|instagram|insta)\b/i;
  var POSSESSIVE_OK = { today: 1, tomorrow: 1, todays: 1, week: 1, weeks: 1, month: 1, year: 1, school: 1, schools: 1, fremont: 1,
    team: 1, teams: 1, club: 1, clubs: 1, class: 1, everyone: 1, monday: 1, tuesday: 1, wednesday: 1, thursday: 1, friday: 1,
    saturday: 1, sunday: 1, senior: 1, seniors: 1, junior: 1, juniors: 1, girl: 1, girls: 1, boy: 1, boys: 1, felipe: 1,
    asb: 1, fhs: 1, homestead: 1, it: 1, that: 1, there: 1, what: 1, who: 1, here: 1, let: 1, he: 1, she: 1, next: 1, ms: 1, mr: 1, mrs: 1 };
  function otherPersonInfo(raw) {
    var m = String(raw || "").match(POSSESSIVE_INFO);
    if (!m) return false;
    var who = m[1].toLowerCase();
    if (POSSESSIVE_OK[who] || SCHOOL_TOK.test(who)) return false;
    // A teacher's or coach's schedule is public school info; their phone or address is not.
    if (/^(?:teacher|teachers|coach|coachs|counselor|counselors|principal|advisor|advisors)$/.test(who)) return !/schedule|classes/.test(m[2]);
    return true;
  }
  var OTHER_SCHOOL = new RegExp("\\b" + SCHOOLS + "s?\\b.*\\b" + alt(["bell schedule", "schedule", "clubs?", "teachers?",
    "students?", "lunch", "finals", "homework", "principal", "asb", "prom", "homecoming", "dance", "grades?", "rules",
    "horario", "maestros?"]) + "\\b|\\b" + alt(["bell schedule", "schedule", "clubs", "teachers", "students", "lunch",
    "finals", "principal", "asb", "prom", "homecoming", "horario"]) + "\\b.*\\b" + SCHOOLS + "s?\\b");
  var OTHER_SCHOOL_OK = new RegExp("\\b" + alt(["game", "games", "play", "playing", "vs", "versus", "against", "match",
    "meet", "score", "beat", "bell game", "fremont", "partido", "contra", SPORTW]) + "\\b");

  // Two patterns that must both match (cheaper than two lookaheads on long text).
  function both(a, b) { return { test: function (t) { return a.test(t) && b.test(t); } }; }
  // [intent, weight, regex]. Local intents get weight 3 or more only from patterns that are
  // specific enough to answer without a model.
  var RULES = [
    // ---- what period is it / time left
    ["period_now", 4, /\bwhat (?:period|class|block) (?:is it|is this|is now|are we in|am i in|is going on|now|right now)\b/],
    ["period_now", 3, /\b(?:what|which) period (?:are we|is it|is now|now|right now)\b/],
    ["period_now", 4, /\bis it (?:lunch|brunch|tutorial|passing period|passing)(?: time| period)?(?: now| right now| yet)?\s*$/],
    ["period_now", 3, /\bare we in (?:class|lunch|brunch|tutorial|passing)\b/],
    ["period_now", 2, /\b(?:current|this) period\b/],
    ["period_now", 1, /\bright now\b/],
    ["period_now", 4, /\b(?:que|cual|en que) (?:periodo|clase|bloque) (?:es|estamos|toca|hay|tenemos|vamos)\b/],
    ["period_now", 4, /\bya es (?:la hora del |hora del |el )?(?:almuerzo|brunch|recreo)\b/],
    ["time_left", 4, /\bhow (?:much|many) (?:time|minutes|mins|min)(?: is| are| do we have)? (?:left|remaining)\b/],
    ["time_left", 3, /\b(?:time|minutes) (?:left|remaining)\b/],
    ["time_left", 4, /\bwhen (?:does|is|will) (?:this|the|my|current|our) (?:period|class|block) (?:end|over|done|finish)/],
    ["time_left", 3, /\b(?:when|what time) (?:does|do) (?:class|period) (?:end|finish|get out)\b/],
    ["time_left", 4, /\bhow long (?:until|till|til|before|is left in) (?:the )?(?:bell|class is over|period is over|this period|this class|class ends|period ends|end of (?:class|period))\b/],
    ["time_left", 3, /\bcuanto (?:tiempo )?(?:falta|queda)\b/],
    ["time_left", 4, /\bcuando (?:termina|acaba) (?:la|esta|el|este) (?:clase|periodo)\b/],
    // ---- bell times
    ["bell_time", 4, both(/\b(?:lunch|brunch|tutorial|school|classes|period \d|p ?\d|(?:first|second|third|fourth|fifth|sixth|seventh|last|1st|2nd|3rd|[4-7]th) period|almuerzo|recreo|escuela|clases|periodo \d|salida|entrada|dismissal)\b/, /\b(?:when|what time|how long until|how long till|how long til|start|starts|begin|begins|end|ends|over|get out|let out|finish|finishes|dismissed|a que hora|cuando|empieza|empiezan|comienza|comienzan|termina|terminan|acaba|acaban|salimos|sale|salen|entramos)\b/)],
    ["bell_time", 4, /\b(?:when|what time) (?:do|does|can) (?:we|i|school|students) (?:get|let) out\b/],
    ["bell_time", 4, /\bwhat (?:period|time) is (?:lunch|brunch|tutorial)\b/],
    ["bell_time", 3, /\bwhat time is (?:school|dismissal) (?:out|over)\b/],
    ["bell_time", 4, /\ba que hora (?:salimos|entramos|es el almuerzo|es el recreo|termina|empieza)\b/],
    // ---- A day / B day / today's schedule
    ["day_type", 5, /\b(?:an? )?a (?:day )?or (?:an? )?b(?: day)?\b|\bdia a o (?:dia )?b\b/],
    ["day_type", 5, new RegExp("\\bis (?:it|today|tomorrow|this|that|" + WD + "|next " + WD + ") (?:an? )?(?:a|b) day\\b(?! off| of)")],
    ["day_type", 4, /\b(?:a|b) day (?:today|tomorrow|on \w+)\b/],
    ["day_type", 4, /\bwhat (?:kind|type) of (?:day|schedule)\b/],
    ["day_type", 3, /\bwhat day is (?:it|today|tomorrow)\b/],
    ["day_type", 3, new RegExp("\\bwhat is (?:the |today |tomorrow |my )?(?:bell )?schedule(?: (?:for |on )?(?:today|tomorrow|" + WD + "))?\\s*$")],
    ["day_type", 4, new RegExp("\\b(?:bell )?schedule (?:for |on )?(?:today|tomorrow|" + WD + ")\\b")],
    ["day_type", 4, /\b(?:today|tomorrow) schedule\b/],
    ["day_type", 3, /\b(?:do|does) (?:we|i) have (?:period|p) ?\d\b/],
    ["day_type", 4, /\b(?:es|sera) (?:hoy|manana|el \w+) (?:un )?dia (?:a|b)\b|\bdia (?:a|b) (?:hoy|manana)\b|\b(?:hoy|manana) (?:es|sera) (?:un )?dia (?:a|b)\b/],
    ["day_type", 4, /\bque (?:horario|dia) (?:es|hay|tenemos|toca)(?: hoy| manana)?\b/],
    ["day_type", 4, new RegExp("\\bhorario (?:de |para )?(?:hoy|manana|" + WD + ")\\b")],
    // ---- is there school
    ["school_on", 4, /\b(?:is there|will there be|do we have|we have|any|have|is there going to be) (?:school|class|classes)\b(?! club)/],
    ["school_on", 4, /\bno school\b|\bdays? off\b|\bno classes\b/],
    ["school_on", 3, /\b(?:is school|are we) (?:open|off|closed|on)\b/],
    ["school_on", 4, /\b(?:thanksgiving|winter|spring|mid ?year|christmas|holiday|presidents|ski|summer|fall) (?:break|vacation|week|holiday)\b/],
    ["school_on", 4, /\bwhen is (?:thanksgiving|veterans day|labor day|memorial day|mlk day|martin luther king day|presidents day)\b/],
    ["school_on", 4, /\b(?:next|upcoming) (?:break|holiday|day off|long weekend|vacation)\b/],
    ["school_on", 4, /\b(?:back to school|go back to school|school starts again|classes start again|first day back|return to school|resume)\b/],
    ["school_on", 4, /\bafter (?:the )?(?:break|thanksgiving|winter break|spring break|holiday|vacation)\b/],
    ["school_on", 2, /\bholidays?\b/],
    ["school_on", 3, new RegExp("\\b(?:school|class|classes|clases|escuela) (?:on )?(?:today|tomorrow|" + WD + "|hoy|manana)\\b")],
    ["school_on", 4, /\b(?:hay|habra|tenemos) (?:clases|escuela|colegio)\b|\bno hay (?:clases|escuela)\b/],
    ["school_on", 4, /\bdias? (?:libres?|festivos?|feriados?|sin clases)\b|\bvacaciones\b|\baccion de gracias\b/],
    ["school_on", 3, /\b(?:regresamos|volvemos) (?:a la escuela|a clases)\b/],
    // ---- events
    ["next_event", 4, /\b(?:next|upcoming|proximo|siguiente) (?:event|events|evento|eventos)\b/],
    ["next_event", 4, /\bwhat is (?:coming up|happening|going on|next|on the calendar)\b/],
    ["next_event", 4, /\bany(?:thing)? (?:events?|fun|happening|going on)\b/],
    ["next_event", 4, /\bevents? (?:this|next|today|tonight|tomorrow) ?(?:week|weekend|month)?\b/],
    ["next_event", 3, /\bwhat (?:events|is happening|is going on) (?:this|next|today|tonight|tomorrow|on)\b/],
    ["next_event", 4, new RegExp("\\b(?:when|what day|what time) (?:is|does|will) (?:the )?(?:next )?(?:\\w+ )?" + EVENTNOUN + "\\b")],
    ["next_event", 4, /\bque (?:eventos|pasa|esta pasando) (?:hay )?(?:esta|este|la proxima|hoy|manana)\b|\bque eventos hay\b/],
    ["next_event", 3, new RegExp("\\bcuando (?:es|sera) (?:el|la) (?:proxim[oa] )?" + EVENTNOUN + "\\b")],
    // ---- games
    ["next_game", 4, both(new RegExp("\\b" + SPORTW + "\\b"), new RegExp("\\b(?:next|when|what time|upcoming|coming up|tonight|today|tomorrow|this week|this weekend|this friday|who do we play|who are we playing|who is playing|play next|playing next|is there a|are there any|any games|proximo|proxima|cuando|a que hora|hoy|manana|esta semana|contra quien|juegan|juega)\\b"))],
    ["next_game", 3, /\b(?:home|away) (?:games?|matches|match|meets?)\b|\bpartidos? en casa\b/],
    // "do we play Homestead", "when does the team play": a game, not a theater play.
    ["next_game", 3, /\b(?:we|fremont|team|teams|firebirds) (?:play|playing|plays|face|facing)\b/],
    ["next_game", 4, /\b(?:when|what time|what day) (?:do|does|will|are) (?:we|fremont|our team|the team|our|the firebirds) (?:play|playing|face)\b|\bwho (?:do|are) we (?:play|playing)\b/],
    // ---- spirit standings
    ["spirit_standings", 4, /\bspirit (?:points?|standings?|score|scores|leaderboard|board|race|rankings?|totals?)\b/],
    ["spirit_standings", 4, /\b(?:which|what) (?:class|grade) (?:is )?(?:winning|in first|ahead|leading|on top|has the most)\b/],
    ["spirit_standings", 4, /\bwho is (?:winning|leading|ahead|in first)\b.*\b(?:spirit|class|classes|grades?|seniors|juniors|sophomores|freshmen)\b/],
    ["spirit_standings", 4, /\b(?:seniors|juniors|sophomores|freshmen|freshman)\b.*\b(?:winning|ahead|in first|losing|in last)\b/],
    ["spirit_standings", 4, /\bpuntos de espiritu\b|\bque (?:clase|grado) (?:va )?(?:ganando|gana|primero|adelante)\b|\bquien va ganando\b/],
    // ---- announcements
    ["announcements_today", 3, /\b(?:morning )?announcements?\b|\banuncios?\b/],
    // ---- small talk
    ["greeting", 6, /^\s*(?:hi|hello|hey|hey there|yo|sup|hola|buenas|buenos dias|buenas tardes|good morning|good afternoon|what is up|howdy|hiya)(?: felipe| there| bro| friend)?\s*$/],
    ["thanks", 6, /^\s*(?:thanks|thank you|gracias|muchas gracias)\b(?: (?:so much|a lot|felipe|muy amable|eres muy amable|mucho|for (?:the|your) help|for helping|por (?:la|tu) ayuda|bro|man))*\s*$/],
    ["thanks", 6, /^\s*(?:thanks|thank you|thanks a lot|ok thanks|okay thanks|cool thanks|great thanks|awesome thanks|gracias|muchas gracias|ok gracias|perfect|perfecto|got it|ok|okay|cool|nice|awesome|great)(?: so much| felipe| a lot| mucho)?\s*$/],
    ["capabilities", 6, /\b(?:what can you (?:do|help(?: me)? with)|what do you do|who are you|what are you|how (?:do|does) (?:this|felipe|you) work|what can i ask|que puedes hacer|quien eres|en que (?:me )?puedes ayudar)\b/],
    // ---- model intents
    ["assignments", 2, /\b(?:assignments?|homework|due|quiz|quizzes|tests?|exams?|projects?|essay|lab report|worksheet|schoology|deadlines?|tareas?|deberes|entrega|entregar|examen(?:es)?|pruebas?|proyectos?)\b/],
    ["assignments", 2, /\b(?:my|mis|mi|this|esta) (?:assignments?|homework|quiz|tests?|essay|projects?|tareas?|examen|proyecto)\b/],
    ["assignments", 3, /\bwhat is due\b|\bdue (?:today|tomorrow|this week|next week|on|soon)\b|\bque (?:tengo|hay) (?:de tarea|que entregar|para entregar)\b/],
    ["assignments", 4, /\bsummar\w* (?:this|my|the|that) (?:assignment|homework|quiz|test|essay|project|lab)\b|\bresum\w* (?:la|mi|esta) (?:tarea|asignacion|proyecto)\b|\bwhat is (?:this|my|the) (?:assignment|homework|project|essay) about\b/],
    ["clubs", 3, /\bclubs?\b|\bclubes\b/],
    ["clubs", 2, /\b(?:robotics|deca|fbla|key club|mock trial|speech and debate|debate|model un|mun|hosa|interact|nhs|csf|gsa|bsu|msa|astrophysics|science olympiad|chess|kpop|k pop)\b/],
    ["sports", 1, new RegExp("\\b" + SPORTW + "\\b")],
    ["sports", 3, /\b(?:score|scores|won|win|lose|lost|beat|result|results|record|how did|final score|roster|tryouts?|coach|clearance|register for|physical|meeting|meetings|practice|practices|reunion|gano|ganamos|perdimos|resultado|marcador|entrenador)\b/],
    ["events", 2, new RegExp("\\b" + EVENTNOUN + "\\b")],
    ["events", 1, /\bevents?\b|\beventos?\b|\btickets?\b|\bboletos?\b/],
    ["spirit", 2, /\bspirit\b|\bdress ?up\b|\bspirit (?:week|wear|days?)\b|\bclass colors?\b|\bespiritu\b/],
    ["schedule", 2, /\b(?:bell schedule|finals|final exams|finals week|caaspp|minimum day|min day|late start|early release|special schedule|rally schedule|horario|finales)\b/],
    // "When are final exams?" / "¿Cuándo son los exámenes finales?" is the finals schedule, not homework.
    ["schedule", 2, /\b(?:final exams?|finals week|examen(?:es)? finales?|semana de finales)\b/],
    ["schedule", 1, /\b(?:schedule|periods?|tutorial)\b/],
    ["announcements", 2, /\bannouncements?\b|\banuncios?\b/],
    ["app_help", 3, /\b(?:this app|the app|firebird hub|sign in|signin|log in|login|sign out|connect schoology|schoology link|ical|install|home screen|notifications?|dark mode|language|spanish mode|settings|report a bug|bug|contact form|aplicacion|configuracion|idioma|iniciar sesion)\b/],
    ["writing", 3, /\b(?:write|draft|compose|email|e mail|letter|message to|note to|speech|proposal|cover letter|personal statement|caption|poster|flyer|rewrite|proofread|edit my|grammar|correo|carta|escribe|escribir|redacta|redactar|mensaje para)\b/],
    ["planning", 4, /\bwhat should i (?:do|work on|start|study|finish) (?:first|next|today|tonight|now)\b|\b(?:get|getting) (?:everything|it all|all (?:of )?(?:my|this)) done\b|\bcatch up on\b|\b(?:make|build|give) me a (?:plan|schedule|study plan|study schedule)\b|\bplan (?:my|out my|for my)\b/],
    ["planning", 3, /\b(?:plan|planning|organize|schedule my|time management|to do list|todo list|prioritize|procrastinat\w*|planear|organizar|organizarme|planifica)\b/],
    ["study", 2, /\b(?:explain|define|definition|meaning of|help me (?:understand|study|with)|study|studying|quiz me|flashcards?|practice (?:problems|questions)|study tips|review|solve|equation|formula|thesis|outline|math|algebra|geometry|calculus|precalc|stats|statistics|chemistry|chem|biology|bio|physics|history|apush|english|literature|french|chinese|economics|psychology|computer science|python|java|coding|sat|act|psat|test prep|estudiar|explica|explicame|repasar|matematicas|quimica|biologia|fisica|historia|ingles)\b/],
    ["study", 3, /\bquiz me\b|\bflashcards?\b|\bpractice (?:problems|questions)\b/],
    ["guidance", 3, /\b(?:college|colleges|university|universities|applications?|scholarships?|internships?|jobs?|volunteer|volunteering|community service|service hours|counselors?|graduation|graduate|credits|a g requirements|recommendation letter|careers?|universidad|becas?|consejer[oa]|graduacion|creditos|voluntariado)\b/],
    ["wellbeing", 3, /\b(?:stress|stressed|stressful|anxious|anxiety|overwhelmed|sad|lonely|depressed|tired|burnout|burned out|burnt out|nervous|bullied|bully|bullying|friendship|motivation|unmotivated|estres|estresad[oa]|ansiedad|triste|sol[oa]|agobiad[oa]|acoso)\b/]
  ];
  var LOCAL_INTENTS = { period_now: "schedule", time_left: "schedule", bell_time: "schedule", day_type: "schedule",
    school_on: "schedule", next_event: "events", next_game: "sports", spirit_standings: "spirit",
    announcements_today: "announcements", greeting: "general", thanks: "general", capabilities: "app_help" };
  // Tie-breaker: earlier wins.
  var PRIORITY = ["capabilities", "greeting", "thanks", "spirit_standings", "day_type", "school_on", "time_left",
    "period_now", "bell_time", "announcements_today", "next_game", "next_event", "assignments", "clubs", "sports",
    "events", "spirit", "schedule", "announcements", "app_help", "writing", "planning", "guidance", "wellbeing", "study"];
  var PRI = {}; PRIORITY.forEach(function (k, i) { PRI[k] = i; });

  // Context sections the server should load for each intent ("digest" = compact next-3-weeks list).
  var INTENT_SECTIONS = {
    period_now: ["schedule"], time_left: ["schedule"], bell_time: ["schedule"], day_type: ["schedule"],
    school_on: ["schedule"], schedule: ["schedule", "digest"],
    next_event: ["events", "digest"], events: ["events", "announcements", "digest"],
    next_game: ["sports"], sports: ["sports"],
    spirit_standings: ["spirit"], spirit: ["spirit", "events"],
    announcements_today: ["announcements"], announcements: ["announcements"],
    clubs: ["clubs", "events"], assignments: ["assignments", "schedule"],
    study: ["assignments"], writing: ["clubs", "events", "assignments"], planning: ["assignments", "schedule", "digest"],
    guidance: ["digest"], wellbeing: [], app_help: ["app"],
    greeting: [], thanks: [], capabilities: ["app"], general: ["digest", "schedule"]
  };

  var SPANISH = /\b(?:que|cuando|donde|como|cual|hay|el|la|los|las|del|para|por|mis?|tengo|hoy|manana|clases?|horario|partido|almuerzo|escuela|puedes|ayuda|quiero|necesito|esta|estoy|semana|proximo|cuanto|tarea|tareas|anuncios|eres|hola|gracias|es|un|una|de|en|y|con|sobre)\b/g;
  var ENGLISH = /\b(?:the|is|what|when|where|how|are|do|does|my|i|you|we|today|tomorrow|next|lunch|school|game|class|it|a|an|of|to|in|on|and|for|with|about|there)\b/g;
  function guessLang(raw, n, fallback) {
    if (/[¿¡ñ]/.test(raw)) return "es";
    var es = (n.match(SPANISH) || []).length, en = (n.match(ENGLISH) || []).length;
    if (es >= 2 && es > en) return "es";
    if (en >= 2 && en > es) return "en";
    return fallback === "es" ? "es" : (fallback === "en" ? "en" : (es > en ? "es" : "en"));
  }

  var FOLLOW_START = /^(?:what about|how about|and|also|what if|for|on|the|y|y el|y la|y los|y las|que tal|y para|and for|and the|same for|what about for)\b/;
  var FOLLOW_STRIP = /^(?:(?:and )?what about(?: for)?|how about|and(?: for| the| what about)?|also|same for|que tal|y(?: para| el| la| los| las)?)\s*/;
  // A follow-up may only borrow the last question when every word it adds is a refinement the
  // last question's answer can use: a team, level, day, date, time, period or place word.
  var FRAG = {};
  ("the a an for on at in of to then one ones team teams game games match matches meet meets night senior home away " +
    "girls girl boys boy womens mens varsity jv frosh fs soph sophomore freshman level levels sport sports " +
    "today tonight tomorrow yesterday this next week weekend morning afternoon evening day days time times start starts end ends " +
    "monday tuesday wednesday thursday friday saturday sunday tues thurs fri jan january feb february mar march apr april may jun june " +
    "jul july aug august sep sept september oct october nov november dec december first second third last st nd rd th " +
    "period periods p lunch brunch tutorial school class classes a day b day schedule bell " +
    "football flag basketball hoops soccer volleyball water polo waterpolo tennis cross country xc field hockey wrestling badminton " +
    "baseball softball golf swim swimming diving track lacrosse " +
    "hoy manana el la los las de del para en y chicas chicos nina ninas nino ninos hija hijo varonil femenil partido partidos juego juegos " +
    "lunes martes miercoles jueves viernes sabado domingo semana proxima proximo almuerzo recreo periodo clases escuela casa").split(" ")
    .forEach(function (w) { FRAG[w] = 1; });
  var SCHOOL_TOK = new RegExp("^" + SCHOOLS + "$"), SCHOOL_ANY = new RegExp("\\b" + SCHOOLS + "\\b");
  function isFragment(n) {
    var rest = n.replace(FOLLOW_STRIP, "").trim();
    if (!rest) return false;
    var toks = rest.split(" ");
    for (var i = 0; i < toks.length; i++) {
      var w = toks[i];
      if (FRAG[w] || /^\d{1,2}(?::\d{2})?(?:st|nd|rd|th|am|pm)?$/.test(w) || /^\d{1,2}\/\d{1,2}$/.test(w) || /^p\d$/.test(w)) continue;
      if (SCHOOL_TOK.test(w) || SCHOOL_ANY.test(rest)) continue;
      return false;
    }
    return true;
  }
  var OWN_QUESTION = /\b(?:who|whos|where|why|which|can i|could i|should i|do i|may i|is the|are the|what is|what are|how (?:do|does|can|much|many)|quien|donde|por que|puedo|cual|cuanto)\b/;
  var SMALLTALK = /^\s*(?:thanks?|thank you|thx|gracias|muchas gracias|ok|okay|cool|nice|great|awesome|perfect|perfecto|got it|vale|bueno|hi|hello|hey|hola|bye|adios)\b/;
  var NEEDS_SGY = /\b(?:my|mis|mi|this|the|esta|that) (?:assignments?|homework|quiz|tests?|essay|projects?|lab|worksheet|tareas?|examen|proyecto|prueba)\b|\bschoology\b|\bdue\b|\bque (?:tengo|hay) de tarea\b|\bentregar\b/;
  var SCHED_SPECIAL = /\b(?:finals|final exams|caaspp|testing|minimum day|min day|late start|early release|rally|career day|special schedule|assembly|finales)\b/;
  var STANDINGS_HOW = /\b(?:how|earn|get|gain|work|works|submit|ganar|como|conseguir|rules|reglas)\b/;
  var ANN_LOCAL = /\b(?:today|latest|new|recent|this morning|what are|what were|any|read|show|hoy|ultimos|nuevos|de hoy|cuales son)\b|^\s*(?:morning )?announcements?\s*$|^\s*anuncios?\s*$/;
  var ANN_LLM = /\b(?:about|regarding|mention|mentioned|say about|said about|sobre|how do i|submit|make an|post an|add an|send an|get my)\b/;

  function scoreAll(t) {
    var s = {};
    for (var i = 0; i < RULES.length; i++) {
      var r = RULES[i];
      if (r[2].test(t)) s[r[0]] = (s[r[0]] || 0) + r[1];
    }
    return s;
  }
  function pickBest(s) {
    var best = null, bs = 0;
    for (var k in s) {
      if (!Object.prototype.hasOwnProperty.call(s, k)) continue;
      if (s[k] > bs || (s[k] === bs && best !== null && PRI[k] < PRI[best])) { best = k; bs = s[k]; }
    }
    return { intent: best, score: bs };
  }

  function classifyCore(raw, ctx, depth) {
    var n = norm(raw), t = " " + n + " ";
    var lang = guessLang(String(raw || ""), n, ctx && ctx.lang);
    var res = function (route, intent, extra) {
      var o = { route: route, intent: intent, lang: lang, needsAssignments: false };
      if (extra) for (var k in extra) o[k] = extra[k];
      return o;
    };
    if (!n.trim()) return res("cannot", "empty", { reason: "empty" });

    // 1. Safety first: danger, then self-harm and abuse. The reply uses the language of the
    //    words that matched (a Spanish "me quiero morir" in an English app gets Spanish).
    if ((DANGER.test(t) || DANGER2.test(t)) && !/\b(?:drill|drills|video game|movie|nerf|water gun|glue gun|hot glue)\b/.test(t)) return res("crisis", "danger", { reason: "danger" });
    var selfEn = SELF_EN.test(t), selfEs = SELF_ES.test(t), abEn = ABUSE_EN.test(t), abEs = ABUSE_ES.test(t);
    if ((selfEn || selfEs || abEn || abEs) && !(CRISIS_OK.test(t) && !/\b(?:i|me|my|myself|yo|me)\b.*\b(?:want|wanna|going|quiero|voy)\b/.test(t))) {
      var es = selfEs || abEs, en = selfEn || abEn;
      if (es && !en) lang = "es"; else if (en && !es) lang = "en";
      return res("crisis", "crisis", { reason: selfEn || selfEs ? "crisis" : "abuse" });
    }

    // 2. Requests Felipe must refuse. A feature that is turned off gets a plain "not available".
    if (/\b(?:fire ?bucks?|bird ?bucks?|firebird card|firebird bucks)\b/.test(t)) return res("cannot", "unavailable", { reason: "unavailable" });
    if (MANIP.test(t) || MANIP2.test(t)) return res("cannot", "manipulation", { reason: "manipulation" });
    for (var u = 0; u < UNSAFE.length; u++) if (UNSAFE[u].test(t)) return res("cannot", "unsafe", { reason: "unsafe" });
    if (CHEAT.test(t)) return res("cannot", "cheat", { reason: "cheat" });
    if (RUDE.test(t)) return res("cannot", "rude", { reason: "rude" });
    var improving = /\b(?:improve|raise|bring up|boost|increase|better|help me|tips|how (?:do|can) i (?:get|raise|improve|bring)|mejorar|subir)\b/.test(t);
    if (!improving && PRIVATE[1](t)) return res("cannot", "password", { reason: "password" });
    for (var p = 0; p < PRIVATE.length; p++) if (!improving && PRIVATE[p](t)) return res("cannot", "private", { reason: "private" });
    if (otherPersonInfo(raw)) return res("cannot", "private", { reason: "private" });
    if (OTHER_SCHOOL.test(t) && !OTHER_SCHOOL_OK.test(t)) return res("cannot", "other_school", { reason: "other_school" });

    var anchored = ANCHOR.test(t);
    if (PRO.test(t) && !PRO_ANCHOR.test(t)) return res("cannot", "offtopic", { reason: "offtopic" });
    if (OFFTOPIC.test(t) && !anchored) return res("cannot", "offtopic", { reason: "offtopic" });
    if (WEATHER.test(t) && !anchored) return res("cannot", "weather", { reason: "weather" });

    // 3. Score the school intents.
    var scores = scoreAll(t);
    // "When does the school dance start" is about the dance, not the bell.
    if (scores.bell_time && ((scores.events || 0) >= 2 || scores.next_game || (scores.clubs || 0) >= 3)) scores.bell_time -= 3;
    var b = pickBest(scores);
    var intent = b.intent, score = b.score;
    var tokCount = n.split(" ").length;

    // Short follow-up: borrow the last user question ("Girls", "what about Friday"), but only
    // when the new words are a pure refinement. "who is the principal", "whats the wifi",
    // "tickets?" or "gracias, muy amable" stand on their own.
    if (depth === 0 && ctx && Array.isArray(ctx.history) && tokCount <= 6 &&
        (FOLLOW_START.test(n) || !intent || (score <= 1 && tokCount <= 4)) && intent !== "greeting" && intent !== "thanks" &&
        !SMALLTALK.test(n) && !OWN_QUESTION.test(n.replace(FOLLOW_STRIP, "")) && isFragment(n)) {
      var prev = "";
      for (var h = ctx.history.length - 1; h >= 0; h--) {
        var turn = ctx.history[h];
        if (turn && turn.role === "user" && typeof turn.text === "string" && turn.text.trim()) { prev = turn.text; break; }
      }
      if (prev) {
        // "and lunch?" or "what about tomorrow" after "what period is it" asks about lunch or
        // that day's schedule, not the current period again.
        var prevC = classifyCore(prev, { lang: lang }, 1);
        var frag = n.replace(FOLLOW_STRIP, "").trim();
        if (prevC.intent === "period_now" || prevC.intent === "time_left") {
          var alt1 = /\b(?:lunch|brunch|tutorial|almuerzo|recreo|period \d|periodo \d|p\d)\b/.test(frag) ? "when is " + frag
            : (new RegExp("\\b(?:" + DAYW + "|" + WD + "|manana)\\b").test(frag) ? "what is the schedule " + frag : "");
          if (alt1) { var r3 = classifyCore(alt1, { lang: lang }, 1); if (r3.route === "local" || r3.route === "llm") { r3.resolved = alt1; r3.followUp = true; r3.lang = lang; return r3; } }
        }
        var merged = String(prev).slice(0, 300) + " " + String(raw || "");
        var r2 = classifyCore(merged, { lang: lang }, 1);
        if ((r2.route === "local" || r2.route === "llm") && r2.intent !== "general") {
          r2.resolved = merged; r2.followUp = true; r2.lang = lang;
          return r2;
        }
      }
    }

    if (!intent) intent = "general";
    // A request to make something (plan, explain, draft) that also names a day or break is a
    // planning or writing request, not a bell-schedule lookup.
    if (LOCAL_INTENTS[intent] && GEN.test(t)) {
      var gen = null, gs = 0;
      ["planning", "writing", "study", "assignments", "guidance", "wellbeing"].forEach(function (k) { if ((scores[k] || 0) > gs) { gs = scores[k]; gen = k; } });
      if (gen && gs >= 2) { intent = gen; score = gs; }
    }
    var needs = NEEDS_SGY.test(t) || intent === "assignments" || intent === "planning" ||
      ((intent === "study" || intent === "writing") && /\b(?:my|mis|mi|due|homework|assignments?|tests?|quiz|quizzes|exam|essay|project|week|today|tonight|tomorrow|tarea|tareas|examen)\b/.test(t));

    if (LOCAL_INTENTS[intent]) {
      var fallback = LOCAL_INTENTS[intent];
      var exact = intent === "greeting" || intent === "thanks" || intent === "capabilities";
      var local = score >= 3 && tokCount <= 24 && (exact || !GEN.test(t));
      if (local && (intent === "bell_time" || intent === "day_type" || intent === "period_now" || intent === "time_left") && SCHED_SPECIAL.test(t)) local = false;
      if (local && intent === "spirit_standings" && STANDINGS_HOW.test(t)) { local = false; fallback = "spirit"; }
      if (local && intent === "announcements_today" && (ANN_LLM.test(t) || !ANN_LOCAL.test(t))) local = false;
      if (local && intent === "next_game" && (scores.sports || 0) >= 4) local = false;   // scores, results, tryouts
      // "Firebird Football" is the Homecoming class-vs-class spirit event, not a team.
      if (local && (intent === "next_game" || intent === "next_event") && /\bfirebird football\b/.test(t)) { local = false; fallback = "events"; }
      // Past tense ("when was senior night", "did we win") needs results, not the next game.
      if (local && (intent === "next_game" || intent === "next_event") && /\b(?:was|were|did|last|ago|yesterday|happened|ayer|fue|paso)\b/.test(t)) local = false;
      if (local && /\brancho\b/.test(t)) local = false;
      if (local && intent === "next_game" && (scores.clubs || 0) >= 3) { local = false; fallback = "clubs"; }
      if (local && intent === "next_event" && (scores.clubs || 0) >= 3 && !/\b(?:clubs? (?:day|fair|trivia|grub)|grub day|trivia night|multicultural)\b/.test(t)) { local = false; fallback = "clubs"; }
      if (local && needs && !exact) local = false;
      if (local) return res("local", intent, { needsAssignments: false });
      intent = fallback;
    }
    return res("llm", intent, { needsAssignments: needs });
  }

  function classify(question, ctx) {
    var t0 = clock();
    var r;
    try { r = classifyCore(question, ctx || {}, 0); }
    catch (e) { r = { route: "llm", intent: "general", lang: (ctx && ctx.lang) === "es" ? "es" : "en", needsAssignments: false }; }
    r.ms = Math.round((clock() - t0) * 1000) / 1000;
    return r;
  }

  /* =====================================================================
     3. Canned replies
     ===================================================================== */
  var CANNOT = {
    en: {
      offtopic: "That one is outside what I can help with, since I stick to Fremont school life. I'm happy to help with your schedule, events, clubs, sports, spirit points, or your classes and assignments.",
      private: "I can't see grades, passwords or anyone's personal information, so I can't help with that one. For your own grades, check Infinite Campus or Schoology, or ask your teacher.",
      password: "I can't share or look up passwords, including Wi-Fi passwords. The front office or the school's tech staff can help you get connected.",
      cheat: "I can't give answers to a quiz or test, but I can help you get ready for it. I can make practice questions, explain the topic, or help you plan your studying.",
      other_school: "I only have information about Fremont High, so I can't answer for other schools. Their own website is the best place to check.",
      unsafe: "I can't help with that one. I'm happy to help with school, your classes or events. If something is worrying you, a counselor or a trusted adult can help.",
      manipulation: "I can't change how I work, but I'm happy to help with anything about school life at Fremont.",
      rude: "I'm here whenever you need help with your schedule, events, clubs, sports or classes.",
      weather: "I can't check the weather, so a weather app is your best bet. I can help with schedules, events and anything else about school.",
      empty: "Ask me anything about school, like your schedule, events, clubs, sports or your assignments.",
      unavailable: "That isn't part of Firebird Hub right now. I can help with events, sports, clubs, the bell schedule or spirit points.",
      default: "I can't help with that one, but I'm happy to help with anything about school life at Fremont."
    },
    es: {
      offtopic: "Eso está fuera de lo que puedo responder, porque solo ayudo con la vida escolar en Fremont. Con gusto te ayudo con tu horario, eventos, clubes, deportes, puntos de espíritu, o tus clases y tareas.",
      private: "No puedo ver calificaciones, contraseñas ni información personal de nadie, así que no puedo ayudarte con eso. Para tus propias calificaciones, revisa Infinite Campus o Schoology, o pregúntale a tu maestro.",
      password: "No puedo compartir ni buscar contraseñas, incluida la del Wi-Fi. La oficina principal o el personal de tecnología de la escuela pueden ayudarte a conectarte.",
      cheat: "No puedo darte las respuestas de un quiz o un examen, pero sí puedo ayudarte a prepararte. Puedo hacerte preguntas de práctica, explicarte el tema o ayudarte a planear cómo estudiar.",
      other_school: "Solo tengo información de Fremont High, así que no puedo responder sobre otras escuelas. Su propio sitio web es el mejor lugar para revisarlo.",
      unsafe: "No puedo ayudarte con eso. Con gusto te ayudo con la escuela, tus clases o los eventos. Si algo te preocupa, un consejero o un adulto de confianza puede ayudarte.",
      manipulation: "No puedo cambiar cómo funciono, pero con gusto te ayudo con cualquier cosa de la vida escolar en Fremont.",
      rude: "Aquí estoy cuando necesites ayuda con tu horario, eventos, clubes, deportes o clases.",
      weather: "No puedo revisar el clima, así que una app del clima es tu mejor opción. Puedo ayudarte con horarios, eventos y cualquier otra cosa de la escuela.",
      empty: "Pregúntame lo que quieras sobre la escuela, como tu horario, eventos, clubes, deportes o tus tareas.",
      unavailable: "Eso no forma parte de Firebird Hub por ahora. Puedo ayudarte con eventos, deportes, clubes, el horario o los puntos de espíritu.",
      default: "No puedo ayudarte con eso, pero con gusto te ayudo con cualquier cosa de la vida escolar en Fremont."
    }
  };
  function cannotReply(reason, lang) {
    var L = CANNOT[lang === "es" ? "es" : "en"];
    return L[reason] || L.default;
  }
  function crisisReply(lang, reason) {
    if (lang === "es") {
      if (reason === "danger") return "Si tú o alguien más está en peligro, llama al 911 ahora y avísale de inmediato a un adulto de confianza, a un consejero escolar o a la oficina. No tienes que manejar esto solo. Si necesitas hablar con alguien, puedes llamar o enviar un mensaje de texto al 988 en cualquier momento.";
      if (reason === "abuse") return "Gracias por contármelo. Lo que describes no está bien y no es tu culpa. Por favor, habla hoy con un adulto de confianza o con uno de los consejeros de la escuela, para que te ayuden a estar a salvo. Puedes llamar a la línea de Childhelp al 1-800-422-4453 en cualquier momento, o enviarle un mensaje de texto con la palabra GO. Atienden en español. Si alguna vez sientes ganas de hacerte daño, llama al 988 y marca 2 para español, envía AYUDA al 988 o envía HOME al 741741. Si estás en peligro ahora mismo, llama al 911.";
      return "Gracias por contármelo, y siento mucho que estés pasando por esto. No tienes que enfrentarlo solo. Puedes llamar al 988 en cualquier momento y marcar 2 para hablar en español, o enviar la palabra AYUDA al 988 por mensaje de texto. También puedes enviar HOME al 741741. Por favor habla hoy con un adulto de confianza o con uno de los consejeros de la escuela. Si estás en peligro ahora mismo, llama al 911.";
    }
    if (reason === "danger") return "If you or someone else is in danger, please call 911 now, and tell a trusted adult, a school counselor or the front office right away. You don't have to handle this alone. If you need someone to talk to, you can call or text 988 any time.";
    if (reason === "abuse") return "Thank you for telling me. What you're describing is not okay, and it's not your fault. Please tell a trusted adult or one of the school counselors today, so they can help keep you safe. You can call the Childhelp hotline at 1-800-422-4453 any time, or text GO to that number. If you ever feel like hurting yourself, call or text 988, or text HOME to 741741. If you're in danger right now, call 911.";
    return "I'm really glad you told me, and I'm sorry you're going through this. You don't have to handle it alone. You can call or text 988 any time to reach the Suicide and Crisis Lifeline, or text HOME to 741741 to reach the Crisis Text Line. Please talk to a trusted adult or one of the school counselors today. If you're in danger right now, call 911.";
  }


  /* =====================================================================
     4. Dates and times
     ===================================================================== */
  var MO_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MO_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  var WDL_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var WDL_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  var MONTHS = { jan: 1, january: 1, enero: 1, feb: 2, february: 2, febrero: 2, mar: 3, march: 3, marzo: 3, apr: 4, april: 4,
    abril: 4, may: 5, mayo: 5, jun: 6, june: 6, junio: 6, jul: 7, july: 7, julio: 7, aug: 8, august: 8, agosto: 8, sep: 9,
    sept: 9, september: 9, septiembre: 9, oct: 10, october: 10, octubre: 10, nov: 11, november: 11, noviembre: 11, dec: 12,
    december: 12, diciembre: 12 };

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function isoOf(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function isoNorm(s) { var m = String(s || "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); return m ? m[1] + "-" + pad(+m[2]) + "-" + pad(+m[3]) : ""; }
  function wdOf(iso) { return new Date(iso + "T12:00:00Z").getUTCDay(); }
  function addDays(iso, n) { var d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function daysBetween(a, b) { return Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000); }
  function ptNow() {
    try { return new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" })); }
    catch (e) { return new Date(); }
  }
  function toDate(v) {
    if (v instanceof Date) return isNaN(v) ? null : v;
    if (typeof v === "number") return new Date(v);
    if (typeof v === "string" && v) {
      var m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/);
      if (m && !/[zZ]|[+-]\d\d:?\d\d$/.test(v)) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
      var d = new Date(v); return isNaN(d) ? null : d;
    }
    return null;
  }
  // Bell-table times: "8:30" -> minutes; hours below 7 are PM (school runs 7:35 AM to 3:50 PM).
  function bellMin(t) { var p = String(t).split(":"); var h = +p[0], m = +p[1] || 0; if (h < 7) h += 12; return h * 60 + m; }
  function fmtMin(min, lang) {
    var h = Math.floor(min / 60), m = min % 60, pm = h >= 12, h12 = h % 12 || 12;
    return h12 + ":" + pad(m) + (lang === "es" ? (pm ? " p. m." : " a. m.") : (pm ? " PM" : " AM"));
  }
  function fmtBell(t, lang) { return fmtMin(bellMin(t), lang); }
  function gameTimeMin(t) { var m = String(t || "").match(/(\d+):(\d+)\s*(AM|PM)/i); if (!m) return null; var h = +m[1] % 12; if (/PM/i.test(m[3])) h += 12; return h * 60 + (+m[2]); }
  function fmtGameTime(t, lang) { var m = gameTimeMin(t); return m == null ? "" : fmtMin(m, lang); }
  function inMinutes(diff, lang) {
    var h = Math.floor(diff / 60), m = diff % 60;
    if (lang === "es") {
      if (!h) return "en " + m + (m === 1 ? " minuto" : " minutos");
      return "en " + h + (h === 1 ? " hora" : " horas") + (m ? " y " + m + (m === 1 ? " minuto" : " minutos") : "");
    }
    if (!h) return "in " + m + (m === 1 ? " minute" : " minutes");
    return "in " + h + (h === 1 ? " hour" : " hours") + (m ? " " + m + (m === 1 ? " minute" : " minutes") : "");
  }
  function longDate(iso, lang) {
    var m = iso.split("-"), wd = wdOf(iso);
    return lang === "es" ? WDL_ES[wd] + " " + (+m[2]) + " de " + MO_ES[+m[1] - 1] + "." : WDL_EN[wd] + ", " + MO_EN[+m[1] - 1] + " " + (+m[2]);
  }
  function shortDate(iso, lang) { var m = iso.split("-"); return lang === "es" ? (+m[2]) + " de " + MO_ES[+m[1] - 1] + "." : MO_EN[+m[1] - 1] + " " + (+m[2]); }
  // As a sentence subject: "Today", "Tomorrow (Thursday, Nov 19)", "Thursday, Nov 19".
  function subj(iso, today, lang) {
    var d = daysBetween(today, iso);
    if (lang === "es") return d === 0 ? "Hoy" : d === 1 ? "Mañana (" + longDate(iso, lang) + ")" : "El " + longDate(iso, lang);
    return d === 0 ? "Today" : d === 1 ? "Tomorrow (" + longDate(iso, lang) + ")" : longDate(iso, lang);
  }
  // After a verb: "today", "tomorrow (Thursday, Nov 19)", "on Thursday, Nov 19".
  function onDay(iso, today, lang) {
    var d = daysBetween(today, iso);
    if (lang === "es") return d === 0 ? "hoy" : d === 1 ? "mañana, " + longDate(iso, lang) : "el " + longDate(iso, lang);
    return d === 0 ? "today" : d === 1 ? "tomorrow, " + longDate(iso, lang) : "on " + longDate(iso, lang);
  }

  var DAY_RE = new RegExp("\\b(?:(day after tomorrow|pasado manana)|(today|tonight|this morning|this afternoon|esta manana|esta noche|hoy)|(tomorrow|manana)|(yesterday|ayer)|(?:(this|next|este|el proximo|proximo|el) )?(" +
    WD_EN.concat(WD_ES, ["tues", "thurs", "fri"]).join("|") + ")|(\\d{1,2})/(\\d{1,2})|(" + Object.keys(MONTHS).join("|") +
    ") (\\d{1,2})(?:st|nd|rd|th)?|(\\d{1,2}) de (" + Object.keys(MONTHS).join("|") + ")|the (\\d{1,2})(?:st|nd|rd|th))\\b", "g");
  var WEEK_RE = /\b(this week|next week|esta semana|(?:la )?proxima semana|(?:la )?semana que viene|this weekend|next weekend|weekend|fin de semana)\b/g;
  var SHORT_WD = { tues: 2, thurs: 4, fri: 5 };
  // A month and day with no year: the first one from 60 days ago on, so "May 28" asked in
  // November means next May, while "Nov 10" asked on Nov 18 is still last week.
  function pickYear(mo, dd, today) {
    var y = +today.slice(0, 4), best = null;
    for (var k = -1; k <= 1; k++) {
      var c = (y + k) + "-" + pad(mo) + "-" + pad(dd);
      if (daysBetween(today, c) >= -60) { best = c; break; }
    }
    return best || ((y + 1) + "-" + pad(mo) + "-" + pad(dd));
  }
  // The LAST day or week the text mentions (so a follow-up's "what about Friday" wins).
  // -> { iso } | { week: [fromIso, toIso], label } | null
  function parseWhen(n, today) {
    var best = null, m;
    DAY_RE.lastIndex = 0;
    while ((m = DAY_RE.exec(n))) {
      var iso = null;
      if (m[1]) iso = addDays(today, 2);
      else if (m[2]) iso = today;
      else if (m[3]) {
        var before = n.slice(Math.max(0, m.index - 4), m.index);
        if (m[3] === "manana" && /\bla $/.test(before)) continue;    // "por la manana" = in the morning
        iso = addDays(today, 1);
      } else if (m[4]) iso = addDays(today, -1);
      else if (m[6]) {
        var w = WD_EN.indexOf(m[6]); if (w < 0) w = WD_ES.indexOf(m[6]); if (w < 0) w = SHORT_WD[m[6]] - 1;
        var target = (w + 1) % 7, delta = (target - wdOf(today) + 7) % 7;
        if (/next|proximo/.test(m[5] || "") && delta === 0) delta = 7;
        iso = addDays(today, delta);
      } else if (m[7]) iso = pickYear(+m[7], +m[8], today);
      else if (m[9]) iso = pickYear(MONTHS[m[9]], +m[10], today);
      else if (m[11]) iso = pickYear(MONTHS[m[12]], +m[11], today);
      else if (m[13]) { var mo = +today.slice(5, 7), dd = +m[13]; if (dd < +today.slice(8, 10)) mo = mo % 12 + 1; iso = pickYear(mo, dd, today); }
      if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) && !isNaN(Date.parse(iso))) best = { iso: iso, at: m.index };
    }
    WEEK_RE.lastIndex = 0;
    while ((m = WEEK_RE.exec(n))) {
      if (best && best.at > m.index) continue;
      var k = m[1], wd = wdOf(today), mon = addDays(today, -((wd + 6) % 7));
      if (/weekend|fin de semana/.test(k)) {
        var sat = addDays(mon, 5 + (/next/.test(k) ? 7 : 0));
        best = { week: [sat, addDays(sat, 1)], weekend: true, at: m.index };
      } else if (/next|proxima|que viene/.test(k)) best = { week: [addDays(mon, 7), addDays(mon, 11)], at: m.index };
      else best = { week: [today > addDays(mon, 4) ? addDays(mon, 7) : today, today > addDays(mon, 4) ? addDays(mon, 11) : addDays(mon, 4)], at: m.index };
    }
    return best;
  }

  /* =====================================================================
     5. The school day from the app's own tables
     ===================================================================== */
  function pick(data, names) { for (var i = 0; i < names.length; i++) { var v = data[names[i]]; if (v != null) return v; } return null; }
  function tables(data) {
    return {
      schedules: pick(data, ["schedules", "SCHEDULES"]),
      special: pick(data, ["specialDays", "SPECIAL_DAYS"]) || {},
      noClasses: pick(data, ["noClasses", "NO_CLASSES", "noSchoolDays"]) || [],
      year: pick(data, ["schoolYear", "SCHOOL_YEAR"])
    };
  }
  var KEY_NAME = { en: { mon: "a Monday schedule", a: "an A day", b: "a B day" }, es: { mon: "un horario de lunes", a: "un día A", b: "un día B" } };
  var KEY_SHORT = { en: { mon: "Monday schedule", a: "A day", b: "B day" }, es: { mon: "horario de lunes", a: "día A", b: "día B" } };
  // { iso, off:[en, es] } | { iso, weekend:true } | { iso, key, rows, swapped }
  function dayStatus(iso, T) {
    var y = T.year;
    if (y && y.first && y.last) {
      if (iso < y.first && iso >= y.first.slice(0, 4) + "-06-01") return { iso: iso, off: ["Summer Break", "vacaciones de verano"], summer: true };
      if (iso > y.last && iso <= y.last.slice(0, 4) + "-08-10") return { iso: iso, off: ["Summer Break", "vacaciones de verano"], summer: true };
    }
    for (var i = 0; i < T.noClasses.length; i++) {
      var r = T.noClasses[i];
      if (r && iso >= r[0] && iso <= r[1]) return { iso: iso, off: [r[2], r[3] || r[2]], range: r };
    }
    var wd = wdOf(iso);
    var key = T.special[iso] || (wd === 1 ? "mon" : wd === 2 || wd === 4 ? "a" : wd === 3 || wd === 5 ? "b" : null);
    if (!key) return { iso: iso, weekend: true };
    var sch = T.schedules && T.schedules[key];
    if (!sch || !Array.isArray(sch.rows)) return { iso: iso, unknown: true };
    var rows = sch.rows.filter(function (r) { return r && !/staff only/i.test(r[0]); });
    return { iso: iso, key: key, rows: rows, swapped: !!T.special[iso] };
  }
  function nextClassDay(iso, T, inclusive) {
    for (var i = inclusive ? 0 : 1; i <= 120; i++) {
      var d = addDays(iso, i), st = dayStatus(d, T);
      if (st.rows) return st;
      if (T.year && T.year.last && d > T.year.last) return null;
    }
    return null;
  }
  function prevClassDay(iso, T) {
    for (var i = 1; i <= 30; i++) {
      var d = addDays(iso, -i), st = dayStatus(d, T);
      if (st.rows) return st;
      if (T.year && T.year.first && d < T.year.first) return null;
    }
    return null;
  }
  var PERIOD_ES = { Brunch: "el brunch", Lunch: "el almuerzo", Tutorial: "Tutoría", Rally: "el rally", Enrichment: "Enriquecimiento" };
  function rowName(name, lang, cap) {
    var s;
    if (lang !== "es") s = name;
    else if (PERIOD_ES[name]) s = PERIOD_ES[name];
    else {
      var m = name.match(/^Period (\d+)$/); if (m) s = "el periodo " + m[1];
      else { m = name.match(/^(\d+)(?:st|nd|rd|th) Final$/); s = m ? "el final del periodo " + m[1] : name; }
    }
    return cap ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }
  function listJoin(arr, lang) {
    if (arr.length <= 1) return arr.join("");
    return arr.slice(0, -1).join(", ") + (lang === "es" ? " y " : " and ") + arr[arr.length - 1];
  }
  function periodsOf(st, lang) {
    var nums = st.rows.filter(function (r) { return /^Period \d$/.test(r[0]); }).map(function (r) { return r[0].slice(7); });
    var tut = st.rows.some(function (r) { return /Tutorial/.test(r[0]); });
    if (lang === "es") return (nums.length > 1 ? "los periodos " : "el periodo ") + listJoin(nums, lang) + (tut ? ", con Tutoría" : "");
    return (nums.length > 1 ? "Periods " : "Period ") + listJoin(nums, lang) + (tut ? ", plus Tutorial" : "");
  }
  function schoolSpan(st) { return [st.rows[0][1], st.rows[st.rows.length - 1][2]]; }
  function offText(st, today, lang) {
    var reason = lang === "es" ? st.off[1] : st.off[0];
    if (st.off && st.range && st.range[0] !== st.range[1]) {
      return lang === "es"
        ? "No hay clases " + onDay(st.iso, today, lang) + " por " + reason + " (del " + shortDate(st.range[0], lang) + " al " + shortDate(st.range[1], lang) + ")."
        : "There's no school " + onDay(st.iso, today, lang) + " because of " + reason + " (" + shortDate(st.range[0], lang) + " to " + shortDate(st.range[1], lang) + ").";
    }
    return lang === "es" ? "No hay clases " + onDay(st.iso, today, lang) + " por " + reason + "."
      : "There's no school " + onDay(st.iso, today, lang) + " because of " + reason + ".";
  }
  function noSchoolText(st, today, lang) {
    if (st.off) return offText(st, today, lang);
    return lang === "es" ? "No hay clases " + onDay(st.iso, today, lang) + ", porque es fin de semana."
      : "There's no school " + onDay(st.iso, today, lang) + ", since it's the weekend.";
  }
  function backText(st, T, today, lang) {
    var nx = nextClassDay(st.iso, T, false);
    if (!nx) return "";
    return lang === "es" ? " Las clases siguen " + onDay(nx.iso, today, lang) + ", con " + KEY_NAME.es[nx.key] + "."
      : " Classes are back " + onDay(nx.iso, today, lang) + ", with " + KEY_NAME.en[nx.key] + ".";
  }
  function dayTypeLine(st, today, lang) {
    var sp = schoolSpan(st);
    if (lang === "es") return subj(st.iso, today, lang) + " es " + KEY_NAME.es[st.key] + ": " + periodsOf(st, lang) + ", de " + fmtBell(sp[0], lang) + " a " + fmtBell(sp[1], lang) + "." +
      (st.swapped ? " Esta semana cambia el orden de los días A y B por un día sin clases." : "");
    return subj(st.iso, today, lang) + " is " + KEY_NAME.en[st.key] + ": " + periodsOf(st, lang) + ", from " + fmtBell(sp[0], lang) + " to " + fmtBell(sp[1], lang) + "." +
      (st.swapped ? " This week's A and B days are shifted because of a day off." : "");
  }

  /* --- local answers: schedule --- */
  function answerNow(n, D, now, lang, T) {
    var today = isoOf(now), st = dayStatus(today, T);
    if (st.unknown) return null;
    if (!st.rows) return noSchoolText(st, today, lang) + backText(st, T, today, lang);
    var nowMin = now.getHours() * 60 + now.getMinutes(), rows = st.rows, i;
    var first = bellMin(rows[0][1]), last = bellMin(rows[rows.length - 1][2]);
    var label = KEY_SHORT[lang][st.key];
    if (nowMin < first) {
      return lang === "es"
        ? "Las clases aún no empiezan. Hoy es " + KEY_NAME.es[st.key] + ", y " + rowName(rows[0][0], lang) + " empieza a las " + fmtBell(rows[0][1], lang) + ", " + inMinutes(first - nowMin, lang) + "."
        : "School hasn't started yet. Today is " + KEY_NAME.en[st.key] + ", and " + rowName(rows[0][0], lang) + " starts at " + fmtBell(rows[0][1], lang) + ", " + inMinutes(first - nowMin, lang) + ".";
    }
    if (nowMin >= last) {
      var nx = nextClassDay(today, T, false);
      var tail = nx ? (lang === "es" ? " La próxima clase es " + onDay(nx.iso, today, lang) + " (" + KEY_SHORT.es[nx.key] + ") a las " + fmtBell(nx.rows[0][1], lang) + "."
        : " Next class is " + onDay(nx.iso, today, lang) + " (" + KEY_SHORT.en[nx.key] + ") at " + fmtBell(nx.rows[0][1], lang) + ".") : "";
      return (lang === "es" ? "Las clases ya terminaron por hoy." : "School is out for today.") + tail;
    }
    for (i = 0; i < rows.length; i++) {
      var s = bellMin(rows[i][1]), e = bellMin(rows[i][2]);
      if (nowMin >= s && nowMin < e) {
        var next = rows[i + 1];
        if (lang === "es") return "Ahora es " + rowName(rows[i][0], lang) + " (" + label + "). Termina a las " + fmtBell(rows[i][2], lang) + ", " + inMinutes(e - nowMin, lang) + "." +
          (next ? " Después sigue " + rowName(next[0], lang) + "." : "");
        return "It's " + rowName(rows[i][0], lang) + " right now (" + label + "). It ends at " + fmtBell(rows[i][2], lang) + ", " + inMinutes(e - nowMin, lang) + "." +
          (next ? " " + rowName(next[0], lang) + " is next." : "");
      }
      if (rows[i + 1] && nowMin >= e && nowMin < bellMin(rows[i + 1][1])) {
        var ns = bellMin(rows[i + 1][1]);
        return lang === "es"
          ? "Es tiempo de pasar entre clases. " + rowName(rows[i + 1][0], lang, true) + " empieza a las " + fmtBell(rows[i + 1][1], lang) + ", " + inMinutes(ns - nowMin, lang) + "."
          : "It's passing time. " + rowName(rows[i + 1][0], lang) + " starts at " + fmtBell(rows[i + 1][1], lang) + ", " + inMinutes(ns - nowMin, lang) + ".";
      }
    }
    return null;
  }

  var ORD = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4, fifth: 5, "5th": 5, sixth: 6, "6th": 6, seventh: 7, "7th": 7 };
  var TARGET_RE = /\b(?:(lunch|almuerzo)|(brunch|recreo)|(tutorial|tutoria)|(?:period|periodo|p) ?([1-7])\b|(first|second|third|fourth|fifth|sixth|seventh|1st|2nd|3rd|4th|5th|6th|7th|last) period|(school|classes|clases|escuela|dismissal|salida|entrada|get out|let out|salimos|entramos))/g;
  function lastTarget(n) {
    var m, out = null; TARGET_RE.lastIndex = 0;
    while ((m = TARGET_RE.exec(n))) {
      if (m[1]) out = "Lunch"; else if (m[2]) out = "Brunch"; else if (m[3]) out = "Tutorial";
      else if (m[4]) out = "Period " + m[4];
      else if (m[5]) out = m[5] === "last" ? "LAST" : "Period " + ORD[m[5]];
      else if (m[6]) out = /entrada|entramos/.test(m[6]) ? "SCHOOL_START" : /dismissal|salida|get out|let out|salimos/.test(m[6]) ? "SCHOOL_END" : "SCHOOL";
    }
    return out;
  }
  var END_RE = /\b(?:end|ends|ending|over|out|finish|finishes|done|dismiss|dismissed|dismissal|termina|terminan|acaba|acaban|salimos|sale|salen|salida)\b/;
  var START_RE = /\b(?:start|starts|begin|begins|starting|empieza|empiezan|comienza|comienzan|entrada|entramos)\b/;

  function answerBell(n, D, now, lang, T) {
    var today = isoOf(now), when = parseWhen(n, today), iso = when && when.iso ? when.iso : today;
    var target = lastTarget(n);
    if (!target) {
      if (iso === today) return answerNow(n, D, now, lang, T);
      return answerDayType(n, D, now, lang, T);
    }
    var st = dayStatus(iso, T);
    if (st.unknown) return null;
    if (!st.rows) return noSchoolText(st, today, lang) + backText(st, T, today, lang);
    var nowMin = iso === today ? now.getHours() * 60 + now.getMinutes() : -1;
    // A follow-up like "when does school end today? and lunch?" asks about lunch as a whole:
    // read start or end only from the part that names the last target, when it is a later part.
    var segs = n.split(/\b(?:and|y|also|what about|how about|que tal)\b/), seg = n;
    for (var sg = segs.length - 1; sg > 0; sg--) { if (lastTarget(segs[sg])) { seg = segs[sg]; break; } }
    var wantEnd = END_RE.test(seg), wantStart = START_RE.test(seg);
    var lbl = " (" + KEY_SHORT[lang][st.key] + ")";
    var soon = function (min) { return nowMin >= 0 && min > nowMin ? ", " + inMinutes(min - nowMin, lang) : ""; };
    if (/^SCHOOL/.test(target)) {
      var sp = schoolSpan(st), s0 = bellMin(sp[0]), s1 = bellMin(sp[1]);
      if (target === "SCHOOL_END") wantEnd = true;
      if (target === "SCHOOL_START") wantStart = true;
      if (wantEnd && !wantStart) return lang === "es" ? "Las clases terminan a las " + fmtBell(sp[1], lang) + " " + onDay(iso, today, lang) + lbl + soon(s1) + "."
        : "School ends at " + fmtBell(sp[1], lang) + " " + onDay(iso, today, lang) + lbl + soon(s1) + ".";
      if (wantStart && !wantEnd) return lang === "es" ? "Las clases empiezan a las " + fmtBell(sp[0], lang) + " " + onDay(iso, today, lang) + lbl + soon(s0) + "."
        : "School starts at " + fmtBell(sp[0], lang) + " " + onDay(iso, today, lang) + lbl + soon(s0) + ".";
      return lang === "es" ? "Las clases son de " + fmtBell(sp[0], lang) + " a " + fmtBell(sp[1], lang) + " " + onDay(iso, today, lang) + lbl + "."
        : "School runs from " + fmtBell(sp[0], lang) + " to " + fmtBell(sp[1], lang) + " " + onDay(iso, today, lang) + lbl + ".";
    }
    var row = null;
    if (target === "LAST") { for (var k = st.rows.length - 1; k >= 0; k--) if (/^Period /.test(st.rows[k][0])) { row = st.rows[k]; break; } }
    else row = st.rows.filter(function (r) { return r[0] === target; })[0] || null;
    if (!row) {
      var hint = target === "Tutorial" ? (lang === "es" ? " Tutoría es los lunes y los días B." : " Tutorial is on Mondays and B days.") : "";
      var nx = null;
      if (/^Period /.test(target)) {
        for (var j = 1; j <= 14 && !nx; j++) {
          var s2 = dayStatus(addDays(iso, j), T);
          if (s2.rows && s2.rows.some(function (r) { return r[0] === target; })) nx = s2;
        }
      }
      var nm = rowName(target, lang, true);
      var base = lang === "es" ? nm + " no tiene clase " + onDay(iso, today, lang) + ", porque es " + KEY_NAME.es[st.key] + "."
        : nm + " doesn't meet " + onDay(iso, today, lang) + ", since it's " + KEY_NAME.en[st.key] + ".";
      if (nx) {
        var r2 = nx.rows.filter(function (r) { return r[0] === target; })[0];
        base += lang === "es" ? " La próxima vez es " + onDay(nx.iso, today, lang) + ", de " + fmtBell(r2[1], lang) + " a " + fmtBell(r2[2], lang) + "."
          : " It meets next " + onDay(nx.iso, today, lang) + ", " + fmtBell(r2[1], lang) + " to " + fmtBell(r2[2], lang) + ".";
      }
      return base + hint;
    }
    var a = bellMin(row[1]), z = bellMin(row[2]), name = rowName(row[0], lang, true);
    if (nowMin >= a && nowMin < z) {
      return lang === "es" ? name + " es ahora y termina a las " + fmtBell(row[2], lang) + ", " + inMinutes(z - nowMin, lang) + "."
        : name + " is happening now and ends at " + fmtBell(row[2], lang) + ", " + inMinutes(z - nowMin, lang) + ".";
    }
    if (wantEnd && !wantStart) return lang === "es" ? name + " termina a las " + fmtBell(row[2], lang) + " " + onDay(iso, today, lang) + lbl + soon(z) + "."
      : name + " ends at " + fmtBell(row[2], lang) + " " + onDay(iso, today, lang) + lbl + soon(z) + ".";
    if (wantStart && !wantEnd) return lang === "es" ? name + " empieza a las " + fmtBell(row[1], lang) + " " + onDay(iso, today, lang) + lbl + soon(a) + "."
      : name + " starts at " + fmtBell(row[1], lang) + " " + onDay(iso, today, lang) + lbl + soon(a) + ".";
    var startsIn = nowMin >= 0 && a > nowMin ? (lang === "es" ? " Empieza " + inMinutes(a - nowMin, lang) + "." : " It starts " + inMinutes(a - nowMin, lang) + ".") : "";
    return lang === "es" ? name + " es de " + fmtBell(row[1], lang) + " a " + fmtBell(row[2], lang) + " " + onDay(iso, today, lang) + lbl + "." + startsIn
      : name + " is from " + fmtBell(row[1], lang) + " to " + fmtBell(row[2], lang) + " " + onDay(iso, today, lang) + lbl + "." + startsIn;
  }

  function weekSummary(range, T, today, lang) {
    var parts = [], off = [], groups = [], from = range[0], to = range[1];
    for (var d = from; d <= to; d = addDays(d, 1)) {
      var st = dayStatus(d, T), wd = wdOf(d);
      if (wd === 0 || wd === 6) continue;
      var name = lang === "es" ? WDL_ES[wd] : WDL_EN[wd];
      if (st.rows) parts.push(name + " (" + KEY_SHORT[lang][st.key] + ")");
      else if (st.off) {
        var why = lang === "es" ? st.off[1] : st.off[0], g = groups[groups.length - 1];
        if (g && g.why === why && addDays(g.last, 1) === d) { g.to = name; g.last = d; } else groups.push({ why: why, from: name, to: "", last: d });
      }
    }
    off = groups.map(function (g) { return (g.to ? g.from + (lang === "es" ? " a " : " to ") + g.to : g.from) + " (" + g.why + ")"; });
    if (!parts.length && !off.length) return null;
    var thisWk = from <= today && today <= to;
    if (lang === "es") return (parts.length ? "Hay clases el " + listJoin(parts, lang) + "." : (thisWk ? "No hay clases esta semana." : "No hay clases esa semana.")) + (off.length ? " Sin clases: " + listJoin(off, lang) + "." : "");
    return (parts.length ? "There's school on " + listJoin(parts, lang) + "." : (thisWk ? "There's no school this week." : "There's no school that week.")) + (off.length ? " No school " + listJoin(off, lang) + "." : "");
  }

  function answerDayType(n, D, now, lang, T) {
    var today = isoOf(now), when = parseWhen(n, today);
    var target = lastTarget(n);
    if (target && /^Period /.test(target)) return answerBell(n, D, now, lang, T);
    if (when && when.week) {
      if (when.weekend) return lang === "es" ? "No hay clases el fin de semana." : "There's no school on the weekend.";
      return weekSummary(when.week, T, today, lang);
    }
    var iso = when && when.iso ? when.iso : today, st = dayStatus(iso, T);
    if (st.unknown) return null;
    if (!st.rows) return noSchoolText(st, today, lang) + backText(st, T, today, lang);
    return dayTypeLine(st, today, lang);
  }

  var BREAKS = [
    [/\bthanksgiving|accion de gracias\b/, /thanksgiving/i],
    [/\b(?:winter|christmas|mid ?year|holiday break|navidad|invierno|fin de ano)\b/, /mid-year/i],
    [/\b(?:spring|primavera)\b/, /spring/i],
    [/\b(?:presidents|ski week|presidentes)\b/, /presidents/i],
    [/\b(?:mlk|martin luther king)\b/, /king/i],
    [/\bmemorial\b/, /memorial/i],
    [/\blabor day|dia del trabajo\b/, /labor/i],
    [/\bveterans\b/, /veterans/i],
    [/\bnon duty|teacher day\b/, /non-duty/i]
  ];
  function rangeText(r, lang) {
    var a = r[0], b = r[1], name = lang === "es" ? (r[3] || r[2]) : r[2];
    var plural = lang === "es" && /^vacaciones\b/i.test(name);
    if (plural) name = "Las " + name.charAt(0).toLowerCase() + name.slice(1);
    if (a === b) return lang === "es" ? name + (plural ? " son el " : " es el ") + longDate(a, lang) : name + " is on " + longDate(a, lang);
    return lang === "es" ? name + (plural ? " son del " : " es del ") + longDate(a, lang) + " al " + longDate(b, lang) : name + " is " + longDate(a, lang) + " to " + longDate(b, lang);
  }
  function answerSchoolOn(n, D, now, lang, T) {
    var today = isoOf(now);
    if (!T.noClasses.length && !T.schedules) return null;
    // A named break.
    for (var i = 0; i < BREAKS.length; i++) {
      if (!BREAKS[i][0].test(n)) continue;
      var rows = T.noClasses.filter(function (r) { return BREAKS[i][1].test(r[2]); });
      if (!rows.length) return null;
      var r = rows.filter(function (x) { return x[1] >= today; })[0];
      if (!r) {
        r = rows[rows.length - 1];
        return lang === "es" ? (r[3] || r[2]) + " ya pasó este año escolar (" + shortDate(r[0], lang) + ")." : (r[2] + " already happened this school year (" + shortDate(r[0], lang) + ").");
      }
      var back = nextClassDay(r[1], T, false);
      var now0 = r[0] <= today;
      // "last day before the break": the school day before it starts.
      var before = !now0 && /\b(?:last (?:school )?day|before|antes|ultimo dia)\b/.test(n) ? prevClassDay(r[0], T) : null;
      if (before && before.iso >= today) {
        return (lang === "es" ? "El último día de clases antes de " + (r[3] || r[2]) + " es " + onDay(before.iso, today, lang) + ". "
          : "The last school day before " + r[2] + " is " + onDay(before.iso, today, lang) + ". ") + rangeText(r, lang) + "." +
          (back ? (lang === "es" ? " Las clases regresan " + onDay(back.iso, today, lang) + "." : " Classes are back " + onDay(back.iso, today, lang) + ".") : "");
      }
      var txt = rangeText(r, lang) + (lang === "es" ? (now0 ? ", y es ahora" : "") + ", así que no hay clases esos días." : (now0 ? ", and it's happening now" : "") + ", so there's no school " + (r[0] === r[1] ? "that day." : "those days."));
      if (back) txt += lang === "es" ? " Las clases regresan " + onDay(back.iso, today, lang) + "." : " Classes are back " + onDay(back.iso, today, lang) + ".";
      return txt;
    }
    var when = parseWhen(n, today);
    var askNext = /\b(?:next|upcoming|proximo|proximos|siguiente) (?:break|holiday|day off|days off|long weekend|vacation|dia libre|dias libres|vacaciones|feriado)\b|\bwhen is (?:the next |our next )?(?:break|day off|holiday)\b|\bdays off\b|\bno school days\b|\bdias (?:libres|festivos|feriados|sin clases)\b/.test(n);
    var askBack = /\b(?:back to school|go back to school|school starts again|classes start again|first day back|return to school|resume|regresamos|volvemos)\b|\bafter (?:the )?(?:break|holiday|vacation)\b/.test(n);
    if ((askNext || askBack || (!when && /\b(?:break|holiday|vacation|vacaciones)\b/.test(n)))) {
      var cur = null, nxt = null;
      for (var k = 0; k < T.noClasses.length; k++) {
        var x = T.noClasses[k];
        if (x[0] <= today && x[1] >= today) cur = x;
        else if (x[0] > today && !nxt) nxt = x;
      }
      if (askBack) {
        var base = cur || nxt;
        if (!base) return null;
        var bk = nextClassDay(base[1], T, false);
        if (!bk) return null;
        return lang === "es" ? "Las clases regresan " + onDay(bk.iso, today, lang) + ", después de " + (base[3] || base[2]) + "."
          : "Classes start again " + onDay(bk.iso, today, lang) + ", after " + base[2] + ".";
      }
      if (cur) {
        var b2 = nextClassDay(cur[1], T, false);
        return (lang === "es" ? "Ahora mismo es " + (cur[3] || cur[2]) + "." : "It's " + cur[2] + " right now.") +
          (b2 ? (lang === "es" ? " Las clases regresan " + onDay(b2.iso, today, lang) + "." : " Classes are back " + onDay(b2.iso, today, lang) + ".") : "");
      }
      if (!nxt) return lang === "es" ? "No quedan más días sin clases en el calendario de este año, aparte de los fines de semana." : "There are no more days off on this year's calendar, apart from weekends.";
      var after = null;
      for (var q = 0; q < T.noClasses.length; q++) if (T.noClasses[q][0] > nxt[1]) { after = T.noClasses[q]; break; }
      return (lang === "es" ? "El próximo día sin clases: " + rangeText(nxt, lang) + "." : "The next day off: " + rangeText(nxt, lang) + ".") +
        (after ? (lang === "es" ? " Después viene " + (after[3] || after[2]) + " (" + shortDate(after[0], lang) + ")." : " After that comes " + after[2] + " (" + shortDate(after[0], lang) + ").") : "");
    }
    if (when && when.week) {
      if (when.weekend) return lang === "es" ? "No hay clases el fin de semana." : "There's no school on the weekend.";
      return weekSummary(when.week, T, today, lang);
    }
    var iso = when && when.iso ? when.iso : today, st = dayStatus(iso, T);
    if (st.unknown) return null;
    if (!st.rows) return (lang === "es" ? "No. " : "No. ") + noSchoolText(st, today, lang) + backText(st, T, today, lang);
    var sp = schoolSpan(st);
    return lang === "es"
      ? "Sí, hay clases " + onDay(iso, today, lang) + ". Es " + KEY_NAME.es[st.key] + ", de " + fmtBell(sp[0], lang) + " a " + fmtBell(sp[1], lang) + "."
      : "Yes, there's school " + onDay(iso, today, lang) + ". It's " + KEY_NAME.en[st.key] + ", from " + fmtBell(sp[0], lang) + " to " + fmtBell(sp[1], lang) + ".";
  }

  /* --- local answers: events --- */
  var EV_STOP = {};
  ("when what where is are the a an next upcoming coming up event events evento eventos happening going on this that week weekend " +
    "month today tonight tomorrow any anything fun there do we have will be calendar time day of for in at to on our school fremont " +
    "fhs asb please felipe que cuando es el la los las hay esta este proximo proxima siguiente semana hoy manana pasa pasando de del " +
    "en sera show me tell list whats about and or how long it its date dates which").split(" ").forEach(function (w) { EV_STOP[w] = 1; });
  WD_EN.concat(WD_ES).forEach(function (w) { EV_STOP[w] = 1; });
  var EV_GENERIC = { club: 1, night: 1, day: 1, meeting: 1, monthly: 1, show: 1, social: 1, student: 1, class: 1, noche: 1, dia: 1 };
  function stem(w) { return w.replace(/(?:ies)$/, "y").replace(/(?:es|s)$/, ""); }
  function eventList(D) {
    var raw = pick(D, ["events", "EVENTS", "nextEvents"]) || [];
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var e = raw[i]; if (!e || !e.name) continue;
      var when = toDate(e.when || e.date), end = toDate(e.end || e.endDate);
      if (!when) continue;
      if (!end) end = new Date(when.getFullYear(), when.getMonth(), when.getDate(), 23, 59);
      out.push({ name: String(e.name), when: when, end: end, time: e.time || "", loc: e.loc || e.location || "", desc: e.desc || e.description || "", tags: e.tags || [] });
    }
    return out.sort(function (a, b) { return a.when - b.when; });
  }
  function evWhenText(e, lang) {
    var a = isoOf(e.when), b = isoOf(e.end);
    if (a !== b) return lang === "es" ? "del " + longDate(a, lang) + " al " + longDate(b, lang) : "from " + longDate(a, lang) + " to " + longDate(b, lang);
    var t = String(e.time || "").trim();
    var timeTxt = "";
    if (t && !/^(?:all day|during school|all week|tba|tbd)$/i.test(t)) {
      if (lang === "es") timeTxt = " (" + t + ")";
      else if (/\d/.test(t)) timeTxt = " at " + t;
      else if (/^(?:morning|afternoon|evening)$/i.test(t)) timeTxt = " in the " + t.toLowerCase();
      else if (/^(?:lunch|brunch|tutorial|night)$/i.test(t)) timeTxt = " at " + t.toLowerCase();
      else timeTxt = " (" + t + ")";
    }
    return (lang === "es" ? "el " : "on ") + longDate(a, lang) + timeTxt;
  }
  function shortDesc(s) {
    s = String(s || "").replace(/\s+/g, " ").trim(); if (!s) return "";
    if (s.length <= 150) return /[.!?]$/.test(s) ? s : s + ".";
    var cut = s.slice(0, 150), dot = cut.lastIndexOf(". ");
    return dot > 60 ? cut.slice(0, dot + 1) : cut.replace(/\s+\S*$/, "") + "...";
  }
  function locText(loc, lang) {
    loc = String(loc || "").trim();
    if (!loc || /^(?:tba|tbd)$/i.test(loc)) return "";
    if (/^online$/i.test(loc)) return lang === "es" ? " en línea" : " online";
    return lang === "es" ? " en " + loc : " at " + loc;
  }
  // Games in a date range, as short items ("Boys Basketball at Milpitas, Thu").
  function gamesBetween(D, from, to, now) {
    var games = pick(D, ["games", "sportsGames", "nextGames"]) || [], today = isoOf(now), nowMin = now.getHours() * 60 + now.getMinutes();
    return games.filter(function (g) {
      if (!g || !g.sport || /rancho\s*san\s*antonio/i.test([g.title, g.opponent, g.location].join(" "))) return false;
      var d = isoNorm(g.date); if (!d || d < from || d > to || d < today) return false;
      if (d === today) { var gm = gameTimeMin(g.time); if (String(g.score || "").trim() || (gm != null && gm + 150 < nowMin)) return false; }
      return true;
    }).map(function (g) { var c = {}; for (var k in g) c[k] = g[k]; c.date = isoNorm(g.date); return c; })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (gameTimeMin(a.time) || 0) - (gameTimeMin(b.time) || 0); });
  }
  function gameShort(g, lang) {
    var opp = String(g.opponent || "").trim(), away = /away/i.test(String(g.homeAway || ""));
    var wd = (lang === "es" ? WDL_ES : WDL_EN)[wdOf(g.date)];
    var vs = opp ? (away ? (lang === "es" ? " en " : " at ") : (lang === "es" ? " contra " : " vs ")) + opp : "";
    return g.sport + (g.level && !/^all$/i.test(g.level) ? " " + g.level : "") + vs + " (" + wd + " " + shortDate(g.date, lang) + ")";
  }
  function answerNextEvent(n, D, now, lang) {
    var list = eventList(D);
    if (!list.length) return null;
    var today = isoOf(now), when = parseWhen(n, today);
    var fun = /\b(?:fun|divertido)\b/.test(n);
    var words = n.split(" ").filter(function (w) { return w.length >= 3 && !EV_STOP[w] && !/^\d/.test(w) && w !== "fun" && w !== "divertido"; });
    var up = list.filter(function (e) { return e.end >= now; });
    if (fun) up = up.filter(function (e) { return !/\b(?:due|deadline|check ?-?in|application|apply)\b/i.test(e.name); });
    var pool = up, scope = "", thisWk = false;
    if (when) {
      var from = when.iso || when.week[0], to = when.iso || when.week[1];
      pool = up.filter(function (e) { return isoOf(e.when) <= to && isoOf(e.end) >= from; });
      thisWk = !when.iso && from <= addDays(today, 6) && to >= today && !/next|proxima|que viene/.test(n);
      scope = when.iso ? onDay(when.iso, today, lang)
        : (lang === "es" ? (thisWk ? (when.weekend ? "este fin de semana" : "esta semana") : (when.weekend ? "ese fin de semana" : "esa semana"))
          : (thisWk ? (when.weekend ? "this weekend" : "this week") : (when.weekend ? "that weekend" : "that week")));
    }
    if (words.length) {
      // Score each event on the question's distinctive words: a word that appears in many
      // events ("club") counts little, a rare one ("trivia", "grub") counts a lot.
      var hays = list.map(function (e) { return e.hay || (e.hay = norm(e.name + " " + (Array.isArray(e.tags) ? e.tags.join(" ") : e.tags))); });
      var stems = words.map(stem).filter(function (s) { return s.length >= 3; });
      var res = stems.map(function (s) { return new RegExp("\\b" + s); });
      var df = res.map(function (re) { return hays.filter(function (h) { return re.test(h); }).length; });
      var best = 0, scored = pool.map(function (e) {
        var hay = e.hay, sc = 0, strong = false;
        res.forEach(function (re, k) { if (df[k] && re.test(hay)) { sc += 1 / df[k]; if (!EV_GENERIC[stems[k]]) strong = true; } });
        if (sc > best) best = sc;
        return { e: e, sc: sc, strong: strong };
      });
      var top = scored.filter(function (x) { return x.sc > 0 && x.sc >= best - 1e-9; });
      if (!top.length) return null;                        // a specific thing we can't find: let the model answer
      if (!top.some(function (x) { return x.strong; }) && top.length > 1) return null;   // only generic words matched
      pool = top.map(function (x) { return x.e; });
    }
    var games = when && !words.length ? gamesBetween(D, when.iso || when.week[0], when.iso || when.week[1], now) : [];
    var gamesTxt = games.length
      ? (lang === "es" ? " Partidos " + scope + ": " : " Games " + scope + ": ") + listJoin(games.slice(0, 4).map(function (g) { return gameShort(g, lang); }), lang) +
        (games.length > 4 ? (lang === "es" ? " y " + (games.length - 4) + " más" : ", and " + (games.length - 4) + " more") : "") + "."
      : "";
    if (!pool.length) {
      var nxt = up[0];
      if (!when) return lang === "es" ? "No hay eventos próximos en el calendario por ahora." : "There are no upcoming events on the calendar right now.";
      return (lang === "es" ? "No hay eventos en el calendario " + scope + "." : "There's nothing on the events calendar " + scope + ".") + gamesTxt +
        (nxt ? (lang === "es" ? " El próximo evento es " + nxt.name + ", " + evWhenText(nxt, lang) + "." : " The next event is " + nxt.name + ", " + evWhenText(nxt, lang) + ".") : "");
    }
    var e = pool[0], live = e.when <= now && e.end >= now;
    var loc = locText(e.loc, lang);
    var head = live
      ? (lang === "es" ? e.name + " es ahora" + (isoOf(e.end) !== today ? ", hasta el " + longDate(isoOf(e.end), lang) : "") + loc + "."
        : e.name + " is happening now" + (isoOf(e.end) !== today ? ", through " + longDate(isoOf(e.end), lang) : "") + loc + ".")
      : (lang === "es" ? (words.length ? "" : "El próximo evento es ") + e.name + (words.length ? " es " : ", ") + evWhenText(e, lang) + loc + "."
        : (words.length ? "" : "The next event is ") + e.name + (words.length ? " is " : ", ") + evWhenText(e, lang) + loc + ".");
    var more = pool.slice(1, 3).map(function (x) { return x.name + " (" + shortDate(isoOf(x.when), lang) + ")"; });
    return head + (e.desc ? " " + shortDesc(e.desc) : "") +
      (more.length ? (lang === "es" ? " Después: " + listJoin(more, lang) + "." : " After that: " + listJoin(more, lang) + ".") : "") + gamesTxt;
  }

  /* --- local answers: games --- */
  var SPORT_PAT = [
    [/\bflag football\b|\bflag\b/, function (s) { return /flag football/i.test(s); }, "Flag Football"],
    [/\bfootball\b|\bfutbol americano\b/, function (s) { return /^football$/i.test(s); }, "Football"],
    [/\b(?:basketball|hoops|baloncesto|basquetbol|basquet)\b/, function (s) { return /basketball/i.test(s); }, "Basketball"],
    [/\b(?:soccer|futbol)\b(?! americano)/, function (s) { return /soccer/i.test(s); }, "Soccer"],
    [/\b(?:volleyball|voleibol|voley)\b/, function (s) { return /volleyball/i.test(s); }, "Volleyball"],
    [/\b(?:water polo|waterpolo|polo)\b/, function (s) { return /water polo/i.test(s); }, "Water Polo"],
    [/\b(?:tennis|tenis)\b/, function (s) { return /tennis/i.test(s); }, "Tennis"],
    [/\b(?:cross country|xc|campo traviesa)\b/, function (s) { return /cross country/i.test(s); }, "Cross Country"],
    [/\b(?:field hockey|hockey)\b/, function (s) { return /field hockey/i.test(s); }, "Field Hockey"],
    [/\b(?:wrestling|wrestle|lucha)\b/, function (s) { return /wrestl/i.test(s); }, "Wrestling"],
    [/\bbadminton\b/, function (s) { return /badminton/i.test(s); }, "Badminton"],
    [/\b(?:baseball|beisbol)\b/, function (s) { return /baseball/i.test(s); }, "Baseball"],
    [/\bsoftball\b/, function (s) { return /softball/i.test(s); }, "Softball"],
    [/\bgolf\b/, function (s) { return /golf/i.test(s); }, "Golf"],
    [/\b(?:swim|swimming|diving|natacion)\b/, function (s) { return /swim/i.test(s); }, "Swimming & Diving"],
    [/\b(?:track|atletismo)\b/, function (s) { return /track/i.test(s); }, "Track & Field"],
    [/\blacrosse\b/, function (s) { return /lacrosse/i.test(s); }, "Lacrosse"]
  ];
  function lastIdx(re, n) { var g = new RegExp(re.source, "g"), m, at = -1; while ((m = g.exec(n))) at = m.index; return at; }
  function sportOf(n) {
    var best = null, at = -1;
    for (var i = 0; i < SPORT_PAT.length; i++) {
      var k = lastIdx(SPORT_PAT[i][0], n);
      if (k > at || (k === at && k >= 0 && i === 0)) { at = k; best = SPORT_PAT[i]; }
    }
    // "flag football": the football pattern matches at a later index inside it, so prefer flag.
    if (best && best[2] === "Football" && /\bflag football\b/.test(n) && lastIdx(/\bflag football\b/, n) + 5 === at) best = SPORT_PAT[0];
    return best;
  }
  function genderOf(n) {
    var g = lastIdx(/\b(?:girls?|womens|women|ladies|daughters?|chicas?|femenil|femenino|ninas?|hijas?)\b/, n), b = lastIdx(/\b(?:boys?|mens|men|my son|chicos?|varonil|masculino|ninos?|hijos?)\b/, n);
    return g < 0 && b < 0 ? null : (g > b ? "girls" : "boys");
  }
  function levelOf(n) {
    var opts = [["varsity", /\b(?:varsity)\b/], ["jv", /\b(?:jv|junior varsity)\b/], ["fs", /\b(?:frosh|freshman|fs|frosh soph|sophomore)\b/]];
    var best = null, at = -1;
    opts.forEach(function (o) { var k = lastIdx(o[1], n); if (k > at) { at = k; best = o[0]; } });
    return best;
  }
  function levelFits(lv, want) {
    if (!want) return true;
    var s = String(lv || "").toLowerCase();
    if (!s.trim()) return true;
    if (want === "varsity") return /varsity/.test(s) && !/junior varsity/.test(s);
    if (want === "jv") return /\bjv\b|junior varsity/.test(s);
    return /frosh|fresh|\bfs\b|f\/s|soph/.test(s);
  }
  function isMeetSport(s) { return /cross country|track|swim|dive|wrestl/i.test(String(s || "")); }
  function isMatchSport(s) { return /tennis|badminton|golf/i.test(String(s || "")); }
  function isBellGame(g) {
    if (/bell\s*game/i.test(String(g.title || ""))) return true;
    var sport = String(g.sport || ""), level = String(g.level || "") + " " + String(g.title || "");
    return /\bfootball\b/i.test(sport) && !/\bflag\b/i.test(sport) && /homestead/i.test(String(g.opponent || "")) &&
      !/\b(jv|junior\s*varsity|frosh|freshman|freshmen|f\/s|sophomore)\b/i.test(level) && (/\bvarsity\b/i.test(level) || !String(g.level || "").trim());
  }
  function isSenior(g) { return !!(g.senior || /senior\s*(night|day)/i.test(String(g.title || ""))); }
  var EVENT_NAME_RE = /tournament|invite|invitational|classic|showcase|finals|championship|ccs|scval|league|meet|#\d|jamboree|relays|duals?|memorial|toc\b|tourney/i;
  function gameSentence(g, today, lang, withSport) {
    var team = (withSport ? g.sport + " " : "") + (g.level || "");
    team = team.trim() || g.sport;
    var date = onDay(g.date, today, lang), tm = fmtGameTime(g.time, lang);
    var at = tm ? (lang === "es" ? " a las " + tm : " at " + tm) : "";
    var opp = String(g.opponent || "").trim(), ha = String(g.homeAway || ""), away = /away/i.test(ha), home = g.home || /home/i.test(ha);
    var loc = String(g.location || "").trim();
    var tag = isSenior(g) ? (lang === "es" ? " Es Senior Night." : " It's Senior Night.") : "";
    if (isBellGame(g)) {
      var bAway = away || (!ha && /homestead/i.test(loc));
      return (lang === "es" ? "El Bell Game: Football " + (bAway ? "en" : "vs") + " Homestead es " : "The Bell Game: Football " + (bAway ? "at" : "vs") + " Homestead is ") + date + at + "." + tag;
    }
    if (isMeetSport(g.sport) || isMatchSport(g.sport) && EVENT_NAME_RE.test(opp) || EVENT_NAME_RE.test(opp)) {
      var where = loc && !new RegExp(loc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(opp) ? (lang === "es" ? " en " + loc : " at " + loc) : "";
      if (!opp) return (lang === "es" ? team + " tiene competencia " : team + " has a meet ") + date + at + where + "." + tag;
      if (EVENT_NAME_RE.test(opp) || isMeetSport(g.sport) && !/^[A-Z][\w .'-]+$/.test(opp)) return (lang === "es" ? team + " compite en " + opp : team + " competes in the " + opp.replace(/^the /i, "")) + where + " " + date + at + "." + tag;
      return (lang === "es" ? team + " tiene competencia contra " + opp : team + " has a meet against " + opp) + (home ? (lang === "es" ? " en casa " : " at home ") : " ") + date + at + "." + tag;
    }
    if (!opp) return (lang === "es" ? team + " juega " : team + " plays ") + date + at + (home ? (lang === "es" ? " en casa" : " at home") : "") + "." + tag;
    if (away) return (lang === "es" ? team + " juega en " + opp + " " : team + " plays at " + opp + " ") + date + at + "." + tag;
    if (home) return (lang === "es" ? team + " juega contra " + opp + " en casa " : team + " plays " + opp + " at home ") + date + at + "." + tag;
    return (lang === "es" ? team + " juega contra " + opp + " " : team + " plays " + opp + " ") + date + at + "." + tag;
  }
  function unitWord(sportName, lang, plural) {
    if (sportName && isMeetSport(sportName)) return lang === "es" ? (plural ? "competencias" : "competencia") : (plural ? "meets" : "meet");
    if (sportName && isMatchSport(sportName)) return lang === "es" ? (plural ? "partidos" : "partido") : (plural ? "matches" : "match");
    return lang === "es" ? (plural ? "partidos" : "partido") : (plural ? "games" : "game");
  }
  function answerNextGame(n, D, now, lang) {
    var games = pick(D, ["games", "sportsGames", "nextGames"]) || [];
    if (!games.length) return null;
    // Not ours to answer: the Homecoming spirit event, past games, the XC practice spot.
    if (/\bfirebird football\b|\brancho\b/.test(n)) return null;
    if (/\b(?:was|were|did|last|ago|yesterday|happened|ayer|fue)\b/.test(n)) return null;
    var today = isoOf(now), nowMin = now.getHours() * 60 + now.getMinutes();
    var up = games.filter(function (g) {
      if (!g || !g.sport || /rancho\s*san\s*antonio/i.test([g.title, g.opponent, g.location].join(" "))) return false;
      var d = isoNorm(g.date); if (!d || d < today) return false;
      if (d === today) { var gm = gameTimeMin(g.time); if (String(g.score || "").trim() || (gm != null && gm + 150 < nowMin)) return false; }
      return true;
    }).map(function (g) { var c = {}; for (var k in g) c[k] = g[k]; c.date = isoNorm(g.date); return c; })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (gameTimeMin(a.time) || 0) - (gameTimeMin(b.time) || 0); });
    var sp = sportOf(n), gender = genderOf(n), level = levelOf(n);
    var homeOnly = /\bhome (?:game|games|match|matches|meet|meets)\b|\bat home\b|\ben casa\b/.test(n);
    var awayOnly = /\baway (?:game|games|match|matches)\b|\bfuera de casa\b/.test(n);
    var senior = /\bsenior (?:night|nights|day)\b/.test(n), bell = /\bbell game\b/.test(n);
    var when = parseWhen(n, today);
    // A named opponent ("when do we play Homestead") narrows to games against it.
    var opps = {};
    up.forEach(function (g) { var o = norm(g.opponent || ""); if (o.length >= 4 && (" " + n + " ").indexOf(" " + o + " ") >= 0) opps[o] = 1; });
    var oppNamed = Object.keys(opps).length > 0;
    var pool = up.filter(function (g) {
      if (oppNamed && !opps[norm(g.opponent || "")]) return false;
      if (sp && !sp[1](g.sport)) return false;
      if (gender && /^(boys|girls)\b/i.test(g.sport) && g.sport.toLowerCase().indexOf(gender) !== 0) return false;
      if (!levelFits(g.level, level)) return false;
      if (homeOnly && !(g.home || /home/i.test(g.homeAway || ""))) return false;
      if (awayOnly && !/away/i.test(g.homeAway || "")) return false;
      if (senior && !isSenior(g)) return false;
      if (bell && !isBellGame(g)) return false;
      if (when) { var from = when.iso || when.week[0], to = when.iso || when.week[1]; if (g.date < from || g.date > to) return false; }
      return true;
    });
    var gName = (gender && sp && !/^(?:Football|Flag Football|Cross Country|Field Hockey|Wrestling)$/.test(sp[2]) ? (gender === "girls" ? "Girls " : "Boys ") : "") + (sp ? sp[2] : "");
    var label = (senior ? (lang === "es" ? "Senior Night " : "senior night ") : "") + (gName || (lang === "es" ? "" : "")).trim();
    if (!pool.length) {
      var thisWk = when && !when.iso && when.week[0] <= addDays(today, 6) && !/next|proxima|que viene/.test(n);
      var scope = when ? (when.iso ? " " + onDay(when.iso, today, lang)
        : (lang === "es" ? (thisWk ? " esta semana" : " esa semana") : (thisWk ? " this week" : " that week"))) : "";
      var unit = unitWord(sp && sp[2], lang, true);
      // Nothing in that window: name the next one that fits everything else the student asked.
      var after = (when || homeOnly || awayOnly) ? up.filter(function (g) {
        if (oppNamed && !opps[norm(g.opponent || "")]) return false;
        if (sp && !sp[1](g.sport)) return false;
        if (gender && /^(boys|girls)\b/i.test(g.sport) && g.sport.toLowerCase().indexOf(gender) !== 0) return false;
        if (!levelFits(g.level, level)) return false;
        if (homeOnly && !(g.home || /home/i.test(g.homeAway || ""))) return false;
        if (awayOnly && !/away/i.test(g.homeAway || "")) return false;
        if (senior && !isSenior(g)) return false;
        if (when) { var to2 = when.iso || when.week[1]; if (g.date <= to2) return false; }
        return true;
      })[0] : null;
      var where = homeOnly ? (lang === "es" ? " en casa" : " at home") : "";
      var head = lang === "es"
        ? "No veo " + (label ? unit + " de " + label : unit) + (/^competencia/.test(unit) ? " próximas" : " próximos") + where + " en el calendario" + scope + "."
        : "I don't see any upcoming " + (label ? label + " " : "") + unit + where + " on the schedule" + scope + ".";
      if (after) return head + (lang === "es" ? " El próximo: " : " The next one: ") + gameSentence(after, today, lang, true);
      return head + (lang === "es" ? " La pestaña Deportes tiene la temporada completa y los resultados." : " The Sports tab has the full season and results.");
    }
    var lines = [];
    if (sp && !gender && !level && !senior && !bell) {
      // Every matching team and level, soonest first, one line each.
      var seen = {};
      for (var i = 0; i < pool.length && lines.length < 4; i++) {
        var key = pool[i].sport + "|" + String(pool[i].level || "").toLowerCase();
        if (seen[key]) continue; seen[key] = 1;
        lines.push(gameSentence(pool[i], today, lang, true));
      }
    } else if (!sp && !when && !senior && !bell && !homeOnly && !awayOnly) {
      for (var j = 0; j < pool.length && lines.length < 3; j++) lines.push(gameSentence(pool[j], today, lang, true));
      lines[0] = (lang === "es" ? "Próximo: " : "Next up: ") + lines[0];
    } else {
      for (var k2 = 0; k2 < pool.length && lines.length < 3; k2++) lines.push(gameSentence(pool[k2], today, lang, true));
    }
    return lines.join(" ");
  }

  /* --- local answers: spirit, announcements, small talk --- */
  var CLS_ES = { Seniors: "Cuarto año", Juniors: "Tercer año", Sophomores: "Segundo año", Freshmen: "Primer año" };
  function num(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function answerSpirit(n, D, now, lang) {
    var st = (pick(D, ["spirit", "spiritStandings"]) || []).filter(function (s) { return s && s.cls && isFinite(s.pts); }).slice()
      .sort(function (a, b) { return b.pts - a.pts; });
    if (!st.length) return null;
    var nm = function (c) { return lang === "es" ? (CLS_ES[c] || c) : "the " + c; };
    var lead = st[0], tied = st.filter(function (s) { return s.pts === lead.pts; });
    var rest = st.slice(tied.length).map(function (s) { return nm(s.cls) + " (" + num(s.pts) + ")"; });
    var head;
    if (lang === "es") {
      head = tied.length > 1 ? listJoin(tied.map(function (s) { return nm(s.cls); }), lang) + " van empatados en primer lugar con " + num(lead.pts) + " puntos"
        : nm(lead.cls) + " va en primer lugar con " + num(lead.pts) + " puntos";
      return head + (rest.length ? ", seguido de " + listJoin(rest, lang) : "") + ". La pestaña Espíritu tiene la gráfica completa.";
    }
    head = tied.length > 1 ? cap(listJoin(tied.map(function (s) { return nm(s.cls); }), lang)) + " are tied for first with " + num(lead.pts) + " points"
      : cap(nm(lead.cls)) + " are in first with " + num(lead.pts) + " points";
    return head + (rest.length ? ", followed by " + listJoin(rest, lang) : "") + ". The Spirit tab has the full chart.";
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function answerAnnouncements(n, D, now, lang) {
    var raw = pick(D, ["announcements", "annAll", "announcementsToday"]) || [];
    if (!raw.length) return null;
    var today = isoOf(now), nowMin = now.getHours() * 60 + now.getMinutes();
    var byDate = {};
    raw.forEach(function (a) {
      var d = isoNorm(a && a.date); if (!d) return;
      if (d > today || (d === today && nowMin < 510)) return;    // revealed at 8:30 AM, like the app
      var list = byDate[d] || (byDate[d] = []);
      if (Array.isArray(a.bullets)) a.bullets.forEach(function (b) { if (b) list.push(String(b)); });
      else { var h = a.title || (String(a.text || "").match(/^[\s\S]*?[.!?](?=\s|$)/) || [String(a.text || "")])[0]; if (h) list.push(String(h)); }
    });
    var dates = Object.keys(byDate).sort();
    if (!dates.length) return null;
    var d0 = dates[dates.length - 1], items = byDate[d0].map(function (s) { return s.replace(/\s+/g, " ").replace(/[.\s]+$/, "").slice(0, 110); });
    var shown = items.slice(0, 12), extra = items.length - shown.length;
    var list = shown.join("; ") + (extra > 0 ? (lang === "es" ? "; y " + extra + " más" : "; and " + extra + " more") : "") + ".";
    if (d0 === today) return (lang === "es" ? "Los anuncios de hoy: " : "Today's announcements: ") + list + (lang === "es" ? " El texto completo está en Inicio." : " The full text is on the Home tab.");
    return (lang === "es" ? "No hay anuncios nuevos hoy. Los más recientes, del " + longDate(d0, lang) + ": " : "There are no new announcements today. The latest ones, from " + longDate(d0, lang) + ": ") +
      list + (lang === "es" ? " El texto completo está en Inicio." : " The full text is on the Home tab.");
  }
  var SMALL = {
    greeting: { en: "Hi, I'm Felipe! Ask me about your schedule, events, sports, clubs, spirit points or your Schoology assignments.",
      es: "¡Hola, soy Felipe! Pregúntame sobre tu horario, eventos, deportes, clubes, puntos de espíritu o tus tareas de Schoology." },
    thanks: { en: "You're welcome! Let me know if you need anything else.", es: "¡De nada! Avísame si necesitas algo más." },
    capabilities: { en: "I can tell you what period it is, when lunch starts, whether there's school on a given day, the next events and games, the spirit standings and today's announcements. I can also help with school life, like explaining a concept, planning your week, drafting an email to a teacher or a club, or summarizing your Schoology assignments once you connect Schoology.",
      es: "Puedo decirte qué periodo es, a qué hora es el almuerzo, si hay clases un día, los próximos eventos y partidos, los puntos de espíritu y los anuncios de hoy. También puedo ayudarte con la vida escolar, como explicar un tema, planear tu semana, escribir un correo a un maestro o a un club, o resumir tus tareas de Schoology cuando conectes Schoology." }
  };

  var LOCAL = {
    period_now: function (n, D, now, lang, T) { return answerNow(n, D, now, lang, T); },
    time_left: function (n, D, now, lang, T) { return answerBell(n, D, now, lang, T); },
    bell_time: function (n, D, now, lang, T) { return answerBell(n, D, now, lang, T); },
    day_type: function (n, D, now, lang, T) { return answerDayType(n, D, now, lang, T); },
    school_on: function (n, D, now, lang, T) { return answerSchoolOn(n, D, now, lang, T); },
    next_event: function (n, D, now, lang) { return answerNextEvent(n, D, now, lang); },
    next_game: function (n, D, now, lang) { return answerNextGame(n, D, now, lang); },
    spirit_standings: function (n, D, now, lang) { return answerSpirit(n, D, now, lang); },
    announcements_today: function (n, D, now, lang) { return answerAnnouncements(n, D, now, lang); },
    greeting: function (n, D, now, lang) { return SMALL.greeting[lang]; },
    thanks: function (n, D, now, lang) { return SMALL.thanks[lang]; },
    capabilities: function (n, D, now, lang) { return SMALL.capabilities[lang]; }
  };
  var SCHEDULE_INTENTS = { period_now: 1, time_left: 1, bell_time: 1, day_type: 1, school_on: 1 };

  function tidy(s) {
    return String(s).replace(/\s*—\s*/g, ", ").replace(/\s{2,}/g, " ").replace(/\s+([.,;:!?])/g, "$1").replace(/\.\./g, ".").trim();
  }
  function answerLocal(intent, question, data, lang) {
    try {
      var fn = LOCAL[intent]; if (!fn) return null;
      var D = data || {};
      lang = lang === "es" ? "es" : "en";
      var now = D.now instanceof Date && !isNaN(D.now) ? D.now : ptNow();
      var T = tables(D);
      if (SCHEDULE_INTENTS[intent] && (!T.schedules || !T.schedules.mon)) return null;
      var text = fn(norm(question), D, now, lang, T);
      return text ? { text: tidy(text), source: "app" } : null;
    } catch (e) { return null; }
  }

  /* =====================================================================
     6. Schoology items for one question (client side; never stored)
     ===================================================================== */
  var SGY_STOP = {};
  ("what when about this that the my is are due assignment assignments homework summarize summary explain help with for " +
    "please can you tell me does do have any and quiz test essay project tarea tareas que mi mis sobre esta resumen resume " +
    "make plan planning everything done before after break first should today tonight tomorrow week weekend need work start " +
    "organize prioritize finish catch thanksgiving winter spring next this friday monday tuesday wednesday thursday " +
    "study studying schedule list show give everything things stuff upcoming coming").split(" ")
    .forEach(function (w) { SGY_STOP[w] = 1; });
  // Subject words a student says that the feed's titles may not ("my spanish quiz" vs "Unidad 4 Vocabulario Quiz").
  var SGY_ALIAS = {
    spanish: ["espanol", "unidad", "vocabulario", "vocab", "capitulo"], french: ["francais", "unite", "vocabulaire", "chapitre"],
    chem: ["chemistry", "stoichiometry", "mole", "moles", "reaction", "titration"], chemistry: ["chem", "stoichiometry", "mole", "titration"],
    bio: ["biology", "cell", "photosynthesis", "genetics", "ecology"], biology: ["bio", "cell", "photosynthesis", "genetics"],
    physics: ["phys", "motion", "forces", "kinematics", "energy"], math: ["algebra", "geometry", "calculus", "calc", "precalc", "stats", "statistics", "trig"],
    english: ["essay", "reading", "novel", "literature", "poem", "annotation"], history: ["apush", "whap", "chapter", "dbq", "civics", "government", "econ"],
    calc: ["calculus", "derivative", "integral", "limits"], cs: ["coding", "python", "java", "programming"]
  };
  function pickAssignments(question, items, max) {
    max = Math.min(Math.max(+max || 8, 1), 12);
    if (!Array.isArray(items) || !items.length) return [];
    var n = norm(question), today = isoOf(ptNow());
    var list = items.filter(function (e) { return e && typeof e.title === "string" && e.title.trim(); }).slice()
      .sort(function (a, b) { var x = isoNorm(a.date) || "9999", y = isoNorm(b.date) || "9999"; return x < y ? -1 : x > y ? 1 : 0; });
    var upcoming = list.filter(function (e) { return !e.date || isoNorm(e.date) >= today; });
    var words = n.split(" ").filter(function (w) { return w.length >= 3 && !SGY_STOP[w] && !EV_STOP[w]; });
    var chosen = [];
    if (words.length) {
      chosen = list.map(function (e) {
        var hay = norm(e.title + " " + (e.desc || "")), s = 0;
        words.forEach(function (w) {
          if (w.length >= 4 && hay.indexOf(w) >= 0) s += 2;
          else if (w.length >= 4 && hay.indexOf(w.slice(0, 4)) >= 0) s += 1;
          else if ((SGY_ALIAS[w] || []).some(function (a) { return new RegExp("\\b" + a).test(hay); })) s += 2;
        });
        return { e: e, s: s };
      }).filter(function (x) { return x.s >= 2; }).sort(function (a, b) { return b.s - a.s; }).map(function (x) { return x.e; });
    }
    if (!chosen.length) {
      var when = parseWhen(n, today);
      if (when) {
        var from = when.iso || when.week[0], to = when.iso || when.week[1];
        chosen = upcoming.filter(function (e) { var d = isoNorm(e.date); return d >= from && d <= to; });
      }
    }
    // Nothing matched by name or date: send the upcoming list only for a general question about
    // the student's work ("what's due", "my homework"); otherwise send nothing.
    if (!chosen.length && /\b(?:due|homework|assignments?|tareas?|entregar|schoology|what do i have|que tengo|workload|busy|plan my)\b/.test(n)) chosen = upcoming;
    var clip = function (s, k) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, k); };
    return chosen.slice(0, max).map(function (e) {
      var d = isoNorm(e.date);
      // The weekday goes with the date, so the model never has to work one out.
      var due = d ? WDL_EN[wdOf(d)].slice(0, 3) + " " + d + (e.allDay ? "" : (e.time ? " " + e.time : "")) : "";
      return { title: clip(e.title, 200), type: clip(e.type, 20), due: clip(due, 40),
        desc: clip(e.desc, 600), url: /^https:\/\/[a-z0-9-]+\.schoology\.com\//i.test(String(e.url || "")) ? clip(e.url, 300) : "" };
    });
  }

  // Compile every pattern once at load, so the first real question is as fast as the rest.
  try { classify("what period is it"); classify("when is the next girls basketball game tomorrow"); classify("hay clases el viernes"); } catch (e) {}

  return {
    version: VERSION,
    classify: classify,
    answerLocal: answerLocal,
    cannotReply: cannotReply,
    crisisReply: crisisReply,
    pickAssignments: pickAssignments,
    norm: norm,
    INTENT_SECTIONS: INTENT_SECTIONS,
    LOCAL_INTENTS: Object.keys(LOCAL_INTENTS)
  };
});
