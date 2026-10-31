import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import { sendOtpMail, mailEnabled } from './mailer.js';

export const OTP_ENABLED = String(process.env.OTP_ENABLED ?? 'true').toLowerCase() !== 'false';
export const OTP_TTL_MS = Number(process.env.OTP_TTL_MINUTES || 5) * 60 * 1000;
export const RESEND_COOLDOWN_MS = 30 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_SENDS = 5;

const SECRET = process.env.JWT_SECRET || 'xtpl-dev-secret-change-me';
const OTP_SECRET = `${SECRET}:otp-challenge`;

// Show the code on screen only in dev (no SMTP) unless explicitly disabled.
export const SHOW_DEV_OTP = !mailEnabled
  && process.env.NODE_ENV !== 'production'
  && String(process.env.OTP_SHOW_IN_UI ?? 'true').toLowerCase() !== 'false';

const pending = new Map(); // id -> record
const OTP_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'otp.json');
let persistQueue = Promise.resolve();

function toDisk(rec) {
  return { ...rec, hash: rec.hash ? Buffer.from(rec.hash).toString('hex') : '' };
}
function fromDisk(rec) {
  return { ...rec, hash: rec.hash ? Buffer.from(rec.hash, 'hex') : Buffer.alloc(0) };
}
async function persist() {
  persistQueue = persistQueue.then(async () => {
    await fs.mkdir(path.dirname(OTP_FILE), { recursive: true });
    const payload = Object.fromEntries([...pending.entries()].map(([id, rec]) => [id, toDisk(rec)]));
    await fs.writeFile(OTP_FILE, JSON.stringify(payload), 'utf8');
  }).catch(err => console.error('[otp] could not persist challenges:', err.message));
  return persistQueue;
}
await fs.readFile(OTP_FILE, 'utf8').then(raw => {
  const data = JSON.parse(raw);
  for (const [id, rec] of Object.entries(data || {})) pending.set(id, fromDisk(rec));
}).catch(() => {});

setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [id, r] of pending) if (r.expires + 10 * 60 * 1000 < now) { pending.delete(id); changed = true; }
  if (changed) persist();
}, 60 * 1000).unref();

const hashCode = (id, salt, code) => crypto.createHash('sha256').update(`${id}:${salt}:${code}`).digest();

export function maskEmail(email) {
  const [u, d] = String(email).split('@');
  if (!d) return email;
  return `${u.slice(0, 2)}${'*'.repeat(Math.max(u.length - 2, 2))}@${d}`;
}

async function deliver(id, rec, user) {
  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  rec.salt = crypto.randomBytes(12).toString('hex');
  rec.hash = hashCode(id, rec.salt, code);
  rec.expires = Date.now() + OTP_TTL_MS;
  rec.attempts = 0;
  rec.lastSent = Date.now();
  rec.sends += 1;
  await persist();
  const sent = await sendOtpMail({ to: user.email, name: user.name, code, purpose: rec.purpose, minutes: Math.round(OTP_TTL_MS / 60000) });
  if (sent.channel === 'failed') {
    throw Object.assign(new Error('We could not send the verification email right now. Please try again in a moment.'), { status: 502 });
  }
  return { channel: sent.channel, devOtp: SHOW_DEV_OTP && sent.channel === 'console' ? code : undefined };
}

function describe(id, rec, user, extra) {
  return {
    otpRequired: true,
    challengeToken: jwt.sign({ otp: id, sub: user.id, purpose: rec.purpose, typ: 'otp' }, OTP_SECRET, { expiresIn: '15m' }),
    email: maskEmail(user.email),
    purpose: rec.purpose,
    expiresInSeconds: Math.round(OTP_TTL_MS / 1000),
    resendInSeconds: Math.round(RESEND_COOLDOWN_MS / 1000),
    channel: extra.channel,
    ...(extra.devOtp ? { devOtp: extra.devOtp } : {}),
  };
}

export async function startChallenge(user, purpose) {
  const id = crypto.randomUUID();
  const rec = { userId: user.id, purpose, sends: 0 };
  pending.set(id, rec);
  const extra = await deliver(id, rec, user);
  return describe(id, rec, user, extra);
}

// For an address with no account (forgot-password): same response shape and the same attempt/expiry
// behaviour as a real challenge, but no email is sent and no code can ever match.
export async function startDecoyChallenge(email, purpose) {
  const id = crypto.randomUUID();
  const rec = {
    userId: '', email, purpose, decoy: true, sends: 1, attempts: 0,
    salt: crypto.randomBytes(12).toString('hex'), hash: crypto.randomBytes(32),
    expires: Date.now() + OTP_TTL_MS, lastSent: Date.now(),
  };
  pending.set(id, rec);
  await persist();
  return describe(id, rec, { id: '', email }, { channel: mailEnabled ? 'email' : 'console' });
}

function readChallenge(challengeToken) {
  try {
    const p = jwt.verify(String(challengeToken || ''), OTP_SECRET);
    if (p.typ !== 'otp') return null;
    return p;
  } catch {
    return null;
  }
}

export async function resendChallenge(challengeToken, user) {
  const p = readChallenge(challengeToken);
  const rec = p && pending.get(p.otp);
  if (rec?.decoy) {
    const waitDecoy = rec.lastSent + RESEND_COOLDOWN_MS - Date.now();
    if (waitDecoy > 0) return { error: `Please wait ${Math.ceil(waitDecoy / 1000)}s before requesting another code`, status: 429 };
    if (rec.sends >= MAX_SENDS) { pending.delete(p.otp); persist(); return { error: 'Too many codes requested. Sign in again.', status: 429 }; }
    rec.sends += 1; rec.lastSent = Date.now(); rec.attempts = 0; rec.expires = Date.now() + OTP_TTL_MS;
    await persist();
    return { data: describe(p.otp, rec, { id: '', email: rec.email }, { channel: mailEnabled ? 'email' : 'console' }) };
  }
  if (!rec || rec.userId !== user?.id) return { error: 'Verification expired. Sign in again.', status: 401 };
  const wait = rec.lastSent + RESEND_COOLDOWN_MS - Date.now();
  if (wait > 0) return { error: `Please wait ${Math.ceil(wait / 1000)}s before requesting another code`, status: 429 };
  if (rec.sends >= MAX_SENDS) { pending.delete(p.otp); persist(); return { error: 'Too many codes requested. Sign in again.', status: 429 }; }
  const extra = await deliver(p.otp, rec, user);
  return { data: describe(p.otp, rec, user, extra) };
}

export function peekChallenge(challengeToken) {
  const p = readChallenge(challengeToken);
  return p ? { userId: p.sub, purpose: p.purpose } : null;
}

export function verifyChallenge(challengeToken, code) {
  const p = readChallenge(challengeToken);
  const rec = p && pending.get(p.otp);
  if (!rec) return { error: 'Verification expired. Sign in again.', status: 401 };
  if (Date.now() > rec.expires) return { error: 'That code has expired. Request a new one.', status: 410 };
  if (rec.attempts >= MAX_ATTEMPTS) { pending.delete(p.otp); persist(); return { error: 'Too many wrong attempts. Sign in again.', status: 429 }; }
  const given = String(code || '').replace(/\s+/g, '');
  rec.attempts += 1;
  const expected = Buffer.from(rec.hash);
  const actual = hashCode(p.otp, rec.salt, given);
  const ok = !rec.decoy && /^\d{6}$/.test(given) && expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
  if (!ok) {
    const left = MAX_ATTEMPTS - rec.attempts;
    if (left <= 0) pending.delete(p.otp);
    persist();
    return { error: left > 0 ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Too many wrong attempts. Sign in again.', status: 401 };
  }
  pending.delete(p.otp); // single use
  persist();
  return { userId: rec.userId, purpose: rec.purpose };
}
