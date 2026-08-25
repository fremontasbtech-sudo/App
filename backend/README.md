# Firebird Hub backend — 5-minute setup

The whole backend is one Google Apps Script attached to one Google Sheet. It's free, runs on the ASB Google account, and needs no server. It powers: Fire Bucks grants (teacher QR scans), balances + recent activity, spirit-point submissions with dedupe, feedback, and the class leaderboard.

**Your sheet already exists** — it was created in your Google Drive:
https://docs.google.com/spreadsheets/d/1ijHJzX7kOimDlvVpNmTJJPKmnW0cbVAp4RuY1xM-4ts/edit
(named "Firebird Hub Data", owned by abirpogo421@gmail.com — move it to the ASB account later if you want.)

## Deploy (once)

1. Open the sheet above (or **sheets.new** on the ASB account if starting fresh).
2. **Extensions → Apps Script**. Delete the starter code, paste in `Code.gs`, save.
3. In the editor, pick the **setup** function and hit **Run** once. Approve the permissions. This creates the four tabs (students, transactions, spirit, feedback) and sets a starter teacher PIN of **2627**.
4. **Change the PIN**: Project Settings (gear) → Script Properties → edit `TEACHER_PIN`. Share the PIN with staff only.
5. **Deploy → New deployment → Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Click Deploy and copy the URL ending in `/exec`.
6. Open the app's `app.js` and paste that URL into `CONFIG.apiUrl`. Re-upload the FirebirdHub folder to your host (Netlify Drop). Done — the app switches itself from demo mode to live.

## How each piece flows

- **Teacher scans a student's QR** → the app opens its Give Fire Bucks screen with the student pre-filled → teacher picks an amount + reason, enters the PIN → the script checks the PIN, caps the grant at 50, appends a row to `transactions`, and updates the student's balance in `students`.
- **Student opens their card** → the app asks the script for their balance and last few transactions.
- **Spirit dress-up submission** → appended to `spirit` as *pending*, one per student per day (duplicates are refused). Spirit changes the Status column to `verified` to make it count.
- **Leaderboard** → counts `verified` spirit rows per grade. (Rally/Olympia points are added by editing the sheet directly, or keep the app's scoreboard numbers hand-set like now.)
- **Feedback** → appended to `feedback`.

## Teacher Console (FirebirdHub/teacher.html)

A separate app just for staff, hosted at `<your-site>/teacher.html` when you drag the FirebirdHub folder to Netlify. Teachers open it, tap **Scan card**, point at a student's Firebird Card QR (it uses the phone camera; a built-in decoder handles phones without native scanning), pick or type a custom amount (1–50), enter the PIN, done. It also has manual entry when a camera isn't handy, and a "Today's grants" session log.

Sync: paste the SAME `/exec` URL into `API_URL` at the top of teacher.html. Then a grant from the console lands in the sheet, and the student's card in the main app shows the new balance on its next refresh — that's the sync loop. In demo mode (no URL), the console is fully testable on its own: **Load test student**, PIN **2627**, balances tracked in-session.

## Google sign-in (real)

The app has Google Identity Services wired in. To turn it on:

1. Go to **console.cloud.google.com** → create a project (call it Firebird Hub).
2. **APIs & Services → OAuth consent screen** → External → fill in the app name + your email → save (test mode is fine to start; add yourself as a test user).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application.**
4. Under **Authorized JavaScript origins**, add your hosted URL (e.g. `https://your-site.netlify.app`). Sign-in only works on the hosted site, not on a file opened directly.
5. Copy the client ID (ends in `.apps.googleusercontent.com`) into `CONFIG.googleClientId` in app.js and redeploy.

Then the Sign in button shows the real Google button: it puts the student's first name + photo in the header and prefills their Firebird Card. To later restrict it to school accounts, check that the decoded email ends in `@student.fuhsd.org` inside `onGoogleCred` in app.js.

## Updating the script later

Edit Code.gs, then **Deploy → Manage deployments → edit (pencil) → New version → Deploy**. The URL stays the same, so the app keeps working.

## Notes

- Everything is auditable: every grant is one row in `transactions` with the teacher label, time, and reason.
- If a wrong grant happens, fix the student's balance cell and delete the transaction row.
- The web app URL is unguessable but public; the PIN is what protects grants. Change it each semester.
