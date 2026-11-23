// Technician side of a task: accept -> start -> notes / payment -> OTP -> completed.
const router = require('express').Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const env = require('../../config/env');
const BRAND = require('../../config/brand');
const { db } = require('../../lib/supabase');
const { wrap, fail } = require('../../lib/http');
const { z } = require('../../lib/validation');
const { nowIso } = require('../../lib/dates');
const { auth, isStaff } = require('../../middleware/auth');
const { audit, logEvent } = require('../../services/audit');
const { push } = require('../../services/push');
const { MAIL_READY, sendMail, mailShell, esc } = require('../../services/mail');
const wa = require('../../services/whatsapp');
const { getTask, notifyCustomerWhatsApp, afterComplete } = require('./tasks.service');
const { PAY_METHOD } = require('./tasks.schemas');

const OTP_TTL = 10 * 60_000;
const OTP_RESEND_WAIT = 30_000;
const OTP_MAX_ATTEMPTS = 5;

// ---------- state machine ----------
async function transition(req, res, from, to, extra = {}) {
  const { data, error } = await db.from('tasks').update({ status: to, updated_at: nowIso(), ...extra })
    .eq('id', req.params.id).eq('assigned_to', req.user.id).in('status', from).select().single();
  if (error || !data) throw fail(409, `Task not in ${from.join('/')} state`);
  logEvent(data.id, to, { employee_id: req.user.id, actor_id: req.user.id, meta: extra.reject_reason ? { reason: extra.reject_reason } : null });
  if (to === 'accepted') {
    push(data.customer_id, 'Technician accepted your request', data.title);
    await notifyCustomerWhatsApp(data, 'accepted', [data.customer_name, req.user.full_name, req.user.phone || BRAND.phone, data.title]);
  }
  if (to === 'in_progress') push(data.customer_id, 'Work has started', data.title);
  res.json(data);
}

router.post('/tasks/:id/accept', auth, wrap((q, s) => transition(q, s, ['assigned'], 'accepted', { accepted_at: nowIso() })));
router.post('/tasks/:id/start', auth, wrap((q, s) => transition(q, s, ['accepted'], 'in_progress', { started_at: nowIso() })));
router.post('/tasks/:id/reject', auth, wrap(async (req, res) => {
  const { reason } = z.object({ reason: z.string().min(3).max(300) }).parse(req.body);
  await transition(req, res, ['assigned'], 'rejected', { reject_reason: reason, assigned_to: null });
}));

router.post('/tasks/:id/notes', auth, wrap(async (req, res) => {
  const { notes } = z.object({ notes: z.string().max(2000) }).parse(req.body);
  const { data, error } = await db.from('tasks').update({ notes, updated_at: nowIso() })
    .eq('id', req.params.id).eq('assigned_to', req.user.id).in('status', ['accepted', 'in_progress']).select().maybeSingle();
  if (error || !data) throw fail(409, 'Notes can be saved only while the task is accepted or in progress');
  res.json(data);
}));

// ---------- payment received (technician in the field, or staff) ----------
router.post('/tasks/:id/payment', auth, wrap(async (req, res) => {
  const b = z.object({ method: PAY_METHOD, amount: z.number().positive().max(10_000_000).optional() }).parse(req.body);
  const t = await getTask(req.params.id);
  const mine = t.assigned_to === req.user.id && ['in_progress', 'completed'].includes(t.status);
  if (!mine && !(isStaff(req.user) && t.status !== 'cancelled')) throw fail(403, 'You cannot record payment for this task');
  if (t.payment_status === 'paid') throw fail(409, 'Payment is already recorded');
  const hasBill = Array.isArray(t.bill_items) && t.bill_items.length > 0;
  if (!hasBill && t.amount == null && !b.amount) throw fail(400, 'Enter the amount received');
  const now = nowIso();
  const patch = { payment_status: 'paid', payment_method: b.method, paid_at: now, updated_at: now };
  if (!hasBill && b.amount) patch.amount = b.amount;
  const { data, error } = await db.from('tasks').update(patch).eq('id', t.id).select().single();
  if (error) throw fail(400, error.message);
  await audit(req.user.id, 'task.payment', t.id, { method: b.method });
  logEvent(t.id, 'payment', { actor_id: req.user.id, employee_id: t.assigned_to, meta: { method: b.method } });
  res.json(data);
}));

// ---------- OTP completion (code goes to the CUSTOMER: WhatsApp first, then email) ----------
async function myTaskInProgress(req, columns = '*') {
  const { data: t } = await db.from('tasks').select(columns)
    .eq('id', req.params.id).eq('assigned_to', req.user.id).eq('status', 'in_progress').maybeSingle();
  if (!t) throw fail(409, 'Task must be in progress');
  return t;
}

router.post('/tasks/:id/request-otp', auth, wrap(async (req, res) => {
  const t = await myTaskInProgress(req);
  if (!t.customer_email && !wa.normalizePhone(t.customer_phone)) throw fail(400, 'Ask dispatch to add the customer phone number or email first');
  const canWa = wa.READY && !!wa.normalizePhone(t.customer_phone);
  const canMail = MAIL_READY && !!t.customer_email;
  const dev = !canWa && !canMail && !env.isProd;   // local testing: the code is printed in the backend console
  if (!canWa && !canMail && !dev) throw fail(503, 'OTP cannot be sent: WhatsApp / email is not set up on the server');
  const { data: old } = await db.from('task_otps').select('expires_at').eq('task_id', t.id).maybeSingle();
  if (old && new Date(old.expires_at).getTime() - Date.now() > OTP_TTL - OTP_RESEND_WAIT)
    throw fail(429, 'Wait 30 seconds before requesting another OTP');
  const otp = String(crypto.randomInt(100000, 1000000));
  await db.from('task_otps').upsert({ task_id: t.id, otp_hash: await bcrypt.hash(otp, 8),
    expires_at: new Date(Date.now() + OTP_TTL).toISOString(), attempts: 0 });
  const dropOtp = () => db.from('task_otps').delete().eq('task_id', t.id);

  let channel = null;
  if (canWa) {
    try { const r = await wa.sendTemplate(t.customer_phone, 'otp', [t.customer_name, otp]); if (r.sent) channel = 'whatsapp'; }
    catch (e) { console.error('otp whatsapp failed:', e.message); }
  }
  if (!channel && canMail) {
    try {
      await sendMail(t.customer_email, `Your service completion code - ${BRAND.short}`, mailShell(
        `<p>Hi ${esc(t.customer_name)},</p><p>Your service completion code is</p>
         <p style="font-size:30px;letter-spacing:8px;font-weight:bold;margin:12px 0">${otp}</p>
         <p>Share this code with our technician <b>only after the work is done</b>. It is valid for 10 minutes.
         If you did not expect this email, please ignore it or call us.</p>`));
      channel = 'email';
    } catch (e) { await dropOtp(); throw e; }
  }
  if (!channel) {
    if (dev) {
      console.log(`\n[DEV OTP] task "${t.title}" -> ${t.customer_email || t.customer_phone}: ${otp}\n`);
      return res.json({ sent: true, dev: true, channel: 'console' });
    }
    await dropOtp();
    throw fail(502, 'Could not send the OTP. Check the WhatsApp template and the customer phone number.');
  }
  res.json({ sent: true, channel });
}));

router.post('/tasks/:id/verify-otp', auth, wrap(async (req, res) => {
  const { otp } = z.object({ otp: z.string().length(6) }).parse(req.body);
  const t = await myTaskInProgress(req, 'id');
  const { data: rec } = await db.from('task_otps').select('*').eq('task_id', t.id).maybeSingle();
  if (!rec || new Date(rec.expires_at) < new Date()) throw fail(400, 'OTP expired');
  if (rec.attempts >= OTP_MAX_ATTEMPTS) throw fail(429, 'Too many attempts, request a new OTP');
  // Use up one attempt BEFORE checking the code. The update only matches while attempts still has the
  // value we read, so parallel requests cannot all pass with the same count and get unlimited guesses.
  const { data: claimed } = await db.from('task_otps').update({ attempts: rec.attempts + 1 })
    .eq('task_id', t.id).eq('attempts', rec.attempts).select('task_id');
  if (!claimed || !claimed.length) throw fail(429, 'Please wait a moment and try again');
  if (!(await bcrypt.compare(otp, rec.otp_hash))) throw fail(400, 'Wrong OTP');
  // the delete doubles as a lock: only one request can remove the row and complete the task
  const { data: used } = await db.from('task_otps').delete().eq('task_id', t.id).select('task_id');
  if (!used || !used.length) throw fail(400, 'OTP expired');
  const { data, error } = await db.from('tasks').update({ status: 'completed', completed_at: nowIso(), updated_at: nowIso() })
    .eq('id', t.id).eq('status', 'in_progress').select().single();
  if (error || !data) throw fail(409, 'Task must be in progress');
  await afterComplete(data, req.user).catch((e) => console.error('after-complete failed:', e.message));   // never blocks completion
  res.json(data);
}));

module.exports = router;
