/**
 * Firebird Hub — Sports auto-sync (Apps Script)
 * Pulls Fremont HS Athletics games + results from the public endpoint and writes
 * them into a "Sports" tab of THIS spreadsheet, refreshed on a time trigger so it
 * is ALWAYS current. Same column shape as the events sheet, plus status/section.
 *
 * ONE-TIME SETUP (in the "Firebird Hub — Events (26-27)" spreadsheet):
 *   1. Extensions -> Apps Script. Delete any sample code, paste this whole file, Save.
 *   2. Pick setupSportsSync in the function dropdown -> Run. Authorize when asked.
 *      It fills the Sports tab now AND creates a trigger that refreshes every 3 hours.
 *   That's it. The Sports tab then updates on its own, no code, no manual work.
 */
var SPORTS_ENDPOINT = "https://script.google.com/macros/s/AKfycby_2RTRuFEiIRdoNQtzbuUQzSGCGJ3G_p7CxNrqcqOcQiPk268kXu63uLf21GIT5RfQ/exec?view=results";
var SPORTS_TAB = "Sports";
var EVENTS_ID = "11Pm2zUc_O40E0oTZekYvsD_D8FenH9s7PiJ43m7JCH0"; // used when run as a standalone script

function setupSportsSync(){
  syncSports();
  ScriptApp.getProjectTriggers().forEach(function(t){
    if(t.getHandlerFunction() === "syncSports") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("syncSports").timeBased().everyHours(3).create();
}

function syncSports(){
  var res = UrlFetchApp.fetch(SPORTS_ENDPOINT, {muteHttpExceptions:true});
  var data = JSON.parse(res.getContentText());
  if(!data || !data.programs) return;
  var header = ["name","date","endDate","time","location","description","tags","status","section","seniorNight"];
  var rows = [header];
  data.programs.forEach(function(p){
    (p.upcoming||[]).forEach(function(g){ rows.push(gameRow_(g, p, "upcoming")); });
    (p.results||[]).forEach(function(g){ rows.push(gameRow_(g, p, "result")); });
  });
  var ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(EVENTS_ID);
  var sh = ss.getSheetByName(SPORTS_TAB) || ss.insertSheet(SPORTS_TAB);
  sh.clearContents();
  sh.getRange(1, 1, rows.length, header.length).setValues(rows);
  sh.getRange(1, 1, 1, header.length).setFontWeight("bold");
  sh.getRange(1, header.length + 2).setValue("Auto-updated " + new Date());
}

function isSeniorNight_(g){
  var txt = [g.status, g.matchup, g.opponent, g.note, g.title].filter(String).join(" ");
  return /senior\s*(night|day)/i.test(txt);
}
function gameRow_(g, p, section){
  var sport = g.sport || p.sport || "";
  var homeAway = g.home ? "Home" : "Away";
  var score = g.score || g.result || g.finalScore || "";
  var sr = isSeniorNight_(g);
  var name = ((sr ? "\u2605 SENIOR NIGHT \u2014 " : "") + sport + (g.level ? (" " + g.level) : "") + " " + homeAway +
              (g.opponent ? (" vs " + g.opponent) : "")).trim();
  var descBits = [];
  if(g.matchup) descBits.push(g.matchup);
  if(g.league) descBits.push("League game");
  if(section === "result") descBits.push(score ? ("Final: " + score) : "Final score pending");
  var tags = [sport, g.level, homeAway, (g.league ? "league" : ""), (sr ? "senior-night" : "")].filter(String).join(";");
  return [ name, g.date || "", g.date || "", g.time || "", g.location || "",
           descBits.join(" \u2014 "), tags, g.status || "", section, (sr ? "YES" : "") ];
}
