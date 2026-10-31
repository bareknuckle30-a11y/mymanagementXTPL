// Helpers for the Login report. All pure, so they can be tested without a browser.

export const REASONS = {
  logout: 'Signed out',
  timeout: 'Closed (no activity)',
  'password-reset': 'Password reset',
};
export const reasonLabel = r => (r.active ? 'Active now' : REASONS[r.logoutReason] || r.logoutReason || 'Closed');

const pad = n => String(n).padStart(2, '0');

// 3725 -> "1h 02m", 125 -> "2m 05s", 9 -> "9s"
export function formatDuration(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${pad(m)}m`;
  if (m) return `${m}m ${pad(s % 60)}s`;
  return `${s}s`;
}

// 3725 -> "01:02:05" (the live timer)
export function formatClock(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

// Local date + time, 24 hour: "2026-10-30 11:14:07"
export function formatStamp(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Local-calendar range -> the instants the API wants. `to` is the END of that day.
export function rangeToIso(fromDate, toDate) {
  const out = {};
  if (fromDate) out.from = new Date(`${fromDate}T00:00:00`).toISOString();
  if (toDate) out.to = new Date(`${toDate}T23:59:59.999`).toISOString();
  return out;
}

export function presetRange(name, now = new Date()) {
  const back = days => { const d = new Date(now); d.setDate(d.getDate() - days); return localDate(d); };
  if (name === 'today') return { from: localDate(now), to: localDate(now) };
  if (name === '7d') return { from: back(6), to: localDate(now) };
  if (name === '30d') return { from: back(29), to: localDate(now) };
  return { from: '', to: '' };
}

// Total seconds covered by a set of [start, end] ranges, counting overlaps once
// (a person signed in on two devices at the same time is still one hour per hour).
export function unionSeconds(ranges) {
  const sorted = ranges.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0;
  let curStart = null;
  let curEnd = null;
  for (const [a, b] of sorted) {
    if (curEnd === null || a > curEnd) {
      if (curEnd !== null) total += curEnd - curStart;
      curStart = a; curEnd = b;
    } else if (b > curEnd) curEnd = b;
  }
  if (curEnd !== null) total += curEnd - curStart;
  return Math.round(total / 1000);
}

// One row per person: sessions, hours, first sign-in, last activity.
export function summarizeByPerson(records, nowMs = Date.now()) {
  const byUser = new Map();
  for (const r of records) {
    if (!byUser.has(r.userId)) byUser.set(r.userId, []);
    byUser.get(r.userId).push(r);
  }
  const rows = [];
  for (const [userId, list] of byUser) {
    const ranges = list.map(r => [Date.parse(r.loginAt), r.logoutAt ? Date.parse(r.logoutAt) : nowMs]);
    const latest = list.reduce((a, b) => (a.loginAt > b.loginAt ? a : b));
    rows.push({
      userId,
      name: latest.name,
      email: latest.email,
      role: latest.role,
      sessions: list.length,
      totalSec: unionSeconds(ranges),
      firstLogin: list.reduce((a, b) => (a < b.loginAt ? a : b.loginAt), list[0].loginAt),
      lastActivity: list.some(r => !r.logoutAt) ? 'active' : list.reduce((a, b) => (a > b.logoutAt ? a : b.logoutAt), ''),
      active: list.some(r => !r.logoutAt),
    });
  }
  return rows.sort((a, b) => b.totalSec - a.totalSec);
}

// Spreadsheets run text that starts with = + - @ as a formula. Names come from sign-up forms, so neutralise them.
function csvCell(value) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(records, nowMs = Date.now()) {
  const off = -new Date(nowMs).getTimezoneOffset();
  const tz = `UTC${off < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
  const head = ['Name', 'Email', 'Role', `Login (${tz})`, `Logout (${tz})`, 'Duration (hh:mm:ss)', 'Status', 'Device', 'IP address'];
  const lines = [head.map(csvCell).join(',')];
  for (const r of records) {
    const end = r.logoutAt ? Date.parse(r.logoutAt) : nowMs;
    const sec = Math.max(0, Math.round((end - Date.parse(r.loginAt)) / 1000));
    lines.push([
      r.name, r.email, r.role, formatStamp(r.loginAt), r.logoutAt ? formatStamp(r.logoutAt) : '',
      formatClock(sec), reasonLabel({ ...r, active: !r.logoutAt }), r.device, r.ip,
    ].map(csvCell).join(','));
  }
  return lines.join('\r\n');
}
