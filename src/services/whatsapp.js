// WhatsApp Business Cloud API (Meta). Optional: if WHATSAPP_TOKEN / WHATSAPP_PHONE_ID are not set,
// nothing is sent and the caller gets { skipped: true } (the admin screen still has one-tap wa.me links).
//
// Messages that WE start (not replies) must use pre-approved templates. Create these 3 templates
// in Meta Business Manager (see DEPLOY.md for the exact text) and set the names in .env.

const READY = !!process.env.WHATSAPP_TOKEN && !!process.env.WHATSAPP_PHONE_ID
  && !/xxx|YAHAN|PASTE|your-/i.test(process.env.WHATSAPP_TOKEN);

function normalizePhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 10) return `91${d}`;                       // Indian mobile without country code
  if (d.length === 11 && d.startsWith('0')) return `91${d.slice(1)}`;
  if (d.length >= 11 && d.length <= 15) return d;
  return null;
}

const TEMPLATES = {
  accepted: process.env.WA_TEMPLATE_ACCEPTED || 'fs_tech_accepted',     // {{1}} customer {{2}} technician {{3}} technician phone {{4}} service
  completed: process.env.WA_TEMPLATE_COMPLETED || 'fs_work_completed',   // {{1}} customer {{2}} service
  reminder: process.env.WA_TEMPLATE_REMINDER || 'fs_amc_reminder',       // {{1}} customer {{2}} AC {{3}} due date
  otp: process.env.WA_TEMPLATE_OTP || 'fs_otp',                          // {{1}} customer {{2}} 6-digit code
};

const oneLine = (s) => String(s ?? '-').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 200) || '-';

async function sendTemplate(phone, kind, params) {
  if (!READY) return { skipped: true, reason: 'WhatsApp API not configured' };
  const to = normalizePhone(phone);
  if (!to) return { skipped: true, reason: 'No valid phone number' };
  let r;
  try {
    r = await fetch(`https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to, type: 'template',
      template: { name: TEMPLATES[kind], language: { code: process.env.WA_TEMPLATE_LANG || 'en' },
        components: [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: oneLine(p) })) }] },
    }),
    signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    console.error('WhatsApp unreachable:', e.message);
    return { sent: false, error: 'WhatsApp did not respond' };
  }
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    console.error('WhatsApp error', r.status, detail);
    return { sent: false, error: `WhatsApp ${r.status}` };
  }
  return { sent: true };
}

module.exports = { READY, normalizePhone, sendTemplate };
