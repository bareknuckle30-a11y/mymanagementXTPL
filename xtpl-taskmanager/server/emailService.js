import { FROM, previewUrl, SMTP_HOST, SMTP_PORT, SMTP_SECURE, smtpConfigured, transport } from './smtp.js';

// General-purpose SMTP email service (task notifications, welcome mail, test mail).
// Uses the same SMTP transport as the OTP mailer (server/mailer.js).
//
// Safe by design:
//   * No SMTP_HOST  -> every call is a quiet no-op (logged once), the app works as before.
//   * Sending is fire-and-forget (notify*) and never throws, so an SMTP outage can never
//     break a task, sign-in, or upload request.
const { EMAIL_NOTIFICATIONS, APP_URL, APP_NAME } = process.env;

const NAME = APP_NAME || 'XTPL TaskManager';
const BASE_URL = (APP_URL || `http://localhost:${process.env.PORT || 5050}`).replace(/\/+$/, '');

export { smtpConfigured };
export const notificationsEnabled = smtpConfigured
  && String(EMAIL_NOTIFICATIONS ?? 'true').toLowerCase() !== 'false';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function layout({ heading, intro, rows = [], note, cta }) {
  const table = rows.length
    ? `<table style="width:100%;border-collapse:collapse;margin:14px 0">${rows
        .filter(r => r[1])
        .map(([k, v]) => `<tr><td style="padding:6px 10px 6px 0;color:#5b6577;font-size:13px;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;font-size:14px;color:#1b2333">${esc(v)}</td></tr>`)
        .join('')}</table>`
    : '';
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px;border:1px solid #e3e8f0;border-radius:12px">
    <h2 style="margin:0 0 10px;color:#1f2f6b">${esc(NAME)}</h2>
    <h3 style="margin:0 0 8px;color:#1b2333">${esc(heading)}</h3>
    <p style="margin:0 0 6px;color:#1b2333;font-size:14px">${esc(intro)}</p>
    ${table}
    ${note ? `<p style="background:#f4f6fb;border-radius:8px;padding:10px 12px;font-size:13px;color:#1b2333;margin:12px 0">${esc(note)}</p>` : ''}
    ${cta ? `<p style="margin:18px 0 4px"><a href="${esc(BASE_URL)}" style="background:#1f2f6b;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px">${esc(cta)}</a></p>` : ''}
    <p style="color:#8a93a5;font-size:12px;margin-top:18px">Automated message from ${esc(NAME)}.</p></div>`;
  const text = [heading, '', intro, ...rows.filter(r => r[1]).map(([k, v]) => `${k}: ${v}`), note ? `\n${note}` : '', cta ? `\n${cta}: ${BASE_URL}` : '', `\n${NAME}`]
    .join('\n');
  return { html, text };
}

/** Low-level send. Resolves {sent, reason?, messageId?}; never throws. */
export async function sendEmail({ to, subject, text, html, replyTo }) {
  const recipients = [].concat(to || []).filter(Boolean);
  if (!recipients.length) return { sent: false, reason: 'no recipient' };
  if (!transport) return { sent: false, reason: 'SMTP not configured' };
  try {
    const info = await transport.sendMail({ from: FROM, to: recipients, subject, text, html, replyTo });
    const preview = previewUrl(info);
    if (preview) console.log(`[email] preview "${subject}": ${preview}`);
    return { sent: true, messageId: info.messageId, preview };
  } catch (err) {
    console.error(`[email] failed to send "${subject}" to ${recipients.join(', ')}: ${err.message}`);
    return { sent: false, reason: err.message };
  }
}

/** Fire-and-forget wrapper used by the API hooks. */
function fire(label, build) {
  if (!notificationsEnabled) return;
  Promise.resolve()
    .then(build)
    .then(r => { if (r && !r.sent && r.reason !== 'no recipient') console.warn(`[email] ${label} not sent: ${r.reason}`); })
    .catch(err => console.error(`[email] ${label} error: ${err.message}`));
}

const when = d => (d ? String(d) : '');

export function notifyTaskAssigned({ task, assignee, assignedBy }) {
  fire('task-assigned', () => {
    if (!assignee?.email) return { sent: false, reason: 'no recipient' };
    const { html, text } = layout({
      heading: 'New task assigned to you',
      intro: `Hi ${assignee.name || 'there'}, ${assignedBy?.name ? `${assignedBy.name} has` : 'an admin has'} assigned you a task.`,
      rows: [['Task', task.title], ['Project', task.project], ['Priority', task.priority], ['Start', when(task.startDate)], ['Due', when(task.dueDate)]],
      note: task.description,
      cta: 'Open TaskManager',
    });
    return sendEmail({ to: assignee.email, subject: `New task: ${task.title}`, text, html });
  });
}

export function notifyWorkSubmitted({ task, employee, admins }) {
  fire('work-submitted', () => {
    const to = (admins || []).map(a => a.email).filter(Boolean);
    const { html, text } = layout({
      heading: 'Work submitted for review',
      intro: `${employee?.name || 'An employee'} submitted work on a task.`,
      rows: [['Task', task.title], ['Project', task.project], ['Files', String((task.files || []).length)]],
      note: task.submissionNote,
      cta: 'Review in Inbox',
    });
    return sendEmail({ to, subject: `Submitted: ${task.title}`, text, html });
  });
}

export function notifyTaskApproved({ task, assignee }) {
  fire('task-approved', () => {
    if (!assignee?.email) return { sent: false, reason: 'no recipient' };
    const { html, text } = layout({
      heading: 'Your work was approved',
      intro: `Hi ${assignee.name || 'there'}, your submission has been approved.`,
      rows: [['Task', task.title], ['Project', task.project]],
      cta: 'Open TaskManager',
    });
    return sendEmail({ to: assignee.email, subject: `Approved: ${task.title}`, text, html });
  });
}

export function notifyTaskRejected({ task, assignee }) {
  fire('task-rejected', () => {
    if (!assignee?.email) return { sent: false, reason: 'no recipient' };
    const { html, text } = layout({
      heading: 'Changes requested on your submission',
      intro: `Hi ${assignee.name || 'there'}, your submission was sent back for revision.`,
      rows: [['Task', task.title], ['Project', task.project]],
      note: task.reviewNote,
      cta: 'Revise and resubmit',
    });
    return sendEmail({ to: assignee.email, subject: `Sent back: ${task.title}`, text, html });
  });
}

const TZ = process.env.APP_TIMEZONE || 'Asia/Kolkata';
const clock = iso => { try { return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: TZ }); } catch { return ''; } };

/** Chat messages the person missed while away (see chatEmail.js for when this is sent). */
export function notifyChatDigest({ user, messages }) {
  fire('chat-digest', () => {
    if (!user?.email || !messages?.length) return { sent: false, reason: 'no recipient' };
    const shown = messages.slice(-10);
    const hidden = messages.length - shown.length;
    const senders = [...new Set(messages.map(m => m.name).filter(Boolean))];
    const { html, text } = layout({
      heading: messages.length === 1 ? 'New message in team chat' : `${messages.length} new messages in team chat`,
      intro: `Hi ${user.name || 'there'}, you were away when ${senders.length === 1 ? senders[0] : 'your team'} wrote in the chat.`,
      rows: shown.map(m => [`${m.name || 'Someone'} · ${clock(m.createdAt)}`, String(m.text || '').slice(0, 400)]),
      note: hidden > 0 ? `...and ${hidden} earlier message${hidden === 1 ? '' : 's'}.` : 'You can turn these emails off in Settings.',
      cta: 'Open chat',
    });
    return sendEmail({ to: user.email, subject: messages.length === 1 ? `${messages[0].name || 'Team chat'}: new message` : `${messages.length} new chat messages`, text, html });
  });
}

export function notifyWelcome({ user }) {
  fire('welcome', () => {
    const { html, text } = layout({
      heading: `Welcome to ${NAME}`,
      intro: `Hi ${user.name || 'there'}, an account was created for you as ${user.role}. Your admin will share your password separately.`,
      rows: [['Email', user.email], ['Role', user.role]],
      cta: 'Sign in',
    });
    return sendEmail({ to: user.email, subject: `Your ${NAME} account`, text, html });
  });
}

/** Admin diagnostics: checks the SMTP login/connection without sending anything. */
export async function verifyConnection() {
  if (!transport) return { configured: false, ok: false, message: 'SMTP_HOST is not set (console mode)' };
  try {
    await transport.verify();
    return { configured: true, ok: true, message: 'SMTP connection and login succeeded' };
  } catch (err) {
    return { configured: true, ok: false, message: err.message };
  }
}

export function emailStatus() {
  return {
    configured: smtpConfigured,
    notifications: notificationsEnabled,
    host: SMTP_HOST || null,
    port: SMTP_HOST ? Number(SMTP_PORT || 587) : null,
    secure: String(SMTP_SECURE || '').toLowerCase() === 'true',
    from: FROM,
  };
}

export async function sendTestEmail(to) {
  const { html, text } = layout({
    heading: 'SMTP test',
    intro: 'If you can read this, your SMTP settings work and TaskManager can send email.',
    rows: [['Server', `${SMTP_HOST || 'smtp.gmail.com'}:${Number(SMTP_PORT || 587)}`], ['Sent at', new Date().toISOString()]],
  });
  return sendEmail({ to, subject: `${NAME}: SMTP test`, text, html });
}
