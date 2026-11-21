# Find your club: how matching works (rebuilt 2026-11-20)

The quiz lives in `FirebirdHub/club-match.js` (questions, club tags, scoring) and the UI in `FirebirdHub/app.js` (`openMatch`, `renderQuizStep`, `renderQuizResults`). This folder holds the research, the tags and the checks behind it.

## What was wrong with the old quiz

Checked on all 1,512 possible answer sets (`old-quiz-audit.txt`):
- It scored categories, not clubs. Every club in the winning category tied, so the top 3 were the first 3 of that category **in alphabetical order** (Aerospace, Astrophysics, Cloud Computing for almost any STEM answer).
- 58 of 76 clubs could never appear.
- The percent was the category's share of all answer points, so the best match showed a median of 27% (never above 50%), and all three cards showed the same number.

## How it works now

1. **Tags from the real list.** Each of the 76 clubs on the official list has tags taken only from its own description (`club-tags.json`, schema in `TAG-SCHEMA.md`): weighted interests (3 = the club's core purpose), what members do (compete, make, learn, perform, volunteer, hang out), commitment from its meeting line, openness (open, community, selective) and, for culture and faith clubs, which community. Three agents tagged, a fourth checked every tag against the text and fixed 14 clubs (`club-tags-review.md`). Clubs with a stub description are marked low confidence.
2. **Questions** (4, or 5 when "Culture, language and faith" is picked): interests (up to 3 of 16), which communities (only after picking culture), what you want to do at meetings (up to 2), time, and what you want most from a club.
3. **Score** (0 to 1, absolute): 56% interest fit, 20% activities, 12% time, 12% goal.
   - Interest fit uses the best-matching interest plus a smaller share of the second and third, so one strong fit is enough, and a club fitting two of your picks beats one that fits one.
   - A club for a community you picked counts as a full match; other community clubs count as weak, so nobody is pointed at a group that isn't theirs.
   - A club matching none of your interests keeps 40% of its score.
   - Time is a soft penalty (an evening club for someone who wants "a lunch now and then" drops, it isn't hidden).
4. **Top 3 with variety.** Each pick costs other clubs reached through the same interest 0.12, so picking art and coding gets an art club and a coding club. Exact ties are broken by a hash of the answers, never the alphabet. Only the best club and others at "Good match" or better are shown; up to 3 more good fits sit under "Also worth a look".
5. **Labels, not percents.** Strong match (0.88 and up), Good match (0.70 and up), Worth a look. A club with a stub listing never shows as Strong. Each card has one line on why it matched ("Fits your interest in coding and tech, and members build and make things."), the first line of the club's own description and its meeting info.

Why labels: Netflix dropped its "% Match" in 2024 because viewers found it confusing; a precise number from a 5-question quiz claims more than it knows, and ties at the same number look broken. Short, specific reasons tied to the student's own answers raise trust. Details and sources: `CLUB-MATCH-RESEARCH.md`.

## Results (2026-11-20, 76 clubs)

| | Old quiz | New quiz |
|---|---|---|
| Clubs that can appear in a top 3 | 18 of 76 | 76 of 76 (none above 15% of answer sets) |
| How the top 3 is picked on a tie | Alphabetical | Fit, then variety, then a hash of the answers |
| Best match shown as | 27% median (max 50%) | Strong match for coherent answers, Good match for mixed ones |
| Blind judges, 30 student profiles, round 1 (1 to 5) | 1.6 and 1.7 | 3.7 and 3.8 |
| Round 1: judges preferring it | 3 of 30 (each judge) | 27 of 30 (each judge) |
| Round 2, final version, fresh judge (1 to 5) | 1.6 | 4.2 (won 27, tied 3, lost 0) |

The judges saw both lists per student in random order without labels (`personas.mjs` has the 30 profiles; `node club-quiz/personas-run.mjs` prints the current results). After round 2, "Nature" became "Nature, animals and the environment" (Vet Connect is tagged animals) and the "Awards and honors" goal leans harder on honor societies.

Known limits: broad service clubs like culinary for community show for about 15% of answer sets; 9 clubs have thin descriptions, so their tags rest on the name.

## Keeping it current

- A new club on the official list still gets matched (keyword tags from its name and description, shown as no better than "Good match"). Run `node club-quiz/eval.mjs <clubs.json>` with today's list: it names clubs without hand-checked tags.
- To tag one: add it to `club-tags.json` following `TAG-SCHEMA.md` (quote the description in `evidence`), then `python3 club-quiz/inject-tags.py`, bump `club-match.js?v=` in `index.html`, and rerun `eval.mjs` and `node club-quiz/personas-run.mjs`.
- If a club's name changes on the list, update its `name` in `club-tags.json` the same way.
