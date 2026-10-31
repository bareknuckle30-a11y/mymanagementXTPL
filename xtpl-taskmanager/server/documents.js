import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from './auth.js';
import { loadDocuments, loadTasks, saveDocuments, serialize } from './store.js';
import { ALLOWED_EXT, UPLOAD_DIR, attachmentHeader, safeStoredName } from './uploads.js';

export const DOC_CATEGORIES = ['Template', 'Guide / SOP', 'Report', 'Collateral', 'Other'];
const VISIBILITY = ['everyone', 'private'];

const wrap = fn => (req, res) => fn(req, res).catch(err => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => cb(null, safeStoredName(file.originalname)),
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return cb(new Error(`File type ${ext || 'unknown'} is not allowed`));
    cb(null, true);
  },
});

const canSee = (doc, user) => user.role === 'admin' || doc.visibility === 'everyone' || doc.uploadedBy === user.id;
const canManage = (doc, user) => user.role === 'admin' || doc.uploadedBy === user.id;
const present = (doc, user) => ({ ...doc, canManage: canManage(doc, user) });
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

async function resolveTask(taskId, user) {
  if (!taskId) return { taskId: '', taskTitle: '' };
  const tasks = await loadTasks();
  const t = tasks.find(x => x.id === taskId);
  const visible = t && (user.role === 'admin' || !t.assigneeId || t.assigneeId === user.id);
  if (!visible) return { error: 'Linked task not found' };
  return { taskId: t.id, taskTitle: t.title };
}

function cleanupFiles(files) {
  return Promise.all((files || []).map(f => fs.unlink(f.path).catch(() => {})));
}

const router = Router();
router.use(requireAuth);

router.get('/', wrap(async (req, res) => {
  const docs = (await loadDocuments()).filter(d => canSee(d, req.user));
  docs.sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)));
  res.json({ categories: DOC_CATEGORIES, documents: docs.map(d => present(d, req.user)) });
}));

function handleUpload(req, res, next) {
  upload.array('files', 10)(req, res, err => {
    if (!err) return next();
    res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Each file must be 15 MB or smaller' : (err.message || 'Could not upload files') });
  });
}

router.post('/', handleUpload, wrap(async (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'Choose at least one file' });
  const category = DOC_CATEGORIES.includes(req.body?.category) ? req.body.category : 'Other';
  const projectName = text(req.body?.project, 60);
  // Only admins can publish to everyone. Employees' uploads are visible to themselves and admins.
  const wanted = VISIBILITY.includes(req.body?.visibility) ? req.body.visibility : 'private';
  const visibility = req.user.role === 'admin' ? wanted : 'private';
  const task = await resolveTask(text(req.body?.taskId, 60), req.user);
  if (task.error) { await cleanupFiles(files); return res.status(400).json({ error: task.error }); }
  const single = files.length === 1;
  const created = files.map(f => ({
    id: `d${Date.now()}${Math.floor(Math.random() * 100000)}`,
    title: (single && text(req.body?.title, 120)) || path.basename(f.originalname, path.extname(f.originalname)).slice(0, 120),
    description: text(req.body?.description, 500),
    category,
    project: projectName,
    taskId: task.taskId,
    taskTitle: task.taskTitle,
    visibility,
    file: { name: f.originalname, stored: f.filename, mime: f.mimetype, size: f.size },
    uploadedBy: req.user.id,
    uploadedByName: req.user.name,
    uploadedAt: new Date().toISOString(),
    downloads: 0,
  }));
  await serialize(async () => {
    const docs = await loadDocuments();
    docs.unshift(...created);
    await saveDocuments(docs);
  });
  res.status(201).json(created.map(d => present(d, req.user)));
}));

router.get('/:id/download', wrap(async (req, res) => {
  const result = await serialize(async () => {
    const docs = await loadDocuments();
    const doc = docs.find(d => d.id === req.params.id);
    if (!doc || !canSee(doc, req.user)) return null;
    doc.downloads = (doc.downloads || 0) + 1;
    await saveDocuments(docs);
    return doc;
  });
  if (!result) return res.status(404).json({ error: 'Document not found' });
  const filePath = path.join(UPLOAD_DIR, path.basename(result.file.stored));
  try { await fs.access(filePath); } catch { return res.status(404).json({ error: 'File is missing on the server' }); }
  res.setHeader('Content-Disposition', attachmentHeader(result.file.name));
  res.sendFile(filePath);
}));

router.patch('/:id', wrap(async (req, res) => {
  const body = req.body || {};
  const errors = [];
  const out = {};
  if (body.title !== undefined) { out.title = text(body.title, 120); if (!out.title) errors.push('title cannot be empty'); }
  if (body.description !== undefined) out.description = text(body.description, 500);
  if (body.category !== undefined) { if (DOC_CATEGORIES.includes(body.category)) out.category = body.category; else errors.push('invalid category'); }
  if (body.project !== undefined) out.project = text(body.project, 60);
  if (body.visibility !== undefined && !VISIBILITY.includes(body.visibility)) errors.push('invalid visibility');
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  const updated = await serialize(async () => {
    const docs = await loadDocuments();
    const i = docs.findIndex(d => d.id === req.params.id);
    if (i < 0 || !canSee(docs[i], req.user)) return { status: 404, error: 'Document not found' };
    if (!canManage(docs[i], req.user)) return { status: 403, error: 'You can only edit your own documents' };
    if (body.visibility !== undefined && body.visibility !== docs[i].visibility) {
      // Only admins can change who sees a document. Re-sending the current value is harmless.
      if (req.user.role !== 'admin') return { status: 400, error: 'Only admins can change who can see a document' };
      out.visibility = body.visibility;
    }
    docs[i] = { ...docs[i], ...out };
    await saveDocuments(docs);
    return { doc: docs[i] };
  });
  if (updated.error) return res.status(updated.status).json({ error: updated.error });
  res.json(present(updated.doc, req.user));
}));

router.delete('/:id', wrap(async (req, res) => {
  const result = await serialize(async () => {
    const docs = await loadDocuments();
    const doc = docs.find(d => d.id === req.params.id);
    if (!doc || !canSee(doc, req.user)) return { status: 404, error: 'Document not found' };
    if (!canManage(doc, req.user)) return { status: 403, error: 'You can only delete your own documents' };
    await saveDocuments(docs.filter(d => d.id !== doc.id));
    return { doc };
  });
  if (result.error) return res.status(result.status).json({ error: result.error });
  await fs.unlink(path.join(UPLOAD_DIR, path.basename(result.doc.file.stored))).catch(() => {});
  res.json({ ok: true });
}));

export default router;
