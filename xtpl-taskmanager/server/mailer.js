import { FROM, previewUrl, smtpConfigured, transport } from './smtp.js';

// If SMTP is configured, OTP codes are e-mailed. Otherwise they are printed in the
// server console (development mode) so the app works with zero setup.
export const mailEnabled = smtpConfigured && Boolean(transport);

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function purposeCopy(purpose) {
  if (purpose === 'signup') return 'verify your new XTPL TaskManager account';
  if (purpose === 'reset') return 'reset your XTPL TaskManager password';
  return 'sign in to XTPL TaskManager';
}

export async function sendOtpMail({ to, name, code, purpose, minutes }) {
  const what = purposeCopy(purpose);
  if (!transport) {
    console.log(`\n[OTP] ${to} (${purpose}) code: ${code}  (valid ${minutes} min, console mode: no SMTP configured)\n`);
    return { channel: 'console' };
  }
  try {
    const info = await transport.sendMail({
      from: FROM,
      to,
      subject: purpose === 'reset' ? `Reset your XTPL TaskManager password: ${code}` : `Your XTPL TaskManager code: ${code}`,
      text: `Hi ${name || 'there'},\n\nUse this one-time code to ${what}:\n\n    ${code}\n\nIt expires in ${minutes} minutes. If you did not request it, ignore this email.\n\nXTPL TaskManager`,
      html: `<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px;border:1px solid #e3e8f0;border-radius:12px">
        <h2 style="margin:0 0 8px;color:#1f2f6b">XTPL TaskManager</h2>
        <p>Hi ${esc(name) || 'there'}, use this one-time code to ${what}:</p>
        <p style="font-size:34px;letter-spacing:10px;font-weight:700;margin:18px 0;color:#1f2f6b">${code}</p>
        <p style="color:#5b6577;font-size:13px">It expires in ${minutes} minutes. If you did not request it, ignore this email.</p></div>`,
    });
    const preview = previewUrl(info);
    console.log(`[OTP] emailed ${to} (${purpose})${preview ? ` — preview: ${preview}` : ''}`);
    return { channel: 'email', preview };
  } catch (err) {
    console.error(`[OTP] SMTP send failed for ${to}: ${err.message}`);
    // Never write one-time codes to production logs; tell the caller the email did not go out instead.
    if (process.env.NODE_ENV === 'production') return { channel: 'failed' };
    console.log(`\n[OTP] ${to} (${purpose}) code: ${code}  (valid ${minutes} min, SMTP fallback to console)\n`);
    return { channel: 'console' };
  }
}
