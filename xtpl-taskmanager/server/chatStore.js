import './loadEnv.js';
// Pluggable chat storage. Configure Supabase free-tier Postgres with SUPABASE_URL
// and SUPABASE_SERVICE_ROLE_KEY to use hosted storage; otherwise use local JSON.
// AWS migration later: replace getRecentMessages/saveMessage only.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
const file = path.join(dir, 'messages.json');
const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const useSupabase = Boolean(supabaseUrl && supabaseKey);
export const chatStorageMode = useSupabase ? 'supabase' : 'json-file';
let queue = Promise.resolve();

async function readAll() {
  try { const data = JSON.parse(await fs.readFile(file, 'utf8')); return Array.isArray(data) ? data : []; }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
}
async function supabaseRequest(pathname, options = {}) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${pathname}`, {
    ...options,
    headers: { apikey: supabaseKey, ...(supabaseKey.startsWith('eyJ') ? { Authorization: `Bearer ${supabaseKey}` } : {}), 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase chat storage error (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return res.status === 204 ? null : res.json();
}
export async function getRecentMessages(limit = 100) {
  if (useSupabase) {
    const rows = await supabaseRequest(`chat_messages?select=id,user_id,name,text,created_at&order=created_at.desc&limit=${Math.min(limit, 100)}`);
    return rows.reverse().map(r => ({ id: r.id, userId: r.user_id, name: r.name, text: r.text, createdAt: r.created_at }));
  }
  return (await readAll()).slice(-limit);
}
export async function saveMessage(message) {
  if (useSupabase) {
    await supabaseRequest('chat_messages', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ id: message.id, user_id: message.userId, name: message.name, text: message.text, created_at: message.createdAt }) });
    return message;
  }
  const operation = queue.then(async () => {
    const all = await readAll();
    all.push(message);
    const kept = all.slice(-5000);
    await fs.mkdir(dir, { recursive: true });
    const temp = `${file}.tmp`;
    await fs.writeFile(temp, JSON.stringify(kept, null, 2), 'utf8');
    await fs.rename(temp, file);
    return message;
  });
  queue = operation.catch(() => {});
  return operation;
}
