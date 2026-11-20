# Firebird Hub review copy (public comment site)

A second Vercel project, **firebirdhub-review**, deploys this same repo as a public copy of the app with a
comment overlay (adapted from the website marker in `~/Desktop/Claude/Markers/website-marker`).
Anyone with the link can tap **Comment**, tap anything (or drag a box around an area), pick Edit, Bug or Keep,
and say what should change. Each comment becomes a GitHub issue on this repo with the label `marker`.

## How the loop works
1. People leave comments on the review copy.
2. Claude runs `node marker/notes.mjs` (from the App repo) to list open comments, and `show N` for the full
   detail (selector, matching CSS rules, computed styles, html, page and screen size).
3. Claude fixes them in `FirebirdHub/`, ships the usual way (commit, push `main`), and closes each one with
   `node marker/notes.mjs done N "what changed"`. Pushing `main` redeploys both the real app and the review copy.
   Use `reply N "question"` to ask something back, `skip N "why"` for a comment that won't be done.
4. On the review copy the pin turns grey with a check and shows the reply. Repeat.

## Files
| File | What |
|---|---|
| `build.mjs` | Build command of the review project only (`node ../marker/build.mjs`, root `FirebirdHub`). Copies the overlay and the API in, adds `noindex` and "Review copy" to the title, adds the copy's address to the functions' allowed origins. The real `app` project has no build command, so it never gets any of this. |
| `annotate.js` | The overlay, served as `/marker-overlay.js`. |
| `api-marker.js` | Becomes `/api/marker`: lists, creates, edits and deletes comments as GitHub issues. Needs env `GITHUB_TOKEN` on the review project. |
| `notes.mjs` | The local command for reading and closing comments (token from `.git/.sudo-credentials`, never printed). |

## Safety
- No sign-in. A comment can be edited or deleted only from the browser that wrote it (a random edit key kept in
  that browser; only its hash is stored in the issue). Text is capped; 12 comments per IP per 10 minutes.
- Comments are public issues on a public repo. Don't ask reviewers for personal details.
- Closing an issue as "not planned" hides its pin; closing it as completed shows it as done.
