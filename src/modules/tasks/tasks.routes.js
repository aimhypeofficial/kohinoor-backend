// Tasks for staff: create / edit / cancel / assign, list with filters, full detail.
const router = require('express').Router();
const { db } = require('../../lib/supabase');
const { wrap, fail } = require('../../lib/http');
const { z, UUID } = require('../../lib/validation');
const { phoneKey } = require('../../lib/phone');
const { nowIso, DAY } = require('../../lib/dates');
const { billTotals } = require('../../lib/pdf');
const { auth, staffOnly, isStaff } = require('../../middleware/auth');
const { audit, logEvent } = require('../../services/audit');
const { push } = require('../../services/push');
const { mustBeEmployee } = require('../employees/employees.service');
const { upsertCustomer } = require('../customers/customers.service');
const { BUCKET, getTask, canSee, mustExistAc } = require('./tasks.service');
const { STATUSES, OPEN, CREATE_TASK, EDIT_FIELDS, BILL_FIELDS, BILL_ONLY, LIST_QUERY, TECH_FIELDS } = require('./tasks.schemas');

router.post('/tasks', auth, staffOnly, wrap(async (req, res) => {
  const b = CREATE_TASK.parse(req.body);
  if (!b.customer_email && !phoneKey(b.customer_phone)) throw fail(400, 'Enter the customer phone number (10 digits) or email');
  if (b.assigned_to) await mustBeEmployee(b.assigned_to);
  const customer_ref = b.ac_id
    ? (await mustExistAc(b.ac_id)).customer_id          // repeat job from an AC: the AC decides the customer
    : (await upsertCustomer({ name: b.customer_name, email: b.customer_email, phone: b.customer_phone, address: b.address })).id;
  const { data, error } = await db.from('tasks')
    .insert({ ...b, customer_ref, status: b.assigned_to ? 'assigned' : 'created' }).select().single();
  if (error) throw fail(400, error.message);
  await audit(req.user.id, 'task.create', data.id, { title: data.title });
  logEvent(data.id, 'created', { actor_id: req.user.id });
  if (b.assigned_to) {
    logEvent(data.id, 'assigned', { actor_id: req.user.id, employee_id: b.assigned_to });
    push(b.assigned_to, 'New task assigned', b.title);
  }
  res.status(201).json(data);
}));

router.patch('/tasks/:id', auth, staffOnly, wrap(async (req, res) => {
  const t = await getTask(req.params.id);
  const b = EDIT_FIELDS.merge(BILL_FIELDS).strict().parse(req.body);
  if (t.status === 'cancelled') throw fail(409, 'Cancelled tasks cannot be edited');
  const fe = 'customer_email' in b ? b.customer_email : t.customer_email;
  const fp = 'customer_phone' in b ? b.customer_phone : t.customer_phone;
  if (!fe && !phoneKey(fp)) throw fail(400, 'Keep at least the customer phone number or email');
  if (t.status === 'completed' && Object.keys(b).some((k) => !BILL_ONLY.includes(k)))
    throw fail(409, 'A completed task can only change billing and notes');
  if (b.ac_id) {
    const ac = await mustExistAc(b.ac_id);
    // the AC must belong to this task's customer, otherwise the service history mixes up customers
    if (t.customer_ref && ac.customer_id !== t.customer_ref) throw fail(400, "This AC belongs to a different customer");
  }
  const patch = { ...b, updated_at: nowIso() };
  if ('payment_status' in b) {
    patch.paid_at = b.payment_status === 'paid' ? (t.paid_at || nowIso()) : null;
    if (b.payment_status === 'unpaid') patch.payment_method = null;
  }
  if ('bill_items' in b || 'gst_percent' in b) {
    const tot = billTotals('bill_items' in b ? b.bill_items : t.bill_items, 'gst_percent' in b ? b.gst_percent : t.gst_percent);
    patch.amount = tot.rows.length ? tot.total : null;
    if ('bill_items' in b && b.bill_items) patch.bill_items = tot.rows.map(({ desc, qty, rate }) => ({ desc, qty, rate }));
  }
  const { data, error } = await db.from('tasks').update(patch).eq('id', t.id).select().single();
  if (error) throw fail(400, error.message);
  const fields = Object.keys(b);
  await audit(req.user.id, 'task.update', t.id, { fields });
  logEvent(t.id, 'edited', { actor_id: req.user.id, meta: { fields } });
  if (t.assigned_to && ['assigned', 'accepted', 'in_progress'].includes(t.status) && fields.some((k) => TECH_FIELDS.includes(k)))
    push(t.assigned_to, 'Task updated', data.title);
  res.json(data);
}));

router.post('/tasks/:id/cancel', auth, staffOnly, wrap(async (req, res) => {
  const { reason } = z.object({ reason: z.string().min(3).max(300) }).parse(req.body);
  const t = await getTask(req.params.id);
  const { data, error } = await db.from('tasks')
    .update({ status: 'cancelled', cancel_reason: reason, cancelled_at: nowIso(), updated_at: nowIso() })
    .eq('id', t.id).in('status', OPEN).select().maybeSingle();
  if (error || !data) throw fail(409, 'Only open tasks can be cancelled');
  await db.from('task_otps').delete().eq('task_id', t.id);
  await audit(req.user.id, 'task.cancel', t.id, { reason });
  logEvent(t.id, 'cancelled', { actor_id: req.user.id, employee_id: t.assigned_to, meta: { reason } });
  if (t.assigned_to) push(t.assigned_to, 'Task cancelled', `${t.title} - ${reason}`);
  res.json(data);
}));

router.patch('/tasks/:id/assign', auth, staffOnly, wrap(async (req, res) => {
  const { employee_id } = z.object({ employee_id: z.string().uuid() }).parse(req.body);
  await mustBeEmployee(employee_id);
  const before = await getTask(req.params.id);
  const { data, error } = await db.from('tasks').update({ assigned_to: employee_id, status: 'assigned', reject_reason: null, accepted_at: null, updated_at: nowIso() })
    .eq('id', before.id).in('status', ['created', 'rejected', 'assigned', 'accepted']).select().maybeSingle();
  if (error || !data) throw fail(409, 'Task cannot be assigned in its current state');
  await audit(req.user.id, 'task.assign', data.id, { employee_id });
  if (before.assigned_to && before.assigned_to !== employee_id) {
    logEvent(data.id, 'unassigned', { actor_id: req.user.id, employee_id: before.assigned_to, meta: { reason: 'Given to another technician' } });
    push(before.assigned_to, 'Task reassigned', `${data.title} was given to another technician`);
  }
  logEvent(data.id, 'assigned', { actor_id: req.user.id, employee_id });
  push(employee_id, 'New task assigned', data.title);
  res.json(data);
}));

// list: staff can search + filter; a technician gets only their own tasks
router.get('/tasks', auth, wrap(async (req, res) => {
  const qs = LIST_QUERY.parse(req.query);
  let q = db.from('tasks').select('*').order('created_at', { ascending: false }).limit(qs.limit || 300);
  if (!isStaff(req.user)) {
    q = q.eq('assigned_to', req.user.id);
  } else {
    const statuses = (qs.status || '').split(',').map((x) => x.trim()).filter(Boolean);
    if (statuses.length) q = q.in('status', statuses.filter((x) => STATUSES.includes(x)));
    if (qs.employee === 'none') q = q.is('assigned_to', null);
    else if (qs.employee && UUID.safeParse(qs.employee).success) q = q.eq('assigned_to', qs.employee);
    const col = { created: 'created_at', scheduled: 'scheduled_at', completed: 'completed_at' }[qs.date_by || 'created'];
    if (qs.from) q = q.gte(col, qs.from);
    if (qs.to) q = q.lt(col, qs.to);
    const term = (qs.q || '').replace(/[,()*%\\]/g, ' ').trim();
    if (term) q = q.or(['customer_name', 'title', 'address', 'customer_phone', 'customer_email'].map((c) => `${c}.ilike.%${term}%`).join(','));
  }
  const { data, error } = await q;
  if (error) throw fail(500, error.message);
  let rows = data || [];
  if (!isStaff(req.user)) {      // technician list: hide old cancelled/completed jobs
    const now = Date.now();
    rows = rows.filter((t) => (t.status === 'cancelled' ? now - new Date(t.cancelled_at || t.created_at) < 3 * DAY
      : t.status === 'completed' ? now - new Date(t.completed_at || t.created_at) < 30 * DAY : true));
  }
  res.json(rows);
}));

// full detail: timeline, photos, AC, technician (staff sees everything, technician only their own task)
router.get('/tasks/:id', auth, wrap(async (req, res) => {
  const t = await getTask(req.params.id);
  if (!canSee(req.user, t)) throw fail(403, 'Not your task');
  const [{ data: photos }, ac, tech] = await Promise.all([
    db.from('task_photos').select('*').eq('task_id', t.id).order('created_at'),
    t.ac_id ? db.from('customer_acs').select('*').eq('id', t.ac_id).maybeSingle().then((r) => r.data) : null,
    t.assigned_to ? db.from('profiles').select('id,full_name,phone').eq('id', t.assigned_to).maybeSingle().then((r) => r.data) : null,
  ]);
  let signed = [];
  if (photos?.length) {
    const r = await db.storage.from(BUCKET).createSignedUrls(photos.map((p) => p.path), 3600);
    signed = r.data || [];
  }
  const out = { task: t, ac, technician: tech,
    photos: (photos || []).map((p) => ({ id: p.id, kind: p.kind, created_at: p.created_at, url: signed.find((s) => s.path === p.path)?.signedUrl || null })) };
  if (isStaff(req.user)) {
    const { data: events } = await db.from('task_events').select('*').eq('task_id', t.id).order('created_at');
    const ids = [...new Set((events || []).flatMap((e) => [e.actor_id, e.employee_id]).filter(Boolean))];
    const { data: ppl } = ids.length ? await db.from('profiles').select('id,full_name').in('id', ids) : { data: [] };
    const nm = Object.fromEntries((ppl || []).map((p) => [p.id, p.full_name]));
    out.events = (events || []).map((e) => ({ ...e, actor_name: nm[e.actor_id] || null, employee_name: nm[e.employee_id] || null }));
  }
  res.json(out);
}));

module.exports = router;
