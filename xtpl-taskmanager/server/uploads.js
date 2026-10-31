import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOAD_DIR = path.join(__dirname, 'uploads');

export const ALLOWED_EXT = new Set([
  '.xlsx', '.xls', '.csv', '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
  '.doc', '.docx', '.ppt', '.pptx', '.txt', '.zip', '.rar', '.7z', '.mp4', '.mov', '.mp3',
]);

export function safeStoredName(original) {
  const ext = path.extname(original || '').toLowerCase();
  const base = path.basename(original || 'file', ext).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 60) || 'file';
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}-${base}${ext}`;
}

await fs.mkdir(UPLOAD_DIR, { recursive: true });

// Content-Disposition value that keeps the real file name (spaces, unicode) in every browser.
export function attachmentHeader(name) {
  const safe = String(name || 'file').replace(/[\r\n"]/g, '_');
  const ascii = safe.replace(/[^\x20-\x7e]/g, '_').replace(/[\\%]/g, '_');
  const encoded = encodeURIComponent(safe).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
