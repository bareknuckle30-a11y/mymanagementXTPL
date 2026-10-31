import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { seedDocuments, seedTasks, seedUsers } from './seed.js';
import { UPLOAD_DIR } from './uploads.js';
import { supabase, supabaseEnabled } from './supabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, 'data');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const DOCS_FILE = path.join(DATA_DIR, 'documents.json');
const ATTENDANCE_FILE = path.join(DATA_DIR, 'attendance.json');
const QR_FILE = path.join(DATA_DIR, 'qr-codes.json');

let queue = Promise.resolve();
export const serialize = fn => (queue = queue.then(fn, fn));

async function writeJson(file, data) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, file);
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

export function publicUser(user) {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return rest;
}

export async function loadUsers() {
  if (supabaseEnabled) {
    const { data, error } = await supabase.from('profiles').select('*').order('created_at');
    if (error) throw error;
    return (data || []).map(u => ({ id:u.id, name:u.name, email:u.email, initials:u.initials, role:u.role, passwordHash:u.password_hash, emailVerified:u.email_verified, chatEmails:u.chat_emails, createdAt:u.created_at }));
  }
  try {
    return await readJson(USERS_FILE);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    const users = [];
    for (const u of seedUsers) {
      users.push({
        id: u.id,
        name: u.name,
        email: u.email.toLowerCase(),
        initials: u.initials,
        role: u.role,
        passwordHash: await bcrypt.hash(u.password, 10),
      });
    }
    await writeJson(USERS_FILE, users);
    return users;
  }
}

export async function saveUsers(users) {
  if (supabaseEnabled) {
    const rows = users.map(u => ({ id:u.id, name:u.name, email:u.email.toLowerCase(), initials:u.initials || '', role:u.role, password_hash:u.passwordHash, email_verified:u.emailVerified !== false, chat_emails:u.chatEmails !== false, updated_at:new Date().toISOString() }));
    const { error } = await supabase.from('profiles').upsert(rows);
    if (error) throw error;
    return;
  }
  await writeJson(USERS_FILE, users);
}

export async function loadTasks() {
  if (supabaseEnabled) {
    const { data, error } = await supabase.from('tasks').select('*, projects(name), task_attachments(original_name,storage_path,mime_type,size_bytes)').order('created_at', { ascending:false });
    if (error) throw error;
    return (data || []).map(t => ({ id:t.id, title:t.title, description:t.description || '', project:t.projects?.name || '', status:t.status, priority:t.priority, dueDate:t.due_date || '', startDate:t.start_date || '', assigneeId:t.assigned_user_id || '', assignedBy:t.assigned_by || '', assignee:'', tags:t.tags || [], submissionNote:t.submission_note || '', reviewNote:t.review_note || '', submittedAt:t.submitted_at || '', claimedAt:t.claimed_at || '', files:(t.task_attachments || []).map(f => ({name:f.original_name, stored:f.storage_path, mime:f.mime_type, size:f.size_bytes})) }));
  }
  try {
    const tasks = await readJson(TASKS_FILE);
    return Array.isArray(tasks) ? tasks.map(migrateTask) : structuredClone(seedTasks);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    const tasks = structuredClone(seedTasks);
    await writeJson(TASKS_FILE, tasks);
    return tasks;
  }
}

export async function saveTasks(tasks) {
  if (supabaseEnabled) {
    const { data: projects, error: pe } = await supabase.from('projects').select('id,name');
    if (pe) throw pe;
    const projectMap = new Map((projects || []).map(p => [p.name,p.id]));
    const rows = tasks.map(t => ({ id:t.id, title:t.title, description:t.description || '', project_id:projectMap.get(t.project), assigned_user_id:t.assigneeId || null, created_by:t.createdBy || null, assigned_by:t.assignedBy || null, status:t.status, priority:t.priority, start_date:t.startDate || null, due_date:t.dueDate || null, submission_note:t.submissionNote || '', review_note:t.reviewNote || '', submitted_at:t.submittedAt || null, claimed_at:t.claimedAt || null, tags:t.tags || [], updated_at:new Date().toISOString() }));
    if (rows.some(r => !r.project_id)) throw new Error('Task references an unknown project');
    if (rows.length) { const { error } = await supabase.from('tasks').upsert(rows); if (error) throw error; }
    const ids = rows.map(r => r.id);
    const { data: existing, error: ee } = await supabase.from('tasks').select('id');
    if (ee) throw ee;
    const remove = (existing || []).map(x => x.id).filter(id => !ids.includes(id));
    if (remove.length) { const { error } = await supabase.from('tasks').delete().in('id', remove); if (error) throw error; }
    return;
  }
  await writeJson(TASKS_FILE, tasks);
}

function migrateTask(task) {
  return {
    submissionNote: '',
    reviewNote: '',
    submittedAt: '',
    claimedAt: '',
    assignedBy: '',
    startDate: '',
    assigneeId: task.assigneeId || '',
    files: [],
    ...task,
    files: Array.isArray(task.files) ? task.files : [],
  };
}

export async function loadSessions() {
  if (supabaseEnabled) {
    const { data, error } = await supabase.from('sessions').select('*');
    if (error) throw error;
    return (data || []).map(r => ({ id:r.id, ...r.data }));
  }
  try {
    const list = await readJson(SESSIONS_FILE);
    return Array.isArray(list) ? list : [];
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return [];
  }
}

export async function saveSessions(sessions) {
  if (supabaseEnabled) {
    const rows = sessions.map(s => { const { id, ...data } = s; return { id, user_id:data.userId || data.user_id, data, updated_at:new Date().toISOString() }; });
    if (rows.length) { const { error } = await supabase.from('sessions').upsert(rows); if (error) throw error; }
    const ids = rows.map(r => r.id);
    const { data: existing, error: ee } = await supabase.from('sessions').select('id'); if (ee) throw ee;
    const remove=(existing||[]).map(x=>x.id).filter(id=>!ids.includes(id)); if(remove.length){ const {error}=await supabase.from('sessions').delete().in('id',remove); if(error) throw error; }
    return;
  }
  await writeJson(SESSIONS_FILE, sessions);
}

// Login-hour records (one row per sign-in, closed on sign-out / timeout) and the secure-QR registry.
async function loadList(file) {
  try {
    const list = await readJson(file);
    return Array.isArray(list) ? list : [];
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return [];
  }
}
export const loadAttendance = () => loadList(ATTENDANCE_FILE);
export const saveAttendance = records => writeJson(ATTENDANCE_FILE, records);
export const loadQrCodes = () => loadList(QR_FILE);
export const saveQrCodes = list => writeJson(QR_FILE, list);

// Documents: the first run seeds a few ready-to-use templates (real files) for the team.
export async function loadDocuments() {
  try {
    const docs = await readJson(DOCS_FILE);
    return Array.isArray(docs) ? docs : [];
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    const docs = [];
    for (const d of seedDocuments) {
      const stored = `seed-${d.key}${path.extname(d.fileName)}`;
      await fs.writeFile(path.join(UPLOAD_DIR, stored), d.content, 'utf8');
      docs.push({
        id: `d-${d.key}`,
        title: d.title,
        description: d.description,
        category: d.category,
        project: d.project,
        taskId: '',
        taskTitle: '',
        visibility: 'everyone',
        file: { name: d.fileName, stored, mime: d.mime, size: Buffer.byteLength(d.content) },
        uploadedBy: 'u-am',
        uploadedByName: 'Ananya Mehta',
        uploadedAt: new Date().toISOString(),
        downloads: 0,
      });
    }
    await writeJson(DOCS_FILE, docs);
    return docs;
  }
}

export async function saveDocuments(docs) {
  await writeJson(DOCS_FILE, docs);
}
