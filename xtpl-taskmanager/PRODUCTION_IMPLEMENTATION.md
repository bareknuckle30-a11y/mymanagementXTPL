# XTPL TaskManager — production implementation

This repository was upgraded incrementally rather than rebuilt. Existing React screens, JWT/OTP login, chat, tracker, documents, attendance, QR, task workflow and email service are preserved.

## What changed

1. `supabase/migrations/001_production_schema.sql` adds normalized PostgreSQL tables for profiles, projects, tasks, attachments, comments, activity, notifications and sessions; indexes; constraints; seed projects; private Storage bucket.
2. `server/supabase.js` creates a server-only service-role client.
3. `server/store.js` now switches core users/tasks/sessions to Supabase when `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are configured, while retaining the JSON store for local development.
4. `server/storageService.js` stores task submission files in private Supabase Storage and serves them through short-lived signed URLs after API authorization.
5. `server/activity.js` writes audit events.
6. `server/index.js` now includes stricter production CORS/security headers/request limits, dynamic project creation, explicit approve route, dashboard statistics, activity API, UUID task IDs, Supabase attachment handling and audit writes.
7. `deploy/ecosystem.config.cjs` and `deploy/nginx.conf` provide PM2 and Nginx production templates.

## New/important APIs

- `POST /api/projects` — admin only, creates a project without code changes.
- `POST /api/tasks/:id/approve` — admin only.
- `GET /api/dashboard/stats` — role-aware task metrics.
- `GET /api/activity?limit=20` — admin audit feed.

Existing APIs are preserved, including auth, task CRUD, claim, submit, reject, users, documents, tracker, attendance, QR and email diagnostics.

## Supabase setup

Create a Supabase project, open SQL Editor, and run `supabase/migrations/001_production_schema.sql`. Keep the `task-attachments` bucket private. The current architecture intentionally sends all privileged database/storage traffic through Express; never place the service-role key in `client/.env`.

The migration enables RLS on application tables. Because the backend uses the service role and performs authorization in Express middleware, no browser RLS policies are required for this architecture. If direct browser Supabase queries are added later, create explicit authenticated policies before doing so.

## EC2 deployment

Use Ubuntu LTS. In the EC2 Security Group allow 80/443 publicly and restrict 22 to your own IP/VPN/bastion where practical. Do not expose port 5050 publicly.

Install Git, Nginx and a current Node.js LTS. Clone the repository into `/var/www/xtpl-taskmanager`, run `npm install` at the repository root, and create `server/.env` from `server/.env.example`. Set a strong random `JWT_SECRET`, production Supabase values, SMTP values, `APP_URL=https://YOUR_DOMAIN`, `CORS_ORIGINS=https://YOUR_DOMAIN`, `NODE_ENV=production`, and disable development OTP display.

Build the frontend with `npm run build`. Install PM2 globally, then run `pm2 start deploy/ecosystem.config.cjs`, `pm2 save`, and `pm2 startup` (execute the command PM2 prints). Copy `deploy/nginx.conf` to `/etc/nginx/sites-available/xtpl-taskmanager`, replace `YOUR_DOMAIN`, enable the site, run `sudo nginx -t`, and reload Nginx.

Point DNS A/AAAA records to the EC2 public IP. Install Certbot for Nginx and issue a TLS certificate for the domain. After HTTPS works, verify `/api/health`, login/refresh/logout, admin/employee authorization, task create/assign/claim/submit/approve/reject, private attachment access, project creation, email delivery and Socket.IO chat.

## Security checklist

- Keep `.env`, service-role key, JWT secrets and SMTP password out of Git.
- Rotate any secret that was ever committed or shared publicly.
- Use HTTPS only in production and a long random JWT secret.
- Keep Supabase Storage private; signed URLs are short-lived.
- Restrict CORS to the production origin.
- Restrict SSH and do not expose Node port 5050.
- Keep auth rate limiting enabled and OTP UI leakage disabled in production.
- Validate upload extension, count and 15 MB/file limit.
- Review admin signup mode; invitation-only is safer than open signup.
- Back up Supabase/Postgres and test restore procedures; EC2 should be treated as replaceable compute.
- Keep OS, Node dependencies, Nginx and PM2 patched.

## Testing checklist

Run local smoke tests first in JSON mode, then test against a staging Supabase project. Verify role isolation by manually calling admin endpoints with an employee token. Test invalid/expired JWTs, repeated login attempts, duplicate project names, invalid dates/status/priority, task ownership, attachment type/size/count limits, signed URL expiry, SMTP failure behavior, database outage behavior, mobile/tablet layouts, page refresh on React routes, Nginx proxying, Socket.IO upgrade and EC2 reboot/PM2 recovery.

## Remaining incremental migration note

The existing Documents, Tracker, Attendance and Secure QR modules still use their established local JSON/file stores. Core authentication, users, projects, tasks, sessions and task attachments are production-persistent in Supabase. Migrate those auxiliary modules to Supabase in a later isolated migration after regression testing; this avoids blindly replacing currently working functionality.
