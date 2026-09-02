/**
 * Firebird Hub — Featured events (RED highlight -> app)
 * -----------------------------------------------------
 * Ava highlights an event RED in the main events tab; this writes a "featured"
 * column (YES) for those rows on a 5-minute trigger, so it stays current with
 * zero manual work. The app reads the sheet live and shows ONLY featured rows.
 *
 * This is a TRIGGER, not a web app, so it runs as the sheet owner and never needs
 * public web-app serving (which the school account blocks).
 *
 * SETUP (in the "Firebird Hub — Events (26-27)" spreadsheet, personal account):
 *   1. Extensions -> Apps Script. Add a file (+ next to Files), paste this, Save.
 *   2. Pick setupFeaturedEvents in the function dropdown -> Run. Authorize when asked.
 *      It marks featured rows now AND every 5 minutes.
 *   3. Share the spreadsheet: Share -> General access -> Anyone with the link -> Viewer.
 *   That's it. Highlight a row red -> within ~5 min it shows on the app.
 */
var FE_SHEET_ID = "11Pm2zUc_O40E0oTZekYvsD_D8FenH9s7PiJ43m7JCH0";
var FE_FEATURED_HEADER = "featured";

function setupFeaturedEvents(){
  syncFeaturedEvents();
  ScriptApp.getProjectTriggers().forEach(function(t){
    if(t.getHandlerFunction() === "syncFeaturedEvents") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("syncFeaturedEvents").timeBased().everyMinutes(5).create();
}

/* RED when the red channel clearly dominates green and blue. Catches standard red
   plus Google's "light red" shades; ignores pale pinks, yellows and other fills. */
function feIsRed_(hex){
  if(!hex) return false;
  var m = String(hex).trim().match(/^#?([0-9a-fA-F]{6})$/);
  if(!m) return false;
  var n = parseInt(m[1],16), r=(n>>16)&255, g=(n>>8)&255, b=n&255;
  return r>=140 && (r-g)>=45 && (r-b)>=45;
}

function feEventsSheet_(ss){
  var sh = ss.getSheets();
  for(var i=0;i<sh.length;i++){
    var nm = sh[i].getName();
    if(nm === "Sports" || nm === "AppEvents") continue;
    var lc = sh[i].getLastColumn(); if(lc < 1) continue;
    var hdr = sh[i].getRange(1,1,1,lc).getValues()[0].map(function(h){ return String(h).trim().toLowerCase(); });
    if(hdr.indexOf("name") >= 0 && hdr.indexOf("date") >= 0) return sh[i];
  }
  return sh[0];
}

function syncFeaturedEvents(){
  var ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(FE_SHEET_ID);
  var sh = feEventsSheet_(ss);
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if(lastRow < 2) return;
  var header = sh.getRange(1,1,1,lastCol).getValues()[0].map(function(h){ return String(h).trim().toLowerCase(); });
  var featCol = header.indexOf(FE_FEATURED_HEADER) + 1;
  if(featCol === 0){ featCol = lastCol + 1; sh.getRange(1, featCol).setValue(FE_FEATURED_HEADER); }
  var scanCols = featCol > 1 ? featCol - 1 : lastCol; // scan the data columns before "featured"
  var bg = sh.getRange(2, 1, lastRow - 1, scanCols).getBackgrounds();
  var out = [];
  for(var i=0;i<bg.length;i++){
    var red = false;
    for(var j=0;j<bg[i].length;j++){ if(feIsRed_(bg[i][j])){ red = true; break; } }
    out.push([ red ? "YES" : "" ]);
  }
  sh.getRange(2, featCol, out.length, 1).setValues(out);
}
