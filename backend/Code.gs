/**
 * Firebird Hub backend — Google Apps Script + Google Sheets
 * =========================================================
 * One free script powers the whole app: Fire Bucks grants (QR scans),
 * balances, spirit-point submissions, feedback, and the class leaderboard.
 * Data lives in a Google Sheet the ASB advisor owns. No servers, no cost.
 *
 * SETUP (once, ~5 minutes — full walkthrough in README.md):
 *  1. sheets.new → name it "Firebird Hub Data".
 *  2. Extensions → Apps Script → paste this file over Code.gs.
 *  3. Run setup() once (grant permissions). It builds the tabs and
 *     sets a starter teacher PIN — change it in Project Settings →
 *     Script Properties → TEACHER_PIN.
 *  4. Deploy → New deployment → Web app → Execute as ME,
 *     access: ANYONE. Copy the /exec URL.
 *  5. Paste that URL into CONFIG.apiUrl in the app's app.js.
 */

var SHEETS = {
  students:     ["Student ID", "Name", "Grade", "Fire Bucks", "Updated"],
  transactions: ["When", "Student ID", "Name", "Grade", "Amount", "Reason", "Granted by"],
  spirit:       ["When", "Name", "Grade", "Student ID", "Spirit day", "Status"],
  feedback:     ["When", "Message", "Name"]
};

var GRANT_MAX = 50;          // biggest single grant a teacher can give
var RECENT_COUNT = 6;        // transactions returned with a balance lookup

/* ---------- one-time setup ---------- */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEETS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.appendRow(SHEETS[name]);
      sh.setFrozenRows(1);
    }
  });
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty("TEACHER_PIN")) {
    props.setProperty("TEACHER_PIN", "0000"); // PLACEHOLDER ONLY — set the real PIN in Project Settings > Script Properties > TEACHER_PIN before using
  }
}

/* ---------- HTTP entry points ---------- */
function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    switch (p.action) {
      case "ping":        return json_({ ok: true, service: "firebird-hub", time: new Date().toISOString() });
      case "balance":     return json_(getBalance_(String(p.sid || "").trim()));
      case "leaderboard": return json_(getLeaderboard_());
      default:            return json_({ ok: false, error: "unknown action" });
    }
  } catch (err) { return json_({ ok: false, error: String(err) }); }
}

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); }
  catch (err) { return json_({ ok: false, error: "bad JSON" }); }
  try {
    switch (body.action) {
      case "grant":    return json_(grantBucks_(body));
      case "spirit":   return json_(submitSpirit_(body));
      case "feedback": return json_(submitFeedback_(body));
      default:         return json_({ ok: false, error: "unknown action" });
    }
  } catch (err) { return json_({ ok: false, error: String(err) }); }
}

/* ---------- Fire Bucks ---------- */
function grantBucks_(b) {
  var pin = PropertiesService.getScriptProperties().getProperty("TEACHER_PIN");
  if (!b.pin || String(b.pin) !== String(pin)) return { ok: false, error: "wrong PIN" };

  var sid = String(b.sid || "").trim();
  var amount = Math.round(Number(b.amount));
  if (!/^\d{5,7}$/.test(sid))                 return { ok: false, error: "bad student ID" };
  if (!(amount >= 1 && amount <= GRANT_MAX))  return { ok: false, error: "amount must be 1-" + GRANT_MAX };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var students = ss.getSheetByName("students");
    var row = findStudentRow_(students, sid);
    var name = String(b.name || "").slice(0, 60);
    var grade = String(b.grade || "").slice(0, 2);
    var balance;
    if (row === -1) {
      balance = amount;
      students.appendRow([sid, name, grade, balance, new Date()]);
    } else {
      balance = Number(students.getRange(row, 4).getValue() || 0) + amount;
      students.getRange(row, 4).setValue(balance);
      students.getRange(row, 5).setValue(new Date());
      if (name) students.getRange(row, 2).setValue(name);
      if (grade) students.getRange(row, 3).setValue(grade);
    }
    ss.getSheetByName("transactions")
      .appendRow([new Date(), sid, name, grade, amount, String(b.reason || "").slice(0, 80), String(b.teacher || "teacher").slice(0, 40)]);
    return { ok: true, balance: balance };
  } finally { lock.releaseLock(); }
}

function getBalance_(sid) {
  if (!sid) return { ok: false, error: "missing sid" };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var students = ss.getSheetByName("students");
  var row = findStudentRow_(students, sid);
  var balance = row === -1 ? 0 : Number(students.getRange(row, 4).getValue() || 0);

  var tx = ss.getSheetByName("transactions");
  var last = tx.getLastRow();
  var recent = [];
  if (last > 1) {
    var n = Math.min(200, last - 1); // scan the latest 200 rows only
    var rows = tx.getRange(last - n + 1, 1, n, 7).getValues();
    for (var i = rows.length - 1; i >= 0 && recent.length < RECENT_COUNT; i--) {
      if (String(rows[i][1]) === sid) {
        recent.push({ when: Utilities.formatDate(new Date(rows[i][0]), Session.getScriptTimeZone(), "MMM d"),
                      amount: Number(rows[i][4]), reason: String(rows[i][5]) });
      }
    }
  }
  return { ok: true, balance: balance, recent: recent };
}

/* ---------- Spirit points ---------- */
function submitSpirit_(b) {
  var sid = String(b.sid || "").trim();
  var day = String(b.day || "").slice(0, 20);
  if (!/^\d{5,7}$/.test(sid) || !day) return { ok: false, error: "bad submission" };
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("spirit");
  var last = sh.getLastRow();
  if (last > 1) { // dedupe: one submission per student per day
    var rows = sh.getRange(2, 4, last - 1, 2).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][0]) === sid && String(rows[i][1]) === day) {
        return { ok: false, error: "already submitted" };
      }
    }
  }
  sh.appendRow([new Date(), String(b.name || "").slice(0, 60), String(b.grade || "").slice(0, 2), sid, day, "pending"]);
  return { ok: true };
}

/* Leaderboard: verified spirit rows count 1 pt each, per grade.
   Spirit can edit the "Status" column to verified / rejected. */
function getLeaderboard_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("spirit");
  var totals = { "9": 0, "10": 0, "11": 0, "12": 0 };
  var last = sh.getLastRow();
  if (last > 1) {
    var rows = sh.getRange(2, 3, last - 1, 4).getValues(); // grade..status
    rows.forEach(function (r) {
      if (String(r[3]).toLowerCase() === "verified" && totals[String(r[0])] !== undefined) totals[String(r[0])]++;
    });
  }
  return { ok: true, totals: totals };
}

/* ---------- Feedback ---------- */
function submitFeedback_(b) {
  var msg = String(b.message || "").trim().slice(0, 2000);
  if (!msg) return { ok: false, error: "empty message" };
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName("feedback")
    .appendRow([new Date(), msg, String(b.name || "").slice(0, 60)]);
  return { ok: true };
}

/* ---------- helpers ---------- */
function findStudentRow_(sheet, sid) {
  var last = sheet.getLastRow();
  if (last < 2) return -1;
  var ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === sid) return i + 2;
  return -1;
}
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
