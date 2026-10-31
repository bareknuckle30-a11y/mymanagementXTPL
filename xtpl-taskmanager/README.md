# XTPL TaskManager (React + Vite + Node.js + Express)

Admins assign and schedule work. Employees sign up with a Gmail account, pick tasks, and submit files (Excel, PDF, images, and more).

**v3 adds:** automatic **login hour monitoring** with an admin **Login report**, and an admin-only **Secure QR** (encrypted with a verification code that is never sent).

**v2 adds:** JWT sessions with refresh tokens, two-step login with a 6-digit OTP emailed to the person's inbox, **Forgot your password** reset, real-time chat with stored history, and a **Documents** page (shared templates and guides, uploads, downloads, and every file submitted on tasks).

    xtpl-taskmanager/
    ├─ client/   React + Vite frontend (port 5173)
    ├─ server/   Express API (port 5050) with login, users, tasks, and uploads
    └─ package.json   one-command scripts for both

## Run it (Windows)
Open the folder in VS Code, open a terminal in the project root (the folder with this README).
If PowerShell blocks npm, use `npm.cmd` instead of `npm` (or Command Prompt).

    npm.cmd install
    npm.cmd run dev

Open http://localhost:5173

## Sign in (two steps)
1. Enter email and password on the **Admin** or **Employee** tab.
2. Enter the 6-digit one-time code (OTP). It expires in 5 minutes, allows 5 attempts, and can be resent after 30 seconds.

**Where does the code come from?**
- **Out of the box (development):** no email server is configured, so the code is printed in the terminal running `npm run dev` and shown on the login screen with a "fill it in" button. Look for the line starting with `[OTP]`.
- **Real email:** copy `server/.env.example` to `server/.env`, set `JWT_SECRET`, and fill in the `SMTP_*` values (the file has a Gmail App Password example). Restart the server. Codes are then emailed and no longer shown on screen.
- **Turn OTP off:** set `OTP_ENABLED=false` in `server/.env` (password-only login).

**Forgot your password?** On the Admin or Employee sign-in screen, and on the employee sign-up screen, choose **Forgot your password?**. Enter the email on the account. A 6-digit code is sent to that personal inbox (or shown in the server terminal when SMTP is not set). After the code, choose a new password and sign in again.

Use the **Admin** tab to enter as an admin (assign, schedule, approve), or **Sign up with Gmail** to create an admin account. Admin signup uses the same Gmail + emailed OTP (SMTP) + JWT flow as employees; set `ADMIN_SIGNUP_CODE` (invite code) or `ADMIN_SIGNUP_OPEN=true` in `server/.env` to enable it.
Use the **Employee** tab to sign in, or **Sign up with Gmail** to create an employee account (`@gmail.com`).

| Role | Email | Password |
|---|---|---|
| Admin | ananya@xtpl.com | admin123 |
| Admin | rahul@xtpl.com | admin123 |
| Employee | meera@xtpl.com | work123 |
| Employee | jay@xtpl.com | work123 |
| Employee | sana@xtpl.com | work123 |

Admins can also add people from **Team**.

## Email service (SMTP)
The same `SMTP_*` settings in `server/.env` that deliver OTP codes also power task notifications (`server/emailService.js`). With `SMTP_HOST` empty nothing is sent and the app behaves exactly as before. Mail is sent in the background, so an SMTP outage never blocks a request.

| Event | Who gets the email |
|---|---|
| Task created with an assignee, or reassigned | the assignee |
| Employee submits work | all admins |
| Work approved (status set to Done) | the assignee |
| Work sent back | the assignee (with the review note) |
| Admin adds a team member | the new member (no password is emailed) |

Extra `.env` options: `EMAIL_NOTIFICATIONS=false` (keep OTP mail, stop notifications), `APP_URL` (link in emails), `APP_NAME`.
Admin endpoints: `GET /api/email/status` (checks the SMTP login) and `POST /api/email/test` with `{"to":"you@example.com"}`.

## Live notifications
Everyone gets instant alerts while the app is open, over the same Socket.IO connection as chat:
- **Task assigned or reassigned to you:** the server pushes it to your account; a toast appears, the task board refreshes, and it is listed under the bell.
- **New team chat message** from someone else: a toast and a count badge on **Chat** in the sidebar (nothing is shown while you are reading the chat).
- The **bell** keeps the last 25 alerts, has a mute/unmute button for the alert sound, and (for admins) shows submissions waiting for review.
- Click **Also alert me when this tab is in the background** in the bell to allow desktop notifications. They appear only while the tab is hidden.
- **By email:** the same events reach people's inboxes when SMTP is set up (see Email service). A new task or reassignment is emailed to the assignee straight away. A chat message is emailed only to people who are **not in the app**: after `CHAT_EMAIL_DELAY_SECONDS` (60) they get a digest, and never more than one per `CHAT_EMAIL_INTERVAL_MINUTES` (10), so a busy chat is bundled into one email. Anyone can turn chat emails off under **Settings**. Without `SMTP_HOST` nothing is emailed.
- Limits: alerts need the app open in a browser tab. Phone browsers and closed tabs would need Web Push (a service worker plus push keys), which is not included. Email notifications for new assignments (see Email service) still work when SMTP is set.

## Login hours (admin: Login report)
Every sign-in is timed automatically.
- **Starts** the moment someone signs in (after the password, and the OTP when it is on). A small green clock in the top bar shows their time online.
- **Stops** when they sign out. The logout timestamp and the duration are written to the record.
- **Closed browser?** The page checks in every minute. If it goes quiet for about 5 minutes (browser closed, laptop asleep) the entry is closed at the last check-in and marked "Closed (no activity)". If the person comes back while still signed in, a new entry starts and is tagged "resumed".
- A password reset signs the person out everywhere and closes their open entries.

Admins open **Login report** in the sidebar: who is signed in now, hours per person, and every sign-in with login time, logout time, duration, how it ended, device and IP. Filter by period (today, 7 days, 30 days, all time or custom dates) and person, and **Export CSV** (times in your local time zone). Overlapping sign-ins (two devices at once) are counted once in the hour totals.

Records live in `server/data/attendance.json`. Options in `server/.env`: `ATTENDANCE_STALE_SECONDS` (default 300, minimum 120) and `ATTENDANCE_RETENTION_DAYS` (default 365).

## Secure QR (admin only)
**Secure QR** in the admin sidebar locks a short message (up to 600 bytes) inside a QR code.
- The message is encrypted **in the browser** with AES-256-GCM. The key comes from a random **verification code** (10 characters, e.g. `K7M2Q-9XPRD`) through PBKDF2 (600 000 rounds). The QR holds only ciphertext.
- The code is shown **once**. It is never stored, never put in the QR, and never sent by email or SMS. The issuer gives it to the reader separately. A lost code cannot be recovered: revoke the QR and make a new one.
- **Scan & unlock** reads a QR with the camera, an uploaded image, or pasted text, asks for the code, and shows the message for 60 seconds.
- The server keeps a register (label, who made it, expiry, revoked or not, how many times it was opened and how many wrong codes were tried). Admins can revoke or delete entries. Revoking or expiry is checked whenever the QR is opened inside the app.
- Limits to know: the encryption itself works offline, so revoke/expiry only stops people using this app, not someone who copied the QR and runs their own decryption. The 50-bit code is strong against guessing but treat a QR image like a locked box: do not post it publicly together with a hint to the code.
- The camera needs `https://` or `localhost`. "Upload image" always works.

| Method | URL | Who | Purpose |
|---|---|---|---|
| POST | /api/attendance/heartbeat | signed in | keep your login-hour entry alive, returns when your clock started |
| GET | /api/attendance | admin | login report: `from`, `to` (ISO times), `userId`; returns `records` and `onlineUserIds` |
| GET | /api/qr | admin | the QR register |
| POST | /api/qr | admin | register a QR (`label`, `expiresInMinutes` or null); returns its id |
| GET | /api/qr/:id | admin | is this QR still open-able (not revoked or expired) |
| POST | /api/qr/:id/result | admin | report `{ok}` after an unlock attempt (counts only) |
| POST | /api/qr/:id/revoke | admin | stop this QR from opening |
| DELETE | /api/qr/:id | admin | remove from the register |

After updating, run `npm.cmd install` once: the client now needs the `qrcode` and `jsqr` packages.

## Security model
- **Access token (JWT)** lives 1 hour (`ACCESS_TOKEN_TTL`). Every API call sends it as `Authorization: Bearer <token>`.
- **Refresh token (JWT)** lives 7 days, is stored server side in `server/data/sessions.json`, is rotated on every use, and is revoked on sign out. The browser refreshes silently, so people are not logged out every hour.
- The OTP step uses a separate short-lived challenge token that cannot be used as an access token. Codes are stored only as salted hashes, are single use, and are limited by attempts and by a per-IP rate limit.
- Set a long random `JWT_SECRET` before deploying (see `server/.env.example`).

## Documents page
Open **Documents** in the sidebar (admins and employees).
- **Library:** shared files for the team. The first run seeds ready-to-use templates (daily telecalling report, lead tracker, weekly conversion report, demo session log) and a "how to submit work" guide.
- **Task submissions:** every file attached to tasks, collected in one place with project, status and download button.
- **Upload:** click *Upload document* or drag files onto the page. Pick a category (Template, Guide / SOP, Report, Collateral, Other), a project, and optionally link the file to a task.
- **Access:** admins can publish to *Everyone* or keep a file private. Employee uploads are visible to the uploader and admins (admins can later share them). Uploaders and admins can edit or delete. Files up to 15 MB, same allowed types as task uploads.

## Tracker page
Open **Tracker** in the sidebar (admins and employees). It has two options:
- **Upload your document:** drop an Excel (.xlsx) or CSV file. The server finds the header row, picks the matching template (Lead Tracker, Daily Telecalling Report, Weekly Conversion Report or Demo Session Log), moves each column into place and tidies the values: dates become DD-MM-YYYY, phone numbers become 10 digits (+91 and leading 0 removed), Hot / Warm / Cold and Connected / Busy / No Answer are standardised, Sr.no is renumbered. You see the column mapping and a preview first and can change any column by hand. Cells that cannot be standardised are kept as typed, highlighted yellow, and listed on an **Import notes** sheet.
- **Enter manually:** type rows into a grid for any template and download the filled Excel file.

Both options download an `.xlsx` with a styled header, frozen top row, filters, date formats and drop-downs for the status columns. Tick *Also save a copy to Documents* to keep a private copy in the Library. *Blank template (.xlsx)* downloads the empty template. Old `.xls` files must be re-saved as `.xlsx` or `.csv`.

The templates live in `server/tracker-core.js` (column names, accepted alternative headings, formats). To add a column heading your sheets use, add it to that column's `aliases`. Run `npm install` once after updating, because Tracker needs the `exceljs` package.

| Method | URL | Purpose |
|---|---|---|
| GET | /api/tracker/templates | template list with columns |
| GET | /api/tracker/templates/:key/download | blank Excel template |
| POST | /api/tracker/preview | multipart `file`, `template` (or `auto`), `mapping` (JSON): detection, mapping and preview, nothing stored |
| POST | /api/tracker/convert | multipart `file` or JSON `rows`, `template`, `mapping`, `save`: returns the filled `.xlsx` |

## How it works
- Admin creates a task, sets start/due dates, and assigns it or leaves it in the open pool.
- Employees pick open tasks, then submit a note plus files (xlsx, csv, pdf, images, docs, zip, and similar).
- Admins review files in **Inbox**, then Approve or Send back.
- The back arrow returns to the previous tab. **Esc** closes dialogs.

## Roles
- **Admin** — create, assign, and schedule tasks; review uploads; add teammates.
- **Employee** — Gmail signup, pick unassigned tasks, upload completed work.

Statuses: Todo, In progress, Submitted, Done.

## API
All routes except `/api/health` and the `/api/auth/*` sign-in routes need `Authorization: Bearer <token>`.

| Method | URL | Who | Purpose |
|---|---|---|---|
| POST | /api/auth/login | anyone | step 1: email + password (`as`: admin or employee). Returns an OTP challenge, or tokens if OTP is off |
| POST | /api/auth/signup | Gmail | create an employee or admin account (`role`), then verify the emailed code. Admin signup needs `ADMIN_SIGNUP_CODE` (`inviteCode`) or `ADMIN_SIGNUP_OPEN=true` |
| POST | /api/auth/forgot-password | anyone | send a reset OTP to the account's personal email |
| POST | /api/auth/reset-password | anyone | `resetToken` + new `password` after a successful reset OTP |
| POST | /api/auth/verify-otp | anyone | `challengeToken` + 6-digit `otp`, returns JWT pair (or a reset token) |
| POST | /api/auth/resend-otp | anyone | new code for the same challenge (30 s cooldown) |
| POST | /api/auth/refresh | anyone | swap a refresh token for a new access + refresh token |
| POST | /api/auth/logout | anyone | revoke a refresh token |
| GET | /api/auth/me | signed in | current user |
| GET | /api/chat/messages | signed in | last 100 stored chat messages |
| GET | /api/documents | signed in | documents you are allowed to see |
| POST | /api/documents | signed in | upload one or more files (multipart: `files`, title, category, project, taskId, visibility) |
| GET | /api/documents/:id/download | signed in | download a document |
| PATCH | /api/documents/:id | uploader / admin | edit title, description, category, project, visibility |
| DELETE | /api/documents/:id | uploader / admin | delete a document and its file |
| GET | /api/users | signed in | team list |
| POST | /api/users | admin | add admin or employee |
| GET | /api/tasks | signed in | list (employees see open + own) |
| POST | /api/tasks | admin | create / assign / schedule |
| PATCH | /api/tasks/:id | admin | update or reassign |
| POST | /api/tasks/:id/claim | employee | pick a task |
| POST | /api/tasks/:id/submit | employee | submit note + files (multipart) |
| POST | /api/tasks/:id/reject | admin | send submitted work back |
| GET | /api/files/:stored | signed in | download an uploaded file |
| DELETE | /api/tasks/:id | admin | delete |

## Run as one app (production style)
    npm.cmd run build
    npm.cmd start
Open http://localhost:5050.

## Production deployment
See [DEPLOYMENT.md](./DEPLOYMENT.md) for Vercel/Netlify frontend configuration, WebSocket-capable backend hosting, clean `/chat` routes, Supabase persistence checks, and protected admin signup. Admin self-signup requires a Gmail address plus `ADMIN_SIGNUP_CODE` (or `ADMIN_SIGNUP_OPEN=true`); without either, an existing admin must create admin accounts through Team.
