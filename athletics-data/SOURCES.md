# Fremont HS Athletics — data sources & scrape

Context folder for anything sports-related in Firebird Hub. Captured 2026-09-03.

## Websites
- Main athletics site (schedules, rosters, info): https://www.fremonthsathletics.org
- Legacy host that serves the .ics calendars + rosters: https://fremontathletics.org
- Every sport has a page at https://www.fremonthsathletics.org/<slug> (see slugs below).

## Live data endpoints
- **Games JSON (what Firebird Hub uses)** — Apps Script, public JSONP:
  https://script.google.com/macros/s/AKfycby_2RTRuFEiIRdoNQtzbuUQzSGCGJ3G_p7CxNrqcqOcQiPk268kXu63uLf21GIT5RfQ/exec?view=results
  Returns {ok, updated, season, programs:[{sport, results:[...games], upcoming:[...games]}]}.
  Game fields: sport, level (Varsity/JV/JV-Varsity), opponent, matchup ("vs X"/"at X"),
  home (bool), league (bool), date "YYYY-MM-DD", time, location, status,
  and on results: score ("20–12"/"Scrimmage"), wl, wlWord (WIN/LOSS/NO SCORE), setScores, standouts.
  NOTE: games only — practices are NOT in this feed. Fall season only until winter is published.
- **Schedule widget (the "Live from Google Sheets" list + one-week flyer)** — a Cloud Run renderer
  that reads a second Apps Script:
  renderer: https://fhs-flyer-renderer-388633239325.us-west1.run.app/schedule?src=<appsscript>&page=<slug>
  data script (HTML app, not JSON): https://script.google.com/macros/s/AKfycbwvpOmgpmSqtPVT_KfHsMA91JeHpfF-69ozr96QFyTbEtRZnVA2L8KtLXUL-iaV7RIL/exec
- **Per-team calendar (.ics)** — full schedule INCLUDING practices, past + upcoming:
  https://fremontathletics.org/fhs-ics.php?team=<slug>   (webcal:// works too)
  Google Calendar add: https://calendar.google.com/calendar/r?cid=<url-encoded ics url>
  (Blocks generic HTTP clients with a 500; a real calendar client or Apps Script UrlFetchApp can read it.)
- **Per-team roster (HTML)**: http://fremontathletics.org/<slug>-roster.html

## Sport slugs
Fall: cross-country, field-hockey, flag-football, football, girls-tennis, girls-volleyball,
  boys-water-polo, girlswaterpolo
Winter: boys-basketball, girls-basketball, boys-soccer, girls-soccer, wrestling
Spring: badminton, baseball, golf, softball, swimming-and-diving, boys-tennis, track-and-field, boys-volleyball
(Winter/Spring schedules are usually not published until closer to their season.)

## Files here
- schedule-fall-2026.csv — every game the games JSON currently exposes (8 fall sports, past results
  with scores + all upcoming), categorized: sport, level, section (result/upcoming), date, time,
  home/away, matchup, opponent, location, league/non-league, score, result (W/L), status.

## Senior nights (fall 2026, confirmed with Abir)
- Football + Cheer: Oct 22 (home vs Los Altos)
- Field Hockey: Oct 26, 6 PM
- Girls Tennis: Oct 29, 4-7 PM

## How this flows into the app
- Firebird Hub's Sports tab pulls the games JSON live (JSONP) and renders upcoming + recent results
  with scores, filter chips per sport, and a Senior Night badge.
- The Events spreadsheet's "Sports" tab is written by App/backend/SportsSync.gs on a trigger.
