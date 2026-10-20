/**
 * Firebird Hub - Sports auto-sync (self-contained, full season, formatted)
 * Builds the "Sports" tab of THIS spreadsheet. Practices excluded.
 * PUSH TO APP: type y in a game's push cell to feature it (survives refreshes).
 * SENIOR NIGHTS: color a game's row RED in the Sports tab and it is registered
 * as a senior night (badge shows in the app); your red survives refreshes.
 * SCORES: syncScores runs every 5 min (hourly outside 2 PM to midnight PT) and
 * rewrites only the score + section cells from the fremontathletics.org results
 * feed, so a posted score reaches the site and app within minutes. The full
 * rebuild (syncSports) still runs every 3 h for schedule changes.
 * Run setupSportsSync once, then setupScoreSync once, from the editor.
 */
var SPORTS_TAB = "Sports";
var EVENTS_ID  = "11Pm2zUc_O40E0oTZekYvsD_D8FenH9s7PiJ43m7JCH0";
var RESULTS_ENDPOINT = "https://script.google.com/macros/s/AKfycby_2RTRuFEiIRdoNQtzbuUQzSGCGJ3G_p7CxNrqcqOcQiPk268kXu63uLf21GIT5RfQ/exec?view=results";

// Senior nights from fremontathletics.org (each team schedule sheet, Notes = "Senior Night"), checked 2026-10-10; Cross Country moved to 10-29 6 PM, Lynbrook Invite (Abir, 2026-10-19).
// level marks only that game; leave level out to mark every level that day.
var SENIOR_NIGHTS = [
  { sport:"Cross Country",    date:"2026-10-29", level:"JV/Varsity" },
  { sport:"Football",         date:"2026-10-22", level:"Varsity" },
  { sport:"Girls Volleyball", date:"2026-10-19", level:"Varsity" },
  { sport:"Boys Water Polo",  date:"2026-10-22", level:"Varsity" },
  { sport:"Girls Water Polo", date:"2026-10-22", level:"Varsity" },
  { sport:"Flag Football",    date:"2026-10-26", level:"Varsity" },
  { sport:"Field Hockey",     date:"2026-10-28", level:"Varsity" },
  { sport:"Girls Tennis",     date:"2026-10-29", level:"Varsity" },
  { sport:"Wrestling",        date:"2027-01-21" }
];

var SEASONS = [
  ["FALL SPORTS",   ["Football","Cross Country","Field Hockey","Flag Football","Girls Tennis","Girls Volleyball","Boys Water Polo","Girls Water Polo"]],
  ["WINTER SPORTS", ["Boys Basketball","Girls Basketball","Boys Soccer","Girls Soccer","Wrestling"]],
  ["SPRING SPORTS", ["Badminton","Baseball","Softball","Golf","Swimming & Diving","Boys Tennis","Track & Field","Boys Volleyball"]]
];

var C_BANNER_BG="#8F1106", C_BANNER_FG="#FFFFFF";
var C_HEAD_BG="#FFC91F",   C_HEAD_FG="#271510";
var C_SENIOR="#F4C7C3",    C_PUSH="#B6D7A8", C_PUSHCELL="#FFF2CC", C_WHITE="#FFFFFF";

var HEADER = ["push","sport","date","day","time","level","homeAway","opponent","location","type","kind","section","score","seniorNight","title"];
var NCOLS = HEADER.length;
var PUSH_COL = 1; // column A
var SCORE_EVERY_MIN = 5;          // trigger interval for syncScores
var GAME_HOURS = [14, 24];        // PT hours when every run checks; outside them, at most hourly

// Games from the fremontathletics.org team schedule sheets (practices left out), checked 2026-10-10.
var SCHED = 'Boys Basketball	2026-11-16	5:30 PM	JV	Home	Los Gatos	Fremont	SCRIMMAGE\nBoys Basketball	2026-11-16	7:00 PM	Varsity	Home	Los Gatos	Fremont	SCRIMMAGE\nBoys Basketball	2026-11-19	7:00 PM	Varsity	Away	Milpitas	Milpitas	\nBoys Basketball	2026-11-28	5:30 PM	JV	Home	Santa Teresa	Fremont	Non-league\nBoys Basketball	2026-11-28	7:00 PM	Varsity	Home	Santa Teresa	Fremont	Non-league\nBoys Basketball	2026-11-30	5:30 PM	JV	Home	Mitty	Fremont	Non-league\nBoys Basketball	2026-12-02	4:00 PM	JV	Away	St Francis	St Francis	Non-league\nBoys Basketball	2026-12-08	5:30 PM	JV	Away	Homestead	Homestead	Non-league\nBoys Basketball	2026-12-08	7:00 PM	Varsity	Away	Homestead	Homestead	Non-league\nBoys Basketball	2026-12-12	1:30 PM	Varsity	Away	Piedmont Hills	Piedmont Hills	Non-league\nBoys Basketball	2026-12-12	12:00 PM	JV	Away	Piedmont Hills	Piedmont Hills	Non-league\nBoys Basketball	2026-12-17	7:00 PM	Varsity	Home	Fremont Tournament	Fremont	TOURNAMENT\nBoys Basketball	2026-12-22	5:30 PM	JV	Home	Lynbrook	Fremont	Non-league\nBoys Basketball	2026-12-22	7:00 PM	Varsity	Home	Lynbrook	Fremont	Non-league\nBoys Basketball	2027-01-05	5:30 PM	JV	Away	MacDonald	MacDonald	League\nBoys Basketball	2027-01-05	7:00 PM	Varsity	Away	MacDonald	MacDonald	League\nBoys Basketball	2027-01-06	5:30 PM	JV	Home	Cupertino	Fremont	League\nBoys Basketball	2027-01-06	7:00 PM	Varsity	Home	Cupertino	Fremont	League\nBoys Basketball	2027-01-08	4:30 PM	JV	Away	Monta Vista	Monta Vista	League\nBoys Basketball	2027-01-08	7:45 PM	Varsity	Away	Monta Vista	Monta Vista	League\nBoys Basketball	2027-01-13	5:30 PM	JV	Home	Wilcox	Fremont	League\nBoys Basketball	2027-01-13	7:00 PM	Varsity	Home	Wilcox	Fremont	League\nBoys Basketball	2027-01-15	3:00 PM	JV	Away	Los Altos	Los Altos	League\nBoys Basketball	2027-01-15	7:45 PM	Varsity	Away	Los Altos	Los Altos	League\nBoys Basketball	2027-01-20	5:30 PM	JV	Home	Santa Clara	Fremont	League\nBoys Basketball	2027-01-20	7:00 PM	Varsity	Home	Santa Clara	Fremont	League\nBoys Basketball	2027-01-22	4:30 PM	JV	Home	Saratoga	Fremont	League\nBoys Basketball	2027-01-22	7:45 PM	Varsity	Home	Saratoga	Fremont	League\nBoys Basketball	2027-01-27	5:30 PM	JV	Away	Cupertino	Cupertino	League\nBoys Basketball	2027-01-27	7:00 PM	Varsity	Away	Cupertino	Cupertino	League\nBoys Basketball	2027-01-29	3:00 PM	JV	Home	Monta Vista	Fremont	League\nBoys Basketball	2027-01-29	7:45 PM	Varsity	Home	Monta Vista	Fremont	League\nBoys Basketball	2027-02-03	5:30 PM	JV	Away	Wilcox	Wilcox	League\nBoys Basketball	2027-02-03	7:00 PM	Varsity	Away	Wilcox	Wilcox	League\nBoys Basketball	2027-02-05	4:30 PM	JV	Home	Los Altos	Fremont	League\nBoys Basketball	2027-02-05	7:45 PM	Varsity	Home	Los Altos	Fremont	League\nBoys Basketball	2027-02-10	5:30 PM	JV	Away	Santa Clara	Santa Clara	League\nBoys Basketball	2027-02-10	7:00 PM	Varsity	Away	Santa Clara	Santa Clara	League\nBoys Basketball	2027-02-12	3:00 PM	JV	Away	Saratoga	Saratoga	League\nBoys Basketball	2027-02-12	7:45 PM	Varsity	Away	Saratoga	Saratoga	League\nBoys Basketball	2027-02-15	7:00 PM	JV	Home	MacDonald	Fremont	League\nBoys Basketball	2027-02-16	7:00 PM	Varsity	Home	MacDonald	Fremont	League\nBoys Basketball	2026-12-01		Varsity	Away	Westmont Tournament	Westmont	TOURNAMENT\nBoys Basketball	2026-12-28		JV		Wilcox JV Tournament		TOURNAMENT\nBoys Basketball	2027-02-02	5:30 PM	JV	Home	Los Altos	Fremont	League\nBoys Basketball	2027-02-02	7:00 PM	Varsity	Home	Los Altos	Fremont	League\nBoys Basketball	2027-02-19		Varsity		CCS Playoffs	TBA	Playoffs\nBoys Soccer	2026-12-03	4:00 PM	JV	Home	Overfelt	Fremont	TOURNAMENT\nBoys Soccer	2026-12-03	6:00 PM	Varsity	Home	Overfelt	Fremont	TOURNAMENT\nBoys Soccer	2026-12-15	4:00 PM	JV	Home	Gilroy	Fremont	TOURNAMENT\nBoys Soccer	2026-12-15	6:00 PM	Varsity	Home	Gilroy	Fremont	TOURNAMENT\nBoys Soccer	2026-12-01	6:00 PM	Varsity	Home	Bellarmine	Fremont	TOURNAMENT\nBoys Soccer	2026-12-10	5:00 PM	Varsity	Away	The King\'s Academy	The King\'s Academy	SCRIMMAGE\nBoys Soccer	2026-12-12	2:00 PM	JV	Home	Homestead	Fremont	TOURNAMENT\nBoys Soccer	2026-12-12	4:00 PM	Varsity	Home	Homestead	Fremont	TOURNAMENT\nBoys Soccer	2027-01-05	4:00 PM	JV	Away	Milpitas	Milpitas	League\nBoys Soccer	2027-01-05	6:00 PM	Varsity	Away	Milpitas	Milpitas	League\nBoys Soccer	2027-01-07	5:00 PM	JV	Home	Monta Vista	Fremont	League\nBoys Soccer	2027-01-07	7:00 PM	Varsity	Home	Monta Vista	Fremont	League\nBoys Soccer	2027-01-12	5:00 PM	JV	Away	Gunn	Gunn	League\nBoys Soccer	2027-01-12	7:00 PM	Varsity	Away	Gunn	Gunn	League\nBoys Soccer	2027-01-14	5:00 PM	JV	Home	Cupertino	Fremont	League\nBoys Soccer	2027-01-14	7:00 PM	Varsity	Home	Cupertino	Fremont	League\nBoys Soccer	2027-01-19	4:00 PM	JV	Away	Macdonald	Macdonald	League\nBoys Soccer	2027-01-19	6:00 PM	Varsity	Away	Macdonald	Macdonald	League\nBoys Soccer	2027-01-21	5:00 PM	JV	Home	Lynbrook	Fremont	League\nBoys Soccer	2027-01-21	7:00 PM	Varsity	Home	Lynbrook	Fremont	League\nBoys Soccer	2027-01-23	4:00 PM	JV	Away	Saratoga	Saratoga	League\nBoys Soccer	2027-01-23	6:00 PM	Varsity	Away	Saratoga	Saratoga	League\nBoys Soccer	2027-01-26	5:00 PM	JV	Home	Milpitas	Fremont	League\nBoys Soccer	2027-01-26	7:00 PM	Varsity	Home	Milpitas	Fremont	League\nBoys Soccer	2027-01-28	5:00 PM	JV	Away	Monta Vista	Monta Vista	League\nBoys Soccer	2027-01-28	7:00 PM	Varsity	Away	Monta Vista	Monta Vista	League\nBoys Soccer	2027-02-02	5:00 PM	JV	Home	Gunn	Fremont	League\nBoys Soccer	2027-02-02	7:00 PM	Varsity	Home	Gunn	Fremont	League\nBoys Soccer	2027-02-04	5:00 PM	JV	Away	Cupertino	Cupertino	League\nBoys Soccer	2027-02-04	7:00 PM	Varsity	Away	Cupertino	Cupertino	League\nBoys Soccer	2027-02-09	5:00 PM	JV	Home	Macdonald	Fremont	League\nBoys Soccer	2027-02-09	7:00 PM	Varsity	Home	Macdonald	Fremont	League\nBoys Soccer	2027-02-11	5:00 PM	JV	Away	Lynbrook	Lynbrook	League\nBoys Soccer	2027-02-11	7:00 PM	Varsity	Away	Lynbrook	Lynbrook	League\nBoys Soccer	2027-02-16	5:00 PM	JV	Home	Saratoga	Fremont	League\nBoys Soccer	2027-02-16	7:00 PM	Varsity	Home	Saratoga	Fremont	League\nBoys Water Polo	2026-09-08	6:30 PM	Varsity	Away	Saratoga	Saratoga	League\nBoys Water Polo	2026-09-08	7:45 PM	JV	Away	Saratoga	Saratoga	League\nBoys Water Polo	2026-09-10	4:15 PM	JV	Home	Santa Clara	Fremont Pool	League\nBoys Water Polo	2026-09-10	5:15 PM	Varsity	Home	Santa Clara	Fremont Pool	League\nBoys Water Polo	2026-09-15	6:30 PM	Varsity	Away	Lynbrook	Lynbrook	League\nBoys Water Polo	2026-09-15	7:45 PM	JV	Away	Lynbrook	Lynbrook	League\nBoys Water Polo	2026-09-17	4:15 PM	JV	Home	Cupertino	Fremont Pool	League\nBoys Water Polo	2026-09-17	5:15 PM	Varsity	Home	Cupertino	Fremont Pool	League\nBoys Water Polo	2026-09-19	10:15 AM	JV	Home	American	Fremont Pool	Non-league\nBoys Water Polo	2026-09-19	11:30 AM	Varsity	Home	American	Fremont Pool	Non-league\nBoys Water Polo	2026-09-22	5:00 PM	JV	Away	Wilcox	Peterson Middle School	League\nBoys Water Polo	2026-09-22	6:00 PM	Varsity	Away	Wilcox	Peterson Middle School	League\nBoys Water Polo	2026-09-24	4:15 PM	JV	Home	Monta Vista	Fremont Pool	League\nBoys Water Polo	2026-09-24	5:15 PM	Varsity	Home	Monta Vista	Fremont Pool	League\nBoys Water Polo	2026-09-29	6:30 PM	Varsity	Away	Mt. View	Mt. View	League\nBoys Water Polo	2026-09-29	7:45 PM	JV	Away	Mt. View	Mt. View	League\nBoys Water Polo	2026-10-01	4:15 PM	JV	Away	Santa Clara	MacDonald	League\nBoys Water Polo	2026-10-01	5:15 PM	Varsity	Away	Santa Clara	MacDonald	League\nBoys Water Polo	2026-10-06	6:30 PM	Varsity	Home	Lynbrook	Fremont Pool	League\nBoys Water Polo	2026-10-06	7:45 PM	JV	Home	Lynbrook	Fremont Pool	League\nBoys Water Polo	2026-10-08	4:15 PM	JV	Home	Cupertino	Fremont Pool	League\nBoys Water Polo	2026-10-08	5:15 PM	Varsity	Home	Cupertino	Fremont Pool	League\nBoys Water Polo	2026-10-13	6:30 PM	Varsity	Home	Wilcox	Fremont Pool	League\nBoys Water Polo	2026-10-13	7:45 PM	JV	Home	Wilcox	Fremont Pool	League\nBoys Water Polo	2026-10-15	4:15 PM	JV	Away	Monta Vista	Monta Vista	League\nBoys Water Polo	2026-10-15	5:15 PM	Varsity	Away	Monta Vista	Monta Vista	League\nBoys Water Polo	2026-10-20	6:30 PM	Varsity	Home	Mt. View	Fremont Pool	League\nBoys Water Polo	2026-10-20	7:45 PM	JV	Home	Mt. View	Fremont Pool	League\nBoys Water Polo	2026-10-22	4:15 PM	JV	Home	Saratoga	Fremont Pool	League\nBoys Water Polo	2026-10-22	5:15 PM	Varsity	Home	Saratoga	Fremont Pool	League\nCross Country	2026-09-02	5:15 PM	JV/Varsity	Away	VS WILCOX	Baylands Park	SCRIMMAGE\nCross Country	2026-09-08	3:30 PM	JV/Varsity	Home	FIREBIRD XC INVITE	Fremont Track	\nCross Country	2026-09-19	8:00 AM	JV/Varsity	Away	TOM LEIKAN INVITE	Watsonville	\nCross Country	2026-09-23	3:15 PM	JV/Varsity	Away	SCVAL #1	Baylands Park	\nCross Country	2026-09-26	8:00 AM	JV/Varsity	Away	RAM INVITATIONAL	Westmoor High School	\nCross Country	2026-10-15	3:30 PM	JV/Varsity	Away	SCVAL #2	Crystal Springs	\nCross Country	2026-10-10	8:00 AM	JV/Varsity	Away	CRYSTAL SPRINGS INVITATIONAL	Crystal Springs	\nCross Country	2026-10-20	3:30 PM	JV/Varsity	Away	SCVAL #3	Baylands Park	\nCross Country	2026-10-29	6:00 PM	JV/Varsity	Home	LYNBROOK INVITE	Fremont Track	\nCross Country	2026-11-03	1:45 PM	JV/Varsity	Away	SCVAL LEAGUE FINALS	Crystal Springs	\nCross Country	2026-11-14		Varsity	Away	CCS FINALS	Crystal Springs	\nCross Country	2026-10-24		Varsity	Away	MT. SAC INVITATIONAL	Walnut	\nField Hockey	2026-09-03	4:00 PM	Varsity	Away	Presentation	Presentation	Non-league\nField Hockey	2026-09-09	4:00 PM	Varsity	Home	St. Francis	Fremont Soccer Field	League\nField Hockey	2026-09-09	5:15 PM	JV	Home	St. Francis	Fremont Soccer Field	League\nField Hockey	2026-09-11	4:00 PM	Varsity	Away	Lynbrook	Lynbrook	Non-league\nField Hockey	2026-09-11	5:15 PM	JV	Away	Lynbrook	Lynbrook	Non-league\nField Hockey	2026-09-14	4:00 PM	Varsity	Home	Valley Christian	Fremont Soccer Field	League\nField Hockey	2026-09-14	5:15 PM	JV	Home	Valley Christian	Fremont Soccer Field	League\nField Hockey	2026-09-16	4:00 PM	Varsity	Away	Cupertino	Cupertino	League\nField Hockey	2026-09-16	5:15 PM	JV	Away	Cupertino	Cupertino	League\nField Hockey	2026-09-18	4:00 PM	Varsity	Home	Homestead	Fremont Soccer Field	Non-league\nField Hockey	2026-09-18	5:15 PM	JV	Home	Homestead	Fremont Soccer Field	Non-league\nField Hockey	2026-09-21	4:00 PM	Varsity	Home	Los Altos	Fremont Soccer Field	League\nField Hockey	2026-09-21	5:15 PM	JV	Home	Los Altos	Fremont Soccer Field	League\nField Hockey	2026-09-23	4:00 PM	Varsity	Away	Prospect	Prospect	Non-league\nField Hockey	2026-09-23	5:15 PM	JV	Away	Prospect	Prospect	Non-league\nField Hockey	2026-09-24	3:30 PM	Varsity	Home	Bella Vista	Fremont Soccer Field	Non-league\nField Hockey	2026-09-24	4:45 PM	JV	Home	Bella Vista	Fremont Soccer Field	Non-league\nField Hockey	2026-09-28	4:00 PM	Varsity	Home	St. Ignatius	Fremont Soccer Field	League\nField Hockey	2026-09-28	5:15 PM	JV	Home	St. Ignatius	Fremont Soccer Field	League\nField Hockey	2026-09-30	4:00 PM	Varsity	Away	Homestead	Homestead	League\nField Hockey	2026-09-30	5:15 PM	JV	Away	Homestead	Homestead	League\nField Hockey	2026-10-02	3:30 PM	Varsity	Home	Carmel	Fremont Soccer Field	Non-league\nField Hockey	2026-10-02	4:45 PM	JV	Home	Carmel	Fremont Soccer Field	Non-league\nField Hockey	2026-10-05	4:00 PM	Varsity	Away	St. Francis	St. Francis	League\nField Hockey	2026-10-05	5:15 PM	JV	Away	St. Francis	St. Francis	League\nField Hockey	2026-10-07	4:00 PM	Varsity	Away	Valley Christian	Valley Christian	League\nField Hockey	2026-10-07	5:15 PM	JV	Away	Valley Christian	Valley Christian	League\nField Hockey	2026-10-14	3:30 PM	Varsity	Away	Los Altos	Los Altos	League\nField Hockey	2026-10-14	4:45 PM	JV	Away	Los Altos	Los Altos	League\nField Hockey	2026-10-16	3:30 PM	Varsity	Home	Cupertino	Fremont Soccer Field	League\nField Hockey	2026-10-16	4:45 PM	JV	Home	Cupertino	Fremont Soccer Field	League\nField Hockey	2026-10-19	3:30 PM	Varsity	Away	Palo Alto	Palo Alto	Non-league\nField Hockey	2026-10-19	4:45 PM	JV	Away	Palo Alto	Palo Alto	Non-league\nField Hockey	2026-10-21	3:30 PM	Varsity	Away	St. Ignatius	Fairmont Field	League\nField Hockey	2026-10-21	4:45 PM	JV	Away	St. Ignatius	Fairmont Field	League\nField Hockey	2026-10-28	4:45 PM	JV	Home	Homestead	Fremont Diesner Football Field	League\nField Hockey	2026-10-28	6:00 PM	Varsity	Home	Homestead	Fremont Diesner Football Field	League\nField Hockey	2026-08-27	4:00 PM	Varsity	Home	Santa Clara	Fremont Soccer Field	SCRIMMAGE\nField Hockey	2026-08-27	5:15 PM	JV	Home	Santa Clara	Fremont Soccer Field	SCRIMMAGE\nField Hockey	2026-08-28	4:00 PM	Varsity	Away	Cupertino	Cupertino	SCRIMMAGE\nField Hockey	2026-08-28	5:15 PM	JV	Away	Cupertino	Cupertino	SCRIMMAGE\nField Hockey	2026-09-01	4:00 PM	Varsity	Home	Monta Vista	Fremont Soccer Field	Non-league\nField Hockey	2026-09-01	5:15 PM	JV	Home	Monta Vista	Fremont Soccer Field	Non-league\nFlag Football	2026-09-04	4:15 PM	Varsity	Away	Prospect	Prospect High School	Non-league\nFlag Football	2026-09-09	5:15 PM	JV	Away	Gunn	Gunn	League\nFlag Football	2026-09-09	6:30 PM	Varsity	Away	Gunn	Gunn	League\nFlag Football	2026-09-14	4:15 PM	JV	Away	Mt. View	Mt. View	League\nFlag Football	2026-09-14	5:30 PM	Varsity	Away	Mt. View	Mt. View	League\nFlag Football	2026-09-16	4:15 PM	JV	Home	Monta Vista	Fremont Flag Football Field (Baseball Outfield)	League\nFlag Football	2026-09-16	5:30 PM	Varsity	Home	Monta Vista	Fremont Flag Football Field (Baseball Outfield)	League\nFlag Football	2026-09-21	4:15 PM	JV	Away	Cupertino	Cupertino	League\nFlag Football	2026-09-21	5:30 PM	Varsity	Away	Cupertino	Cupertino	League\nFlag Football	2026-09-23	4:15 PM	JV	Home	Homestead	Fremont Flag Football Field (Baseball Outfield)	League\nFlag Football	2026-09-23	5:30 PM	Varsity	Home	Homestead	Fremont Flag Football Field (Baseball Outfield)	League\nFlag Football	2026-09-28	4:15 PM	Varsity	Home	Lynbrook	Fremont Flag Football Field (Baseball Outfield)	League\nFlag Football	2026-09-30	4:15 PM	JV	Home	Prospect	Fremont Flag Football Field (Baseball Outfield)	Non-league\nFlag Football	2026-09-30	5:30 PM	Varsity	Home	MacDonald	Fremont Flag Football Field (Baseball Outfield)	League\nFlag Football	2026-10-02	7:00 PM	Varsity	Away	Gunderson	Gunderson	Non-league\nFlag Football	2026-10-05	4:15 PM	JV	Home	Mt. View	Fremont Flag Football Field (Baseball Outfield)	League\nFlag Football	2026-10-05	5:30 PM	Varsity	Home	Mt. View	Fremont Flag Football Field (Baseball Outfield)	League\nFlag Football	2026-10-07	4:15 PM	JV	Away	Monta Vista	Monta Vista	League\nFlag Football	2026-10-07	5:30 PM	Varsity	Away	Monta Vista	Monta Vista	League\nFlag Football	2026-10-12	4:15 PM	JV	Home	Cupertino	Fremont Flag Football Field (Baseball Outfield)	League\nFlag Football	2026-10-12	5:30 PM	Varsity	Home	Cupertino	Fremont Flag Football Field (Baseball Outfield)	League\nFlag Football	2026-10-14	4:15 PM	JV	Away	Homestead	Homestead	League\nFlag Football	2026-10-14	5:30 PM	Varsity	Away	Homestead	Homestead	League\nFlag Football	2026-10-19	5:30 PM	Varsity	Away	Lynbrook	Lynbrook	League\nFlag Football	2026-10-21	4:15 PM	JV	Away	MacDonald	MacDonald	League\nFlag Football	2026-10-21	5:30 PM	Varsity	Away	MacDonald	MacDonald	League\nFlag Football	2026-10-26	4:15 PM	JV	Away	Gunn	Stadium	League\nFlag Football	2026-10-26	5:30 PM	Varsity	Away	Gunn	Stadium	League\nFlag Football	2026-09-12	8:30 AM	Varsity	Away	Milpitas	Milpitas	TOURNAMENT\nFlag Football	2026-09-12	9:40 AM	Varsity	Away	Gunn	Milpitas	TOURNAMENT\nFlag Football	2026-09-12	1:40 PM	Varsity	Away	Marina	Milpitas	TOURNAMENT\nFlag Football	2026-09-12	2:50 PM	Varsity	Away	Gunn	Milpitas	TOURNAMENT\nFlag Football	2026-10-20	4:30 PM	JV/Varsity	Away	KIPP Esperanza	KIPP ESPERANZA EAST PALO ALTO	Non-league\nFootball	2026-09-04	4:00 PM	JV	Home	Westmont	Fremont Diesner Football Field	Non-league\nFootball	2026-09-04	7:00 PM	Varsity	Home	Westmont	Fremont Diesner Football Field	Non-league\nFootball	2026-09-11	4:00 PM	JV	Home	Oak Grove	Fremont Diesner Football Field	Non-league\nFootball	2026-09-11	7:00 PM	Varsity	Home	Oak Grove	Fremont Diesner Football Field	Non-league\nFootball	2026-09-25	4:00 PM	JV	Home	Milpitas	Fremont Diesner Football Field	Non-league\nFootball	2026-09-25	7:00 PM	Varsity	Home	Milpitas	Fremont Diesner Football Field	Non-league\nFootball	2026-10-02	4:00 PM	JV	Home	South San Francisco	Fremont Diesner Football Field	League\nFootball	2026-10-02	7:00 PM	Varsity	Home	South San Francisco	Fremont Diesner Football Field	League\nFootball	2026-10-09	4:00 PM	JV	Home	Jefferson	Fremont Diesner Football Field	League\nFootball	2026-10-09	7:00 PM	Varsity	Home	Jefferson	Fremont Diesner Football Field	League\nFootball	2026-10-15	4:00 PM	JV	Away	Terra Nova	Terra Nova	League\nFootball	2026-10-15	7:00 PM	Varsity	Away	Terra Nova	Terra Nova	League\nFootball	2026-10-22	4:00 PM	JV	Home	Los Altos	Fremont Diesner Football Field	League\nFootball	2026-10-22	7:00 PM	Varsity	Home	Los Altos	Fremont Diesner Football Field	League\nFootball	2026-10-31	11:00 AM	JV	Away	Santa Clara	Santa Clara	League\nFootball	2026-10-31	2:00 PM	Varsity	Away	Santa Clara	Santa Clara	League\nFootball	2026-11-06	4:00 PM	JV	Away	Homestead	Homestead	Non-league\nFootball	2026-11-06	7:00 PM	Varsity	Away	Homestead	Homestead	Non-league\nFootball	2026-08-21	4:30 PM	JV	Away	Mt. Pleasant	Mt. Pleasant	SCRIMMAGE\nFootball	2026-08-21	6:00 PM	Varsity	Away	Mt. Pleasant	Mt. Pleasant	SCRIMMAGE\nFootball	2026-08-27	7:00 PM	Varsity	Away	San Jose High	San Jose High	Non-league\nFootball	2026-08-28	4:00 PM	JV	Home	Monta Vista	Fremont Diesner Football Field	SCRIMMAGE\nGirls Basketball	2026-11-17	5:00 PM	JV	Home	M-A	Fremont	SCRIMMAGE\nGirls Basketball	2026-11-17	6:30 PM	Varsity	Home	M-A	Fremont	SCRIMMAGE\nGirls Basketball	2026-11-19	7:00 PM	Varsity	Away	Cupertino	Cupertino	\nGirls Basketball	2026-11-21	2:30 PM	JV	Away	Moreau	Moreau	SCRIMMAGE\nGirls Basketball	2026-11-21	4:00 PM	Varsity	Away	Moreau	Moreau	SCRIMMAGE\nGirls Basketball	2026-12-10	5:30 PM	JV	Home	Westmont	Fremont	Non-league\nGirls Basketball	2027-01-02	4:30 PM	JV	Away	Homestead	Homestead	League\nGirls Basketball	2027-01-02	6:00 PM	Varsity	Away	Homestead	Homestead	League\nGirls Basketball	2027-01-05	5:30 PM	JV	Home	Mtn. View	Fremont	League\nGirls Basketball	2027-01-05	7:00 PM	Varsity	Home	Mtn. View	Fremont	League\nGirls Basketball	2027-01-08	3:00 PM	JV	Away	Monta Vista	Monta Vista	League\nGirls Basketball	2027-01-08	6:00 PM	Varsity	Away	Monta Vista	Monta Vista	League\nGirls Basketball	2027-01-09	2:30 PM	JV	Away	Menlo	Menlo	Non-league\nGirls Basketball	2027-01-09	4:00 PM	Varsity	Away	Menlo	Menlo	Non-league\nGirls Basketball	2027-01-12	5:30 PM	JV	Home	Gunn	Fremont	League\nGirls Basketball	2027-01-12	7:00 PM	Varsity	Home	Gunn	Fremont	League\nGirls Basketball	2027-01-15	4:30 PM	JV	Away	Los Altos	Los Altos	League\nGirls Basketball	2027-01-15	6:00 PM	Varsity	Away	Los Altos	Los Altos	League\nGirls Basketball	2027-01-16	1:00 PM	Varsity	Away	M-A	M-A	Non-league\nGirls Basketball	2027-01-16	11:30 AM	JV	Away	M-A	M-A	Non-league\nGirls Basketball	2027-01-22	3:00 PM	JV	Home	Los Gatos	Fremont	League\nGirls Basketball	2027-01-22	6:00 PM	Varsity	Home	Los Gatos	Fremont	League\nGirls Basketball	2027-01-26	5:30 PM	JV	Away	Mtn. View	Mtn. View	League\nGirls Basketball	2027-01-26	7:00 PM	Varsity	Away	Mtn. View	Mtn. View	League\nGirls Basketball	2027-01-29	4:30 PM	JV	Home	Monta Vista	Fremont	League\nGirls Basketball	2027-01-29	6:00 PM	Varsity	Home	Monta Vista	Fremont	League\nGirls Basketball	2027-02-01	5:00 PM	JV	Away	TKA	TKA	Non-league\nGirls Basketball	2027-02-02	5:30 PM	JV	Away	Gunn	Gunn	League\nGirls Basketball	2027-02-02	7:00 PM	Varsity	Away	Gunn	Gunn	League\nGirls Basketball	2027-02-05	3:00 PM	JV	Home	Los Altos	Fremont	League\nGirls Basketball	2027-02-05	6:00 PM	Varsity	Home	Los Altos	Fremont	League\nGirls Basketball	2027-02-12	4:30 PM	JV	Away	Los Gatos	Los Gatos	League\nGirls Basketball	2027-02-12	6:00 PM	Varsity	Away	Los Gatos	Los Gatos	League\nGirls Basketball	2027-02-15	5:30 PM	JV	Home	Homestead	Fremont	League\nGirls Basketball	2027-02-16	5:30 PM	Varsity	Home	Homestead	Fremont	League\nGirls Basketball	2026-12-01		Varsity	Home	Fremont Varsity Tournament	Fremont	TOURNAMENT\nGirls Basketball	2026-12-02		JV	Away	Monta Vista JV Tournament	Monta Vista	TOURNAMENT\nGirls Basketball	2026-12-10		Varsity	Away	TKA Varsity Tournament	TKA	TOURNAMENT\nGirls Basketball	2026-12-19		Varsity	Away	Willow Glen Varsity Tournament	Willow Glen	TOURNAMENT\nGirls Basketball	2026-12-30	3:30 PM	JV	Home	Branham	Main Gym	Non-league\nGirls Basketball	2026-12-30	5:00 PM	Varsity	Home	Pinewood	Main Gym	Non-league\nGirls Soccer	2026-12-17	5:00 PM	JV	Away	Live Oak	Live Oak	Non-league\nGirls Soccer	2026-12-17	7:00 PM	Varsity	Away	Live Oak	Live Oak	Non-league\nGirls Soccer	2026-12-19	1:00 PM	Varsity	Away	Harbor	Harbor	Non-league\nGirls Soccer	2026-12-19	11:00 AM	JV	Away	Harbor	Harbor	Non-league\nGirls Soccer	2027-01-05	5:00 PM	JV	Home	Milpitas	Fremont	League\nGirls Soccer	2027-01-05	7:00 PM	Varsity	Home	Milpitas	Fremont	League\nGirls Soccer	2027-01-07	5:00 PM	JV	Away	Monta Vista	Monta Vista	League\nGirls Soccer	2027-01-07	7:00 PM	Varsity	Away	Monta Vista	Monta Vista	League\nGirls Soccer	2027-01-12	5:00 PM	JV	Home	Wilcox	Fremont	League\nGirls Soccer	2027-01-12	7:00 PM	Varsity	Home	Wilcox	Fremont	League\nGirls Soccer	2027-01-14	5:00 PM	JV	Away	Cupertino	Cupertino	League\nGirls Soccer	2027-01-14	7:00 PM	Varsity	Away	Cupertino	Cupertino	League\nGirls Soccer	2027-01-19	5:00 PM	JV	Home	MacDonald	Fremont	League\nGirls Soccer	2027-01-19	7:00 PM	Varsity	Home	MacDonald	Fremont	League\nGirls Soccer	2027-01-21	5:00 PM	JV	Away	Lynbrook	Lynbrook	League\nGirls Soccer	2027-01-21	7:00 PM	Varsity	Away	Lynbrook	Lynbrook	League\nGirls Soccer	2027-01-23	5:00 PM	JV	Home	Saratoga	Fremont	League\nGirls Soccer	2027-01-23	7:00 PM	Varsity	Home	Saratoga	Fremont	League\nGirls Soccer	2027-01-26	4:00 PM	JV	Away	Milpitas	Milpitas	League\nGirls Soccer	2027-01-26	6:00 PM	Varsity	Away	Milpitas	Milpitas	League\nGirls Soccer	2027-01-28	5:00 PM	JV	Home	Monta Vista	Fremont	League\nGirls Soccer	2027-01-28	7:00 PM	Varsity	Home	Monta Vista	Fremont	League\nGirls Soccer	2027-02-02	5:00 PM	JV	Away	Wilcox	Wilcox	League\nGirls Soccer	2027-02-02	7:00 PM	Varsity	Away	Wilcox	Wilcox	League\nGirls Soccer	2027-02-04	5:00 PM	JV	Home	Cupertino	Fremont	League\nGirls Soccer	2027-02-04	7:00 PM	Varsity	Home	Cupertino	Fremont	League\nGirls Soccer	2027-02-06	10:00 AM	Varsity	Away	Homestead	Homestead	Non-league\nGirls Soccer	2027-02-06	12:00 PM	JV	Away	Homestead	Homestead	Non-league\nGirls Soccer	2027-02-09	4:00 PM	JV	Away	MacDonald	MacDonald	League\nGirls Soccer	2027-02-09	6:00 PM	Varsity	Away	MacDonald	MacDonald	League\nGirls Soccer	2027-02-11	5:00 PM	JV	Home	Lynbrook	Fremont	League\nGirls Soccer	2027-02-11	7:00 PM	Varsity	Home	Lynbrook	Fremont	League\nGirls Soccer	2027-02-16	4:00 PM	JV	Away	Saratoga	Saratoga	League\nGirls Soccer	2027-02-16	6:00 PM	Varsity	Away	Saratoga	Saratoga	League\nGirls Soccer	2026-12-01	5:00 PM	JV	Away	Andrew Hill	Andrew Hill	Non-league\nGirls Soccer	2026-12-01	7:00 PM	Varsity	Away	Andrew Hill	Andrew Hill	Non-league\nGirls Soccer	2026-12-10	3:15 PM	JV	Away	Menlo	Menlo	Non-league\nGirls Soccer	2026-12-10	3:15 PM	Varsity	Away	Menlo	Menlo	Non-league\nGirls Soccer	2027-02-15	4:00 PM	JV	Away	Los Altos	Los Altos	Non-league\nGirls Soccer	2027-02-15	6:00 PM	Varsity	Away	Los Altos	Los Altos	Non-league\nGirls Tennis	2026-09-15	4:00 PM	JV	Home	Santa Clara	Fremont Tennis Courts	League\nGirls Tennis	2026-09-15	4:00 PM	Varsity	Away	Santa Clara	Santa Clara	League\nGirls Tennis	2026-09-17	4:00 PM	JV	Home	Gunn	Fremont Tennis Courts	League\nGirls Tennis	2026-09-17	4:00 PM	Varsity	Away	Gunn	Gunn	League\nGirls Tennis	2026-09-22	4:00 PM	JV	Away	Milpitas	Milpitas	League\nGirls Tennis	2026-09-22	4:00 PM	Varsity	Home	Milpitas	Fremont Tennis Courts	League\nGirls Tennis	2026-09-24	4:00 PM	JV	Home	Wilcox	Fremont Tennis Courts	League\nGirls Tennis	2026-09-24	4:00 PM	Varsity	Away	Wilcox	Wilcox	League\nGirls Tennis	2026-09-29	4:00 PM	Varsity	Home	MacDonald	Fremont Tennis Courts	League\nGirls Tennis	2026-10-01	4:00 PM	JV	Home	Saratoga	Fremont Tennis Courts	League\nGirls Tennis	2026-10-01	4:00 PM	Varsity	Away	Saratoga	Saratoga	League\nGirls Tennis	2026-10-06	4:00 PM	JV	Away	Homestead	Homestead	League\nGirls Tennis	2026-10-06	4:00 PM	Varsity	Home	Homestead	Fremont Tennis Courts	League\nGirls Tennis	2026-10-08	4:00 PM	JV	Away	Gunn	Gunn	League\nGirls Tennis	2026-10-08	4:00 PM	Varsity	Home	Gunn	Fremont Tennis Courts	League\nGirls Tennis	2026-10-13	4:00 PM	JV	Home	Milpitas	Fremont Tennis Courts	League\nGirls Tennis	2026-10-13	4:00 PM	Varsity	Away	Milpitas	Milpitas	League\nGirls Tennis	2026-10-15	4:00 PM	JV	Away	Wilcox	Wilcox	League\nGirls Tennis	2026-10-15	4:00 PM	Varsity	Home	Wilcox	Fremont Tennis Courts	League\nGirls Tennis	2026-10-20	4:00 PM	Varsity	Away	MacDonald	MacDonald	League\nGirls Tennis	2026-10-22	4:00 PM	JV	Away	Saratoga	Saratoga	League\nGirls Tennis	2026-10-22	4:00 PM	Varsity	Home	Saratoga	Fremont Tennis Courts	League\nGirls Tennis	2026-10-27	4:00 PM	JV	Home	Homestead	Fremont Tennis Courts	League\nGirls Tennis	2026-10-27	4:00 PM	Varsity	Away	Homestead	Homestead	League\nGirls Tennis	2026-10-29	4:00 PM	JV	Away	Santa Clara	Santa Clara	League\nGirls Tennis	2026-10-29	4:00 PM	Varsity	Home	Santa Clara	Fremont Tennis Courts	League\nGirls Tennis	2026-11-03	1:00 PM		Away	SCVAL Finals	Homestead	INVITATIONAL\nGirls Tennis	2026-11-04	1:00 PM		Away	SCVAL Finals	Homestead	INVITATIONAL\nGirls Volleyball	2026-09-09	5:30 PM	JV	Home	Mt. View	Fremont Main Gym	League\nGirls Volleyball	2026-09-09	6:45 PM	Varsity	Home	Mt. View	Fremont Main Gym	League\nGirls Volleyball	2026-09-14	5:30 PM	JV	Home	Saratoga	Fremont Main Gym	League\nGirls Volleyball	2026-09-14	6:45 PM	Varsity	Home	Saratoga	Fremont Main Gym	League\nGirls Volleyball	2026-09-16	5:30 PM	JV	Away	MacDonald	MacDonald	League\nGirls Volleyball	2026-09-16	6:45 PM	Varsity	Away	MacDonald	MacDonald	League\nGirls Volleyball	2026-09-21	5:30 PM	JV	Home	Wilcox	Fremont Main Gym	League\nGirls Volleyball	2026-09-21	6:45 PM	Varsity	Home	Wilcox	Fremont Main Gym	League\nGirls Volleyball	2026-09-23	5:30 PM	JV	Away	Gunn	Gunn	League\nGirls Volleyball	2026-09-23	6:45 PM	Varsity	Away	Gunn	Gunn	League\nGirls Volleyball	2026-09-28	5:30 PM	JV	Home	Santa Clara	Fremont Field House Gym	League\nGirls Volleyball	2026-09-28	6:45 PM	Varsity	Home	Santa Clara	Fremont Field House Gym	League\nGirls Volleyball	2026-09-30	5:30 PM	JV	Away	Lynbrook	Lynbrook	League\nGirls Volleyball	2026-09-30	6:45 PM	Varsity	Away	Lynbrook	Lynbrook	League\nGirls Volleyball	2026-10-06	5:30 PM	JV	Away	Saratoga	Saratoga	League\nGirls Volleyball	2026-10-06	6:45 PM	Varsity	Away	Saratoga	Saratoga	League\nGirls Volleyball	2026-10-08	5:30 PM	JV	Home	MacDonald	Fremont Main Gym	League\nGirls Volleyball	2026-10-08	6:45 PM	Varsity	Home	MacDonald	Fremont Main Gym	League\nGirls Volleyball	2026-10-13	5:30 PM	JV	Away	Wilcox	Wilcox	League\nGirls Volleyball	2026-10-13	6:45 PM	Varsity	Away	Wilcox	Wilcox	League\nGirls Volleyball	2026-10-19	5:30 PM	JV	Home	Gunn	Fremont Main Gym	League\nGirls Volleyball	2026-10-19	6:45 PM	Varsity	Home	Gunn	Fremont Main Gym	League\nGirls Volleyball	2026-10-20	5:30 PM	JV	Away	Santa Clara	Santa Clara	League\nGirls Volleyball	2026-10-20	6:45 PM	Varsity	Away	Santa Clara	Santa Clara	League\nGirls Volleyball	2026-10-22	5:30 PM	JV	Home	Lynbrook	Fremont Main Gym	League\nGirls Volleyball	2026-10-22	6:45 PM	Varsity	Home	Lynbrook	Fremont Main Gym	League\nGirls Volleyball	2026-10-27	5:30 PM	JV	Away	Mt. View	Mt. View	League\nGirls Volleyball	2026-10-27	6:45 PM	Varsity	Away	Mt. View	Mt. View	League\nGirls Volleyball	2026-08-25	5:00 PM	JV	Home	Leland	Fremont Main Gym	Non-league\nGirls Volleyball	2026-08-25	7:00 PM	Varsity	Home	Leland	Fremont Main Gym	Non-league\nGirls Volleyball	2026-08-27	5:00 PM	JV	Away	The King\'s Academy	The King\'s Academy	Non-league\nGirls Volleyball	2026-08-27	6:30 PM	Varsity	Away	The King\'s Academy	The King\'s Academy	Non-league\nGirls Water Polo	2026-09-04	4:00 PM		Away	Los Gatos	Los Gatos	SCRIMMAGE\nGirls Water Polo	2026-09-08	5:15 PM	Varsity	Away	Homestead	Monta Vista	League\nGirls Water Polo	2026-09-10	6:30 PM	Varsity	Home	Santa Clara	Fremont Pool	League\nGirls Water Polo	2026-09-15	5:15 PM	Varsity	Away	Lynbrook	Lynbrook	League\nGirls Water Polo	2026-09-17	6:30 PM	Varsity	Home	Cupertino	Fremont Pool	League\nGirls Water Polo	2026-09-19	9:00 AM	Varsity	Home	American	Fremont Pool	Non-league\nGirls Water Polo	2026-09-22	6:30 PM	Varsity	Away	Milpitas	Milpitas	League\nGirls Water Polo	2026-09-24	6:30 PM	Varsity	Home	Monta Vista	Fremont Pool	League\nGirls Water Polo	2026-09-29	5:15 PM	Varsity	Away	Mt. View	Mt. View	League\nGirls Water Polo	2026-10-01	5:00 PM	Varsity	Away	Santa Clara	McDonald	League\nGirls Water Polo	2026-10-06	5:15 PM	Varsity	Home	Lynbrook	Fremont Pool	League\nGirls Water Polo	2026-10-08	6:30 PM	Varsity	Home	Cupertino	Fremont Pool	League\nGirls Water Polo	2026-10-13	5:15 PM	Varsity	Home	Milpitas	Fremont Pool	League\nGirls Water Polo	2026-10-15	6:30 PM	Varsity	Away	Monta Vista	Monta Vista	League\nGirls Water Polo	2026-10-20	5:15 PM	Varsity	Home	Mt. View	Fremont Pool	League\nGirls Water Polo	2026-10-22	6:30 PM	Varsity	Home	Homestead	Fremont Pool	League\nWrestling	2026-12-05	9:00 AM	Boys Varsity	Away	27th Annual Freedom Duals	Freedom High School	TOURNAMENT\nWrestling	2026-12-05	9:00 AM	Boys FS	Away	Ed Ferrell Classic	Harbor High School	TOURNAMENT\nWrestling	2026-12-11	3:00 PM	Girls Varsity	Home	Webber Lawson Memorial	Fremont High School	TOURNAMENT\nWrestling	2026-12-12	9:00 AM	Boys Varsity	Home	Webber Lawson Memorial	Fremont High School	TOURNAMENT\nWrestling	2026-12-18	4:00 PM	Girls Varsity	Away	WWCTOC	Sierra College Gymnasium	TOURNAMENT\nWrestling	2026-12-19	9:00 AM	Girls JV	Away	WWCTOC	Sierra College Gymnasium	TOURNAMENT\nWrestling	2026-12-19	9:00 AM	2nd Man	Away	Cupertino 2nd Man Tournament	Cupertino High School	TOURNAMENT\nWrestling	2026-12-19	11:00 AM	Girls Varsity	Away	WWCTOC	Sierra College Gymnasium	TOURNAMENT\nWrestling	2027-01-08	9:00 AM	Girls Varsity	Away	Napa Valley Girls Classic	American Canyon High School	TOURNAMENT\nWrestling	2027-01-09	9:00 AM	Girls Varsity	Away	Napa Valley Girls Classic	American Canyon High School	TOURNAMENT\nWrestling	2027-01-09	9:00 AM	Boys Varsity	Away	Apple Cider	Watsonville High School	TOURNAMENT\nWrestling	2027-01-14	5:30 PM	All	Home	Los Gatos	Fremont High School	Dual Meet\nWrestling	2027-01-16	9:00 AM	Boys FS	Away	Los Gatos Tournament	Los Gatos High School	TOURNAMENT\nWrestling	2027-01-18	9:00 AM	All	Away	Mt. View, Lynbrook, Monta Vista, and Milpitas	Los Gatos High School	Dual Meet\nWrestling	2027-01-21	5:30 PM	All	Home	Wilcox	Fremont High School	Dual Meet\nWrestling	2027-01-22	9:00 AM	Boys Varsity/Girls Varsity	Away	MidCals	Gilroy High School	TOURNAMENT\nWrestling	2027-01-23	9:00 AM	Boys Varsity/Girls Varsity	Away	MidCals	Gilroy High School	TOURNAMENT\nWrestling	2027-01-23	9:00 AM	2nd Man	Away	Lynbrook 2nd Man Challenge	Lynbrook High School	TOURNAMENT\nWrestling	2027-01-28	5:30 PM	All	Away	Palo Alto	Palo Alto High School	Dual Meet\nWrestling	2027-02-05		Girls Varsity/2nd Man	Away	SCVAL Finals	Monta Vista High School	League Finals\nWrestling	2027-02-06		Boys Varsity/2nd Man	Away	SCVAL Finals	Monta Vista High School	League Finals\nWrestling	2027-02-13		Boys Varsity/Girls Varsity		CCS Northern Regional		Playoffs\nWrestling	2027-02-20		Boys Varsity/Girls Varsity		CCS Masters Tournament		Playoffs\nWrestling	2027-02-25		Boys Varsity/Girls Varsity		CIF State Tournament		Playoffs';

function setupSportsSync(){
  syncSports();
  ScriptApp.getProjectTriggers().forEach(function(t){
    if(t.getHandlerFunction() === "syncSports") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("syncSports").timeBased().everyHours(3).create();
}

function syncSports(){
  var lock = LockService.getScriptLock();
  if(!lock.tryLock(120000)) return;   // never rebuild while syncScores is writing
  try{ syncSportsLocked_(); } finally { lock.releaseLock(); }
}

function syncSportsLocked_(){
  var ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(EVENTS_ID);
  var sh = ss.getSheetByName(SPORTS_TAB) || ss.insertSheet(SPORTS_TAB);

  var prevPush = readPush_(sh);   // remember which games a human typed y on
  var prevSeniorRed = readSeniorReds_(sh); // human RED rows = senior night

  var games = parseSched_();
  var api = fetchApi_();
  var today = todayStr_();

  games.forEach(function(g){
    var s = scoreFor_(api.index, g.sport, g.date, g.level, g.opponent);
    if(s) g.score = s;
  });
  var seen = {}, slot = {};
  games.forEach(function(g){ seen[gkey_(g)] = true; slot[skey_(g.sport,g.date,g.level)] = true; slot[skey_(g.sport,g.date,g.level)+"|"+timeMin_(g.time)] = true; });
  // a feed game is already listed if SCHED has that sport/date/level at the same start time, or the feed only has a placeholder opponent
  api.games.forEach(function(x){
    var k = skey_(x.sport,x.date,x.level), twin = (timeMin_(x.time) < 9999 && slot[k+"|"+timeMin_(x.time)]) || (isPlaceholder_(x.opponent) && slot[k]);
    if(seasonOf_(x.sport) && !seen[gkey_(x)] && !twin){ games.push(x); seen[gkey_(x)] = true; }
  });

  var out=[HEADER], banners=[], heads=[], seniors=[], pushed=[];
  SEASONS.forEach(function(seasonPair){
    var label=seasonPair[0], sportList=seasonPair[1];
    var seasonGames = games.filter(function(g){ return sportList.indexOf(g.sport) >= 0; });
    if(!seasonGames.length) return;
    banners.push(out.length+1);
    out.push(blankRow_(label));
    sportList.forEach(function(sp){
      var sg = seasonGames.filter(function(g){ return g.sport===sp; });
      if(!sg.length) return;
      sg.sort(function(a,b){ if(a.date!==b.date) return a.date<b.date?-1:1; return timeMin_(a.time)-timeMin_(b.time); });
      heads.push(out.length+1);
      out.push(blankRow_(sp + "  \u00b7  " + noun_(sp,true).toUpperCase()));
      sg.forEach(function(g){
        var senior = isSenior_(g) || !!prevSeniorRed[gkey_(g)];
        var kind = kindOf_(g.type);
        var isPush = !!prevPush[pkey_(g.sport,g.date,g.level)];
        var section = (g.date && g.date < today) ? "result" : "upcoming";
        var title = ((senior?"SENIOR NIGHT - ":"") + g.sport + (g.level?(" "+g.level):"") +
                     (g.homeAway?(" "+g.homeAway):"") + (g.opponent?(" vs "+g.opponent):"")).trim();
        var r = out.length+1;
        if(senior) seniors.push(r);
        if(isPush) pushed.push(r);
        out.push([ isPush?"y":"", g.sport, g.date||"", dayName_(g.date), g.time||"", g.level||"", g.homeAway||"",
                   g.opponent||"", g.location||"", normType_(g.type), kind, section, g.score||"", senior?"YES":"", title ]);
      });
    });
  });

  sh.clear();
  try{ sh.getBandings().forEach(function(b){ b.remove(); }); }catch(e){}
  try{ if(sh.getLastRow()>1) sh.getRange(2,1,Math.max(1,sh.getMaxRows()-1),NCOLS).breakApart(); }catch(e){}

  sh.getRange(1,1,out.length,NCOLS).setNumberFormat("@"); // keep dates/times literal text (ISO) so app + push-preservation read them consistently
  sh.getRange(1,1,out.length,NCOLS).setValues(out);
  sh.getRange(1,1,1,NCOLS).setFontWeight("bold").setBackground("#5F0C03").setFontColor("#FFFFFF");
  sh.setFrozenRows(1);
  sh.getRange(2,1,out.length-1,NCOLS).setBackground(C_WHITE).setFontColor(C_HEAD_FG).setFontWeight("normal");

  banners.forEach(function(r){
    sh.getRange(r,1,1,NCOLS).merge().setBackground(C_BANNER_BG).setFontColor(C_BANNER_FG)
      .setFontWeight("bold").setFontSize(14).setHorizontalAlignment("center").setVerticalAlignment("middle");
    sh.setRowHeight(r,34);
  });
  heads.forEach(function(r){
    sh.getRange(r,1,1,NCOLS).merge().setBackground(C_HEAD_BG).setFontColor(C_HEAD_FG)
      .setFontWeight("bold").setFontSize(12).setHorizontalAlignment("left");
    sh.setRowHeight(r,26);
  });
  pushed.forEach(function(r){ sh.getRange(r,1,1,NCOLS).setBackground(C_PUSH).setFontWeight("bold"); });
  seniors.forEach(function(r){ sh.getRange(r,1,1,NCOLS).setBackground(C_SENIOR).setFontWeight("bold"); });

  // Make the push column obvious: gold tint + a note, on every game row's push cell that is blank.
  try{
    var pushHeader = sh.getRange(1, PUSH_COL);
    pushHeader.setNote("Type y here to push this game to the app. Blank = not shown.");
    sh.setColumnWidth(PUSH_COL, 54);
  }catch(e){}

  var stamp = Utilities.formatDate(new Date(), "America/Los_Angeles", "MMM d, yyyy h:mm a");
  sh.getRange(1,NCOLS+2).setValue("Auto-updated " + stamp + " \u2014 " + (out.length-1) + " rows, full season");
  try{ sh.autoResizeColumns(2, NCOLS-1); }catch(e){}
}

function blankRow_(label){ var r=[label]; for(var i=1;i<NCOLS;i++) r.push(""); return r; }

/* read human y-flags (push) before we wipe the tab, keyed by game identity */
function readPush_(sh){
  var keep={};
  try{
    var lr=sh.getLastRow(), lc=sh.getLastColumn();
    if(lr<2 || lc<1) return keep;
    var vals=sh.getRange(1,1,lr,lc).getValues();
    var h=vals[0].map(function(x){return String(x).trim().toLowerCase();});
    var ci=function(n){return h.indexOf(n);};
    var pc=ci("push"), sc=ci("sport"), dc=ci("date"), lvc=ci("level"), oc=ci("opponent");
    if(pc<0||sc<0||dc<0) return keep;
    for(var i=1;i<vals.length;i++){
      if(!/^\s*y(es)?\s*$/i.test(String(vals[i][pc]||""))) continue;
      var sp=String(vals[i][sc]||"").trim();
      var lv=lvc>=0?String(vals[i][lvc]||"").trim():"";
      if(sp && dnorm_(vals[i][dc])) keep[pkey_(sp,vals[i][dc],lv)]=true;
    }
  }catch(e){}
  return keep;
}

function readSeniorReds_(sh){
  var keep={};
  try{
    var lr=sh.getLastRow(), lc=sh.getLastColumn();
    if(lr<2 || lc<2) return keep;
    var vals=sh.getRange(1,1,lr,lc).getValues();
    var bgs=sh.getRange(1,1,lr,lc).getBackgrounds();
    var h=vals[0].map(function(x){return String(x).trim().toLowerCase();});
    var ci=function(n){return h.indexOf(n);};
    var sc=ci("sport"), dc=ci("date"), lvc=ci("level"), oc=ci("opponent");
    if(sc<0||dc<0) return keep;
    for(var i=1;i<vals.length;i++){
      var dt=String(vals[i][dc]||"").trim();
      if(!/^\d{4}-\d{1,2}-\d{1,2}/.test(dt)) continue;
      var red = hexReddish_(bgs[i][sc]) || (oc>=0 && hexReddish_(bgs[i][oc]));
      if(!red) continue;
      var sp=String(vals[i][sc]||"").trim();
      var lv=lvc>=0?String(vals[i][lvc]||"").trim():"", op=oc>=0?String(vals[i][oc]||"").trim():"";
      if(sp&&dt) keep[(sp+"|"+dt+"|"+lv+"|"+op).toLowerCase()]=true;
    }
  }catch(e){}
  return keep;
}
function hexReddish_(hex){
  var mm=/^#?([0-9a-fA-F]{6})$/.exec(String(hex||"").trim()); if(!mm) return false;
  var n=parseInt(mm[1],16), R=(n>>16)&255, G=(n>>8)&255, B=n&255;
  return R>=200 && (R-G)>=25 && (R-B)>=25;
}

function parseSched_(){
  return SCHED.split("\n").map(function(ln){
    var c = ln.split("\t");
    return { sport:c[0]||"", date:c[1]||"", time:c[2]||"", level:c[3]||"",
             homeAway:c[4]||"", opponent:c[5]||"", location:c[6]||"", type:c[7]||"" };
  }).filter(function(g){ return g.sport && g.date; });
}

/* scrimmage vs real game */
function kindOf_(type){ return /scrimmage/i.test(String(type||"")) ? "Scrimmage" : "Game"; }
function normType_(type){
  var t=String(type||"").trim();
  if(!t) return "Game";
  if(/scrimmage/i.test(t)) return "Scrimmage";
  if(/tournament/i.test(t)) return "Tournament";
  if(/non[- ]?league/i.test(t)) return "Non-League";
  if(/league/i.test(t)) return "League";
  return t.charAt(0).toUpperCase()+t.slice(1).toLowerCase();
}

/* Results feed from fremontathletics.org. Retries twice; on failure ok=false and callers keep what they have. */
function fetchApi_(){
  var res = { ok:false, games:[], index:{} };
  var data = null;
  for(var attempt=0; attempt<3 && !data; attempt++){
    try{
      if(attempt) Utilities.sleep(3000*attempt);
      var r = UrlFetchApp.fetch(RESULTS_ENDPOINT, {muteHttpExceptions:true, followRedirects:true});
      if(r.getResponseCode() !== 200) continue;
      var d = JSON.parse(r.getContentText());
      if(d && d.programs && d.programs.length) data = d;
    }catch(e){}
  }
  if(!data) return res;
  res.ok = true;
  var results = [];
  data.programs.forEach(function(p){
    var sport = normSport_(p.sport || "");
    var handle = function(x, isResult){
      var date = x.date || ""; if(!sport || !date) return;
      var lvl = String(x.level || "").trim();
      var sc = isResult ? bestResult_(x) : "";
      if(isResult) results.push({ sport:sport, date:date, level:lvl, opp:x.opponent||x.matchup||"", score:sc });
      res.games.push({ sport:sport, date:date, time:x.time||"", level:lvl,
        homeAway:(x.home===true?"Home":(x.home===false?"Away":"")), opponent:x.opponent||x.matchup||"",
        location:x.location||"", type:(x.league?"League":""), score:sc });
    };
    (p.results||[]).forEach(function(x){ handle(x, true); });
    (p.upcoming||[]).forEach(function(x){ handle(x, false); });
  });
  res.index = scoreIndex_(results);
  return res;
}

/* One score per game. Scrimmages with no official score use the score written in the coach's note. */
function bestResult_(x){
  var sc = String(x.score || "").trim();
  if(sc && !x.noScore && !/scrimmage|no score|tbd/i.test(sc)) return sc;
  var m = String(x.note || "").match(/\b(\d{1,3})\s*[-\u2013]\s*(\d{1,3})\b/);
  if(m) return m[1] + "\u2013" + m[2];
  if(x.wlWord && !x.noScore && !/no score/i.test(x.wlWord)) return x.wlWord;
  return "";
}

/* Index feed results by sport|date|level|opponent and by sport|date|level.
   A score is never borrowed from another level (that put JV scores on Varsity rows). */
function scoreIndex_(results){
  var idx = { exact:{}, byLevel:{} };
  results.forEach(function(x){
    if(!x.score) return;
    idx.exact[skey_(x.sport,x.date,x.level)+"|"+oppKey_(x.opp)] = x.score;
    var k = skey_(x.sport,x.date,x.level);
    (idx.byLevel[k] = idx.byLevel[k] || []).push(x);
  });
  return idx;
}
function scoreFor_(idx, sport, date, level, opp){
  if(!idx || !idx.exact) return "";
  date = dnorm_(date); level = String(level||"").trim();
  var s = idx.exact[skey_(sport,date,level)+"|"+oppKey_(opp)];
  if(s) return s;
  // Same level, one game that day, and the opponent isn't clearly someone else (e.g. "vs Gunn" vs "Gunn HS").
  var list = idx.byLevel[skey_(sport,date,level)] || [];
  if(list.length === 1 && (!oppKey_(opp) || !oppKey_(list[0].opp) || oppKey_(list[0].opp).indexOf(oppKey_(opp)) >= 0 || oppKey_(opp).indexOf(oppKey_(list[0].opp)) >= 0)) return list[0].score;
  // The feed left the level blank (one Girls Water Polo game): match on opponent only.
  var blank = idx.byLevel[skey_(sport,date,"")] || [];
  for(var i=0;i<blank.length;i++){ if(oppKey_(blank[i].opp) && oppKey_(blank[i].opp) === oppKey_(opp)) return blank[i].score; }
  return "";
}
function oppKey_(o){
  var k = String(o||"").toLowerCase().replace(/^\s*(vs\.?|at|@)\s+/, "").replace(/\bhigh school\b|\bhs\b/g, "").replace(/[^a-z0-9]/g, "");
  return k.replace(/^(mtview|mtnview|mountainview)$/, "mountainview").replace(/^mcdonald$/, "macdonald");
}

/* ---------- Fast score sync: only the score and section cells change ---------- */
function setupScoreSync(){
  ScriptApp.getProjectTriggers().forEach(function(t){
    if(t.getHandlerFunction() === "syncScores") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("syncScores").timeBased().everyMinutes(SCORE_EVERY_MIN).create();
  PropertiesService.getScriptProperties().deleteProperty("scoresLastRun");
  syncScores();
}

function syncScores(){
  var props = PropertiesService.getScriptProperties();
  var now = new Date();
  var hour = +Utilities.formatDate(now, "America/Los_Angeles", "H");
  var last = +(props.getProperty("scoresLastRun") || 0);
  var inGameHours = hour >= GAME_HOURS[0] && hour < GAME_HOURS[1];
  if(!inGameHours && now.getTime() - last < 55*60*1000) return;   // quiet hours: hourly is enough

  var api = fetchApi_();
  if(!api.ok) return;                                               // feed down: keep the scores we have
  var lock = LockService.getScriptLock();
  if(!lock.tryLock(30000)) return;                                  // a rebuild is running; try next time
  try{
    props.setProperty("scoresLastRun", String(now.getTime()));
    var ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(EVENTS_ID);
    var sh = ss.getSheetByName(SPORTS_TAB); if(!sh) return;
    var n = sh.getLastRow() - 1; if(n < 1) return;
    var vals = sh.getRange(2, 1, n, NCOLS).getDisplayValues();
    var today = todayStr_(), changed = 0;
    var out = vals.map(function(r){
      var date = dnorm_(r[2]), section = r[11], score = r[12];
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [section, score];   // banner / header rows
      var sc = scoreFor_(api.index, r[1], date, r[5], r[7]);
      var sec = (sc || date < today) ? "result" : "upcoming";
      if(sc !== score || sec !== section) changed++;
      return [sec, sc];
    });
    if(changed){
      var rng = sh.getRange(2, 12, n, 2);
      rng.setNumberFormat("@");
      // Merged banner rows: only write the game rows, in contiguous runs.
      var start = -1;
      for(var i=0;i<=n;i++){
        var isGame = i < n && /^\d{4}-\d{2}-\d{2}$/.test(dnorm_(vals[i][2]));
        if(isGame && start < 0) start = i;
        if(!isGame && start >= 0){ sh.getRange(2+start, 12, i-start, 2).setValues(out.slice(start, i)); start = -1; }
      }
    }
    var stamp = Utilities.formatDate(now, "America/Los_Angeles", "MMM d, yyyy h:mm a");
    sh.getRange(2, NCOLS+2).setValue("Scores checked " + stamp + " (" + changed + " changed)");
  } finally { lock.releaseLock(); }
}

function noun_(sport,plural){
  var s=String(sport||"");
  if(/cross country|track|swim|dive|wrestl/i.test(s)) return plural?"meets":"meet";
  if(/tennis|badminton|golf/i.test(s)) return plural?"matches":"match";
  return plural?"games":"game";
}
function seasonOf_(sport){ for(var i=0;i<SEASONS.length;i++){ if(SEASONS[i][1].indexOf(sport)>=0) return SEASONS[i][0]; } return ""; }
function normSport_(s){
  s=String(s||"").trim();
  var map={ "girlswaterpolo":"Girls Water Polo","boyswaterpolo":"Boys Water Polo" };
  var k=s.toLowerCase().replace(/[^a-z]/g,"");
  if(map[k]) return map[k];
  return s.replace(/\b\w/g,function(c){return c.toUpperCase();});
}
function skey_(sport,date,level){ return (String(sport)+"|"+String(date)+"|"+String(level)).toLowerCase(); }
function isPlaceholder_(opp){ return /^(meet|tba|tbd|at opponent|vs opponent)?$/i.test(String(opp||"").trim()); }
function gkey_(g){ return (String(g.sport)+"|"+String(g.date)+"|"+String(g.level||"")+"|"+String(g.opponent||"")).toLowerCase(); }
function dnorm_(v){ if(v && typeof v.getMonth==="function"){ var m=("0"+(v.getMonth()+1)).slice(-2),d=("0"+v.getDate()).slice(-2); return v.getFullYear()+"-"+m+"-"+d; } var t=String(v||"").trim(); var mm=t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); return mm?(mm[1]+"-"+("0"+mm[2]).slice(-2)+"-"+("0"+mm[3]).slice(-2)):t; }
function pkey_(sport,date,level){ return (String(sport||"").trim()+"|"+dnorm_(date)+"|"+String(level||"").trim()).toLowerCase(); }
function isSenior_(g){ return SENIOR_NIGHTS.some(function(s){ return s.sport===g.sport && s.date===g.date && (!s.level || s.level===String(g.level||"").trim()); }); }
function dayName_(date){ var m=String(date||"").match(/^(\d{4})-(\d{2})-(\d{2})/); if(!m) return ""; var d=new Date(+m[1],+m[2]-1,+m[3]); return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()]; }
function timeMin_(t){ var m=String(t||"").match(/(\d+):(\d+)\s*(AM|PM)/i); if(!m) return 9999; var h=+m[1]%12; if(/PM/i.test(m[3])) h+=12; return h*60+(+m[2]); }
function todayStr_(){ var d=new Date(new Date().toLocaleString("en-US",{timeZone:"America/Los_Angeles"})); var mm=("0"+(d.getMonth()+1)).slice(-2), dd=("0"+d.getDate()).slice(-2); return d.getFullYear()+"-"+mm+"-"+dd; }
