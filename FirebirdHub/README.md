# Firebird Hub — Fremont ASB app

One folder, no build step. `index.html` + `app.js` + `vision.js` (Spirit Fit Check) + `qr.js` (QR codes) + `styles.css` + `teacher.html` (staff console) + `assets/`.

## What's inside

- **index.html** — the student app: events, live bell schedule (normal + all special weeks built in), spirit points with the photo Fit Check, clubs, Firebird Card with Fire Bucks + QR, feedback.
- **teacher.html** — the staff console: scan a student's card QR with the camera, give a custom number of Fire Bucks (PIN-protected, every grant logged).
- **../backend/** — the Google Apps Script that makes it all real (grants, balances, submissions, leaderboard). Deploy steps in `../backend/README.md`. Until it's deployed, both apps run in demo mode, which is fully testable (demo PIN **2627**).

## Why it "doesn't work" when you open the .html on a phone

Tapping an HTML file in the Files app (iPhone) or a file manager (Android) opens a **preview** that blocks JavaScript. Phones need the app served from a URL.

## Put it on your phone (2 minutes, free, no code)

1. On your Mac, go to **app.netlify.com/drop**.
2. Drag this whole `FirebirdHub` folder onto the page.
3. You get a URL like `firebird-hub.netlify.app` — open it on your phone. The teacher console lives at `/teacher.html` on the same site.
4. On the phone: Safari → Share → **Add to Home Screen**. It installs like a real app (Firebird icon, full-screen) thanks to the included manifest.

Hosting also makes the QR loop real: card QRs point at the live URL, so any teacher's camera can open the give screen. Updating later: drag the folder onto Netlify again.

## Quick test without hosting

- **Mac:** double-click `index.html` (and `teacher.html`). The Fit Check's smart model and Google sign-in need internet; everything else works offline.
- **Phone on the same Wi-Fi:** `cd` into this folder, run `python3 -m http.server 8000`, open `http://<your-Mac's-IP>:8000` on the phone.

## Tech notes (for ASB Tech)

- `CONFIG` at the top of `app.js`: `apiUrl` (the Apps Script /exec URL — turns on live sync) and `googleClientId` (turns on real Google sign-in). Same `API_URL` at the top of `teacher.html`.
- Bell schedules (regular + every special week) are embedded in `app.js` from the official FHS export; update them there if the school changes times.
- `CLASS_COLORS` in `vision.js` = per-grade colors for Tribe day. Set Fremont's real ones.
- `CLUBS` array in `app.js` is sample data — swap in the Club Database export.
