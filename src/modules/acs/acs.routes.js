// A customer's ACs, the AMC board, reminders and one-click "book service".
const router = require('express').Router();
const env = require('../../config/env');
const { db } = require('../../lib/supabase');
const { wrap, fail } = require('../../lib/http');
const { z, uid, YMD, DATE } = require('../../lib/validation');
const { phoneKey } = require('../../lib/phone');
const { istToday } = require('../../lib/dates');
const { auth, adminOnly, staffOnly } = require('../../middleware/auth');
const { audit, logEvent } = require('../../services/audit');
const { push } = require('../../services/push');
const { MAIL_READY } = require('../../services/mail');
const wa = require('../../services/whatsapp');
const { mustBeEmployee } = require('../employees/employees.service');
const { ACTIVE } = require('../tasks/tasks.schemas');
const { dueDate, sendReminder } = require('./amc.service');

const AC = z.object({ type: z.string().max(60).nullable(), brand: z.string().max(60).nullable(), model: z.string().max(80).nullable(),
  location_label: z.string().max(80).nullable(), installed_on: YMD.nullable(), last_service_at: YMD.nullable(),
  amc_interval_months: z.union([z.literal(3), z.literal(4), z.literal(6), z.literal(12)]).nullable(),
  amc_active: z.boolean(), next_service_due: YMD.nullable(), notes: z.string().max(1000).nullable() }).partial();

router.post('/customers/:id/acs', auth, staffOnly, wrap(async (req, res) => {
  const b = AC.strict().parse(req.body);
  const { data: cu } = await db.from('customers').select('id').eq('id', uid(req.params.id)).maybeSingle();
  if (!cu) throw fail(404, 'Customer not found');
  const row = { ...b, customer_id: cu.id };
  if (b.amc_active && b.amc_interval_months && !b.next_service_due) row.next_service_due = dueDate(b);
  if (!b.amc_active) row.next_service_due = null;
  const { data, error } = await db.from('customer_acs').insert(row).select().single();
  if (error) throw fail(400, error.message);
  await audit(req.user.id, 'ac.create', data.id, { customer_id: cu.id });
  res.status(201).json(data);
}));

router.patch('/acs/:id', auth, staffOnly, wrap(async (req, res) => {
  const b = AC.strict().parse(req.body);
  const { data: old } = await db.from('customer_acs').select('*').eq('id', uid(req.params.id)).maybeSingle();
  if (!old) throw fail(404, 'AC not found');
  const merged = { ...old, ...b };
  const patch = { ...b };
  const same = (x, y) => (x ?? null) === (y ?? null);
  const schedule = ['amc_active', 'amc_interval_months', 'last_service_at', 'installed_on'].some((k) => k in b && !same(b[k], old[k]));
  const dueChanged = 'next_service_due' in b && !same(b.next_service_due, old.next_service_due);
  if (!merged.amc_active) patch.next_service_due = null;
  else if (schedule && !('next_service_due' in b)) { patch.next_service_due = dueDate(merged); patch.last_reminded_at = null; }
  else if (dueChanged) patch.last_reminded_at = null;
  const { data, error } = await db.from('customer_acs').update(patch).eq('id', old.id).select().single();
  if (error) throw fail(400, error.message);
  await audit(req.user.id, 'ac.update', old.id, { fields: Object.keys(b) });
  res.json(data);
}));

router.delete('/acs/:id', auth, adminOnly, wrap(async (req, res) => {
  const id = uid(req.params.id);
  await db.from('customer_acs').delete().eq('id', id);
  await audit(req.user.id, 'ac.delete', id);
  res.json({ ok: true });
}));

// AMC board: ACs that are due soon or overdue
router.get('/amc', auth, staffOnly, wrap(async (req, res) => {
  const days = Math.min(365, Math.max(0, parseInt(req.query.days, 10) || 30));
  const { data, error } = await db.from('customer_acs').select('*, customer:customers(id,name,email,phone,address)')
    .eq('amc_active', true).not('next_service_due', 'is', null).lte('next_service_due', istToday(days))
    .order('next_service_due').limit(500);
  if (error) throw fail(500, error.message);
  const ids = (data || []).map((a) => a.id);
  const { data: open } = ids.length ? await db.from('tasks').select('ac_id').in('ac_id', ids).in('status', ACTIVE) : { data: [] };
  const busy = new Set((open || []).map((t) => t.ac_id));
  const today = istToday();
  res.json((data || []).map((a) => ({ ...a, overdue: a.next_service_due < today, has_open_task: busy.has(a.id) })));
}));

router.post('/acs/:id/remind', auth, staffOnly, wrap(async (req, res) => {
  const { data: a } = await db.from('customer_acs').select('*, customer:customers(id,name,email,phone)').eq('id', uid(req.params.id)).maybeSingle();
  if (!a) throw fail(404, 'AC not found');
  if (!MAIL_READY && env.isProd && !wa.READY) throw fail(503, 'Neither email nor WhatsApp is configured on the server');
  const r = await sendReminder(a);
  await audit(req.user.id, 'ac.remind', a.id, r);
  res.json(r);
}));

// "Repeat kaam": one click from the AMC board / customer page creates the task
router.post('/acs/:id/book', auth, staffOnly, wrap(async (req, res) => {
  const b = z.object({ scheduled_at: DATE.optional(), assigned_to: z.string().uuid().optional(),
    title: z.string().min(2).max(200).optional() }).parse(req.body || {});
  const { data: a } = await db.from('customer_acs').select('*, customer:customers(*)').eq('id', uid(req.params.id)).maybeSingle();
  if (!a) throw fail(404, 'AC not found');
  const cu = a.customer;
  if (!cu.email && !phoneKey(cu.phone)) throw fail(400, 'Add the customer phone number or email first (the completion code goes there)');
  if (b.assigned_to) await mustBeEmployee(b.assigned_to);
  const { data, error } = await db.from('tasks').insert({
    title: b.title || `${a.type || 'AC'} - routine service`, customer_name: cu.name, customer_email: cu.email || null,
    customer_phone: cu.phone, address: cu.address || 'Address not saved - please confirm', customer_ref: cu.id, ac_id: a.id,
    description: [a.brand, a.model, a.location_label].filter(Boolean).join(' / ') || null,
    scheduled_at: b.scheduled_at, assigned_to: b.assigned_to, status: b.assigned_to ? 'assigned' : 'created' }).select().single();
  if (error) throw fail(400, error.message);
  await audit(req.user.id, 'task.create', data.id, { from_ac: a.id });
  logEvent(data.id, 'created', { actor_id: req.user.id, meta: { from_ac: a.id } });
  if (b.assigned_to) {
    logEvent(data.id, 'assigned', { actor_id: req.user.id, employee_id: b.assigned_to });
    push(b.assigned_to, 'New task assigned', data.title);
  }
  res.status(201).json(data);
}));

module.exports = router;
