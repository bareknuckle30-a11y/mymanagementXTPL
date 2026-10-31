# XTPL TaskManager — real-time chat addition

## What was added
- A **Chat** page in the existing React workspace navigation for admins and employees.
- Socket.IO real-time messaging with authenticated connections using the app's existing JWT (`Authorization` access token in `handshake.auth.token`).
- Server-side persistence with a storage adapter: local JSON by default (`server/data/messages.json`, last 5,000 kept), or Supabase hosted Postgres (free tier) when configured; newest 100 messages are loaded on connect. Signed-in clients can also `GET /api/chat/messages`.
- Message length validation (2,000 characters), connection state, timestamps, and responsive styling.
- A small storage adapter in `server/chatStore.js`. Later replace `getRecentMessages` and `saveMessage` with AWS persistence (for example DynamoDB for chat records); the UI and Socket.IO events can remain unchanged.

## Run locally
1. Install Node.js LTS if needed.
2. Open a terminal in the extracted `xtpl-taskmanager` project folder.
3. Run `npm install` (this installs Socket.IO and Socket.IO Client too).
4. Ensure `server/.env` has a strong `JWT_SECRET` before using real accounts. Existing local `.env` is not intended for production.
5. Run `npm run dev` from the project root.
6. Open `http://localhost:5173`, sign in, and select **Chat** in the left navigation. Open a second browser/incognito window and sign in as another account to test live messages.

The server runs on port 5050 and Vite on 5173. If port 5050 is occupied, stop the other process or change `PORT` in `server/.env`.

## Storage notes
For development, messages are stored in `server/data/messages.json` and survive server restarts. This is suitable for local testing only: it is not a hosted free storage service, it is not shared across multiple server instances, and the file should be backed up. Before public deployment, use a managed database such as AWS DynamoDB and add authorization/rate limiting appropriate for your use case. Never commit `.env` or real user data.

## Optional deployment configuration
- `VITE_SOCKET_URL`: set only if the Socket.IO server is hosted on a different public origin. For local development it defaults to the current origin and uses the Vite proxy.
- `PORT`: Express + Socket.IO server port (default 5050).
