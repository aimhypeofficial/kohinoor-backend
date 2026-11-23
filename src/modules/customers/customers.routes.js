// Customers (staff): list/search, create, edit, detail page with ACs and job history.
const router = require('express').Router();
const { db } = require('../../lib/supabase');
const { wrap, fail } = require('../../lib/http');
const { z, uid, searchTerm } = require('../../lib/validation');
const { phoneKey } = require('../../lib/phone');
const { auth, staffOnly } = require('../../middleware/auth');
const { audit } = require('../../services/audit');

const CUSTOMER = z.object({ name: z.string().min(1).max(120), email: z.string().email().nullable().optional(),
  phone: z.string().max(30).nullable().optional(), address: z.string().max(500).nullable().optional(),
  notes: z.string().max(2000).nullable().optional() });
const dupMessage = (e) => (/duplicate|unique/i.test(e.message) ? 'A customer with this email already exists' : e.message);

router.get('/customers', auth, staffOnly, wrap(async (req, res) => {
  const term = searchTerm(req.query.q, 60);
  let q = db.from('customers').select('*, customer_acs(count)').order('created_at', { ascending: false }).limit(200);
  if (term) q = q.or(['name', 'email', 'phone', 'address'].map((f) => `${f}.ilike.%${term}%`).join(','));
  const { data, error } = await q;
  if (error) throw fail(500, error.message);
  res.json((data || []).map(({ customer_acs, ...x }) => ({ ...x, ac_count: customer_acs?.[0]?.count ?? 0 })));
}));

router.post('/customers', auth, staffOnly, wrap(async (req, res) => {
  const b = CUSTOMER.parse(req.body);
  const { data, error } = await db.from('customers').insert({ ...b, email: b.email ? b.email.toLowerCase() : null, phone_key: phoneKey(b.phone) }).select().single();
  if (error) throw fail(400, dupMessage(error));
  await audit(req.user.id, 'customer.create', data.id, { name: data.name });
  res.status(201).json(data);
}));

router.patch('/customers/:id', auth, staffOnly, wrap(async (req, res) => {
  const b = CUSTOMER.partial().strict().parse(req.body);
  if (b.email) b.email = b.email.toLowerCase();
  if ('phone' in b) b.phone_key = phoneKey(b.phone);
  const { data, error } = await db.from('customers').update(b).eq('id', uid(req.params.id)).select().maybeSingle();
  if (error) throw fail(400, dupMessage(error));
  if (!data) throw fail(404, 'Customer not found');
  await audit(req.user.id, 'customer.update', data.id, { fields: Object.keys(b) });
  res.json(data);
}));

// customer page: details + every AC (with how many times it was serviced) + job history
router.get('/customers/:id', auth, staffOnly, wrap(async (req, res) => {
  const id = uid(req.params.id);
  const [{ data: customer }, { data: acs }, { data: tasks }] = await Promise.all([
    db.from('customers').select('*').eq('id', id).maybeSingle(),
    db.from('customer_acs').select('*').eq('customer_id', id).order('created_at'),
    db.from('tasks').select('id,title,status,ac_id,scheduled_at,completed_at,created_at,assigned_to,amount,payment_status,notes')
      .eq('customer_ref', id).order('created_at', { ascending: false }).limit(200),
  ]);
  if (!customer) throw fail(404, 'Customer not found');
  const done = (tasks || []).filter((t) => t.status === 'completed');
  res.json({ customer, tasks: tasks || [], service_count: done.length,
    acs: (acs || []).map((a) => ({ ...a, service_count: done.filter((t) => t.ac_id === a.id).length })) });
}));

module.exports = router;
