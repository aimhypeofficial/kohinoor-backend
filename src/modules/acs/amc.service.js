// AMC (annual maintenance) logic: next due date and the reminder message.
const BRAND = require('../../config/brand');
const { db } = require('../../lib/supabase');
const { addMonths, istToday, fmtYmd } = require('../../lib/dates');
const { MAIL_READY, sendMail, mailShell, esc } = require('../../services/mail');
const wa = require('../../services/whatsapp');

// next service date = last service (or install date, or today) + interval. An explicit date from the form wins.
function dueDate(a) {
  if (!a.amc_active || !a.amc_interval_months) return null;
  return addMonths(a.last_service_at || a.installed_on || istToday(), a.amc_interval_months);
}

const acName = (a) => [a.brand, a.model].filter(Boolean).join(' ') || a.type || 'AC';

// a = customer_acs row with customer:customers(...) joined. Returns { email, whatsapp }: sent | skipped | failed
async function sendReminder(a) {
  const cu = a.customer;
  const name = acName(a);
  const due = fmtYmd(a.next_service_due);
  const out = { email: 'skipped', whatsapp: 'skipped' };
  if (cu?.email && MAIL_READY) {
    await sendMail(cu.email, `Your AC service is due - ${BRAND.short}`, mailShell(
      `<p>Hi ${esc(cu.name)},</p><p>Your <b>${esc(name)}</b>${a.location_label ? ` (${esc(a.location_label)})` : ''} is due for its regular service on <b>${due}</b>.</p>
       <p>Regular servicing keeps cooling strong and bills low. To book a visit, reply to this email or call <b>${BRAND.phone}</b>.</p>`));
    out.email = 'sent';
  }
  const w = await wa.sendTemplate(cu?.phone, 'reminder', [cu?.name, name, due]).catch((e) => ({ sent: false, error: e.message }));
  out.whatsapp = w.sent ? 'sent' : w.skipped ? 'skipped' : 'failed';
  if (out.email === 'sent' || out.whatsapp === 'sent') await db.from('customer_acs').update({ last_reminded_at: new Date().toISOString() }).eq('id', a.id);
  return out;
}

module.exports = { dueDate, sendReminder };
