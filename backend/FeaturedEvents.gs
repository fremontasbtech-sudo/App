/**
 * Firebird Hub — Events API (live, reads RED highlights)
 * ------------------------------------------------------
 * Serves the main events tab of THIS spreadsheet as JSON. A row is "featured"
 * when any of its cells is highlighted RED. The app shows ONLY featured events,
 * so Ava just highlights the events she wants and they appear on the app.
 *
 * Reads the sheet LIVE on every request, so any edit (a new event, a new red
 * highlight, an un-highlight) shows up on the app automatically. No trigger,
 * no CSV, no manual step.
 *
 * ONE-TIME DEPLOY (in the "Firebird Hub — Events (26-27)" spreadsheet):
 *   1. Extensions -> Apps Script. Add a file (the + next to "Files"), paste
 *      this whole file, Save.
 *   2. Deploy -> New deployment -> gear icon -> Web app.
 *      Execute as: Me.   Who has access: Anyone.   -> Deploy -> Authorize.
 *   3. Copy the Web app URL (ends in /exec) and send it to Claude to paste into
 *      EVENTS_API in FirebirdHub/app.js. That's the only wiring step.
 *   (After the first deploy, use Deploy -> Manage deployments -> edit -> Deploy
 *    to publish later code changes to the same URL.)
 */

function doGet(e){
  var out = { ok: true, updated: new Date().toISOString(), events: feEvents_() };
  var json = JSON.stringify(out);
  var cb = e && e.parameter && e.parameter.callback;
  if (cb) {
    return ContentService.createTextOutput(cb + "(" + json + ")")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

/* A fill counts as RED when the red channel clearly dominates green and blue.
   Catches the standard red plus Google's "light red" palette shades; ignores
   pale pinks, yellows and every non-red fill. */
function feIsRed_(hex){
  if (!hex) return false;
  var m = String(hex).trim().match(/^#?([0-9a-fA-F]{6})$/);
  if (!m) return false;
  var n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return r >= 140 && (r - g) >= 45 && (r - b) >= 45;
}

/* Pick the editable events tab: first sheet with name+date headers that is not
   an auto-generated tab. Falls back to the first sheet. */
function feEventsSheet_(ss){
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++){
    var nm = sheets[i].getName();
    if (nm === "Sports" || nm === "AppEvents") continue;
    var lc = sheets[i].getLastColumn();
    if (lc < 1) continue;
    var hdr = sheets[i].getRange(1, 1, 1, lc).getValues()[0]
      .map(function(h){ return String(h).trim().toLowerCase(); });
    if (hdr.indexOf("name") >= 0 && hdr.indexOf("date") >= 0) return sheets[i];
  }
  return sheets[0];
}

function feEvents_(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = feEventsSheet_(ss);
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 2) return [];
  var header = sh.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(function(h){ return String(h).trim().toLowerCase(); });
  var idx = function(n){ return header.indexOf(n); };
  var vals = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var bg   = sh.getRange(2, 1, lastRow - 1, lastCol).getBackgrounds();
  var g = function(row, n){ var i = idx(n); return i >= 0 ? String(row[i] || "").trim() : ""; };
  var list = [];
  for (var i = 0; i < vals.length; i++){
    var name = g(vals[i], "name"), date = g(vals[i], "date");
    if (!name || !date) continue;
    var red = false;
    for (var j = 0; j < bg[i].length; j++){ if (feIsRed_(bg[i][j])) { red = true; break; } }
    list.push({
      name: name,
      date: date,
      endDate: g(vals[i], "enddate"),
      time: g(vals[i], "time"),
      location: g(vals[i], "location") || g(vals[i], "place"),
      description: g(vals[i], "description") || g(vals[i], "desc"),
      tags: g(vals[i], "tags"),
      featured: red
    });
  }
  return list;
}
