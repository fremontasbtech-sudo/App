/* Firebird Hub "Find your club" matcher (2026-11-20).
   Every club has hand-checked tags taken from its own description on the official clubs list
   (club-quiz/ in the repo explains how). A club that is not in TAGS yet (new on the list) is tagged
   from its name and purpose by keyword rules, so it can still be matched.
   Scoring: interest fit counts most, then what you want to do at meetings, the time you can give,
   and what you want from a club. The result is an absolute fit from 0 to 1, so a weak best match
   reads as weak instead of being stretched to look good. Works in the browser (window.ClubMatch)
   and in Node (module.exports) so the eval harness runs the same code. */
(function(root){
"use strict";
var VERSION = "2";

/* ---- Questions. Option keys feed the scorer; text is English plus Spanish. ---- */
var QS = [
  { id:"int", multi:true, max:3, q:["What are you into?","¿Qué te interesa?"], hint:["Pick up to 3","Elige hasta 3"], grid:true, opts:[
    { k:"coding",  t:["Coding and tech","Programación y tecnología"], i:{coding:1} },
    { k:"build",   t:["Building and engineering","Construcción e ingeniería"], i:{engineering:1} },
    { k:"science", t:["Science and math","Ciencia y matemáticas"], i:{science:1, math:1} },
    { k:"health",  t:["Medicine and health","Medicina y salud"], i:{health:1} },
    { k:"business",t:["Business and money","Negocios y finanzas"], i:{business:1} },
    { k:"debate",  t:["Debate, law and world affairs","Debate, leyes y asuntos mundiales"], i:{debate_law_politics:1, geography_world:1} },
    { k:"art",     t:["Art and crafts","Arte y manualidades"], i:{visual_art:1} },
    { k:"music",   t:["Music and singing","Música y canto"], i:{music:1} },
    { k:"dance",   t:["Dance","Baile"], i:{dance:1} },
    { k:"theatre", t:["Theatre and film","Teatro y cine"], i:{film_theatre:1} },
    { k:"books",   t:["Books and writing","Libros y escritura"], i:{writing_books:1} },
    { k:"culture", t:["Culture, language and faith","Cultura, idiomas y fe"], i:{culture_heritage:1, language:1, faith:1} },
    { k:"service", t:["Volunteering and causes","Voluntariado y causas"], i:{service:1, identity_support:1, environment:0.6} },
    { k:"nature",  t:["Nature, animals and the environment","Naturaleza, animales y medio ambiente"], i:{environment:1, animals:1} },
    { k:"sports",  t:["Sports and fitness","Deportes y ejercicio"], i:{sports_fitness:1} },
    { k:"games",   t:["Games and food","Juegos y comida"], i:{games:1, food:1} }
  ]},
  { id:"com", multi:true, when:function(a){ return has(a,"int","culture"); }, q:["Which communities?","¿Qué comunidades?"], hint:["Pick any that fit","Elige todas las que te queden"], grid:true, opts:[
    { k:"chinese", t:["Chinese","China"] }, { k:"japanese", t:["Japanese","Japón"] },
    { k:"korean", t:["Korean and K-pop","Corea y K-pop"] }, { k:"south_asian", t:["South Asian","Sur de Asia"] },
    { k:"filipino", t:["Filipino","Filipinas"] }, { k:"latino", t:["Latino and Mexican","Latina y mexicana"] },
    { k:"black", t:["Black","Afroamericana"] }, { k:"french", t:["French","Francia"] },
    { k:"jewish", t:["Jewish","Judía"] }, { k:"muslim", t:["Muslim","Musulmana"] },
    { k:"christian", t:["Christian","Cristiana"] }, { k:"multicultural", t:["Many cultures","Muchas culturas"] }
  ]},
  { id:"act", multi:true, max:2, q:["What do you want to do at meetings?","¿Qué quieres hacer en las reuniones?"], hint:["Pick up to 2","Elige hasta 2"], opts:[
    { k:"compete", t:["Compete in contests","Competir en concursos"], a:{compete:1} },
    { k:"make",    t:["Build or make things","Construir o crear cosas"], a:{build_make:1} },
    { k:"learn",   t:["Learn and talk about ideas","Aprender y hablar de ideas"], a:{learn_discuss:1} },
    { k:"stage",   t:["Perform for an audience","Presentarte ante el público"], a:{perform:1} },
    { k:"help",    t:["Volunteer and help out","Ser voluntario y ayudar"], a:{volunteer:1} },
    { k:"chill",   t:["Hang out and play","Convivir y jugar"], a:{hang_out_play:1} }
  ]},
  { id:"time", q:["How much time do you want to give?","¿Cuánto tiempo quieres dedicar?"], hint:["Pick one","Elige una"], opts:[
    { k:"light",   t:["A lunch now and then","Un almuerzo de vez en cuando"] },
    { k:"regular", t:["Most weeks at lunch","Casi todas las semanas en el almuerzo"] },
    { k:"heavy",   t:["After school too","También después de clases"] }
  ]},
  { id:"goal", q:["What do you want most from a club?","¿Qué es lo que más quieres de un club?"], hint:["Pick one","Elige una"], opts:[
    { k:"friends", t:["New friends","Nuevos amigos"] },
    { k:"skills",  t:["Skills for college or a career","Habilidades para la universidad o una carrera"] },
    { k:"service", t:["Service hours and helping others","Horas de servicio y ayudar a otros"] },
    { k:"honors",  t:["Awards and honors","Premios y honores"] },
    { k:"fun",     t:["A fun break from class","Un descanso divertido"] }
  ]}
];
function has(ans, qid, k){ var v=ans && ans[qid]; return !!(v && v.indexOf(k)>=0); }
function optOf(qid, k){ for(var i=0;i<QS.length;i++){ if(QS[i].id===qid){ var o=QS[i].opts; for(var j=0;j<o.length;j++) if(o[j].k===k) return o[j]; } } return null; }

/* ---- Club tags. i = interests, a = activities (weights 1 to 3, 3 = core purpose),
   c = commitment (l light, r regular, h heavy, u unknown), o = openness (o open, c community,
   s selective), m = community, q = confidence (l = description is a stub). ---- */
var TAGS = /*TAGS_START*/{"4kidz":{"i":{"service":3,"health":1},"a":{"volunteer":3,"learn_discuss":2,"build_make":1},"c":"r","o":"o"},"Aerospace and UAV Society":{"i":{"engineering":3,"film_theatre":1},"a":{"learn_discuss":3,"build_make":1},"c":"r","o":"o"},"Art and animation club":{"i":{"visual_art":3},"a":{"build_make":2},"c":"r","o":"o","q":"l"},"Astrophysics Club":{"i":{"science":3},"a":{"learn_discuss":3},"c":"r","o":"o"},"Basketball Club":{"i":{"sports_fitness":3,"service":3},"a":{"volunteer":3,"hang_out_play":1},"c":"r","o":"o"},"BSU":{"i":{"culture_heritage":3,"identity_support":2},"a":{"hang_out_play":3},"c":"r","o":"c","m":"black"},"Bring Change 2 Mind":{"i":{"identity_support":3,"health":2},"a":{"learn_discuss":3},"c":"r","o":"o"},"California Scholarship Federation (CSF)":{"i":{"academics_honors":3,"service":2},"a":{"volunteer":3},"c":"r","o":"s"},"Ceramics Club":{"i":{"visual_art":3},"a":{"build_make":3,"hang_out_play":2,"learn_discuss":1},"c":"r","o":"o"},"Cheese Club":{"i":{"food":3},"a":{"learn_discuss":1},"c":"r","o":"o","q":"l"},"Chinese club/NCHS":{"i":{"culture_heritage":3,"language":2,"games":1,"academics_honors":1},"a":{"learn_discuss":3,"hang_out_play":2,"volunteer":1},"c":"r","o":"o","m":"chinese"},"Chinese Song Club":{"i":{"music":3,"culture_heritage":2,"language":1},"a":{"perform":2,"hang_out_play":2},"c":"r","o":"o","m":"chinese"},"Climate Collective":{"i":{"environment":3},"a":{"learn_discuss":2,"volunteer":1},"c":"r","o":"o"},"Cloud Computing":{"i":{"coding":3},"a":{"learn_discuss":3},"c":"r","o":"o"},"culinary for community":{"i":{"food":3,"service":3},"a":{"build_make":3,"volunteer":3},"c":"l","o":"o"},"Cybersecurity Club":{"i":{"coding":3},"a":{"learn_discuss":3},"c":"r","o":"o"},"Developer Club":{"i":{"coding":3},"a":{"build_make":3,"learn_discuss":2,"compete":1},"c":"r","o":"o"},"Environmental Club":{"i":{"environment":3},"a":{"learn_discuss":2},"c":"u","o":"o","q":"l"},"Everyday Hardware Essentials Club":{"i":{"engineering":3},"a":{"learn_discuss":3},"c":"l","o":"o"},"FHS Badminton Club":{"i":{"sports_fitness":3},"a":{"hang_out_play":3,"compete":1},"c":"r","o":"o"},"Fhs Christian Club":{"i":{"faith":3},"a":{"learn_discuss":3,"hang_out_play":2,"volunteer":1},"c":"r","o":"c","m":"christian"},"Filipino Youth Organization":{"i":{"culture_heritage":3},"a":{"learn_discuss":1},"c":"l","o":"c","m":"filipino","q":"l"},"Firebird Buddies":{"i":{"identity_support":3,"service":2},"a":{"hang_out_play":3},"c":"r","o":"o"},"Fremont GSA":{"i":{"identity_support":3},"a":{"hang_out_play":2,"learn_discuss":2},"c":"r","o":"c"},"Fremont Hack Club (Programming Club)":{"i":{"coding":3},"a":{"build_make":3,"learn_discuss":2},"c":"r","o":"o"},"Fremont High Robotics":{"i":{"engineering":3,"business":1},"a":{"build_make":3,"learn_discuss":2},"c":"h","o":"o"},"Fremont High School Folklórico":{"i":{"dance":3,"culture_heritage":3},"a":{"learn_discuss":3,"perform":1},"c":"h","o":"o","m":"latino"},"Fremont Pickleball Club":{"i":{"sports_fitness":3},"a":{"hang_out_play":2},"c":"r","o":"o"},"Fremont Rocketry":{"i":{"engineering":3,"science":2},"a":{"compete":3,"build_make":3},"c":"r","o":"o"},"Fremont Speech and Debate":{"i":{"debate_law_politics":3},"a":{"learn_discuss":3,"perform":2,"compete":2},"c":"h","o":"o"},"Fremont Zahraa":{"i":{"dance":3,"culture_heritage":1},"a":{},"c":"r","o":"o","m":"south_asian","q":"l"},"French club/honors society":{"i":{"language":3,"culture_heritage":2,"writing_books":1,"film_theatre":1,"academics_honors":1},"a":{"learn_discuss":3},"c":"r","o":"o","m":"french"},"Future Business Leaders of America":{"i":{"business":3},"a":{"compete":3},"c":"r","o":"o"},"Garden Club":{"i":{"environment":3},"a":{"build_make":2,"learn_discuss":2,"hang_out_play":2},"c":"r","o":"o"},"Geography Club":{"i":{"geography_world":3},"a":{"learn_discuss":3,"hang_out_play":1},"c":"r","o":"o"},"Geopolitics and History":{"i":{"debate_law_politics":3,"geography_world":2},"a":{},"c":"u","o":"o","q":"l"},"Girls in Business":{"i":{"business":3,"identity_support":2,"service":2},"a":{"learn_discuss":3,"volunteer":2,"compete":1},"c":"l","o":"c"},"Girls Who Code":{"i":{"coding":3,"identity_support":2},"a":{"learn_discuss":3},"c":"r","o":"c"},"HOSA":{"i":{"health":3,"service":2},"a":{"learn_discuss":2,"compete":2,"volunteer":2},"c":"r","o":"o"},"Indian Student Association (formerly Indian recognition society)":{"i":{"culture_heritage":3},"a":{"hang_out_play":2},"c":"l","o":"c","m":"south_asian"},"Interact Club":{"i":{"service":3},"a":{"volunteer":3},"c":"r","o":"o"},"Investing Club":{"i":{"business":3},"a":{"learn_discuss":3},"c":"l","o":"o"},"Japanese Culture Club":{"i":{"culture_heritage":3,"games":1,"food":1},"a":{"hang_out_play":2,"learn_discuss":2},"c":"r","o":"o","m":"japanese"},"Jewish Student union":{"i":{"faith":3,"culture_heritage":2},"a":{"learn_discuss":3},"c":"r","o":"c","m":"jewish"},"Just Dance club":{"i":{"dance":3,"games":2},"a":{"hang_out_play":3},"c":"l","o":"o"},"Key Club":{"i":{"service":3},"a":{"volunteer":3},"c":"r","o":"o"},"Knitting & Crochet Club":{"i":{"visual_art":3,"service":2},"a":{"build_make":3,"volunteer":2},"c":"r","o":"o"},"Konnect Dance Troupe (KDT)":{"i":{"dance":3,"culture_heritage":2,"music":1},"a":{"hang_out_play":3,"perform":2},"c":"r","o":"o","m":"korean"},"LSU":{"i":{"culture_heritage":3},"a":{"hang_out_play":2},"c":"l","o":"c","m":"latino"},"Magic: the Gathering Club":{"i":{"games":3},"a":{"hang_out_play":3,"learn_discuss":2},"c":"r","o":"o"},"Math Club":{"i":{"math":3},"a":{"compete":3},"c":"r","o":"o"},"Mock Trial":{"i":{"debate_law_politics":3},"a":{"compete":3,"learn_discuss":2},"c":"h","o":"o"},"Model United nations":{"i":{"debate_law_politics":3,"geography_world":2},"a":{"learn_discuss":3},"c":"r","o":"o"},"Movie Club":{"i":{"film_theatre":3},"a":{"learn_discuss":3,"build_make":2,"hang_out_play":1},"c":"r","o":"o"},"Multicultural club":{"i":{"culture_heritage":3,"geography_world":1},"a":{"learn_discuss":3},"c":"l","o":"o","m":"multicultural","q":"l"},"Muslim Community Association (MSA)":{"i":{"faith":3,"identity_support":2,"culture_heritage":2,"geography_world":1},"a":{"learn_discuss":3,"hang_out_play":1},"c":"l","o":"c","m":"muslim"},"National Honor Society":{"i":{"academics_honors":3,"service":2},"a":{"volunteer":3},"c":"l","o":"s"},"National Personal Finance Challenge Club":{"i":{"business":3},"a":{"compete":3,"learn_discuss":2},"c":"r","o":"o"},"Neuroscience Club":{"i":{"science":3,"health":1},"a":{"learn_discuss":3,"build_make":1},"c":"r","o":"o"},"Octagon Club":{"i":{"service":3,"environment":1},"a":{"volunteer":3},"c":"r","o":"o"},"Poetry Club":{"i":{"writing_books":3},"a":{"perform":3,"hang_out_play":2,"compete":2},"c":"r","o":"o"},"Radical Researchers Club":{"i":{"science":3},"a":{"learn_discuss":3},"c":"r","o":"o","q":"l"},"Red Cross":{"i":{"service":3,"health":2},"a":{"volunteer":3,"learn_discuss":2},"c":"r","o":"o"},"Science Bowl":{"i":{"science":3},"a":{"compete":3},"c":"r","o":"o"},"Science Olympiad":{"i":{"science":3,"engineering":1},"a":{"compete":3,"learn_discuss":1},"c":"r","o":"o"},"Scientist Societea":{"i":{"science":3,"business":1},"a":{"learn_discuss":3},"c":"l","o":"o"},"Self-Defense Club":{"i":{"sports_fitness":3},"a":{"learn_discuss":2},"c":"r","o":"o"},"Ship It Society":{"i":{"coding":3},"a":{"build_make":3},"c":"l","o":"o"},"Sports Medicine":{"i":{"health":3,"sports_fitness":1},"a":{"learn_discuss":3},"c":"r","o":"o"},"Teenswithmed":{"i":{"health":3},"a":{"learn_discuss":3},"c":"r","o":"o"},"The Book Club":{"i":{"writing_books":3},"a":{"learn_discuss":2,"hang_out_play":2},"c":"r","o":"o"},"Theatre club":{"i":{"film_theatre":3},"a":{"hang_out_play":2},"c":"l","o":"o","q":"l"},"Tri-M Music Honor Society":{"i":{"music":3,"academics_honors":2,"service":2},"a":{"volunteer":2,"perform":2},"c":"l","o":"s"},"UNICEF":{"i":{"service":3,"geography_world":2},"a":{"volunteer":3},"c":"l","o":"o"},"USABO":{"i":{"science":3},"a":{"compete":3,"learn_discuss":2},"c":"l","o":"o"},"Vet Connect":{"i":{"health":3,"service":2,"animals":3},"a":{"learn_discuss":2,"volunteer":2,"build_make":1},"c":"l","o":"o"}}/*TAGS_END*/;

function norm(s){ return String(s||"").toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g," ").trim(); }
var TAGN = {}; Object.keys(TAGS).forEach(function(k){ TAGN[norm(k)] = TAGS[k]; });

/* Fallback for clubs added after these tags were written: keyword rules on name and purpose. */
var AUTO_I = [
  ["coding", /\b(cod(e|ing)|program|software|developer|app|web|cyber|hack|computer science|cloud|ai)\b/],
  ["engineering", /\b(robot|engineer|rocket|aerospace|drone|uav|hardware|electronic|build)\b/],
  ["science", /\b(science|physics|astro|biolog|chem|neuro|research|olympiad)\b/],
  ["math", /\b(math|amc|calculus)\b/],
  ["health", /\b(medic|health|hosa|vet|doctor|nurs|mental)\b/],
  ["business", /\b(business|entrepreneur|fbla|deca|invest|financ|econ|market)\b/],
  ["debate_law_politics", /\b(debate|speech|law|trial|model un|politic|history|government)\b/],
  ["geography_world", /\b(geograph|global|international|world|un)\b/],
  ["writing_books", /\b(book|read|poet|writ|literat|journal)\b/],
  ["visual_art", /\b(art|draw|paint|anim|ceramic|craft|knit|crochet|design|photo)\b/],
  ["music", /\b(music|band|orchestra|choir|sing|song)\b/],
  ["dance", /\b(dance|k ?pop|folkl|bollywood)\b/],
  ["film_theatre", /\b(film|movie|theat|drama|act(ing)?)\b/],
  ["culture_heritage", /\b(cultur|heritage|student union|student association|asian|latin|black|filipino|indian|chinese|japanese|korean)\b/],
  ["language", /\b(language|spanish|french|mandarin|chinese|japanese|korean)\b/],
  ["faith", /\b(christian|muslim|jewish|faith|bible|church|islam|hindu)\b/],
  ["service", /\b(service|volunteer|charit|fundrais|donat|community|key club|interact|red cross|unicef)\b/],
  ["identity_support", /\b(awareness|stigma|safe space|advoca|gsa|inclusi|equity)\b/],
  ["environment", /\b(environment|climate|sustain|garden|green|nature|plant)\b/],
  ["sports_fitness", /\b(sport|ball|tennis|badminton|soccer|fitness|yoga|martial|self defense|climb|run)\b/],
  ["games", /\b(game|chess|card|esport|gaming|magic)\b/],
  ["food", /\b(food|cook|culinary|bak|cheese|tea)\b/],
  ["academics_honors", /\b(honor|scholarship federation|nhs|csf)\b/]
];
var AUTO_A = [
  ["compete", /\b(compet|tournament|contest|challenge)\b/], ["build_make", /\b(build|make|creat|design|project)\b/],
  ["learn_discuss", /\b(learn|teach|educat|discuss|explor|speaker|present)\b/], ["perform", /\b(perform|show|concert|stage)\b/],
  ["volunteer", /\b(volunteer|service|fundrais|donat)\b/], ["hang_out_play", /\b(fun|play|hang|social|community|friend)\b/]
];
function commitOf(meet){
  var m = String(meet||"").toLowerCase();
  if(!m) return "u";
  if(/\b(\d{1,2}:\d{2}\s*-\s*\d|pm|after school|evening)\b/.test(m) || /\b(mon|tue|wed|thu|fri)\b.*&.*\b(mon|tue|wed|thu|fri)\b/.test(m)) return "h";
  if(/month|1st|2nd|3rd|last/.test(m)) return "l";
  return "r";
}
function autoTag(c){
  var t = norm(c.name)+" "+norm(c.purpose||c.desc||c.other);
  var nm = norm(c.name), i={}, a={};
  AUTO_I.forEach(function(r){ if(r[1].test(t)) i[r[0]] = r[1].test(nm) ? 3 : 2; });
  AUTO_A.forEach(function(r){ if(r[1].test(t)) a[r[0]] = 2; });
  return { i:i, a:a, c:commitOf(c.meetingInfo), o:/\bhonor\b/.test(t)?"s":"o", q:"l", auto:true };
}
function tagsOf(c){ return TAGN[norm(c.name)] || autoTag(c); }

/* ---- Scoring ---- */
var W = { interest:0.56, act:0.2, time:0.12, goal:0.12 };
var TIME_FIT = { light:{l:1, r:0.75, h:0.3, u:0.75}, regular:{l:0.85, r:1, h:0.55, u:0.8}, heavy:{l:0.6, r:0.85, h:1, u:0.75} };

function interestFit(ans, t){
  var picks = (ans.int||[]), ms = [], best = null;
  picks.forEach(function(k){
    var o = optOf("int", k); if(!o) return;
    var m = 0;
    Object.keys(o.i).forEach(function(key){ var w = (t.i[key]||0)/3 * o.i[key]; if(w>m) m=w; });
    if(k==="culture" && t.m && (ans.com||[]).length){
      // A club for a community you picked is a full match; other community clubs stay partial.
      var want = ans.com;
      if(want.indexOf(t.m)>=0) m = 1;
      else if(t.m==="multicultural" || want.indexOf("multicultural")>=0) m = Math.min(m, 0.45);
      else m = Math.min(m, 0.3);
    }
    ms.push({k:k, m:m});
  });
  // "Awards and honors" as a goal also counts honor societies as an interest match.
  if(has(ans,"goal","honors") && t.i.academics_honors) ms.push({k:"honors", m:0.9*t.i.academics_honors/3});
  ms.sort(function(x,y){ return y.m-x.m; });
  var raw = (ms[0]?ms[0].m:0) + 0.25*(ms[1]?ms[1].m:0) + 0.1*(ms[2]?ms[2].m:0);
  // With 2 or 3 interests picked, a club that fits two of them beats one that fits only one.
  var np = picks.length, denom = 1 + 0.5*((np>=2?0.25:0) + (np>=3?0.1:0));
  return { fit:Math.min(1, raw/denom), raw:raw, top:ms[0] && ms[0].m>0 ? ms[0].k : null, second:ms[1] && ms[1].m>=0.6 ? ms[1].k : null };
}
function actFit(ans, t){
  var picks = ans.act||[], ms = [];
  if(!Object.keys(t.a).length) return { fit:0.5, top:null };
  picks.forEach(function(k){ var o=optOf("act",k); if(!o) return; var key=Object.keys(o.a)[0]; ms.push({k:k, m:(t.a[key]||0)/3}); });
  ms.sort(function(x,y){ return y.m-x.m; });
  if(!ms.length) return { fit:0.5, top:null };
  return { fit:Math.min(1, ms[0].m + 0.2*(ms[1]?ms[1].m:0)), top:ms[0].m>=0.6 ? ms[0].k : null };
}
function goalFit(goal, t){
  var a=t.a, i=t.i, f=function(x){ return (x||0)/3; };
  switch(goal){
    case "friends": return Math.max(f(a.hang_out_play), t.o==="c"?0.8:0, f(i.culture_heritage)*0.8, f(a.volunteer)*0.6, 0.35);
    case "skills":  return Math.max(f(a.learn_discuss), f(a.build_make), f(a.compete), f(i.coding), f(i.engineering), f(i.business), f(i.health)*0.9, 0.2);
    case "service": return Math.max(f(a.volunteer), f(i.service), f(i.identity_support)*0.7, f(i.environment)*0.6, 0.1);
    case "honors":  return Math.max(f(a.compete), f(i.academics_honors), t.o==="s"?1:0, 0.15);
    case "fun":     return Math.max(f(a.hang_out_play), f(i.games), f(i.food)*0.9, t.c==="l"?0.6:0, 0.25);
  }
  return 0.5;
}
function score(ans, clubs){
  ans = ans || {};
  var time = (ans.time||[])[0] || "regular", goal = (ans.goal||[])[0];
  var out = [];
  (clubs||[]).forEach(function(c){
    if(!c || !c.name || c.disbanded) return;
    var t = tagsOf(c);
    var I = interestFit(ans, t), A = actFit(ans, t);
    var T = (TIME_FIT[time]||TIME_FIT.regular)[t.c||"u"] || 0.75;
    var G = goal ? goalFit(goal, t) : 0.5;
    var s = W.interest*I.fit + W.act*A.fit + W.time*T + W.goal*G;
    if(!I.top) s *= 0.4;            // none of your interests: it can only fill space at the bottom
    if(t.auto) s *= 0.93;             // a club tagged by keyword rules only: we know less, so claim less
    // tiny tie-breakers: breadth beyond the cap, then clubs whose core is your top pick
    var tie = 0.004*Math.max(0, I.raw-1) + 0.002*(t.i[I.top && optKeyCore(I.top, t)]===3?1:0);
    out.push({ club:c, tags:t, fit:Math.max(0, Math.min(1, s)), sort:s+tie, why:{ interest:I.top, interest2:I.second, act:A.top, time:T>=0.85, goal:goal, goalHit:G>=0.66 } });
  });
  // exact ties (rare) fall back to a stable hash of the answers and the name, never the alphabet
  var seed = JSON.stringify(ans);
  out.sort(function(x,y){ return (y.sort-x.sort) || (hash(seed+x.club.name)-hash(seed+y.club.name)); });
  return out;
}
function hash(s){ var h=2166136261; for(var i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }
function optKeyCore(optK, t){ var o=optOf("int",optK); if(!o) return ""; var best="", bw=-1; Object.keys(o.i).forEach(function(k){ if((t.i[k]||0)>bw){ bw=t.i[k]||0; best=k; } }); return best; }

/* Top picks with a little variety: a club loses a small amount for each already-picked club that
   matched through the same interest, so three answers about three interests are not answered by
   three clubs about one of them. Only near-ties change order. */
function top(ans, clubs, n){
  var ranked = score(ans, clubs), pick = [], pool = ranked.slice(0, 20);
  n = n || 3;
  while(pick.length < n && pool.length){
    var bi = 0, bv = -1;
    pool.forEach(function(r, idx){
      var same = pick.filter(function(p){ return p.why.interest && p.why.interest===r.why.interest; }).length;
      var v = r.sort - 0.12*same;
      if(v > bv){ bv=v; bi=idx; }
    });
    pick.push(pool.splice(bi,1)[0]);
  }
  // Show only real matches: the best club always, the others only at "good match" or better,
  // listed from the strongest fit down.
  pick = pick.filter(function(r, idx){ return idx===0 || r.fit>=0.7; }).sort(function(x,y){ return y.fit-x.fit; });
  return { top:pick, all:ranked };
}

/* Fit to words. Bands are absolute, so the same answers and club always get the same label. */
function band(fit, t){
  var b = fit>=0.88 ? "strong" : fit>=0.7 ? "good" : "some";
  if(b==="strong" && t && (t.q==="l" || t.auto)) b = "good"; // thin listing: never claim more than a good match
  return b;
}

root.ClubMatch = { VERSION:VERSION, QS:QS, TAGS:TAGS, score:score, top:top, band:band, tagsOf:tagsOf, autoTag:autoTag, optOf:optOf, has:has, norm:norm };
if(typeof module!=="undefined" && module.exports) module.exports = root.ClubMatch;
})(typeof window!=="undefined" ? window : globalThis);
