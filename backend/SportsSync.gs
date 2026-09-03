/**
 * Firebird Hub — Sports auto-sync (Apps Script)
 * Builds a "Sports" tab in THIS spreadsheet with the FULL season for every team,
 * organized by sport then chronological, fully categorized. Games only (practices
 * are filtered out). Known senior-night rows are highlighted RED.
 *
 * Primary source: each team's official .ics calendar (the complete season).
 * Fallback: the athletics games JSON, if the .ics feeds can't be read.
 *
 * SETUP (in the "Firebird Hub — Events (26-27)" spreadsheet, personal account):
 *   1. Extensions -> Apps Script. Put this in a file named SportsSync.gs, Save.
 *      (If a SportsSync already exists, replace its contents. If you can't find it,
 *       just add this file to the SAME project as FeaturedEvents.)
 *   2. Function dropdown -> setupSportsSync -> Run. Authorize when asked.
 *      Fills the Sports tab now and refreshes every 3 hours.
 */
var SPORTS_TAB = "Sports";
var EVENTS_ID = "11Pm2zUc_O40E0oTZekYvsD_D8FenH9s7PiJ43m7JCH0";
var ICS_BASE = "https://fremontathletics.org/fhs-ics.php?team=";
var SPORTS_ENDPOINT = "https://script.google.com/macros/s/AKfycby_2RTRuFEiIRdoNQtzbuUQzSGCGJ3G_p7CxNrqcqOcQiPk268kXu63uLf21GIT5RfQ/exec?view=results";

/* Every team + its display name. Winter/spring feeds are empty until posted; they
   are skipped automatically, then fill in on their own once athletics publishes. */
var TEAMS = [
  ["cross-country","Cross Country"],["field-hockey","Field Hockey"],
  ["flag-football","Flag Football"],["football","Football"],
  ["girls-tennis","Girls Tennis"],["girls-volleyball","Girls Volleyball"],
  ["boys-water-polo","Boys Water Polo"],["girlswaterpolo","Girls Water Polo"],
  ["boys-basketball","Boys Basketball"],["girls-basketball","Girls Basketball"],
  ["boys-soccer","Boys Soccer"],["girls-soccer","Girls Soccer"],["wrestling","Wrestling"],
  ["badminton","Badminton"],["baseball","Baseball"],["golf","Golf"],["softball","Softball"],
  ["swimming-and-diving","Swimming & Diving"],["boys-tennis","Boys Tennis"],
  ["track-and-field","Track & Field"],["boys-volleyball","Boys Volleyball"]
];

var SENIOR_NIGHTS = [
  { sport:"Football",     date:"2026-10-22" },
  { sport:"Field Hockey", date:"2026-10-26" },
  { sport:"Girls Tennis", date:"2026-10-29" }
];

function setupSportsSync(){
  syncSports();
  ScriptApp.getProjectTriggers().forEach(function(t){
    if(t.getHandlerFunction() === "syncSports") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("syncSports").timeBased().everyHours(3).create();
}

function syncSports(){
  var all = [];
  TEAMS.forEach(function(t){
    try{
      var r = UrlFetchApp.fetch(ICS_BASE + encodeURIComponent(t[0]), {
        muteHttpExceptions: true, followRedirects: true,
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh) FirebirdHub/1.0", "Accept": "text/calendar, text/plain, */*" }
      });
      if(r.getResponseCode() === 200){
        var txt = r.getContentText();
        if(txt && txt.indexOf("VEVENT") >= 0) all = all.concat(parseIcs_(txt, t[1]));
      }
    }catch(e){}
  });

  var usedIcs = all.length > 0;
  if(!usedIcs) all = fromApi_();   // fallback when the .ics feeds are unreadable

  // Sort by sport, then date, then time.
  all.sort(function(a,b){
    if(a.sport !== b.sport) return a.sport < b.sport ? -1 : 1;
    if(a.date !== b.date) return a.date < b.date ? -1 : 1;
    return timeMin_(a.time) - timeMin_(b.time);
  });

  var header = ["sport","date","day","time","level","homeAway","opponent","location","type","section","score","seniorNight","title"];
  var out = [header], flags = [];
  var today = todayStr_();
  all.forEach(function(g){
    var senior = isSenior_(g);
    var section = (g.date && g.date < today) ? "result" : "upcoming";
    var title = ((senior ? "★ SENIOR NIGHT — " : "") + g.sport + (g.level?(" "+g.level):"") +
                 (g.homeAway?(" "+g.homeAway):"") + (g.opponent?(" vs "+g.opponent):"")).trim();
    out.push([ g.sport, g.date||"", dayName_(g.date), g.time||"", g.level||"", g.homeAway||"",
               g.opponent||"", g.location||"", g.type||"", section, g.score||"", senior?"YES":"", title ]);
    flags.push(senior);
  });

  var ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(EVENTS_ID);
  var sh = ss.getSheetByName(SPORTS_TAB) || ss.insertSheet(SPORTS_TAB);
  sh.clear();
  sh.getRange(1,1,out.length,header.length).setValues(out);
  sh.getRange(1,1,1,header.length).setFontWeight("bold");
  sh.setFrozenRows(1);
  if(flags.length){
    var bg = flags.map(function(f){ var row=[]; for(var c=0;c<header.length;c++) row.push(f?"#f4c7c3":"#ffffff"); return row; });
    sh.getRange(2,1,bg.length,header.length).setBackgrounds(bg);
  }
  sh.getRange(1, header.length + 2).setValue("Auto-updated " + new Date() + (usedIcs ? " (full season)" : " (games feed)"));
}

/* ---- .ics parsing (games only) ---- */
function parseIcs_(txt, sport){
  txt = txt.replace(/\r\n/g,"\n").replace(/\n[ \t]/g,""); // unfold folded lines
  var blocks = txt.split("BEGIN:VEVENT").slice(1);
  var games = [];
  blocks.forEach(function(bl){
    var g = function(re){ var m = bl.match(re); return m ? m[1].trim() : ""; };
    var summary = unesc_(g(/\nSUMMARY[^:\n]*:(.*)/));
    if(!summary) return;
    if(/\bpractice\b/i.test(summary)) return;           // no practices
    var dt = g(/\nDTSTART[^:\n]*:([0-9T]+)/);
    var dm = dt.match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);
    if(!dm) return;
    var date = dm[1]+"-"+dm[2]+"-"+dm[3];
    var time = "";
    if(dm[4]){ var h=+dm[4], mi=dm[5], ap=h>=12?"PM":"AM", h12=h%12; if(h12===0) h12=12; time=h12+":"+mi+" "+ap; }
    var loc = unesc_(g(/\nLOCATION[^:\n]*:(.*)/));
    var level=(summary.match(/\b(Varsity|JV|Frosh(?:\/Soph)?|Freshman)\b/i)||[])[1]||"";
    var away = /\bat\b/i.test(summary), home = /\bvs\.?\b/i.test(summary) || /\bhome\b/i.test(summary);
    var homeAway = away ? "Away" : (home ? "Home" : "");
    var type=(summary.match(/\b(League|Non[- ]?League|Tournament|Scrimmage)\b/i)||[])[1]||"";
    var opp=""; var om = summary.match(/(?:vs\.?|at)\s+([^\n]+?)(?:\s*[-–—(].*)?$/i); if(om) opp = om[1].trim();
    var sc = summary.match(/\b([WLT])\s*[,: ]\s*(\d+\s*[-–]\s*\d+)/i);
    games.push({ sport:sport, level:level, date:date, time:time, homeAway:homeAway, opponent:opp,
                 location:loc, type:type, score: sc ? (sc[1].toUpperCase()+" "+sc[2].replace(/\s/g,"")) : "" });
  });
  return games;
}
function unesc_(s){ return String(s||"").replace(/\\,/g,",").replace(/\\;/g,";").replace(/\\n/gi," ").replace(/\\\\/g,"\\"); }

/* ---- fallback: games JSON ---- */
function fromApi_(){
  try{
    var res = UrlFetchApp.fetch(SPORTS_ENDPOINT, {muteHttpExceptions:true});
    var data = JSON.parse(res.getContentText());
    if(!data || !data.programs) return [];
    var out = [];
    data.programs.forEach(function(p){
      (p.results||[]).concat(p.upcoming||[]).forEach(function(x){
        out.push({ sport:p.sport, level:x.level||"", date:x.date||"", time:x.time||"",
          homeAway:x.home?"Home":"Away", opponent:x.opponent||"", location:x.location||"",
          type:x.league?"League":"Non-league", score:(x.score||x.wlWord||"")});
      });
    });
    return out;
  }catch(e){ return []; }
}

/* ---- helpers ---- */
function isSenior_(g){
  return SENIOR_NIGHTS.some(function(s){ return s.sport===g.sport && s.date===g.date; });
}
function dayName_(date){ var m=String(date||"").match(/^(\d{4})-(\d{2})-(\d{2})/); if(!m) return ""; var d=new Date(+m[1],+m[2]-1,+m[3]); return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()]; }
function timeMin_(t){ var m=String(t||"").match(/(\d+):(\d+)\s*(AM|PM)/i); if(!m) return 9999; var h=+m[1]%12; if(/PM/i.test(m[3])) h+=12; return h*60+(+m[2]); }
function todayStr_(){ var d=new Date(new Date().toLocaleString("en-US",{timeZone:"America/Los_Angeles"})); var mm=("0"+(d.getMonth()+1)).slice(-2), dd=("0"+d.getDate()).slice(-2); return d.getFullYear()+"-"+mm+"-"+dd; }
