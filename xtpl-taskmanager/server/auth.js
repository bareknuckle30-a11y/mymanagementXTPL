import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { loadSessions, loadUsers, publicUser, saveSessions, serialize } from './store.js';
import { trackLogin, trackLogout, trackLogoutUser } from './attendance.js';

const SECRET = process.env.JWT_SECRET || 'xtpl-dev-secret-change-me';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || `${SECRET}:refresh`;
export const ACCESS_TTL = process.env.ACCESS_TOKEN_TTL || '1h';
const REFRESH_DAYS = Number(process.env.REFRESH_TOKEN_DAYS || 7);

if (!process.env.JWT_SECRET) {
  console.warn('[auth] JWT_SECRET is not set. Using an insecure development secret. Set it in server/.env before deploying.');
}

export function signToken(user, sid) {
  return jwt.sign({ sub: user.id, role: user.role, typ: 'access', ...(sid ? { sid } : {}) }, SECRET, { expiresIn: ACCESS_TTL });
}

// Issues an access token (short lived) + refresh token (long lived, revocable, stored server side).
// `sid` identifies the sign-in. A brand new sign-in gets a new sid and starts the login-hour clock;
// a refresh passes the existing sid so the same login-hour record keeps running.
export async function startSession(user, { sid, ip, userAgent } = {}) {
  const isNewLogin = !sid;
  const sessionId = sid || crypto.randomUUID();
  const jti = crypto.randomUUID();
  const refreshToken = jwt.sign({ sub: user.id, jti, sid: sessionId, typ: 'refresh' }, REFRESH_SECRET, { expiresIn: `${REFRESH_DAYS}d` });
  await serialize(async () => {
    const now = Date.now();
    const sessions = (await loadSessions()).filter(s => s.exp > now);
    sessions.push({ jti, sid: sessionId, userId: user.id, exp: now + REFRESH_DAYS * 86400000, createdAt: new Date().toISOString() });
    await saveSessions(sessions);
  });
  if (isNewLogin) {
    // Login hours must never be able to block a sign-in.
    try { await trackLogin({ user, sid: sessionId, ip, userAgent }); }
    catch (err) { console.error('[attendance] could not record login:', err.message); }
  }
  return { token: signToken(user, sessionId), refreshToken, user };
}

export async function refreshSession(refreshToken, meta = {}) {
  let payload;
  try { payload = jwt.verify(String(refreshToken || ''), REFRESH_SECRET); } catch { return null; }
  if (payload.typ !== 'refresh') return null;
  const result = await serialize(async () => {
    const sessions = await loadSessions();
    const i = sessions.findIndex(s => s.jti === payload.jti && s.userId === payload.sub);
    if (i < 0) return null;
    const sid = sessions[i].sid || payload.sid || payload.jti; // sessions from before login-hour tracking have no sid
    sessions.splice(i, 1); // rotate: old refresh token can never be reused
    await saveSessions(sessions);
    return { sid };
  });
  if (!result) return null;
  const user = (await loadUsers()).find(u => u.id === payload.sub);
  if (!user) return null;
  return startSession(publicUser(user), { sid: result.sid, ...meta });
}

export async function revokeSession(refreshToken) {
  let payload;
  // An expired token still proves whose session it was, so a late sign-out is still recorded.
  try { payload = jwt.verify(String(refreshToken || ''), REFRESH_SECRET, { ignoreExpiration: true }); } catch { return; /* not one of ours */ }
  if (payload.typ !== 'refresh') return;
  let sid = payload.sid || payload.jti;
  try {
    await serialize(async () => {
      const sessions = await loadSessions();
      const own = sessions.find(s => s.jti === payload.jti);
      if (own?.sid) sid = own.sid;
      await saveSessions(sessions.filter(s => s.jti !== payload.jti));
    });
  } catch { /* already invalid */ }
  // Stop the login-hour clock and stamp the logout time.
  try { await trackLogout(sid, 'logout'); }
  catch (err) { console.error('[attendance] could not record logout:', err.message); }
}

export async function revokeUserSessions(userId, reason = 'sessions revoked') {
  await serialize(async () => {
    const sessions = await loadSessions();
    await saveSessions(sessions.filter(s => s.userId !== userId));
  });
  try { await trackLogoutUser(userId, reason); }
  catch (err) { console.error('[attendance] could not close login hours:', err.message); }
}

const RESET_SECRET = process.env.JWT_RESET_SECRET || `${SECRET}:password-reset`;
const usedResetJti = new Set();

export function issueResetToken(user) {
  const jti = crypto.randomUUID();
  return jwt.sign({ sub: user.id, jti, typ: 'reset' }, RESET_SECRET, { expiresIn: '10m' });
}

export function consumeResetToken(resetToken) {
  let payload;
  try { payload = jwt.verify(String(resetToken || ''), RESET_SECRET); } catch { return null; }
  if (payload.typ !== 'reset' || !payload.jti || usedResetJti.has(payload.jti)) return null;
  usedResetJti.add(payload.jti);
  return payload.sub;
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Sign in required' });
  try {
    const payload = jwt.verify(token, SECRET);
    if (payload.typ && payload.typ !== 'access') throw new Error('wrong token type');
    const users = await loadUsers();
    const user = users.find(u => u.id === payload.sub);
    if (!user) return res.status(401).json({ error: 'Account not found' });
    req.user = publicUser(user);
    req.sid = payload.sid || '';
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired. Sign in again.' });
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

export async function login(email, password) {
  const users = await loadUsers();
  const user = users.find(u => u.email === String(email || '').trim().toLowerCase());
  // compare against a dummy hash when the user is unknown so timing does not reveal valid emails
  const hash = user?.passwordHash || '$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi';
  const ok = await bcrypt.compare(String(password || ''), hash);
  if (!user || !ok) return null;
  return publicUser(user);
}

// Tiny in-memory rate limiter (per IP + route) for login / OTP endpoints.
const hits = new Map();
export function rateLimit({ windowMs = 15 * 60 * 1000, max = 20, name = 'rl' } = {}) {
  return (req, res, next) => {
    const key = `${name}:${req.ip}`;
    const now = Date.now();
    const h = (hits.get(key) || []).filter(t => now - t < windowMs);
    if (h.length >= max) {
      return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
    }
    h.push(now);
    hits.set(key, h);
    next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some(t => now - t < 15 * 60 * 1000)) hits.delete(k); }, 5 * 60 * 1000).unref();
