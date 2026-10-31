# XTPL TaskManager deployment notes

## Recommended production topology

This project uses Express + Socket.IO for the API and real-time chat. Deploy the **Node server** to a host that supports long-running Node processes and WebSockets (for example, Render or Railway). The server serves `client/dist` if the frontend build is present, so the simplest option is one service built from the project root:

- Build command: `npm install && npm run build`
- Start command: `npm start`
- Health check: `/api/health`
- Set the server environment variables listed in `server/.env.example` in the hosting dashboard.
- The server refuses to start in production with a missing or placeholder `JWT_SECRET`. Behind a hosting proxy, `TRUST_PROXY` defaults to `1` so rate limits are per visitor (set it to the real number of proxy hops if you have more than one).
- Set `NODE_ENV=production`, a strong random `JWT_SECRET`, a separate `JWT_REFRESH_SECRET`, and real SMTP settings if OTP email is required.
- Configure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` only in the **server** environment. Never add the service-role key to a `VITE_*` variable or commit it.
- Run `server/chat_messages.sql` in the Supabase SQL Editor once.
- Admin signup uses Gmail + emailed OTP (needs real `SMTP_*` settings in production). Set `ADMIN_SIGNUP_CODE` to a long random secret to require an invite code. `ADMIN_SIGNUP_OPEN=true` removes the code (anyone with a Gmail can become admin; avoid on public deployments). If neither is set, admin self-signup is disabled and an existing admin must create accounts through Team.
- Attach your custom domain to this service and enable HTTPS through the hosting provider.

When the API and UI are served from the same domain, clean routes such as `/chat` and Socket.IO use the same origin. The Express fallback serves the SPA for page refreshes.

## Deploying the frontend separately to Vercel or Netlify

These platforms can host the static Vite frontend, but the Express + Socket.IO backend must still run on a separate WebSocket-capable Node host. Set these **frontend build-time** environment variables:

- `VITE_API_URL=https://YOUR-BACKEND-DOMAIN/api`
- `VITE_SOCKET_URL=https://YOUR-BACKEND-DOMAIN`

The API host must allow requests from the frontend domain. Rebuild the frontend after changing `VITE_*` values. Configure your custom domain in the frontend hosting dashboard. The included `client/vercel.json` and `client/netlify.toml` provide SPA fallbacks for clean routes.

## Chat persistence checks

After deploying, visit `/api/health` and confirm `chatStorage` is `supabase`. If it says `json-file`, the server did not receive both `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (restart/redeploy after adding them). If sending fails, check server logs for `[chat] message save failed`; the UI now retains the draft and reports that the server did not confirm persistence. Confirm `public.chat_messages` has the columns in `server/chat_messages.sql`.

## Secrets in the original archive

Do not upload `server/.env` to Git or include it in a distributable archive. Use the example file as a template and set production secrets in the hosting provider's environment settings. Rotate credentials if a real `.env` was shared or committed.
