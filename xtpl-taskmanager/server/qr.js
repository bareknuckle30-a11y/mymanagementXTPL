// Secure QR registry (admin only).
//
// The QR code itself is built in the browser: the message is encrypted there with a key derived from a
// one-time verification code (PBKDF2 + AES-256-GCM, see client/src/qrCrypto.js). This server only keeps a
// register so admins can see what was issued, set an expiry, revoke a code and read the open / failed
// counts. It never receives the message or the verification code, and the code is never emailed or texted:
// whoever issues the QR hands the code over separately.
import crypto from 'node:crypto';
import { Router } from 'express';
import { requireAdmin, requireAuth } from './auth.js';
import { loadQrCodes, saveQrCodes, serialize } from './store.js';

const router = Router();
router.use(requireAuth, requireAdmin);

const wrap = fn => (req, res) => fn(req, res).catch(err => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

const MAX_EXPIRY_MINUTES = 60 * 24 * 365;
const ID_RE = /^q_[0-9a-f]{16}$/;

const status = (q, nowMs = Date.now()) => (q.revoked ? 'revoked' : q.expiresAt && Date.parse(q.expiresAt) <= nowMs ? 'expired' : 'active');
const publicQr = q => ({ ...q, status: status(q) });

router.get('/', wrap(async (_req, res) => {
  const list = await loadQrCodes();
  res.json(list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(publicQr));
}));

// Register a QR before it is drawn: the id is mixed into the encryption so a payload can't be moved to another record.
router.post('/', wrap(async (req, res) => {
  const label = String(req.body?.label ?? '').trim().slice(0, 60);
  if (!label) return res.status(400).json({ error: 'Give the QR a label' });
  const minutes = req.body?.expiresInMinutes;
  if (minutes !== null && minutes !== undefined && !(Number.isFinite(minutes) && minutes >= 1 && minutes <= MAX_EXPIRY_MINUTES)) {
    return res.status(400).json({ error: 'Expiry must be between 1 minute and 1 year, or none' });
  }
  const now = Date.now();
  const qr = {
    id: `q_${crypto.randomBytes(8).toString('hex')}`,
    label,
    createdAt: new Date(now).toISOString(),
    createdBy: req.user.id,
    createdByName: req.user.name,
    expiresAt: minutes ? new Date(now + Math.round(minutes) * 60000).toISOString() : '',
    revoked: false,
    opened: 0,
    failed: 0,
    lastOpenedAt: '',
    lastOpenedByName: '',
  };
  await serialize(async () => {
    const list = await loadQrCodes();
    list.push(qr);
    await saveQrCodes(list);
  });
  res.status(201).json(publicQr(qr));
}));

// Before decrypting, the opener asks whether this QR is still allowed to be opened.
router.get('/:id', wrap(async (req, res) => {
  const qr = ID_RE.test(req.params.id) && (await loadQrCodes()).find(q => q.id === req.params.id);
  if (!qr) return res.status(404).json({ error: 'This QR was not issued by this workspace' });
  const state = status(qr);
  if (state !== 'active') return res.status(410).json({ error: state === 'revoked' ? 'This QR was revoked by an admin' : 'This QR has expired', status: state });
  res.json({ id: qr.id, label: qr.label, expiresAt: qr.expiresAt, status: state });
}));

// The browser reports whether the verification code worked. Only counts and "who / when" are stored.
router.post('/:id/result', wrap(async (req, res) => {
  const ok = req.body?.ok === true;
  const out = await serialize(async () => {
    const list = await loadQrCodes();
    const qr = ID_RE.test(req.params.id) && list.find(q => q.id === req.params.id);
    if (!qr) return null;
    if (ok) { qr.opened += 1; qr.lastOpenedAt = new Date().toISOString(); qr.lastOpenedByName = req.user.name; }
    else qr.failed += 1;
    await saveQrCodes(list);
    return publicQr(qr);
  });
  if (!out) return res.status(404).json({ error: 'QR not found' });
  res.json(out);
}));

router.post('/:id/revoke', wrap(async (req, res) => {
  const out = await serialize(async () => {
    const list = await loadQrCodes();
    const qr = ID_RE.test(req.params.id) && list.find(q => q.id === req.params.id);
    if (!qr) return null;
    qr.revoked = true;
    await saveQrCodes(list);
    return publicQr(qr);
  });
  if (!out) return res.status(404).json({ error: 'QR not found' });
  res.json(out);
}));

router.delete('/:id', wrap(async (req, res) => {
  const removed = await serialize(async () => {
    const list = await loadQrCodes();
    const i = ID_RE.test(req.params.id) ? list.findIndex(q => q.id === req.params.id) : -1;
    if (i < 0) return false;
    list.splice(i, 1);
    await saveQrCodes(list);
    return true;
  });
  if (!removed) return res.status(404).json({ error: 'QR not found' });
  res.json({ ok: true });
}));

export default router;
