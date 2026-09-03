/**
 * Firebird Hub — Sports auto-sync (Apps Script)
 * Pulls Fremont HS Athletics games from the public games endpoint and writes them
 * into a "Sports" tab of THIS spreadsheet, ORGANIZED BY SPORT then chronological,
 * fully categorized, refreshed on a time trigger so it is ALWAYS current.
 * Known senior-night rows are highlighted RED automatically.
 *
 * SETUP (in the "Firebird Hub — Events (26-27)" spreadsheet, personal account):
 *   1. Extensions -> Apps Script. Replace this file's contents, Save.
 *   2. Pick setupSportsSync -> Run. Authorize when asked.
 *      Fills the Sports tab now AND refreshes every 3 hours.
 *   Winter/spring sports appear automatically once athletics publishes their dates.
 */
var SPORTS_ENDPOINT = "https://script.google.com/macros/s/AKfycby_2RTRuFEiIRdoNQtzbuUQzSGCGJ3G_p7CxNrqcqOcQiPk268kXu63uLf21GIT5RfQ/exec?view=results";
var SPORTS_TAB = "Sports";
var EVENTS_ID = "11Pm2zUc_O40E0oTZekYvsD_D8FenH9s7PiJ43m7JCH0";

/* Known senior nights (sport + date). These rows are highlighted red. */
var SENIOR_NIGHTS = [
  { sport: "Football",     date: "2026-10-22" },
  { sport: "Field Hockey", date: "2026-10-26" },
  { sport: "Girls Tennis", date: "2026-10-29" }
];

function setupSportsSync(){
  syncSports();
  ScriptApp.getProjectTriggers().forEach(function(t){
    if(t.getHandlerFunction() === "syncSports") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("syncSports").timeBased().everyHours(3).create();
}

function ssIsSenior_(sport, date, g){
  var txt = [g.status, g.matchup, g.opponent, g.note].filter(String).join(" ");
  if(/senior\s*(night|day)/i.test(txt)) return true;
  return SENIOR_NIGHTS.some(function(s){ return s.sport === sport && s.date === date; });
}

function syncSports(){
  var res = UrlFetchApp.fetch(SPORTS_ENDPOINT, {muteHttpExceptions:true});
  var data = JSON.parse(res.getContentText());
  if(!data || !data.programs) return;

  var header = ["sport","date","day","time","level","homeAway","opponent","location","type","section","score","result","seniorNight","title"];
  var rows = [];        // data rows
  var seniorFlags = []; // parallel: true if row is a senior night

  data.programs.forEach(function(p){
    var games = [];
    (p.results||[]).forEach(function(g){ games.push(gameObj_(g, p, "result")); });
    (p.upcoming||[]).forEach(function(g){ games.push(gameObj_(g, p, "upcoming")); });
    games.forEach(function(o){ rows.push(o.row); seniorFlags.push(o.senior); });
  });

  // Organize: by sport (A-Z), then by date, then time.
  var order = rows.map(function(r,i){ return { r:r, s:seniorFlags[i] }; });
  order.sort(function(a,b){
    if(a.r[0] !== b.r[0]) return a.r[0] < b.r[0] ? -1 : 1;      // sport
    if(a.r[1] !== b.r[1]) return String(a.r[1]) < String(b.r[1]) ? -1 : 1; // date
    return String(a.r[3]).localeCompare(String(b.r[3]));        // time
  });

  var out = [header];
  order.forEach(function(o){ out.push(o.r); });

  var ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(EVENTS_ID);
  var sh = ss.getSheetByName(SPORTS_TAB) || ss.insertSheet(SPORTS_TAB);
  sh.clear();
  sh.getRange(1, 1, out.length, header.length).setValues(out);
  sh.getRange(1, 1, 1, header.length).setFontWeight("bold");
  sh.setFrozenRows(1);

  // Highlight senior-night rows red (data rows start at sheet row 2).
  var white = "#ffffff", red = "#f4c7c3"; // light red fill, readable
  var bg = order.map(function(o){
    var row = []; for(var c=0;c<header.length;c++) row.push(o.s ? red : white);
    return row;
  });
  if(bg.length) sh.getRange(2, 1, bg.length, header.length).setBackgrounds(bg);

  sh.getRange(1, header.length + 2).setValue("Auto-updated " + new Date());
}

function gameObj_(g, p, section){
  var sport = g.sport || p.sport || "";
  var date = g.date || "";
  var day = "";
  var m = String(date).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(m){ var dd = new Date(+m[1], +m[2]-1, +m[3]); day = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][dd.getDay()]; }
  var homeAway = g.home ? "Home" : "Away";
  var type = g.league ? "League" : "Non-league";
  var score = g.score || g.finalScore || "";
  var result = g.wlWord || g.wl || (g.won === true ? "Win" : (g.won === false ? "Loss" : ""));
  var senior = ssIsSenior_(sport, date, g);
  var title = ((senior ? "★ SENIOR NIGHT — " : "") + sport + (g.level ? (" " + g.level) : "") + " " + homeAway +
               (g.opponent ? (" vs " + g.opponent) : "")).trim();
  var row = [ sport, date, day, g.time || "", g.level || "", homeAway, g.opponent || "",
              g.location || "", type, section, score, result, (senior ? "YES" : ""), title ];
  return { row: row, senior: senior };
}
