// Admins + dispatchers, and password resets for any staff member or technician.
const router = require('express').Router();
const { db } = require('../../lib/supabase');
const { wrap, fail } = require('../../lib/http');
const { z, uid } = require('../../lib/validation');
const { auth, adminOnly, STAFF } = require('../../middleware/auth');
const { audit } = require('../../services/audit');
const { setBan, createUser } = require('../employees/employees.service');

async function mustBeStaff(id) {
  uid(id);
  const { data } = await db.from('profiles').select('id,role,status').eq('id', id).maybeSingle();
  if (!data || !STAFF.includes(data.role)) throw fail(404, 'Staff member not found');
  return data;
}
const notSelf = (req) => { if (req.params.id === req.user.id) throw fail(400, 'You cannot do this to your own account'); };

router.get('/staff', auth, adminOnly, wrap(async (_req, res) => {
  const { data, error } = await db.from('profiles').select('id,full_name,phone,role,status,created_at')
    .in('role', STAFF).order('created_at');
  if (error) throw fail(500, error.message);
  const out = await Promise.all((data || []).map(async (p) => {
    const { data: u } = await db.auth.admin.getUserById(p.id);
    return { ...p, email: u?.user?.email || null };
  }));
  res.json(out);
}));

router.post('/staff', auth, adminOnly, wrap(async (req, res) => {
  const b = z.object({ email: z.string().email(), password: z.string().min(8), full_name: z.string().min(2).max(120),
    phone: z.string().max(30).optional(), role: z.enum(STAFF) }).parse(req.body);
  const id = await createUser({ email: b.email, password: b.password,
    profile: { full_name: b.full_name, phone: b.phone, role: b.role, must_change_password: true } });
  await audit(req.user.id, 'staff.create', id, { role: b.role });
  res.status(201).json({ id });
}));

router.patch('/staff/:id/role', auth, adminOnly, wrap(async (req, res) => {
  const { role } = z.object({ role: z.enum(STAFF) }).parse(req.body);
  notSelf(req); await mustBeStaff(req.params.id);
  await db.from('profiles').update({ role }).eq('id', req.params.id);
  await audit(req.user.id, 'staff.role', req.params.id, { role });
  res.json({ ok: true });
}));

for (const [path, ban] of [['ban', true], ['unban', false]]) {
  router.patch(`/staff/:id/${path}`, auth, adminOnly, wrap(async (req, res) => {
    notSelf(req); await mustBeStaff(req.params.id);
    await setBan(req.params.id, ban);
    await audit(req.user.id, ban ? 'staff.ban' : 'staff.unban', req.params.id);
    res.json({ ok: true });
  }));
}

// admin sets a new temporary password for an employee / staff member who forgot theirs
router.post('/users/:id/reset-password', auth, adminOnly, wrap(async (req, res) => {
  const { password } = z.object({ password: z.string().min(8).max(72) }).parse(req.body);
  const id = uid(req.params.id);
  if (id === req.user.id) throw fail(400, 'Use "Change password" for your own account');
  const { data: p } = await db.from('profiles').select('id,role,status').eq('id', id).maybeSingle();
  if (!p || !['employee', ...STAFF].includes(p.role) || p.status === 'deleted') throw fail(404, 'User not found');
  const { error } = await db.auth.admin.updateUserById(id, { password });
  if (error) throw fail(400, error.message);
  await db.from('profiles').update({ must_change_password: true }).eq('id', id);
  await audit(req.user.id, 'staff.password_reset', id);
  res.json({ ok: true });
}));

module.exports = router;
