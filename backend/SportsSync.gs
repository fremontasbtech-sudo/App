/**
 * Firebird Hub - Sports auto-sync (self-contained, full season, formatted)
 * -----------------------------------------------------------------------
 * Builds the "Sports" tab of THIS spreadsheet with the FULL season for every
 * posted team, grouped FALL -> WINTER -> SPRING, each sport under a bright
 * section divider, chronological, categorized. Practices excluded. Senior
 * nights are RED. Live scores (and any brand-new games that appear later) are
 * merged from the athletics feed on each run.
 *
 * The schedule is EMBEDDED (SCHED), so no external files / GitHub are needed.
 *
 * SETUP (Extensions -> Apps Script in the Events spreadsheet):
 *   1. Add a file named SportsSync (or replace the old one's contents), paste
 *      this whole file, Save.
 *   2. Function dropdown -> setupSportsSync -> Run -> authorize.
 *      Fills the tab now and refreshes every 3 hours. Nothing to touch after.
 *
 * The divider/header rows have no date, so the app skips them automatically.
 */
var SPORTS_TAB = "Sports";
var EVENTS_ID  = "11Pm2zUc_O40E0oTZekYvsD_D8FenH9s7PiJ43m7JCH0";
var RESULTS_ENDPOINT = "https://script.google.com/macros/s/AKfycby_2RTRuFEiIRdoNQtzbuUQzSGCGJ3G_p7CxNrqcqOcQiPk268kXu63uLf21GIT5RfQ/exec?view=results";

var SENIOR_NIGHTS = [
  { sport:"Football",     date:"2026-10-22" },
  { sport:"Field Hockey", date:"2026-10-26" },
  { sport:"Girls Tennis", date:"2026-10-29" }
];

// Season groups (fall first). Order within a season is the display order too.
var SEASONS = [
  ["FALL SPORTS",   ["Football","Cross Country","Field Hockey","Flag Football","Girls Tennis","Girls Volleyball","Boys Water Polo","Girls Water Polo"]],
  ["WINTER SPORTS", ["Boys Basketball","Girls Basketball","Boys Soccer","Girls Soccer","Wrestling"]],
  ["SPRING SPORTS", ["Badminton","Baseball","Softball","Golf","Swimming & Diving","Boys Tennis","Track & Field","Boys Volleyball"]]
];

// Colors
var C_BANNER_BG="#8F1106", C_BANNER_FG="#FFFFFF";   // season banner: cardinal / white
var C_HEAD_BG="#FFC91F",   C_HEAD_FG="#271510";      // sport header: gold / ink
var C_SENIOR="#F4C7C3",    C_WHITE="#FFFFFF";        // senior game red / normal

var NCOLS = 13;
var HEADER = ["sport","date","day","time","level","homeAway","opponent","location","type","section","score","seniorNight","title"];

var SCHED = 'Boys Basketball	2026-11-16	5:30 PM	JV	Home	Los Gatos	Fremont	SCRIMMAGE\nBoys Basketball	2026-11-16	7:00 PM	Varsity	Home	Los Gatos	Fremont	SCRIMMAGE\nBoys Basketball	2026-11-19	7:00 PM	Varsity	Away	Milpitas	Milpitas	\nBoys Basketball	2026-11-28	5:30 PM	JV	Home	Santa Teresa	Fremont	Non-league\nBoys Basketball	2026-11-28	7:00 PM	Varsity	Home	Santa Teresa	Fremont	Non-league\nBoys Basketball	2026-11-30	5:30 PM	JV	Home	Mitty	Fremont	Non-league\nBoys Basketball	2026-12-01	5:30 PM	JV	Away	St Francis	St Francis	Non-league\nBoys Basketball	2026-12-08	5:30 PM	JV	Away	Homestead	Homestead	Non-league\nBoys Basketball	2026-12-08	7:00 PM	Varsity	Away	Homestead	Homestead	Non-league\nBoys Basketball	2026-12-12	1:30 PM	Varsity	Away	Piedmont Hills	Piedmont Hills	Non-league\nBoys Basketball	2026-12-12	12:00 PM	JV	Away	Piedmont Hills	Piedmont Hills	Non-league\nBoys Basketball	2026-12-17	7:00 PM	Varsity	Home	Fremont Tournament	Fremont	TOURNAMENT\nBoys Basketball	2026-12-22	5:30 PM	JV	Home	Lynbrook	Fremont	Non-league\nBoys Basketball	2026-12-22	7:00 PM	Varsity	Home	Lynbrook	Fremont	Non-league\nBoys Basketball	2027-01-05	5:30 PM	JV	Away	MacDonald	MacDonald	League\nBoys Basketball	2027-01-05	7:00 PM	Varsity	Away	MacDonald	MacDonald	League\nBoys Basketball	2027-01-06	5:30 PM	JV	Home	Cupertino	Fremont	League\nBoys Basketball	2027-01-06	7:00 PM	Varsity	Home	Cupertino	Fremont	League\nBoys Basketball	2027-01-08	4:30 PM	JV	Away	Monta Vista	Monta Vista	League\nBoys Basketball	2027-01-08	7:45 PM	Varsity	Away	Monta Vista	Monta Vista	League\nBoys Basketball	2027-01-13	5:30 PM	JV	Home	Wilcox	Fremont	League\nBoys Basketball	2027-01-13	7:00 PM	Varsity	Home	Wilcox	Fremont	League\nBoys Basketball	2027-01-15	3:00 PM	JV	Away	Los Altos	Los Altos	League\nBoys Basketball	2027-01-15	7:45 PM	Varsity	Away	Los Altos	Los Altos	League\nBoys Basketball	2027-01-20	5:30 PM	JV	Home	Santa Clara	Fremont	League\nBoys Basketball	2027-01-20	7:00 PM	Varsity	Home	Santa Clara	Fremont	League\nBoys Basketball	2027-01-22	4:30 PM	JV	Home	Saratoga	Fremont	League\nBoys Basketball	2027-01-22	7:45 PM	Varsity	Home	Saratoga	Fremont	League\nBoys Basketball	2027-01-27	5:30 PM	JV	Away	Cupertino	Cupertino	League\nBoys Basketball	2027-01-27	7:00 PM	Varsity	Away	Cupertino	Cupertino	League\nBoys Basketball	2027-01-29	3:00 PM	JV	Home	Monta Vista	Fremont	League\nBoys Basketball	2027-01-29	7:45 PM	Varsity	Home	Monta Vista	Fremont	League\nBoys Basketball	2027-02-03	5:30 PM	JV	Away	Wilcox	Wilcox	League\nBoys Basketball	2027-02-03	7:00 PM	Varsity	Away	Wilcox	Wilcox	League\nBoys Basketball	2027-02-05	4:30 PM	JV	Home	Los Altos	Fremont	League\nBoys Basketball	2027-02-05	7:45 PM	Varsity	Home	Los Altos	Fremont	League\nBoys Basketball	2027-02-10	5:30 PM	JV	Away	Santa Clara	Santa Clara	League\nBoys Basketball	2027-02-10	7:00 PM	Varsity	Away	Santa Clara	Santa Clara	League\nBoys Basketball	2027-02-12	3:00 PM	JV	Away	Saratoga	Saratoga	League\nBoys Basketball	2027-02-12	7:45 PM	Varsity	Away	Saratoga	Saratoga	League\nBoys Basketball	2027-02-15	5:30 PM	JV	Home	MacDonald	Fremont	League\nBoys Basketball	2027-02-16	7:00 PM	Varsity	Home	MacDonald	Fremont	League\nBoys Soccer	2026-11-28	2:00 PM	JV	Home	Overfelt	Fremont	TOURNAMENT\nBoys Soccer	2026-11-28	4:00 PM	Varsity	Home	Overfelt	Fremont	TOURNAMENT\nBoys Soccer	2026-12-01	4:00 PM	JV	Away	Gilroy	Gilroy	TOURNAMENT\nBoys Soccer	2026-12-01	6:00 PM	Varsity	Away	Gilroy	Gilroy	TOURNAMENT\nBoys Soccer	2026-12-10	5:00 PM	Varsity	Away	The King\'s Academy	The King\'s Academy	SCRIMMAGE\nBoys Soccer	2026-12-12	2:00 PM	JV	Home	Homestead	Fremont	TOURNAMENT\nBoys Soccer	2026-12-12	4:00 PM	Varsity	Home	Homestead	Fremont	TOURNAMENT\nBoys Soccer	2027-01-05	5:00 PM	JV	Away	Milpitas	Milpitas	League\nBoys Soccer	2027-01-05	7:00 PM	Varsity	Away	Milpitas	Milpitas	League\nBoys Soccer	2027-01-07	5:00 PM	JV	Home	Monta Vista	Fremont	League\nBoys Soccer	2027-01-07	7:00 PM	Varsity	Home	Monta Vista	Fremont	League\nBoys Soccer	2027-01-12	5:00 PM	JV	Away	Gunn	Gunn	League\nBoys Soccer	2027-01-12	7:00 PM	Varsity	Away	Gunn	Gunn	League\nBoys Soccer	2027-01-14	5:00 PM	JV	Home	Cupertino	Fremont	League\nBoys Soccer	2027-01-14	7:00 PM	Varsity	Home	Cupertino	Fremont	League\nBoys Soccer	2027-01-19	5:00 PM	JV	Away	Macdonald	Macdonald	League\nBoys Soccer	2027-01-19	7:00 PM	Varsity	Away	Macdonald	Macdonald	League\nBoys Soccer	2027-01-21	5:00 PM	JV	Home	Lynbrook	Fremont	League\nBoys Soccer	2027-01-21	7:00 PM	Varsity	Home	Lynbrook	Fremont	League\nBoys Soccer	2027-01-23	5:00 PM	JV	Away	Saratoga	Saratoga	League\nBoys Soccer	2027-01-23	7:00 PM	Varsity	Away	Saratoga	Saratoga	League\nBoys Soccer	2027-01-26	5:00 PM	JV	Home	Milpitas	Fremont	League\nBoys Soccer	2027-01-26	7:00 PM	Varsity	Home	Milpitas	Fremont	League\nBoys Soccer	2027-01-28	5:00 PM	JV	Away	Monta Vista	Monta Vista	League\nBoys Soccer	2027-01-28	7:00 PM	Varsity	Away	Monta Vista	Monta Vista	League\nBoys Soccer	2027-02-02	5:00 PM	JV	Home	Gunn	Fremont	League\nBoys Soccer	2027-02-02	7:00 PM	Varsity	Home	Gunn	Fremont	League\nBoys Soccer	2027-02-04	5:00 PM	JV	Away	Cupertino	Cupertino	League\nBoys Soccer	2027-02-04	7:00 PM	Varsity	Away	Cupertino	Cupertino	League\nBoys Soccer	2027-02-09	5:00 PM	JV	Home	Macdonald	Fremont	League\nBoys Soccer	2027-02-09	7:00 PM	Varsity	Home	Macdonald	Fremont	League\nBoys Soccer	2027-02-11	5:00 PM	JV	Away	Lynbrook	Lynbrook	League\nBoys Soccer	2027-02-11	7:00 PM	Varsity	Away	Lynbrook	Lynbrook	League\nBoys Soccer	2027-02-16	5:00 PM	JV	Home	Saratoga	Fremont	League\nBoys Soccer	2027-02-16	7:00 PM	Varsity	Home	Saratoga	Fremont	League\nBoys Water Polo	2026-09-08	6:30 PM	Varsity	Away	Saratoga	Saratoga	League\nBoys Water Polo	2026-09-08	7:45 PM	JV	Away	Saratoga	Saratoga	League\nBoys Water Polo	2026-09-10	4:15 PM	JV	Home	Santa Clara	Fremont Pool	League\nBoys Water Polo	2026-09-10	5:15 PM	Varsity	Home	Santa Clara	Fremont Pool	League\nBoys Water Polo	2026-09-15	6:30 PM	Varsity	Away	Lynbrook	Lynbrook	League\nBoys Water Polo	2026-09-15	7:45 PM	JV	Away	Lynbrook	Lynbrook	League\nBoys Water Polo	2026-09-17	4:15 PM	JV	Home	Cupertino	Fremont Pool	League\nBoys Water Polo	2026-09-17	5:15 PM	Varsity	Home	Cupertino	Fremont Pool	League\nBoys Water Polo	2026-09-19	10:15 AM	JV	Home	American	Fremont Pool	Non-league\nBoys Water Polo	2026-09-19	11:30 AM	Varsity	Home	American	Fremont Pool	Non-league\nBoys Water Polo	2026-09-22	5:00 PM	JV	Away	Wilcox	Wilcox	League\nBoys Water Polo	2026-09-22	6:00 PM	Varsity	Away	Wilcox	Wilcox	League\nBoys Water Polo	2026-09-24	4:15 PM	JV	Home	Monta Vista	Fremont Pool	League\nBoys Water Polo	2026-09-24	5:15 PM	Varsity	Home	Monta Vista	Fremont Pool	League\nBoys Water Polo	2026-09-29	6:30 PM	Varsity	Away	Mt. View	Mt. View	League\nBoys Water Polo	2026-09-29	7:45 PM	JV	Away	Mt. View	Mt. View	League\nBoys Water Polo	2026-10-01	3:00 PM	JV	Away	Santa Clara	Santa Clara	League\nBoys Water Polo	2026-10-01	4:00 PM	Varsity	Away	Santa Clara	Santa Clara	League\nBoys Water Polo	2026-10-06	6:30 PM	Varsity	Home	Lynbrook	Fremont Pool	League\nBoys Water Polo	2026-10-06	7:45 PM	JV	Home	Lynbrook	Fremont Pool	League\nBoys Water Polo	2026-10-08	4:15 PM	JV	Away	Cupertino	Cupertino	League\nBoys Water Polo	2026-10-08	5:15 PM	Varsity	Away	Cupertino	Cupertino	League\nBoys Water Polo	2026-10-13	6:30 PM	Varsity	Home	Wilcox	Fremont Pool	League\nBoys Water Polo	2026-10-13	7:45 PM	JV	Home	Wilcox	Fremont Pool	League\nBoys Water Polo	2026-10-15	4:15 PM	JV	Away	Monta Vista	Monta Vista	League\nBoys Water Polo	2026-10-15	5:15 PM	Varsity	Away	Monta Vista	Monta Vista	League\nBoys Water Polo	2026-10-20	6:30 PM	Varsity	Home	Mt. View	Fremont Pool	League\nBoys Water Polo	2026-10-20	7:45 PM	JV	Home	Mt. View	Fremont Pool	League\nBoys Water Polo	2026-10-22	4:15 PM	JV	Home	Saratoga	Fremont Pool	League\nBoys Water Polo	2026-10-22	5:15 PM	Varsity	Home	Saratoga	Fremont Pool	League\nCross Country	2026-09-02	5:15 PM	JV/Varsity	Away	VS WILCOX	Baylands Park	SCRIMMAGE\nCross Country	2026-09-07	4:15 PM	JV/Varsity	Away	RANCHO SAN ANTONIO	Rancho San Antonio	\nCross Country	2026-09-08	3:30 PM	JV/Varsity	Home	FIREBIRD XC INVITE	Fremont Track	\nCross Country	2026-09-14	4:15 PM	JV/Varsity	Away	RANCHO SAN ANTONIO	Rancho San Antonio	\nCross Country	2026-09-19	8:00 AM	JV/Varsity	Away	FARMER INVITATIONAL	Hayward HS	\nCross Country	2026-09-21	4:15 PM	JV/Varsity	Away	RANCHO SAN ANTONIO	Rancho San Antonio	\nCross Country	2026-09-23	3:30 PM	JV/Varsity	Away	SCVAL #1	Baylands Park	\nCross Country	2026-09-26	8:00 AM	JV/Varsity	Away	RAM INVITATIONAL	Westmoor High School	\nCross Country	2026-09-28	4:15 PM	JV/Varsity	Away	RANCHO SAN ANTONIO	Rancho San Antonio	\nCross Country	2026-10-03	9:00 AM	JV/Varsity	Away	ARTICHOKE INVITATIONAL	Half Moon Bay High School	\nCross Country	2026-10-05	4:15 PM	JV/Varsity	Away	RANCHO SAN ANTONIO	Rancho San Antonio	\nCross Country	2026-10-06	3:30 PM	JV/Varsity	Away	SCVAL #2	Crystal Springs	\nCross Country	2026-10-10	8:00 AM	JV/Varsity	Away	CRYSTAL SPRINGS INVITATIONAL	Crystal Springs	\nCross Country	2026-10-12	4:15 PM	JV/Varsity	Away	RANCHO SAN ANTONIO	Rancho San Antonio	\nCross Country	2026-10-19	4:15 PM	JV/Varsity	Away	RANCHO SAN ANTONIO	Rancho San Antonio	\nCross Country	2026-10-20	3:30 PM	JV/Varsity	Away	SCVAL #3	Baylands Park	\nCross Country	2026-10-26	4:15 PM	JV/Varsity	Away	LAST RANCHO SAN ANTONIO	Rancho San Antonio	\nCross Country	2026-11-03	1:45 PM	JV/Varsity	Away	SCVAL LEAGUE FINALS	Crystal Springs	\nCross Country	2026-11-06	5:00 PM	JV/Varsity	Away	END OF SZN POTLUCK	TBD	\nField Hockey	2026-09-03	4:00 PM	Varsity	Away	Presentation	Presentation	Non-league\nField Hockey	2026-09-09	4:00 PM	Varsity	Home	St. Francis	Fremont Soccer Field	League\nField Hockey	2026-09-09	5:15 PM	JV	Home	St. Francis	Fremont Soccer Field	League\nField Hockey	2026-09-11	4:00 PM	Varsity	Away	Lynbrook	Lynbrook	Non-league\nField Hockey	2026-09-11	5:15 PM	JV	Away	Lynbrook	Lynbrook	Non-league\nField Hockey	2026-09-14	4:00 PM	Varsity	Home	Valley Christian	Fremont Soccer Field	League\nField Hockey	2026-09-14	5:15 PM	JV	Home	Valley Christian	Fremont Soccer Field	League\nField Hockey	2026-09-16	4:00 PM	Varsity	Away	Cupertino	Cupertino	League\nField Hockey	2026-09-16	5:15 PM	JV	Away	Cupertino	Cupertino	League\nField Hockey	2026-09-18	4:00 PM	Varsity	Home	Homestead	Fremont Soccer Field	Non-league\nField Hockey	2026-09-18	5:15 PM	JV	Home	Homestead	Fremont Soccer Field	Non-league\nField Hockey	2026-09-21	4:00 PM	Varsity	Home	Los Altos	Fremont Soccer Field	League\nField Hockey	2026-09-21	5:15 PM	JV	Home	Los Altos	Fremont Soccer Field	League\nField Hockey	2026-09-23	4:00 PM	Varsity	Away	Prospect	Prospect	Non-league\nField Hockey	2026-09-23	5:15 PM	JV	Away	Prospect	Prospect	Non-league\nField Hockey	2026-09-24	3:30 PM	Varsity	Home	Bella Vista	Fremont Soccer Field	Non-league\nField Hockey	2026-09-24	4:45 PM	JV	Home	Bella Vista	Fremont Soccer Field	Non-league\nField Hockey	2026-09-28	4:00 PM	Varsity	Home	St. Ignatius	Fremont Soccer Field	League\nField Hockey	2026-09-28	5:15 PM	JV	Home	St. Ignatius	Fremont Soccer Field	League\nField Hockey	2026-09-30	4:00 PM	Varsity	Away	Homestead	Homestead	League\nField Hockey	2026-09-30	5:15 PM	JV	Away	Homestead	Homestead	League\nField Hockey	2026-10-02	3:30 PM	Varsity	Home	Carmel	Fremont Soccer Field	Non-league\nField Hockey	2026-10-02	4:45 PM	JV	Home	Carmel	Fremont Soccer Field	Non-league\nField Hockey	2026-10-05	4:00 PM	Varsity	Away	St. Francis	St. Francis	League\nField Hockey	2026-10-05	5:15 PM	JV	Away	St. Francis	St. Francis	League\nField Hockey	2026-10-07	4:00 PM	Varsity	Away	Valley Christian	Valley Christian	League\nField Hockey	2026-10-07	5:15 PM	JV	Away	Valley Christian	Valley Christian	League\nField Hockey	2026-10-14	3:30 PM	Varsity	Away	Los Altos	Los Altos	League\nField Hockey	2026-10-14	4:45 PM	JV	Away	Los Altos	Los Altos	League\nField Hockey	2026-10-16	3:30 PM	Varsity	Home	Cupertino	Fremont Soccer Field	League\nField Hockey	2026-10-16	4:45 PM	JV	Home	Cupertino	Fremont Soccer Field	League\nField Hockey	2026-10-19	3:30 PM	Varsity	Away	Palo Alto	Palo Alto	Non-league\nField Hockey	2026-10-19	4:45 PM	JV	Away	Palo Alto	Palo Alto	Non-league\nField Hockey	2026-10-21	3:30 PM	Varsity	Away	St. Ignatius	Fairmont Field	League\nField Hockey	2026-10-21	4:45 PM	JV	Away	St. Ignatius	Fairmont Field	League\nField Hockey	2026-10-26	4:45 PM	JV	Home	Homestead	Fremont Diesner Football Field	League\nField Hockey	2026-10-26	6:00 PM	Varsity	Home	Homestead	Fremont Diesner Football Field	League\nFlag Football	2026-09-04	4:15 PM	Varsity	Away	Prospect	Prospect High School	Non-league\nFlag Football	2026-09-09	4:15 PM	JV	Away	Gunn	Gunn	League\nFlag Football	2026-09-09	5:30 PM	Varsity	Away	Gunn	Gunn	League\nFlag Football	2026-09-14	4:15 PM	JV	Away	Mt. View	Mt. View	League\nFlag Football	2026-09-14	5:30 PM	Varsity	Away	Mt. View	Mt. View	League\nFlag Football	2026-09-16	4:15 PM	JV	Home	Monta Vista	Fremont Flag Football Field (Baseball Outfield)	League\nFlag Football	2026-09-16	5:30 PM	Varsity	Home	Monta Vista	Fremont Flag Football Field (Baseball Outfield)	League\nFlag Football	2026-09-21	4:15 PM	JV	Away	Cupertino	Cupertino	League\nFlag Football	2026-09-21	5:30 PM	Varsity	Away	Cupertino	Cupertino	League\nFlag Football	2026-09-23	4:15 PM	JV	Home	Homestead	Fremont Flag Football Field (Baseball Outfield)	League\nFlag Football	2026-09-23	5:30 PM	Varsity	Home	Homestead	Fremont Flag Football Field (Baseball Outfield)	League\nFlag Football	2026-09-28	4:15 PM	Varsity	Away	Lynbrook	Lynbrook	League\nFlag Football	2026-09-30	4:15 PM	JV	Home	Prospect	Fremont Flag Football Field (Baseball Outfield)	Non-league\nFlag Football	2026-09-30	5:30 PM	Varsity	Home	MacDonald	Fremont Flag Football Field (Baseball Outfield)	League\nFlag Football	2026-10-02	7:00 PM	Varsity	Away	Gunderson	Gunderson	Non-league\nFlag Football	2026-10-05	4:15 PM	JV	Home	Mt. View	Fremont Flag Football Field (Baseball Outfield)	League\nFlag Football	2026-10-05	5:30 PM	Varsity	Home	Mt. View	Fremont Flag Football Field (Baseball Outfield)	League\nFlag Football	2026-10-07	4:15 PM	JV	Away	Monta Vista	Monta Vista	League\nFlag Football	2026-10-07	5:30 PM	Varsity	Away	Monta Vista	Monta Vista	League\nFlag Football	2026-10-12	4:15 PM	JV	Home	Cupertino	Fremont Flag Football Field (Baseball Outfield)	League\nFlag Football	2026-10-12	5:30 PM	Varsity	Home	Cupertino	Fremont Flag Football Field (Baseball Outfield)	League\nFlag Football	2026-10-14	4:15 PM	JV	Away	Homestead	Homestead	League\nFlag Football	2026-10-14	5:30 PM	Varsity	Away	Homestead	Homestead	League\nFlag Football	2026-10-19	4:15 PM	JV	Home	Lynbrook	Fremont Flag Football Field (Baseball Outfield)	League\nFlag Football	2026-10-19	5:30 PM	Varsity	Home	Lynbrook	Fremont Flag Football Field (Baseball Outfield)	League\nFlag Football	2026-10-21	4:15 PM	JV	Away	MacDonald	MacDonald	League\nFlag Football	2026-10-21	5:30 PM	Varsity	Away	MacDonald	MacDonald	League\nFlag Football	2026-10-26	4:15 PM	JV	Away	Gunn	Stadium	League\nFlag Football	2026-10-26	5:30 PM	Varsity	Away	Gunn	Stadium	League\nFootball	2026-09-04	4:00 PM	JV	Home	Westmont	Fremont Diesner Football Field	Non-league\nFootball	2026-09-04	7:00 PM	Varsity	Home	Westmont	Fremont Diesner Football Field	Non-league\nFootball	2026-09-11	4:00 PM	JV	Home	Oak Grove	Fremont Diesner Football Field	Non-league\nFootball	2026-09-11	7:00 PM	Varsity	Home	Oak Grove	Fremont Diesner Football Field	Non-league\nFootball	2026-09-25	4:00 PM	JV	Home	Milpitas	Fremont Diesner Football Field	Non-league\nFootball	2026-09-25	7:00 PM	Varsity	Home	Milpitas	Fremont Diesner Football Field	Non-league\nFootball	2026-10-02	4:00 PM	JV	Home	South San Francisco	Fremont Diesner Football Field	League\nFootball	2026-10-02	7:00 PM	Varsity	Home	South San Francisco	Fremont Diesner Football Field	League\nFootball	2026-10-09	4:00 PM	JV	Home	Jefferson	Fremont Diesner Football Field	League\nFootball	2026-10-09	7:00 PM	Varsity	Home	Jefferson	Fremont Diesner Football Field	League\nFootball	2026-10-15	4:00 PM	JV	Away	Terra Nova	Terra Nova	League\nFootball	2026-10-15	7:00 PM	Varsity	Away	Terra Nova	Terra Nova	League\nFootball	2026-10-22	4:00 PM	JV	Home	Los Altos	Fremont Diesner Football Field	League\nFootball	2026-10-22	7:00 PM	Varsity	Home	Los Altos	Fremont Diesner Football Field	League\nFootball	2026-10-31	11:00 AM	JV	Away	Santa Clara	Santa Clara	League\nFootball	2026-10-31	2:00 PM	Varsity	Away	Santa Clara	Santa Clara	League\nFootball	2026-11-06	4:00 PM	JV	Away	Homestead	Homestead	Non-league\nFootball	2026-11-06	7:00 PM	Varsity	Away	Homestead	Homestead	Non-league\nGirls Basketball	2026-11-17	5:00 PM	JV	Home	M-A	Fremont	SCRIMMAGE\nGirls Basketball	2026-11-17	6:30 PM	Varsity	Home	M-A	Fremont	SCRIMMAGE\nGirls Basketball	2026-11-19	7:00 PM	Varsity	Away	Cupertino	Cupertino	\nGirls Basketball	2026-11-21	2:30 PM	JV	Away	Moreau	Moreau	SCRIMMAGE\nGirls Basketball	2026-11-21	4:00 PM	Varsity	Away	Moreau	Moreau	SCRIMMAGE\nGirls Basketball	2026-12-10	5:30 PM	JV	Home	Westmont	Fremont	Non-league\nGirls Basketball	2027-01-02	4:30 PM	JV	Away	Homestead	Homestead	League\nGirls Basketball	2027-01-02	6:00 PM	Varsity	Away	Homestead	Homestead	League\nGirls Basketball	2027-01-05	5:30 PM	JV	Home	Mtn. View	Fremont	League\nGirls Basketball	2027-01-05	7:00 PM	Varsity	Home	Mtn. View	Fremont	League\nGirls Basketball	2027-01-08	3:00 PM	JV	Away	Monta Vista	Monta Vista	League\nGirls Basketball	2027-01-08	6:00 PM	Varsity	Away	Monta Vista	Monta Vista	League\nGirls Basketball	2027-01-09	2:30 PM	JV	Away	Menlo	Menlo	Non-league\nGirls Basketball	2027-01-09	4:00 PM	Varsity	Away	Menlo	Menlo	Non-league\nGirls Basketball	2027-01-12	5:30 PM	JV	Home	Gunn	Fremont	League\nGirls Basketball	2027-01-12	7:00 PM	Varsity	Home	Gunn	Fremont	League\nGirls Basketball	2027-01-15	4:30 PM	JV	Away	Los Altos	Los Altos	League\nGirls Basketball	2027-01-15	6:00 PM	Varsity	Away	Los Altos	Los Altos	League\nGirls Basketball	2027-01-16	1:00 PM	Varsity	Away	M-A	M-A	Non-league\nGirls Basketball	2027-01-16	11:30 AM	JV	Away	M-A	M-A	Non-league\nGirls Basketball	2027-01-22	3:00 PM	JV	Home	Los Gatos	Fremont	League\nGirls Basketball	2027-01-22	6:00 PM	Varsity	Home	Los Gatos	Fremont	League\nGirls Basketball	2027-01-26	5:30 PM	JV	Away	Mtn. View	Mtn. View	League\nGirls Basketball	2027-01-26	7:00 PM	Varsity	Away	Mtn. View	Mtn. View	League\nGirls Basketball	2027-01-29	4:30 PM	JV	Home	Monta Vista	Fremont	League\nGirls Basketball	2027-01-29	6:00 PM	Varsity	Home	Monta Vista	Fremont	League\nGirls Basketball	2027-02-01	5:00 PM	JV	Away	TKA	TKA	Non-league\nGirls Basketball	2027-02-02	5:30 PM	JV	Away	Gunn	Gunn	League\nGirls Basketball	2027-02-02	7:00 PM	Varsity	Away	Gunn	Gunn	League\nGirls Basketball	2027-02-05	3:00 PM	JV	Home	Los Altos	Fremont	League\nGirls Basketball	2027-02-05	6:00 PM	Varsity	Home	Los Altos	Fremont	League\nGirls Basketball	2027-02-12	4:30 PM	JV	Away	Los Gatos	Los Gatos	League\nGirls Basketball	2027-02-12	6:00 PM	Varsity	Away	Los Gatos	Los Gatos	League\nGirls Basketball	2027-02-15	5:30 PM	JV	Home	Homestead	Fremont	League\nGirls Basketball	2027-02-16	5:30 PM	Varsity	Home	Homestead	Fremont	League\nGirls Soccer	2026-12-03	6:00 PM	Varsity	Home	Cristo Rey	Fremont	Non-league\nGirls Soccer	2026-12-17	5:00 PM	JV	Away	Live Oak	Live Oak	Non-league\nGirls Soccer	2026-12-17	7:00 PM	Varsity	Away	Live Oak	Live Oak	Non-league\nGirls Soccer	2026-12-19	1:00 PM	Varsity	Away	Harbor	Harbor	Non-league\nGirls Soccer	2026-12-19	11:00 AM	JV	Away	Harbor	Harbor	Non-league\nGirls Soccer	2027-01-05	5:00 PM	JV	Home	Milpitas	Fremont	League\nGirls Soccer	2027-01-05	7:00 PM	Varsity	Home	Milpitas	Fremont	League\nGirls Soccer	2027-01-07	5:00 PM	JV	Away	Monta Vista	Monta Vista	League\nGirls Soccer	2027-01-07	7:00 PM	Varsity	Away	Monta Vista	Monta Vista	League\nGirls Soccer	2027-01-12	5:00 PM	JV	Home	Wilcox	Fremont	League\nGirls Soccer	2027-01-12	7:00 PM	Varsity	Home	Wilcox	Fremont	League\nGirls Soccer	2027-01-14	5:00 PM	JV	Away	Cupertino	Cupertino	League\nGirls Soccer	2027-01-14	7:00 PM	Varsity	Away	Cupertino	Cupertino	League\nGirls Soccer	2027-01-19	5:00 PM	JV	Home	MacDonald	Fremont	League\nGirls Soccer	2027-01-19	7:00 PM	Varsity	Home	MacDonald	Fremont	League\nGirls Soccer	2027-01-21	5:00 PM	JV	Away	Lynbrook	Lynbrook	League\nGirls Soccer	2027-01-21	7:00 PM	Varsity	Away	Lynbrook	Lynbrook	League\nGirls Soccer	2027-01-23	5:00 PM	JV	Home	Saratoga	Fremont	League\nGirls Soccer	2027-01-23	7:00 PM	Varsity	Home	Saratoga	Fremont	League\nGirls Soccer	2027-01-26	5:00 PM	JV	Away	Milpitas	Milpitas	League\nGirls Soccer	2027-01-26	7:00 PM	Varsity	Away	Milpitas	Milpitas	League\nGirls Soccer	2027-01-28	5:00 PM	JV	Home	Monta Vista	Fremont	League\nGirls Soccer	2027-01-28	7:00 PM	Varsity	Home	Monta Vista	Fremont	League\nGirls Soccer	2027-02-02	5:00 PM	JV	Away	Wilcox	Wilcox	League\nGirls Soccer	2027-02-02	7:00 PM	Varsity	Away	Wilcox	Wilcox	League\nGirls Soccer	2027-02-04	5:00 PM	JV	Home	Cupertino	Fremont	League\nGirls Soccer	2027-02-04	7:00 PM	Varsity	Home	Cupertino	Fremont	League\nGirls Soccer	2027-02-06	10:00 AM	Varsity	Away	Homestead	Homestead	Non-league\nGirls Soccer	2027-02-06	12:00 PM	JV	Away	Homestead	Homestead	Non-league\nGirls Soccer	2027-02-09	5:00 PM	JV	Away	MacDonald	MacDonald	League\nGirls Soccer	2027-02-09	7:00 PM	Varsity	Away	MacDonald	MacDonald	League\nGirls Soccer	2027-02-11	5:00 PM	JV	Home	Lynbrook	Fremont	League\nGirls Soccer	2027-02-11	7:00 PM	Varsity	Home	Lynbrook	Fremont	League\nGirls Soccer	2027-02-16	5:00 PM	JV	Away	Saratoga	Saratoga	League\nGirls Soccer	2027-02-16	7:00 PM	Varsity	Away	Saratoga	Saratoga	League\nGirls Tennis	2026-09-15	4:00 PM	JV	Home	Santa Clara	Fremont Tennis Courts	League\nGirls Tennis	2026-09-15	4:00 PM	Varsity	Away	Santa Clara	Santa Clara	League\nGirls Tennis	2026-09-17	4:00 PM	JV	Home	Gunn	Fremont Tennis Courts	League\nGirls Tennis	2026-09-17	4:00 PM	Varsity	Away	Gunn	Gunn	League\nGirls Tennis	2026-09-22	4:00 PM	JV	Away	Milpitas	Milpitas	League\nGirls Tennis	2026-09-22	4:00 PM	Varsity	Home	Milpitas	Fremont Tennis Courts	League\nGirls Tennis	2026-09-24	4:00 PM	JV	Home	Wilcox	Fremont Tennis Courts	League\nGirls Tennis	2026-09-24	4:00 PM	Varsity	Away	Wilcox	Wilcox	League\nGirls Tennis	2026-09-29	4:00 PM	JV	Away	MacDonald	MacDonald	League\nGirls Tennis	2026-09-29	4:00 PM	Varsity	Home	MacDonald	Fremont Tennis Courts	League\nGirls Tennis	2026-10-01	4:00 PM	JV	Home	Saratoga	Fremont Tennis Courts	League\nGirls Tennis	2026-10-01	4:00 PM	Varsity	Away	Saratoga	Saratoga	League\nGirls Tennis	2026-10-06	4:00 PM	JV	Away	Homestead	Homestead	League\nGirls Tennis	2026-10-06	4:00 PM	Varsity	Home	Homestead	Fremont Tennis Courts	League\nGirls Tennis	2026-10-08	4:00 PM	JV	Away	Gunn	Gunn	League\nGirls Tennis	2026-10-08	4:00 PM	Varsity	Home	Gunn	Fremont Tennis Courts	League\nGirls Tennis	2026-10-13	4:00 PM	JV	Home	Milpitas	Fremont Tennis Courts	League\nGirls Tennis	2026-10-13	4:00 PM	Varsity	Away	Milpitas	Milpitas	League\nGirls Tennis	2026-10-15	4:00 PM	JV	Away	Wilcox	Wilcox	League\nGirls Tennis	2026-10-15	4:00 PM	Varsity	Home	Wilcox	Fremont Tennis Courts	League\nGirls Tennis	2026-10-20	4:00 PM	JV	Home	MacDonald	Fremont Tennis Courts	League\nGirls Tennis	2026-10-20	4:00 PM	Varsity	Away	MacDonald	MacDonald	League\nGirls Tennis	2026-10-22	4:00 PM	JV	Away	Saratoga	Saratoga	League\nGirls Tennis	2026-10-22	4:00 PM	Varsity	Home	Saratoga	Fremont Tennis Courts	League\nGirls Tennis	2026-10-27	4:00 PM	JV	Home	Homestead	Fremont Tennis Courts	League\nGirls Tennis	2026-10-27	4:00 PM	Varsity	Away	Homestead	Homestead	League\nGirls Tennis	2026-10-29	4:00 PM	JV	Away	Santa Clara	Santa Clara	League\nGirls Tennis	2026-10-29	4:00 PM	Varsity	Home	Santa Clara	Fremont Tennis Courts	League\nGirls Tennis	2026-11-03	1:00 PM		Away	SCVAL FINALSTournament	Homestead	INVITATIONAL\nGirls Tennis	2026-11-04	1:00 PM		Away	SCVAL FINALSTournament	Homestead	INVITATIONAL\nGirls Volleyball	2026-09-09	5:30 PM	JV	Home	Mt. View	Fremont Main Gym	League\nGirls Volleyball	2026-09-09	6:45 PM	Varsity	Home	Mt. View	Fremont Main Gym	League\nGirls Volleyball	2026-09-12	7:30 AM	JV	Away	JV Spikefest	Milpitas	TOURNAMENT\nGirls Volleyball	2026-09-14	5:30 PM	JV	Home	Saratoga	Fremont Main Gym	League\nGirls Volleyball	2026-09-14	6:45 PM	Varsity	Home	Saratoga	Fremont Main Gym	League\nGirls Volleyball	2026-09-16	5:30 PM	JV	Away	MacDonald	MacDonald	League\nGirls Volleyball	2026-09-16	6:45 PM	Varsity	Away	MacDonald	MacDonald	League\nGirls Volleyball	2026-09-18	5:30 PM	JV	Away	Westmont	Westmont	Non-league\nGirls Volleyball	2026-09-18	7:00 PM	Varsity	Away	Westmont	Westmont	Non-league\nGirls Volleyball	2026-09-21	5:30 PM	JV	Home	Wilcox	Fremont Main Gym	League\nGirls Volleyball	2026-09-21	6:45 PM	Varsity	Home	Wilcox	Fremont Main Gym	League\nGirls Volleyball	2026-09-23	5:30 PM	JV	Away	Gunn	Gunn	League\nGirls Volleyball	2026-09-23	6:45 PM	Varsity	Away	Gunn	Gunn	League\nGirls Volleyball	2026-09-28	5:30 PM	JV	Home	Santa Clara	Fremont Field House Gym	League\nGirls Volleyball	2026-09-28	6:45 PM	Varsity	Home	Santa Clara	Fremont Field House Gym	League\nGirls Volleyball	2026-09-30	5:30 PM	JV	Away	Lynbrook	Lynbrook	League\nGirls Volleyball	2026-09-30	6:45 PM	Varsity	Away	Lynbrook	Lynbrook	League\nGirls Volleyball	2026-10-06	5:30 PM	JV	Away	Saratoga	Saratoga	League\nGirls Volleyball	2026-10-06	6:45 PM	Varsity	Away	Saratoga	Saratoga	League\nGirls Volleyball	2026-10-08	5:30 PM	JV	Home	MacDonald	Fremont Main Gym	League\nGirls Volleyball	2026-10-08	6:45 PM	Varsity	Home	MacDonald	Fremont Main Gym	League\nGirls Volleyball	2026-10-13	5:30 PM	JV	Away	Wilcox	Wilcox	League\nGirls Volleyball	2026-10-13	6:45 PM	Varsity	Away	Wilcox	Wilcox	League\nGirls Volleyball	2026-10-15	5:30 PM	JV	Home	Gunn	Fremont Main Gym	League\nGirls Volleyball	2026-10-15	6:45 PM	Varsity	Home	Gunn	Fremont Main Gym	League\nGirls Volleyball	2026-10-20	5:30 PM	JV	Away	Santa Clara	Santa Clara	League\nGirls Volleyball	2026-10-20	6:45 PM	Varsity	Away	Santa Clara	Santa Clara	League\nGirls Volleyball	2026-10-22	5:30 PM	JV	Home	Lynbrook	Fremont Main Gym	League\nGirls Volleyball	2026-10-22	6:45 PM	Varsity	Home	Lynbrook	Fremont Main Gym	League\nGirls Volleyball	2026-10-27	5:30 PM	JV	Away	Mt. View	Mt. View	League\nGirls Volleyball	2026-10-27	6:45 PM	Varsity	Away	Mt. View	Mt. View	League\nGirls Water Polo	2026-09-04	4:00 PM		Away	Los Gatos	Los Gatos	SCRIMMAGE\nGirls Water Polo	2026-09-08	5:15 PM	Varsity	Away	Homestead	Homestead	League\nGirls Water Polo	2026-09-10	6:30 PM	Varsity	Home	Santa Clara	Fremont Pool	League\nGirls Water Polo	2026-09-15	5:15 PM	Varsity	Away	Lynbrook	Lynbrook	League\nGirls Water Polo	2026-09-17	6:30 PM	Varsity	Home	Cupertino	Fremont Pool	League\nGirls Water Polo	2026-09-19	9:00 AM	Varsity	Home	American	Fremont Pool	Non-league\nGirls Water Polo	2026-09-22	5:15 PM	Varsity	Away	Milpitas	Milpitas	League\nGirls Water Polo	2026-09-24	6:30 PM	Varsity	Home	Monta Vista	Fremont Pool	League\nGirls Water Polo	2026-09-29	5:15 PM	Varsity	Away	Mt. View	Mt. View	League\nGirls Water Polo	2026-10-01	5:00 PM	Varsity	Away	Santa Clara	McDonald	League\nGirls Water Polo	2026-10-06	5:15 PM	Varsity	Home	Lynbrook	Fremont Pool	League\nGirls Water Polo	2026-10-08	6:30 PM	Varsity	Away	Cupertino	Cupertino	League\nGirls Water Polo	2026-10-13	5:15 PM	Varsity	Home	Milpitas	Fremont Pool	League\nGirls Water Polo	2026-10-15	6:30 PM	Varsity	Away	Monta Vista	Monta Vista	League\nGirls Water Polo	2026-10-20	5:15 PM	Varsity	Home	Mt. View	Fremont Pool	League\nGirls Water Polo	2026-10-22	6:30 PM	Varsity	Home	Homestead	Fremont Pool	League';

function setupSportsSync(){
  syncSports();
  ScriptApp.getProjectTriggers().forEach(function(t){
    if(t.getHandlerFunction() === "syncSports") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("syncSports").timeBased().everyHours(3).create();
}

function syncSports(){
  var games = parseSched_();
  var api = fetchApi_();
  var today = todayStr_();

  // merge scores from the live feed
  games.forEach(function(g){
    var s = api.scores[skey_(g.sport,g.date,g.level)] || api.scores[skey_(g.sport,g.date,"")];
    if(s) g.score = s;
  });
  // append genuinely-new games (e.g. spring, once athletics posts them) for known sports
  var seen = {};
  games.forEach(function(g){ seen[gkey_(g)] = true; });
  api.games.forEach(function(x){
    if(seasonOf_(x.sport) && !seen[gkey_(x)]){ games.push(x); seen[gkey_(x)] = true; }
  });

  // group -> ordered rows with dividers
  var out=[HEADER], banners=[], heads=[], seniors=[];
  SEASONS.forEach(function(seasonPair){
    var label=seasonPair[0], sportList=seasonPair[1];
    var seasonGames = games.filter(function(g){ return sportList.indexOf(g.sport) >= 0; });
    if(!seasonGames.length) return;
    banners.push(out.length+1);                        // 1-based sheet row
    out.push([label,"","","","","","","","","","","",""]);
    sportList.forEach(function(sp){
      var sg = seasonGames.filter(function(g){ return g.sport===sp; });
      if(!sg.length) return;
      sg.sort(function(a,b){ if(a.date!==b.date) return a.date<b.date?-1:1; return timeMin_(a.time)-timeMin_(b.time); });
      heads.push(out.length+1);
      out.push([sp + "  \u00b7  " + noun_(sp,true).toUpperCase(),"","","","","","","","","","","",""]);
      sg.forEach(function(g){
        var senior = isSenior_(g);
        var section = (g.date && g.date < today) ? "result" : "upcoming";
        var title = ((senior?"SENIOR NIGHT - ":"") + g.sport + (g.level?(" "+g.level):"") +
                     (g.homeAway?(" "+g.homeAway):"") + (g.opponent?(" vs "+g.opponent):"")).trim();
        if(senior) seniors.push(out.length+1);
        out.push([ g.sport, g.date||"", dayName_(g.date), g.time||"", g.level||"", g.homeAway||"",
                   g.opponent||"", g.location||"", g.type||"", section, g.score||"", senior?"YES":"", title ]);
      });
    });
  });

  var ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(EVENTS_ID);
  var sh = ss.getSheetByName(SPORTS_TAB) || ss.insertSheet(SPORTS_TAB);
  sh.clear();
  try{ sh.getBandings().forEach(function(b){ b.remove(); }); }catch(e){}
  try{ if(sh.getLastRow()>1) sh.getRange(2,1,sh.getMaxRows()-1,NCOLS).breakApart(); }catch(e){}

  sh.getRange(1,1,out.length,NCOLS).setValues(out);
  // base look
  sh.getRange(1,1,1,NCOLS).setFontWeight("bold").setBackground("#5F0C03").setFontColor("#FFFFFF");
  sh.setFrozenRows(1);
  sh.getRange(2,1,out.length-1,NCOLS).setBackground(C_WHITE).setFontColor(C_HEAD_FG);

  // season banners
  banners.forEach(function(r){
    sh.getRange(r,1,1,NCOLS).merge().setBackground(C_BANNER_BG).setFontColor(C_BANNER_FG)
      .setFontWeight("bold").setFontSize(14).setHorizontalAlignment("center").setVerticalAlignment("middle");
    sh.setRowHeight(r,34);
  });
  // sport headers
  heads.forEach(function(r){
    sh.getRange(r,1,1,NCOLS).merge().setBackground(C_HEAD_BG).setFontColor(C_HEAD_FG)
      .setFontWeight("bold").setFontSize(12).setHorizontalAlignment("left");
    sh.setRowHeight(r,26);
  });
  // senior-night games
  seniors.forEach(function(r){ sh.getRange(r,1,1,NCOLS).setBackground(C_SENIOR).setFontWeight("bold"); });

  // timestamp off to the side of the header row (col 15) - app reads it, humans ignore it
  var stamp = Utilities.formatDate(new Date(), "America/Los_Angeles", "MMM d, yyyy h:mm a");
  sh.getRange(1,15).setValue("Auto-updated " + stamp + " \u2014 " + (out.length-1) + " rows, full season");
  try{ sh.autoResizeColumns(1, NCOLS); }catch(e){}
}

/* ---- embedded schedule ---- */
function parseSched_(){
  return SCHED.split("\n").map(function(ln){
    var c = ln.split("\t");
    return { sport:c[0]||"", date:c[1]||"", time:c[2]||"", level:c[3]||"",
             homeAway:c[4]||"", opponent:c[5]||"", location:c[6]||"", type:c[7]||"" };
  }).filter(function(g){ return g.sport && g.date; });
}

/* ---- live feed: scores + any new games ---- */
function fetchApi_(){
  var res = { scores:{}, games:[] };
  try{
    var r = UrlFetchApp.fetch(RESULTS_ENDPOINT, {muteHttpExceptions:true, followRedirects:true});
    if(r.getResponseCode() !== 200) return res;
    var data = JSON.parse(r.getContentText());
    var progs = (data && data.programs) || [];
    progs.forEach(function(p){
      var sport = normSport_(p.sport || "");
      var handle = function(x, isResult){
        var date = x.date || ""; if(!sport || !date) return;
        var lvl = x.level || "";
        var sc = x.score || x.finalScore || x.result || x.wlWord || "";
        if(sc){ res.scores[skey_(sport,date,lvl)] = sc; res.scores[skey_(sport,date,"")] = sc; }
        res.games.push({ sport:sport, date:date, time:x.time||"", level:lvl,
          homeAway:(x.home?"Home":(x.away?"Away":"")), opponent:x.opponent||x.matchup||"",
          location:x.location||"", type:(x.league?"League":""), score:sc });
      };
      (p.results||[]).forEach(function(x){ handle(x,true); });
      (p.upcoming||[]).forEach(function(x){ handle(x,false); });
    });
  }catch(e){}
  return res;
}

/* ---- helpers ---- */
function noun_(sport,plural){
  var s=String(sport||"");
  if(/cross country|track|swim|dive|wrestl/i.test(s)) return plural?"meets":"meet";
  if(/tennis|badminton|golf/i.test(s)) return plural?"matches":"match";
  return plural?"games":"game";
}
function seasonOf_(sport){
  for(var i=0;i<SEASONS.length;i++){ if(SEASONS[i][1].indexOf(sport)>=0) return SEASONS[i][0]; }
  return "";
}
function normSport_(s){
  s=String(s||"").trim();
  var map={ "girlswaterpolo":"Girls Water Polo","boyswaterpolo":"Boys Water Polo" };
  var k=s.toLowerCase().replace(/[^a-z]/g,"");
  if(map[k]) return map[k];
  // title-case fallback
  return s.replace(/\b\w/g,function(c){return c.toUpperCase();});
}
function skey_(sport,date,level){ return (String(sport)+"|"+String(date)+"|"+String(level)).toLowerCase(); }
function gkey_(g){ return (String(g.sport)+"|"+String(g.date)+"|"+String(g.level||"")+"|"+String(g.opponent||"")).toLowerCase(); }
function isSenior_(g){ return SENIOR_NIGHTS.some(function(s){ return s.sport===g.sport && s.date===g.date; }); }
function dayName_(date){ var m=String(date||"").match(/^(\d{4})-(\d{2})-(\d{2})/); if(!m) return ""; var d=new Date(+m[1],+m[2]-1,+m[3]); return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()]; }
function timeMin_(t){ var m=String(t||"").match(/(\d+):(\d+)\s*(AM|PM)/i); if(!m) return 9999; var h=+m[1]%12; if(/PM/i.test(m[3])) h+=12; return h*60+(+m[2]); }
function todayStr_(){ var d=new Date(new Date().toLocaleString("en-US",{timeZone:"America/Los_Angeles"})); var mm=("0"+(d.getMonth()+1)).slice(-2), dd=("0"+d.getDate()).slice(-2); return d.getFullYear()+"-"+mm+"-"+dd; }
