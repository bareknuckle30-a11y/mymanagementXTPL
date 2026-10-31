# XTPL TaskManager — React + Vite frontend

## Run
    npm install
    npm run dev        (Windows PowerShell blocked? use: npm.cmd install / npm.cmd run dev)

Open http://localhost:5173. Runs in demo mode with sample data (changes are kept in memory only).

## Connect a backend later
Copy `.env.example` to `.env` and set `VITE_API_URL`. Expected endpoints:
GET/POST `/tasks`, PATCH/DELETE `/tasks/:id` (tasks need an `id` field).
