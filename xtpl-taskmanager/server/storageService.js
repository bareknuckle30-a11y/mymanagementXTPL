import crypto from 'node:crypto';
import path from 'node:path';
import { supabase, supabaseEnabled } from './supabase.js';

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'task-attachments';

export async function uploadTaskFiles(taskId, files = []) {
  if (!supabaseEnabled) throw new Error('Supabase Storage is required for production task attachments');
  const uploaded = [];
  for (const file of files) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const key = `${taskId}/${Date.now()}-${crypto.randomUUID()}${ext}`;
    const { error } = await supabase.storage.from(BUCKET).upload(key, file.buffer, {
      contentType: file.mimetype,
      upsert: false,
    });
    if (error) throw error;
    uploaded.push({ name: file.originalname, stored: key, mime: file.mimetype, size: file.size });
  }
  return uploaded;
}

export async function signedTaskFileUrl(stored, expiresIn = 60) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(stored, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}

export async function deleteTaskFiles(files = []) {
  if (!supabaseEnabled || !files.length) return;
  const { error } = await supabase.storage.from(BUCKET).remove(files.map(f => f.stored));
  if (error) console.error('[storage] delete failed:', error.message);
}
