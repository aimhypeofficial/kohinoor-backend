// Customer portal (mobile app, role = customer): sign up, book, cancel, track.
const router = require('express').Router();
const { db } = require('../../lib/supabase');
const { wrap, fail } = require('../../lib/http');
const { z, uid, DATE } = require('../../lib/validation');
const { nowIso } = require('../../lib/dates');
const { authAny, customerOnly } = require('../../middleware/auth');
const { logEvent } = require('../../services/audit');
const { push } = require('../../services/push');
const { upsertCustomer } = require('../customers/customers.service');
const { OPEN } = require('../tasks/tasks.schemas');

const MAX_OPEN_REQUESTS = 5;

router.post('/customer/register', authAny, wrap(async (req, res) => {
  if (req.profile) return res.json(req.profile);
  const b = z.object({ full_name: z.string().min(2), phone: z.string().optional() }).parse(req.body);
  const { data, error } = await db.from('profiles')
    .insert({ id: req.authUser.id, full_name: b.full_name, phone: b.phone, role: 'customer', must_change_password: false })
    .select().single();
  if (error) throw fail(400, error.message);
  res.status(201).json(data);
}));

router.post('/customer/tasks', authAny, customerOnly, wrap(async (req, res) => {
  const b = z.object({ title: z.string().min(3), description: z.string().optional(),
    address: z.string().min(5), scheduled_at: DATE.optional() }).parse(req.body);
  const { count: openCount } = await db.from('tasks').select('id', { count: 'exact', head: true })
    .eq('customer_id', req.profile.id).in('status', OPEN);
  if ((openCount || 0) >= MAX_OPEN_REQUESTS) throw fail(429, `You already have ${MAX_OPEN_REQUESTS} open requests. Please wait for them or call us.`);
  const cust = await upsertCustomer({ name: req.profile.full_name, email: req.authUser.email, phone: req.profile.phone, address: b.address });
  const { data, error } = await db.from('tasks').insert({ ...b, customer_id: req.profile.id, customer_ref: cust.id,
    customer_name: req.profile.full_name, customer_email: req.authUser.email,
    customer_phone: req.profile.phone, status: 'created' }).select().single();
  if (error) throw fail(400, error.message);
  logEvent(data.id, 'created', { actor_id: req.profile.id, meta: { by: 'customer' } });
  res.status(201).json(data);
}));

router.post('/customer/tasks/:id/cancel', authAny, customerOnly, wrap(async (req, res) => {
  const reason = 'Cancelled by customer';
  const { data, error } = await db.from('tasks')
    .update({ status: 'cancelled', cancel_reason: reason, cancelled_at: nowIso(), updated_at: nowIso() })
    .eq('id', uid(req.params.id)).eq('customer_id', req.profile.id).in('status', ['created', 'assigned']).select().maybeSingle();
  if (error || !data) throw fail(409, 'This request can no longer be cancelled here. Please call us.');
  logEvent(data.id, 'cancelled', { actor_id: req.profile.id, employee_id: data.assigned_to, meta: { reason } });
  if (data.assigned_to) push(data.assigned_to, 'Task cancelled', `${data.title} - cancelled by customer`);
  res.json(data);
}));

// technician location is exposed ONLY while the task is accepted / in progress
router.get('/customer/tasks', authAny, customerOnly, wrap(async (req, res) => {
  const { data } = await db.from('tasks')
    .select('*, tech:profiles!tasks_assigned_to_fkey(full_name, phone, last_locations(*))')
    .eq('customer_id', req.profile.id).order('created_at', { ascending: false });
  // eslint-disable-next-line no-unused-vars
  res.json((data || []).map(({ tech, reject_reason, notes, bill_items, ...t }) => {
    const ll = Array.isArray(tech?.last_locations) ? tech.last_locations[0] : tech?.last_locations;
    const live = ['accepted', 'in_progress'].includes(t.status) && ll;
    return { ...t, technician: tech ? { full_name: tech.full_name, phone: tech.phone } : null,
      technician_location: live ? { lat: ll.lat, lng: ll.lng, recorded_at: ll.recorded_at } : null };
  }));
}));

module.exports = router;
