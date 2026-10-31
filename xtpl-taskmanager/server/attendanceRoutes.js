import { Router } from 'express';
import { requireAdmin, requireAuth } from './auth.js';
import { STALE_MS, listAttendance, trackHeartbeat } from './attendance.js';
import { loadSessions } from './store.js';

const router = Router();

const wrap = fn => (req, res) => fn(req, res).catch(err => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

// The signed-in page calls this on load and every minute. It keeps the login-hour record alive and
// tells the page when the clock started, so the timer in the top bar is the server's, not the browser's.
router.post('/heartbeat', requireAuth, wrap(async (req, res) => {
  const serverNow = new Date().toISOString();
  // Tokens from before login-hour tracking carry no session id; they get one at the next refresh.
  if (!req.sid) return res.json({ tracking: false, serverNow });
  // A sign-out in another tab must not be undone by a late heartbeat.
  const live = (await loadSessions()).some(s => s.sid === req.sid && s.exp > Date.now());
  if (!live) return res.json({ tracking: false, serverNow });
  const session = await trackHeartbeat({ user: req.user, sid: req.sid, ip: req.ip, userAgent: req.headers['user-agent'] });
  res.json({ tracking: true, serverNow, session });
}));

// Admin login report. ?from=<ISO>&to=<ISO>&userId=<id>  (from / to filter on the sign-in time)
router.get('/', requireAuth, requireAdmin, wrap(async (req, res) => {
  const parse = v => {
    if (v === undefined || v === '') return undefined;
    const ms = Date.parse(String(v));
    return Number.isNaN(ms) ? null : ms;
  };
  const fromMs = parse(req.query.from);
  const toMs = parse(req.query.to);
  if (fromMs === null || toMs === null) return res.status(400).json({ error: 'from and to must be valid dates' });
  const { records, online } = await listAttendance({ fromMs, toMs, userId: req.query.userId ? String(req.query.userId) : undefined });
  res.json({ now: new Date().toISOString(), staleAfterSeconds: Math.round(STALE_MS / 1000), onlineUserIds: online, records });
}));

export default router;
