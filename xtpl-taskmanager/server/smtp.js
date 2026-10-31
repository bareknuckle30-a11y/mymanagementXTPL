import './loadEnv.js';
import nodemailer from 'nodemailer';

function env(name, fallback = '') {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return String(raw).trim().replace(/^['"]|['"]$/g, '');
}

export const SMTP_HOST = env('SMTP_HOST');
export const SMTP_PORT = Number(env('SMTP_PORT', '587'));
export const SMTP_USER = env('SMTP_USER');
export const SMTP_PASS = env('SMTP_PASS').replace(/\s+/g, '');
export const SMTP_FROM = env('SMTP_FROM');
export const SMTP_SECURE = env('SMTP_SECURE').toLowerCase() === 'true';
export const SMTP_SERVICE = env('SMTP_SERVICE').toLowerCase();

export const smtpConfigured = Boolean(SMTP_HOST || SMTP_SERVICE === 'gmail');

const NAME = env('APP_NAME', 'XTPL TaskManager');
export const FROM = SMTP_FROM || (SMTP_USER ? `${NAME} <${SMTP_USER}>` : `${NAME} <no-reply@xtpl.local>`);

function buildTransport() {
  if (!smtpConfigured) return null;
  const auth = SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined;
  const timeouts = {
    pool: true,
    maxConnections: 3,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    ...(process.platform === 'win32' ? { family: 4 } : {}),
  };

  if (SMTP_SERVICE === 'gmail' || SMTP_HOST === 'smtp.gmail.com') {
    return nodemailer.createTransport({
      service: 'gmail',
      auth,
      ...timeouts,
    });
  }

  const port = Number.isFinite(SMTP_PORT) ? SMTP_PORT : 587;
  const secure = SMTP_SECURE || port === 465;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure,
    requireTLS: !secure && port === 587,
    auth,
    tls: { minVersion: 'TLSv1.2', servername: SMTP_HOST },
    ...timeouts,
  });
}

export const transport = buildTransport();

export function previewUrl(info) {
  try {
    return nodemailer.getTestMessageUrl(info) || null;
  } catch {
    return null;
  }
}
