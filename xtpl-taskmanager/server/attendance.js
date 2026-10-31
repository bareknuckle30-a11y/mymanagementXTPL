// Login-hour monitoring.
//
// One record per sign-in. The record is opened automatically when a session starts (password or OTP
// step succeeds) and closed when the person signs out. If the browser is simply closed, the page's
// heartbeat stops and the record is closed at the last heartbeat with reason "timeout".
//
//   { id, sid, userId, name, email, role,
//     loginAt, lastSeen, logoutAt ('' while active), logoutReason, durationSec (set on close),
//     ip, device, resumed }
//
// `sid` is the id of the sign-in session. It survives refresh-token rotation, so a session that quietly
// refreshes its tokens stays one record.
import crypto from 'node:crypto';
import { loadAttendance, saveAttendance, serialize } from './store.js';

// A record with no heartbeat for this long is closed at its last heartbeat. The page beats every 60 s.
export const STALE_MS = Math.max(120, Number(process.env.ATTENDANCE_STALE_SECONDS || 300)) * 1000;
const RETENTION_MS = Math.max(1, Number(process.env.ATTENDANCE_RETENTION_DAYS || 365)) * 86400000;
const MAX_ROWS = 5000;

const iso = ms => new Date(ms).toISOString();
const secondsBetween = (fromIso, toIso) => Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 1000));

// "Chrome on Windows" from a user-agent string. Order matters: Edge and Chrome both say "Safari".
export function describeDevice(ua = '') {
  const s = String(ua);
  const browser = /Edg(e|A|iOS)?\//.test(s) ? 'Edge'
    : /OPR\/|Opera/.test(s) ? 'Opera'
    : /Firefox\/|FxiOS/.test(s) ? 'Firefox'
    : /Chrome\/|CriOS/.test(s) ? 'Chrome'
    : /Safari\//.test(s) ? 'Safari'
    : '';
  const os = /Windows/.test(s) ? 'Windows'
    : /Android/.test(s) ? 'Android'
    : /iPhone|iPad|iPod/.test(s) ? 'iOS'
    : /Mac OS X|Macintosh/.test(s) ? 'macOS'
    : /CrOS/.test(s) ? 'ChromeOS'
    : /Linux/.test(s) ? 'Linux'
    : '';
  if (browser && os) return `${browser} on ${os}`;
  return browser || os || 'Unknown device';
}

// ---- pure helpers (they edit the array in place and say whether anything changed) -------------

function closeRecord(r, atIso, reason) {
  r.logoutAt = atIso;
  r.logoutReason = reason;
  r.durationSec = secondsBetween(r.loginAt, atIso);
}

export function closeStale(records, nowMs, staleMs = STALE_MS) {
  let changed = false;
  for (const r of records) {
    if (r.logoutAt) continue;
    const seen = Date.parse(r.lastSeen || r.loginAt);
    if (nowMs - seen > staleMs) { closeRecord(r, r.lastSeen || r.loginAt, 'timeout'); changed = true; }
  }
  return changed;
}

export function newRecord({ user, sid, ip = '', userAgent = '', nowMs, resumed = false }) {
  const at = iso(nowMs);
  return {
    id: `a_${crypto.randomUUID()}`,
    sid,
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    loginAt: at,
    lastSeen: at,
    logoutAt: '',
    logoutReason: '',
    durationSec: null,
    ip: String(ip || '').replace(/^::ffff:/, ''),
    device: describeDevice(userAgent),
    resumed,
  };
}

// What the API returns: adds `active` and a live duration for records that are still open.
export function present(r, nowMs) {
  const active = !r.logoutAt;
  return { ...r, active, durationSec: active ? secondsBetween(r.loginAt, iso(nowMs)) : (r.durationSec ?? secondsBetween(r.loginAt, r.logoutAt)) };
}

function prune(records, nowMs) {
  const kept = records.filter(r => nowMs - Date.parse(r.loginAt) < RETENTION_MS);
  return kept.length === records.length ? records : kept;
}

// ---- storage-backed operations (serialised with every other write to the data folder) ---------

function update(fn) {
  return serialize(async () => {
    const nowMs = Date.now();
    let records = await loadAttendance();
    let dirty = closeStale(records, nowMs);
    const out = fn(records, nowMs) || {};
    dirty = dirty || Boolean(out.dirty);
    if (dirty) {
      records = prune(records, nowMs);
      await saveAttendance(records);
    }
    return out.result;
  });
}

// Sign-in succeeded: the clock starts.
export function trackLogin({ user, sid, ip, userAgent }) {
  return update((records, nowMs) => {
    const existing = records.find(r => r.sid === sid && !r.logoutAt);
    if (existing) return { result: present(existing, nowMs) };
    const rec = newRecord({ user, sid, ip, userAgent, nowMs });
    records.push(rec);
    return { result: present(rec, nowMs), dirty: true };
  });
}

// Sign-out (or anything else that ends the session): the clock stops and the timestamp is written.
export function trackLogout(sid, reason = 'logout') {
  return update((records, nowMs) => {
    let dirty = false;
    for (const r of records) {
      if (r.sid === sid && !r.logoutAt) { closeRecord(r, iso(nowMs), reason); dirty = true; }
    }
    return { dirty };
  });
}

export function trackLogoutUser(userId, reason) {
  return update((records, nowMs) => {
    let dirty = false;
    for (const r of records) {
      if (r.userId === userId && !r.logoutAt) { closeRecord(r, iso(nowMs), reason); dirty = true; }
    }
    return { dirty };
  });
}

// Called by the page every minute while it is open. If the record was closed for being quiet (laptop
// asleep, no network) but the sign-in is still valid, a new "resumed" record starts so hours stay true.
export function trackHeartbeat({ user, sid, ip, userAgent }) {
  return update((records, nowMs) => {
    let rec = records.find(r => r.sid === sid && !r.logoutAt);
    if (!rec) {
      rec = newRecord({ user, sid, ip, userAgent, nowMs, resumed: true });
      records.push(rec);
      return { result: present(rec, nowMs), dirty: true };
    }
    // Skip the disk write if we were just told about this session.
    const fresh = nowMs - Date.parse(rec.lastSeen) < 20000;
    if (!fresh) rec.lastSeen = iso(nowMs);
    return { result: present(rec, nowMs), dirty: !fresh };
  });
}

// Admin report. `fromMs` / `toMs` filter on the sign-in time. `online` lists everyone who is signed in
// right now, whatever the date filter says.
export async function listAttendance({ fromMs, toMs, userId } = {}) {
  const nowMs = Date.now();
  const all = await update(records => ({ result: records.slice() }));
  const online = [...new Set(all.filter(r => !r.logoutAt).map(r => r.userId))];
  const records = all
    .filter(r => (fromMs === undefined || Date.parse(r.loginAt) >= fromMs)
      && (toMs === undefined || Date.parse(r.loginAt) <= toMs)
      && (!userId || r.userId === userId))
    .sort((a, b) => b.loginAt.localeCompare(a.loginAt))
    .slice(0, MAX_ROWS)
    .map(r => present(r, nowMs));
  return { records, online };
}

// Close quiet sessions even when nobody is looking at the report.
export function sweepAttendance() {
  return update(() => ({}));
}
