import './loadEnv.js';
import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { Server as SocketIOServer } from 'socket.io';
import { chatStorageMode, getRecentMessages, saveMessage } from './chatStore.js';
import cors from 'cors';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { consumeResetToken, issueResetToken, login, rateLimit, refreshSession, requireAdmin, requireAuth, revokeSession, revokeUserSessions, startSession } from './auth.js';
import { OTP_ENABLED, peekChallenge, resendChallenge, startChallenge, startDecoyChallenge, verifyChallenge } from './otp.js';
import documentsRouter from './documents.js';
import trackerRouter from './tracker.js';
import attendanceRouter from './attendanceRoutes.js';
import { sweepAttendance } from './attendance.js';
import qrRouter from './qr.js';
import { createChatEmailer } from './chatEmail.js';
import { emailStatus, notifyChatDigest, notifyTaskApproved, notifyTaskAssigned, notifyTaskRejected, notifyWelcome, notifyWorkSubmitted, sendTestEmail, verifyConnection } from './emailService.js';
import { ALLOWED_EXT, UPLOAD_DIR, attachmentHeader, safeStoredName } from './uploads.js';
import { loadTasks, loadUsers, publicUser, saveTasks, saveUsers, serialize } from './store.js';
import { supabase, supabaseEnabled } from './supabase.js';
import { uploadTaskFiles, signedTaskFileUrl, deleteTaskFiles } from './storageService.js';
import { recordActivity, recentActivity } from './activity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 5050;
// Who is signing in, for the login-hour record.
const clientMeta = req => ({ ip: req.ip, userAgent: req.headers['user-agent'] });
const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');

const PROJECTS = [
  { id: 'p1', name: 'Marketing', color: 'blue' },
  { id: 'p2', name: 'Telecalling Reports', color: 'violet' },
  { id: 'p3', name: 'Training & Demo Sessions', color: 'cyan' },
  { id: 'p4', name: 'Operations', color: 'orange' },
];
const STATUSES = ['Todo', 'In progress', 'Submitted', 'Done'];
const PRIORITIES = ['High', 'Medium', 'Low'];
const ROLES = ['admin', 'employee'];
const projectNames = PROJECTS.map(p => p.name);

function initialsFrom(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0].toUpperCase())
    .join('') || 'XX';
}

function isGmail(email) {
  return /^[^\s@]+@(gmail|googlemail)\.com$/i.test(String(email || '').trim());
}

// How admin self-signup is gated:
//   'invite'   -> ADMIN_SIGNUP_CODE is set; the code is required (recommended)
//   'open'     -> ADMIN_SIGNUP_OPEN=true and no code; any verified Gmail can become admin
//   'disabled' -> neither set; existing admins must add admins from Team
function adminSignupMode() {
  if (String(process.env.ADMIN_SIGNUP_CODE || '')) return 'invite';
  if (String(process.env.ADMIN_SIGNUP_OPEN || '').toLowerCase() === 'true') return 'open';
  return 'disabled';
}

function visibleTasks(tasks, user) {
  if (user.role === 'admin') return tasks;
  return tasks.filter(t => !t.assigneeId || t.assigneeId === user.id);
}

function resolveAssignee(body, users) {
  if (body.assigneeId === undefined) return {};
  if (!body.assigneeId) return { assigneeId: '', assignee: '', assignedBy: '' };
  const person = users.find(u => u.id === body.assigneeId && u.role === 'employee' && u.emailVerified !== false);
  if (!person) return { error: 'assignee must be an employee account' };
  return { assigneeId: person.id, assignee: person.initials };
}

function isRealDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function clean(body, { partial }) {
  const out = {};
  const errors = [];
  const str = (k, max) => {
    if (body[k] === undefined) return;
    if (typeof body[k] !== 'string') return errors.push(`${k} must be text`);
    out[k] = body[k].trim().slice(0, max);
  };
  const oneOf = (k, list) => {
    if (body[k] === undefined) return;
    if (!list.includes(body[k])) return errors.push(`${k} must be one of: ${list.join(', ')}`);
    out[k] = body[k];
  };
  str('title', 200);
  str('description', 1000);
  str('submissionNote', 1000);
  str('reviewNote', 1000);
  oneOf('status', STATUSES);
  oneOf('priority', PRIORITIES);
  str('project', 120);
  if (body.dueDate !== undefined) {
    if (body.dueDate !== '' && !isRealDate(body.dueDate)) errors.push('dueDate must be a real date like 2026-10-31');
    else out.dueDate = body.dueDate;
  }
  if (body.startDate !== undefined) {
    if (body.startDate !== '' && !isRealDate(body.startDate)) errors.push('startDate must be a real date like 2026-10-31');
    else out.startDate = body.startDate;
  }
  if (out.startDate && out.dueDate && out.dueDate < out.startDate) errors.push('due date cannot be before the start date');
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags)) errors.push('tags must be a list');
    else out.tags = body.tags.filter(t => typeof t === 'string').map(t => t.trim().slice(0, 30)).slice(0, 8);
  }
  if (!partial && !out.title) errors.push('title is required');
  if (partial && 'title' in out && !out.title) errors.push('title cannot be empty');
  return { out, errors };
}

const upload = multer({
  storage: supabaseEnabled ? multer.memoryStorage() : multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => cb(null, safeStoredName(file.originalname)),
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 8 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return cb(new Error(`File type ${ext || 'unknown'} is not allowed`));
    cb(null, true);
  },
});

const IS_PROD = process.env.NODE_ENV === 'production';
if (IS_PROD && (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'change-me-in-production')) {
  console.error('[auth] Refusing to start in production without a real JWT_SECRET. Set a long random value in the server environment.');
  process.exit(1);
}

const app = express();
// Behind a hosting proxy (Render, Railway, Heroku, Nginx...) req.ip is the proxy's address unless
// Express is told to trust it, which makes the login rate limiter count every user as one person.
// TRUST_PROXY: a hop count (e.g. 1), "true" (= 1 hop), "false", or a subnet. Defaults to 1 in production.
{
  const tp = String(process.env.TRUST_PROXY ?? '').trim().toLowerCase();
  if (tp) app.set('trust proxy', /^\d+$/.test(tp) ? Number(tp) : tp === 'true' ? 1 : tp === 'false' ? false : process.env.TRUST_PROXY.trim());
  else if (IS_PROD) app.set('trust proxy', 1);
}
const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer, { cors: { origin: true, credentials: true }, maxHttpBufferSize: 1e6 });
const JWT_SECRET = process.env.JWT_SECRET || 'xtpl-dev-secret-change-me';

io.use(async (socket, next) => {
  try {
    const token = String(socket.handshake.auth?.token || '');
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.typ && payload.typ !== 'access') throw new Error('Invalid access token');
    const account = (await loadUsers()).find(u => u.id === payload.sub);
    if (!account) throw new Error('Account not found');
    socket.user = publicUser(account);
    next();
  } catch { next(new Error('Sign in again to use chat')); }
});

// Chat messages for people who are away are emailed as a digest (see chatEmail.js).
const chatEmailer = createChatEmailer({
  loadUsers,
  isOnline: async userId => (await io.in(`user:${userId}`).fetchSockets()).length > 0,
  sendDigest: notifyChatDigest,
  delayMs: Math.max(0, Number(process.env.CHAT_EMAIL_DELAY_SECONDS ?? 60)) * 1000,
  intervalMs: Math.max(1, Number(process.env.CHAT_EMAIL_INTERVAL_MINUTES ?? 10)) * 60000,
});
const CHAT_EMAIL_ON = String(process.env.CHAT_EMAIL_NOTIFICATIONS ?? 'true').toLowerCase() !== 'false';

// Live alerts: every socket joins a room for its own account, so a message can be pushed to one person.
const pushToUser = (userId, payload) => {
  if (!userId) return;
  io.to(`user:${userId}`).emit('notify', { id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, createdAt: new Date().toISOString(), ...payload });
};
const assignedAlert = (task, by) => ({
  type: 'task',
  title: 'New task assigned',
  body: `${by?.name ? `${by.name} assigned you: ` : ''}${task.title}${task.dueDate ? ` (due ${task.dueDate})` : ''}`,
  taskId: task.id,
});

io.on('connection', async socket => {
  socket.join(`user:${socket.user.id}`);
  try { socket.emit('chat:history', await getRecentMessages(100)); }
  catch (err) { console.error('[chat] history load failed:', err); socket.emit('chat:error', 'Could not load message history'); }
  socket.on('chat:send', async (payload, acknowledge) => {
    const ack = typeof acknowledge === 'function' ? acknowledge : () => {};
    const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
    if (!text) return ack({ ok: false, error: 'Write a message first.' });
    if (text.length > 2000) { const error = 'Messages must be 2000 characters or fewer'; socket.emit('chat:error', error); return ack({ ok: false, error }); }
    const message = { id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`, userId: socket.user.id, name: socket.user.name, text, createdAt: new Date().toISOString() };
    try {
      await saveMessage(message);
      io.emit('chat:message', message);
      if (CHAT_EMAIL_ON) chatEmailer.onMessage(message).catch(err => console.error('[chat-email]', err.message));
      ack({ ok: true, messageId: message.id });
    } catch (err) {
      console.error('[chat] message save failed:', err);
      const publicError = 'Message could not be saved. Check the server chat-storage configuration and logs.';
      socket.emit('chat:error', publicError);
      ack({ ok: false, error: publicError });
    }
  });
});

app.use((_req,res,next) => { res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('X-Frame-Options','DENY'); res.setHeader('Referrer-Policy','no-referrer'); res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()'); if (IS_PROD) res.setHeader('Strict-Transport-Security','max-age=31536000; includeSubDomains'); next(); });
const allowedOrigins = String(process.env.CORS_ORIGINS || process.env.APP_URL || '').split(',').map(v => v.trim()).filter(Boolean);
app.use(cors({ origin: IS_PROD ? allowedOrigins : true, credentials: true }));
app.use(express.json({ limit: '1mb' }));

const wrap = fn => (req, res) => fn(req, res).catch(err => {
  console.error(err);
  const status = Number(err.status) >= 400 && Number(err.status) < 600 ? Number(err.status) : 500;
  res.status(status).json({ error: err.message || 'Server error' });
});

app.get('/api/health', (_req, res) => res.json({ ok: true, storage: 'json-file', auth: 'jwt', otp: OTP_ENABLED, chat: true, chatStorage: chatStorageMode, uploads: true, documents: true, tracker: true, attendance: true, secureQr: true, adminSignup: adminSignupMode() }));

const authLimiter = rateLimit({ name: 'auth', max: 60 });
const otpLimiter = rateLimit({ name: 'otp', max: 120 });

app.post('/api/auth/login', authLimiter, wrap(async (req, res) => {
  const user = await login(req.body?.email, req.body?.password);
  if (!user) return res.status(401).json({ error: 'Incorrect email or password' });
  const as = String(req.body?.as || '').toLowerCase();
  if (as === 'admin' && user.role !== 'admin') {
    return res.status(403).json({ error: 'This account is an employee. Use the Employee tab.' });
  }
  if (as === 'employee' && user.role !== 'employee') {
    return res.status(403).json({ error: 'This account is an admin. Use the Admin tab.' });
  }
  // Step 1 of 2: password is correct. If OTP is on, no token yet - send a code first.
  if (OTP_ENABLED) return res.json(await startChallenge(user, 'login'));
  res.json(await startSession(user, clientMeta(req)));
}));

app.post('/api/auth/signup', authLimiter, wrap(async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 80);
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const role = String(req.body?.role || 'employee').toLowerCase();
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  if (!['admin', 'employee'].includes(role)) return res.status(400).json({ error: 'Choose a valid account type' });
  // Both employees and admins sign up with Gmail; the emailed OTP proves they own the mailbox.
  if (!isGmail(email)) return res.status(400).json({ error: `${role === 'admin' ? 'Admins' : 'Employees'} must sign up with a Gmail address` });
  if (password.length < 6) return res.status(400).json({ error: 'password must be at least 6 characters' });
  if (role === 'admin') {
    const mode = adminSignupMode();
    if (mode === 'disabled') return res.status(503).json({ error: 'Admin self-signup is disabled. Set ADMIN_SIGNUP_CODE (or ADMIN_SIGNUP_OPEN=true) in the server environment, or ask an existing admin to create your account.' });
    if (mode === 'invite') {
      const a = Buffer.from(String(req.body?.inviteCode || '')); const b = Buffer.from(String(process.env.ADMIN_SIGNUP_CODE));
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(403).json({ error: 'Invalid admin invitation code' });
    }
  }
  const created = await serialize(async () => {
    const users = await loadUsers();
    const existing = users.find(u => u.email === email);
    // Only an unverified (pending) signup may be replaced, whatever role it asked for. Otherwise
    // anyone could park someone else's address as a pending account and block them from signing up.
    if (existing && existing.emailVerified !== false) return { error: 'email already in use' };
    const user = {
      id: existing?.id || `u${Date.now()}${Math.floor(Math.random() * 1000)}`,
      name, email, initials: initialsFrom(name), role,
      emailVerified: !OTP_ENABLED,
      passwordHash: await bcrypt.hash(password, 10),
    };
    if (existing) users[users.indexOf(existing)] = user;
    else users.push(user);
    await saveUsers(users);
    return { user: publicUser(user) };
  });
  if (created.error) return res.status(409).json({ error: created.error });
  if (OTP_ENABLED) return res.status(201).json(await startChallenge(created.user, 'signup'));
  res.status(201).json(await startSession(created.user, clientMeta(req)));
}));

app.post('/api/auth/forgot-password', authLimiter, wrap(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Enter a valid email address' });
  }
  const user = (await loadUsers()).find(u => u.email === email);
  // Unknown address: answer with an identical-looking code screen (a decoy that can never succeed),
  // so this endpoint cannot be used to find out who has an account.
  if (!user) return res.json(await startDecoyChallenge(email, 'reset'));
  res.json(await startChallenge(publicUser(user), 'reset'));
}));

app.post('/api/auth/reset-password', authLimiter, wrap(async (req, res) => {
  const userId = consumeResetToken(req.body?.resetToken);
  if (!userId) return res.status(401).json({ error: 'Reset link expired. Request a new code.' });
  const password = String(req.body?.password || '');
  if (password.length < 6) return res.status(400).json({ error: 'password must be at least 6 characters' });
  const updated = await serialize(async () => {
    const users = await loadUsers();
    const i = users.findIndex(u => u.id === userId);
    if (i < 0) return null;
    users[i] = { ...users[i], passwordHash: await bcrypt.hash(password, 10) };
    await saveUsers(users);
    return publicUser(users[i]);
  });
  if (!updated) return res.status(401).json({ error: 'Account not found' });
  await revokeUserSessions(updated.id, 'password-reset');
  res.json({ ok: true, message: 'Password updated. Sign in with your new password.' });
}));

app.post('/api/auth/verify-otp', otpLimiter, wrap(async (req, res) => {
  const result = verifyChallenge(req.body?.challengeToken, req.body?.otp);
  if (result.error) return res.status(result.status).json({ error: result.error });
  const user = await serialize(async () => {
    const users = await loadUsers();
    const i = users.findIndex(u => u.id === result.userId);
    if (i < 0) return null;
    if (!users[i].emailVerified) {
      users[i] = { ...users[i], emailVerified: true };
      await saveUsers(users);
    }
    return users[i];
  });
  if (!user) return res.status(401).json({ error: 'Account not found' });
  if (result.purpose === 'reset') {
    return res.json({ resetRequired: true, resetToken: issueResetToken(publicUser(user)), email: user.email });
  }
  res.json(await startSession(publicUser(user), clientMeta(req)));
}));

app.post('/api/auth/resend-otp', otpLimiter, wrap(async (req, res) => {
  const info = peekChallenge(req.body?.challengeToken);
  if (!info) return res.status(401).json({ error: 'Verification expired. Sign in again.' });
  const user = (await loadUsers()).find(u => u.id === info.userId);
  const out = await resendChallenge(req.body?.challengeToken, user);
  if (out.error) return res.status(out.status).json({ error: out.error });
  res.json(out.data);
}));

app.post('/api/auth/refresh', otpLimiter, wrap(async (req, res) => {
  const session = await refreshSession(req.body?.refreshToken, clientMeta(req));
  if (!session) return res.status(401).json({ error: 'Session expired. Sign in again.' });
  res.json(session);
}));

app.post('/api/auth/logout', wrap(async (req, res) => {
  await revokeSession(req.body?.refreshToken);
  res.json({ ok: true });
}));

app.get('/api/auth/me', requireAuth, (req, res) => res.json(req.user));

app.get('/api/chat/messages', requireAuth, wrap(async (_req, res) => {
  res.json(await getRecentMessages(100));
}));

app.get('/api/users', requireAuth, wrap(async (req, res) => {
  // Pending signups (email not yet verified) are not team members yet.
  const users = (await loadUsers()).filter(u => u.emailVerified !== false).map(publicUser);
  if (req.user.role === 'admin') return res.json(users);
  res.json(users.map(({ id, name, initials, role }) => ({ id, name, initials, role })));
}));

app.post('/api/users', requireAuth, requireAdmin, wrap(async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 80);
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const role = req.body?.role;
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'valid email is required' });
  if (password.length < 6) return res.status(400).json({ error: 'password must be at least 6 characters' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'role must be admin or employee' });
  const created = await serialize(async () => {
    const users = await loadUsers();
    const clash = users.findIndex(u => u.email === email);
    if (clash >= 0 && users[clash].emailVerified !== false) return { error: 'email already in use' };
    if (clash >= 0) users.splice(clash, 1); // an unverified pending signup never blocks the real owner
    const user = {
      id: `u${Date.now()}${Math.floor(Math.random() * 1000)}`,
      name,
      email,
      initials: initialsFrom(name),
      role,
      passwordHash: await bcrypt.hash(password, 10),
    };
    users.push(user);
    await saveUsers(users);
    return { user: publicUser(user) };
  });
  if (created.error) return res.status(409).json({ error: created.error });
  notifyWelcome({ user: created.user });
  res.status(201).json(created.user);
}));

// Per-person switch for the "missed chat messages" email.
app.patch('/api/users/me/preferences', requireAuth, wrap(async (req, res) => {
  if (typeof req.body?.chatEmails !== 'boolean') return res.status(400).json({ error: 'chatEmails must be true or false' });
  const updated = await serialize(async () => {
    const users = await loadUsers();
    const i = users.findIndex(u => u.id === req.user.id);
    if (i < 0) return null;
    users[i] = { ...users[i], chatEmails: req.body.chatEmails };
    await saveUsers(users);
    return publicUser(users[i]);
  });
  if (!updated) return res.status(404).json({ error: 'Account not found' });
  res.json(updated);
}));

app.get('/api/projects', requireAuth, wrap(async (req, res) => {
  const tasks = visibleTasks(await loadTasks(), req.user);
  let projects = PROJECTS;
  if (supabaseEnabled) {
    const { data, error } = await supabase.from('projects').select('id,name,color,description,active').eq('active', true).order('name');
    if (error) throw error;
    projects = data || [];
  }
  res.json(projects.map(p => { const mine = tasks.filter(t => t.project === p.name); return { ...p, tasks: mine.length, done: mine.filter(t => t.status === 'Done').length }; }));
}));

app.post('/api/projects', requireAuth, requireAdmin, wrap(async (req, res) => {
  if (!supabaseEnabled) return res.status(503).json({ error: 'Project management requires Supabase configuration' });
  const name = String(req.body?.name || '').trim().slice(0, 120);
  const description = String(req.body?.description || '').trim().slice(0, 500);
  const color = String(req.body?.color || 'blue').trim().slice(0, 30);
  if (!name) return res.status(400).json({ error: 'Project name is required' });
  const { data, error } = await supabase.from('projects').insert({ name, description, color, created_by:req.user.id }).select().single();
  if (error) return res.status(error.code === '23505' ? 409 : 400).json({ error: error.code === '23505' ? 'Project already exists' : error.message });
  await recordActivity({ actor:req.user, action:'project.created', metadata:{ projectId:data.id, name:data.name } });
  res.status(201).json(data);
}));

app.get('/api/tasks', requireAuth, wrap(async (req, res) => {
  res.json(visibleTasks(await loadTasks(), req.user));
}));

app.post('/api/tasks', requireAuth, requireAdmin, wrap(async (req, res) => {
  const { out, errors } = clean(req.body || {}, { partial: false });
  const users = await loadUsers();
  const assigned = resolveAssignee(req.body || {}, users);
  if (assigned.error) errors.push(assigned.error);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  const task = {
    id: crypto.randomUUID(),
    title: out.title,
    description: out.description ?? '',
    project: out.project ?? PROJECTS[0].name,
    status: out.status ?? 'Todo',
    priority: out.priority ?? 'Medium',
    dueDate: out.dueDate ?? '',
    startDate: out.startDate ?? '',
    assignee: assigned.assignee || '',
    assigneeId: assigned.assigneeId || '',
    assignedBy: assigned.assigneeId ? req.user.id : '',
    createdBy: req.user.id,
    tags: out.tags ?? [],
    submissionNote: '',
    reviewNote: '',
    submittedAt: '',
    claimedAt: '',
    files: [],
  };
  await serialize(async () => {
    const tasks = await loadTasks();
    tasks.unshift(task);
    await saveTasks(tasks);
  });
  if (task.assigneeId) {
    notifyTaskAssigned({ task, assignee: users.find(u => u.id === task.assigneeId), assignedBy: req.user });
    pushToUser(task.assigneeId, assignedAlert(task, req.user));
  }
  await recordActivity({ actor:req.user, action:'task.created', taskId:task.id, metadata:{ title:task.title, assigneeId:task.assigneeId || null } });
  res.status(201).json(task);
}));

app.patch('/api/tasks/:id', requireAuth, requireAdmin, wrap(async (req, res) => {
  const { out, errors } = clean(req.body || {}, { partial: true });
  const users = await loadUsers();
  const assigned = resolveAssignee(req.body || {}, users);
  if (assigned.error) errors.push(assigned.error);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  let before = null;
  const updated = await serialize(async () => {
    const tasks = await loadTasks();
    const i = tasks.findIndex(t => t.id === req.params.id);
    if (i < 0) return null;
    before = tasks[i];
    const next = { ...tasks[i], ...out };
    if (('startDate' in out || 'dueDate' in out) && next.startDate && next.dueDate && next.dueDate < next.startDate) {
      return { dateError: 'due date cannot be before the start date' };
    }
    if (req.body?.assigneeId !== undefined) {
      next.assigneeId = assigned.assigneeId;
      next.assignee = assigned.assignee;
      next.assignedBy = assigned.assigneeId ? req.user.id : '';
    }
    tasks[i] = next;
    await saveTasks(tasks);
    return tasks[i];
  });
  if (!updated) return res.status(404).json({ error: 'Task not found' });
  if (updated.dateError) return res.status(400).json({ error: updated.dateError });
  if (updated.assigneeId && updated.assigneeId !== before?.assigneeId) {
    notifyTaskAssigned({ task: updated, assignee: users.find(u => u.id === updated.assigneeId), assignedBy: req.user });
    pushToUser(updated.assigneeId, assignedAlert(updated, req.user));
  }
  if (updated.status === 'Done' && before?.status !== 'Done' && updated.assigneeId) {
    notifyTaskApproved({ task: updated, assignee: users.find(u => u.id === updated.assigneeId) });
  }
  res.json(updated);
}));

app.post('/api/tasks/:id/claim', requireAuth, wrap(async (req, res) => {
  if (req.user.role !== 'employee') return res.status(403).json({ error: 'Only employees can pick tasks' });
  const updated = await serialize(async () => {
    const tasks = await loadTasks();
    const i = tasks.findIndex(t => t.id === req.params.id);
    if (i < 0) return { error: 'Task not found', status: 404 };
    const task = tasks[i];
    if (task.assigneeId && task.assigneeId !== req.user.id) return { error: 'Task already assigned', status: 409 };
    if (task.status === 'Done' || task.status === 'Submitted') return { error: 'This task is already closed', status: 409 };
    tasks[i] = {
      ...task,
      assigneeId: req.user.id,
      assignee: req.user.initials,
      status: 'In progress',
      claimedAt: new Date().toISOString(),
    };
    await saveTasks(tasks);
    return { task: tasks[i] };
  });
  if (updated.error) return res.status(updated.status).json({ error: updated.error });
  res.json(updated.task);
}));

function handleUpload(req, res, next) {
  upload.array('files', 8)(req, res, err => {
    if (!err) return next();
    res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Each file must be 15 MB or smaller' : err.code === 'LIMIT_FILE_COUNT' ? 'You can attach up to 8 files' : (err.message || 'Could not upload files') });
  });
}

const discardUploads = files => Promise.all((files || []).map(f => fs.unlink(f.path).catch(() => {})));

app.post('/api/tasks/:id/submit', requireAuth, handleUpload, wrap(async (req, res) => {
  if (req.user.role !== 'employee') { await discardUploads(req.files); return res.status(403).json({ error: 'Only employees can submit work' }); }
  const note = String(req.body?.note ?? req.body?.submissionNote ?? '').trim().slice(0, 1000);
  if (!note && !(req.files || []).length) return res.status(400).json({ error: 'Add a note or attach at least one file before submitting' });
  const incoming = supabaseEnabled ? await uploadTaskFiles(req.params.id, req.files || []) : (req.files || []).map(f => ({ name:f.originalname, stored:f.filename, mime:f.mimetype, size:f.size }));
  if (supabaseEnabled && incoming.length) {
    const rows = incoming.map(f => ({ task_id:req.params.id, uploaded_by:req.user.id, original_name:f.name, storage_path:f.stored, mime_type:f.mime, size_bytes:f.size }));
    const { error } = await supabase.from('task_attachments').insert(rows);
    if (error) { await deleteTaskFiles(incoming); throw error; }
  }
  const updated = await serialize(async () => {
    const tasks = await loadTasks();
    const i = tasks.findIndex(t => t.id === req.params.id);
    if (i < 0) return { error: 'Task not found', status: 404 };
    const task = tasks[i];
    if (task.assigneeId !== req.user.id) return { error: 'You can only submit your own tasks', status: 403 };
    if (task.status === 'Done') return { error: 'This task is already approved', status: 409 };
    tasks[i] = {
      ...task,
      status: 'Submitted',
      submissionNote: note,
      submittedAt: new Date().toISOString(),
      files: [...(task.files || []), ...incoming],
    };
    await saveTasks(tasks);
    return { task: tasks[i] };
  });
  if (updated.error) { if (supabaseEnabled) await deleteTaskFiles(incoming); else await discardUploads(req.files); return res.status(updated.status).json({ error: updated.error }); }
  loadUsers().then(users => notifyWorkSubmitted({
    task: updated.task,
    employee: users.find(u => u.id === req.user.id),
    admins: users.filter(u => u.role === 'admin'),
  })).catch(() => {});
  await recordActivity({ actor:req.user, action:'task.submitted', taskId:updated.task.id, metadata:{ attachmentCount:incoming.length } });
  res.json(updated.task);
}));

app.post('/api/tasks/:id/reject', requireAuth, requireAdmin, wrap(async (req, res) => {
  const note = String(req.body?.note || '').trim().slice(0, 1000);
  const updated = await serialize(async () => {
    const tasks = await loadTasks();
    const i = tasks.findIndex(t => t.id === req.params.id);
    if (i < 0) return { error: 'Task not found', status: 404 };
    const task = tasks[i];
    if (task.status !== 'Submitted') return { error: 'Only submitted work can be sent back', status: 409 };
    tasks[i] = {
      ...task,
      status: 'In progress',
      reviewNote: note || 'Please revise and resubmit.',
    };
    await saveTasks(tasks);
    return { task: tasks[i] };
  });
  if (updated.error) return res.status(updated.status).json({ error: updated.error });
  loadUsers().then(users => notifyTaskRejected({
    task: updated.task,
    assignee: users.find(u => u.id === updated.task.assigneeId),
  })).catch(() => {});
  res.json(updated.task);
}));

app.get('/api/files/:stored(*)', requireAuth, wrap(async (req, res) => {
  const stored = supabaseEnabled ? String(req.params.stored || '') : path.basename(req.params.stored);
  // Admins can open every submission; employees only the files on their own tasks.
  const all = await loadTasks();
  const tasks = req.user.role === 'admin' ? all : all.filter(t => t.assigneeId === req.user.id);
  const allowed = tasks.some(t => (t.files || []).some(f => f.stored === stored));
  if (!allowed) return res.status(404).json({ error: 'File not found' });
  const filePath = path.join(UPLOAD_DIR, path.basename(stored));
  if (!supabaseEnabled) { try { await fs.access(filePath); } catch { return res.status(404).json({ error:'File not found' }); } }
  const meta = tasks.flatMap(t => t.files || []).find(f => f.stored === stored);
  if (supabaseEnabled) return res.redirect(302, await signedTaskFileUrl(stored, 60));
  res.setHeader('Content-Disposition', attachmentHeader(meta?.name || stored));
  res.sendFile(filePath);
}));

app.delete('/api/tasks/:id', requireAuth, requireAdmin, wrap(async (req, res) => {
  const removed = await serialize(async () => {
    const tasks = await loadTasks();
    const task = tasks.find(t => t.id === req.params.id);
    if (!task) return null;
    await saveTasks(tasks.filter(t => t.id !== req.params.id));
    return task;
  });
  if (!removed) return res.status(404).json({ error: 'Task not found' });
  // the uploaded files belonged to this task: do not leave them behind on disk
  if (supabaseEnabled) await deleteTaskFiles(removed.files || []); else await discardUploads((removed.files || []).map(f => ({ path:path.join(UPLOAD_DIR, path.basename(f.stored)) })));
  await recordActivity({ actor:req.user, action:'task.deleted', taskId:null, metadata:{ taskId:removed.id, title:removed.title } });
  res.json({ ok: true });
}));

app.post('/api/tasks/:id/approve', requireAuth, requireAdmin, wrap(async (req, res) => {
  const note = String(req.body?.note || '').trim().slice(0, 1000);
  const updated = await serialize(async () => {
    const tasks = await loadTasks(); const i = tasks.findIndex(t => t.id === req.params.id);
    if (i < 0) return { error:'Task not found', status:404 };
    if (tasks[i].status !== 'Submitted') return { error:'Only submitted work can be approved', status:409 };
    tasks[i] = { ...tasks[i], status:'Done', reviewNote:note || 'Approved.' }; await saveTasks(tasks); return { task:tasks[i] };
  });
  if (updated.error) return res.status(updated.status).json({ error:updated.error });
  const users = await loadUsers(); notifyTaskApproved({ task:updated.task, assignee:users.find(u => u.id === updated.task.assigneeId) });
  await recordActivity({ actor:req.user, action:'task.approved', taskId:updated.task.id, metadata:{ note } });
  res.json(updated.task);
}));

app.get('/api/dashboard/stats', requireAuth, wrap(async (req, res) => {
  const tasks = visibleTasks(await loadTasks(), req.user); const today = new Date().toISOString().slice(0,10);
  const count = status => tasks.filter(t => t.status === status).length;
  const distribution = Object.entries(tasks.reduce((a,t) => { if(t.assigneeId) a[t.assigneeId]=(a[t.assigneeId]||0)+1; return a; }, {})).map(([userId,total]) => ({ userId,total }));
  res.json({ total:tasks.length, todo:count('Todo'), inProgress:count('In progress'), submitted:count('Submitted'), completed:count('Done'), overdue:tasks.filter(t => t.dueDate && t.dueDate < today && t.status !== 'Done').length, highPriority:tasks.filter(t => t.priority === 'High').length, employeeTaskDistribution:distribution });
}));

app.get('/api/activity', requireAuth, requireAdmin, wrap(async (req,res) => res.json(await recentActivity(req.query.limit))));

// Email service diagnostics (admin only)
app.get('/api/email/status', requireAuth, requireAdmin, wrap(async (_req, res) => {
  res.json({ ...emailStatus(), connection: await verifyConnection() });
}));

app.post('/api/email/test', requireAuth, requireAdmin, wrap(async (req, res) => {
  const to = String(req.body?.to || req.user.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ error: 'valid "to" email is required' });
  if (!emailStatus().configured) return res.status(400).json({ error: 'SMTP is not configured. Set SMTP_HOST in server/.env' });
  const result = await sendTestEmail(to);
  res.status(result.sent ? 200 : 502).json(result.sent ? { ok: true, to } : { ok: false, error: result.reason });
}));

app.use('/api/documents', documentsRouter);
app.use('/api/tracker', trackerRouter);
app.use('/api/attendance', attendanceRouter);
app.use('/api/qr', qrRouter);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

app.use(express.static(CLIENT_DIST));
app.get('*', (_req, res, next) => res.sendFile(path.join(CLIENT_DIST, 'index.html'), err => err && next()));

// Always answer API errors as JSON (bad JSON bodies, oversize bodies, anything unexpected).
app.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large' });
  const status = Number(err.status || err.statusCode) || 500;
  if (status >= 500) console.error(err);
  res.status(status >= 400 && status < 600 ? status : 500).json({ error: status >= 500 ? 'Server error' : err.message });
});

// Close login-hour records whose page stopped sending heartbeats (browser closed, laptop asleep).
setInterval(() => sweepAttendance().catch(err => console.error('[attendance] sweep failed:', err.message)), 60 * 1000).unref();

httpServer.listen(PORT, () => {
  const mail = emailStatus();
  console.log(`XTPL TaskManager API running at http://localhost:${PORT}`);
  if (IS_PROD && OTP_ENABLED && !mail.configured) console.warn('[otp] OTP is on but SMTP is not configured: nobody can receive codes. Set the SMTP_* variables or OTP_ENABLED=false.');
  console.log(`[auth] JWT ${process.env.JWT_SECRET ? 'loaded from server/.env' : 'is not set — using an insecure development secret'}`);
  console.log(`[email] SMTP ${mail.configured ? `connecting (${mail.host || 'gmail'}:${mail.port || 587}) — OTP goes to each user's personal inbox` : 'not configured — OTP stays in the terminal until SMTP_HOST is set in server/.env'}`);
  if (mail.configured) {
    verifyConnection().then(r => {
      console.log(`[email] SMTP ${r.ok ? 'authenticated' : `login failed: ${r.message}`}`);
    }).catch(err => console.error(`[email] SMTP verify error: ${err.message}`));
  }
})
  .on('error', err => {
    console.error(err.code === 'EADDRINUSE' ? `Port ${PORT} is already in use. Close the other app or change PORT in server/.env.` : err);
    process.exit(1);
  });
