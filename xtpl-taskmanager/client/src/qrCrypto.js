// Encryption for the Secure QR feature. Runs in the browser (WebCrypto); the server never sees the
// message or the verification code.
//
//   code  = 10 random characters (about 50 bits), shown to the admin once and never stored or sent anywhere
//   key   = PBKDF2-HMAC-SHA256(code, random 16-byte salt, 600 000 rounds) -> AES-256 key
//   blob  = AES-256-GCM(message JSON), random 12-byte IV, the QR id bound in as authenticated data
//
// QR text:  XQR1.<id>.<salt>.<iv>.<ciphertext>      (base64url parts)
// The QR contains no message and no code, only the ciphertext. Without the code it is just noise.

export const PREFIX = 'XQR1';
export const MAX_TEXT_BYTES = 600;
export const MAX_LABEL = 60;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 symbols, no I or O
const CODE_LENGTH = 10;
const ITERATIONS = 600000;
const ID_RE = /^q_[0-9a-f]{16}$/;

const te = new TextEncoder();
const td = new TextDecoder();
const subtle = () => globalThis.crypto.subtle;

export class QrError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export const byteLength = text => te.encode(String(text ?? '')).length;

function toB64u(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64u(text) {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new QrError('BAD_QR', 'This is not a valid secure QR');
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

// 32 symbols divide 256 evenly, so masking a random byte is unbiased.
export function generateCode() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  const chars = Array.from(bytes, b => ALPHABET[b & 31]).join('');
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

export const normalizeCode = code => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

async function deriveKey(code, salt) {
  const material = await subtle().importKey('raw', te.encode(normalizeCode(code)), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

const aad = id => te.encode(`${PREFIX}|${id}`);

export async function encryptPayload({ id, code, label, text, createdAt, expiresAt }) {
  if (!ID_RE.test(id)) throw new QrError('BAD_QR', 'Missing QR id');
  if (normalizeCode(code).length < CODE_LENGTH) throw new QrError('BAD_CODE', 'Verification code is too short');
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(code, salt);
  const plain = te.encode(JSON.stringify({ v: 1, label, text, createdAt, expiresAt: expiresAt || '' }));
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aad(id) }, key, plain));
  return [PREFIX, id, toB64u(salt), toB64u(iv), toB64u(ct)].join('.');
}

// Reads the public parts only (no code needed). Throws BAD_QR when the text is not one of ours.
export function parsePayload(text) {
  const parts = String(text || '').trim().split('.');
  if (parts.length !== 5 || parts[0] !== PREFIX || !ID_RE.test(parts[1])) throw new QrError('BAD_QR', 'This is not a secure QR from XTPL TaskManager');
  const salt = fromB64u(parts[2]);
  const iv = fromB64u(parts[3]);
  const ct = fromB64u(parts[4]);
  if (salt.length !== 16 || iv.length !== 12 || ct.length < 17) throw new QrError('BAD_QR', 'This QR is damaged or incomplete');
  return { id: parts[1], salt, iv, ct };
}

// A wrong code and a tampered QR fail the same way on purpose (GCM cannot tell them apart).
export async function decryptPayload(text, code) {
  const { id, salt, iv, ct } = parsePayload(text);
  let plain;
  try {
    plain = await subtle().decrypt({ name: 'AES-GCM', iv, additionalData: aad(id) }, await deriveKey(code, salt), ct);
  } catch {
    throw new QrError('BAD_CODE', 'Wrong verification code, or the QR was altered');
  }
  const data = JSON.parse(td.decode(plain));
  return { id, ...data };
}
