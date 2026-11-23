const { db } = require('../../lib/supabase');
const { fail } = require('../../lib/http');
const { UUID } = require('../../lib/validation');
const { istToday, addMonths } = require('../../lib/dates');
const { isStaff } = require('../../middleware/auth');
const { logEvent } = require('../../services/audit');
const { push } = require('../../services/push');
const wa = require('../../services/whatsapp');
const { MAIL_READY } = require('../../services/mail');
const { emailReport, REPORT_AUTO } = require('./report.service');

const BUCKET = 'task-photos';

async function getTask(id) {
  if (!UUID.safeParse(id).success) throw fail(400, 'Invalid id');
  const { data } = await db.from('tasks').select('*').eq('id', id).maybeSingle();
  if (!data) throw fail(404, 'Task not found');
  return data;
}

// staff sees every task, a technician only their own
const canSee = (user, t) => isStaff(user) || t.assigned_to === user.id;

async function mustExistAc(acId) {
  const { data: ac } = await db.from('customer_acs').select('customer_id').eq('id', acId).maybeSingle();
  if (!ac) throw fail(404, 'AC not found');
  return ac;
}

// never throws; the result is written to the task timeline
async function notifyCustomerWhatsApp(task, kind, params) {
  try {
    const r = await wa.sendTemplate(task.customer_phone, kind, params);
    if (r.sent) logEvent(task.id, 'whatsapp_sent', { meta: { kind } });
    else if (r.sent === false) logEvent(task.id, 'whatsapp_failed', { meta: { kind, error: r.error } });
  } catch (e) { console.error('whatsapp failed:', e.message); }
}

// after the customer's OTP: update the AC's service dates, notify, email the report
async function afterComplete(t, tech) {
  logEvent(t.id, 'completed', { employee_id: tech.id, actor_id: tech.id });
  if (t.ac_id) {
    const { data: ac } = await db.from('customer_acs').select('*').eq('id', t.ac_id).maybeSingle();
    if (ac) {
      const today = istToday();
      await db.from('customer_acs').update({ last_service_at: today, last_reminded_at: null,
        next_service_due: ac.amc_active && ac.amc_interval_months ? addMonths(today, ac.amc_interval_months) : null }).eq('id', ac.id);
    }
  }
  push(t.customer_id, 'Your service is complete', t.title);
  // run in parallel so completion stays fast on serverless hosting
  await Promise.allSettled([
    notifyCustomerWhatsApp(t, 'completed', [t.customer_name, t.title]),
    REPORT_AUTO && MAIL_READY && t.customer_email ? emailReport(t).catch((e) => {
      console.error('report email failed:', e.message);
      logEvent(t.id, 'report_failed', { meta: { error: String(e.message || e).slice(0, 200) } });   // shows in the task History
    }) : null,
  ]);
}

module.exports = { BUCKET, getTask, canSee, mustExistAc, notifyCustomerWhatsApp, afterComplete };
