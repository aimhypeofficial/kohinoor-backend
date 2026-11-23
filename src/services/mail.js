// Email: Gmail/any SMTP with an App Password (SMTP_USER + SMTP_PASS), or Resend (RESEND_API_KEY).
// MAIL_READY is false when neither is set (dev then prints the OTP in the console).
const env = require('../config/env');
const BRAND = require('../config/brand');
const { fail } = require('../lib/http');

const { MAIL_READY } = env;

const esc = (x) => String(x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// branded HTML frame around every email
function mailShell(inner) {
  const logo = env.LOGO_URL
    ? `<img src="${env.LOGO_URL}" alt="${BRAND.name}" width="300" style="max-width:100%;height:auto;display:block;margin:0 auto" />`
    : `<h2 style="margin:0;color:#14264d">${BRAND.name}</h2>`;
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;border:1px solid #e2e6ea;border-radius:10px;overflow:hidden">
    <div style="background:#fff;padding:16px;text-align:center;border-bottom:4px solid #f7c800">${logo}</div>
    <div style="padding:24px;color:#14264d;font-size:15px;line-height:1.5">${inner}</div>
    <div style="background:#2d6fba;color:#fff;padding:14px 24px;font-size:13px;line-height:1.6">
      <b>${BRAND.since}</b> &middot; ${BRAND.tagline}<br/>Call ${BRAND.phone} &middot; ${BRAND.email}<br/>${BRAND.hours}<br/>${BRAND.address}</div></div>`;
}

// ---------- SMTP (Gmail + App Password) ----------
let transport;
function smtp() {
  if (!transport) {
    const nodemailer = require('nodemailer');   // loaded only when SMTP is used
    transport = nodemailer.createTransport({
      host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    });
  }
  return transport;
}

// Gmail sends only as the signed-in address: keep the display name from MAIL_FROM, use SMTP_USER as the address
function smtpFrom() {
  const name = (env.MAIL_FROM || '').replace(/<[^>]*>/, '').replace(/"/g, '').trim() || BRAND.short;
  return `"${name}" <${env.SMTP_USER}>`;
}

async function sendSmtp(to, subject, html, attachments) {
  try {
    await smtp().sendMail({
      from: smtpFrom(), to, subject, html, replyTo: BRAND.email,
      attachments: (attachments || []).map((a) => ({ filename: a.filename, content: a.content, encoding: 'base64' })),
    });
  } catch (e) {
    console.error('SMTP error:', e.code || '', e.responseCode || '', e.message);
    if (e.code === 'EAUTH' || e.responseCode === 535)
      throw fail(502, 'Email login failed: check SMTP_USER and the Gmail App Password (SMTP_PASS)');
    if (['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'ECONNREFUSED'].includes(e.code))
      throw fail(502, 'Could not reach the email server (SMTP port blocked by the host?), try again');
    throw fail(502, 'Email send failed');
  }
}

async function sendMail(to, subject, html, attachments) {
  if (!to) throw fail(400, 'This customer has no email address');
  if (env.MAIL_PROVIDER === 'smtp') return sendSmtp(to, subject, html, attachments);
  let r;
  try {
    r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM, to, subject, html, reply_to: BRAND.email, ...(attachments ? { attachments } : {}) }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    console.error('Resend unreachable:', e.message);
    throw fail(502, 'Email service did not respond, try again');
  }
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    console.error('Resend error', r.status, detail);
    throw fail(502, r.status === 403 || /domain|verify/i.test(detail)
      ? 'Email send failed: verify kohinoorac.com in Resend, or check MAIL_FROM' : 'Email send failed');
  }
}

module.exports = { MAIL_READY, sendMail, mailShell, esc };
