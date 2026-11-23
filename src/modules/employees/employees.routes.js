// Technicians (role = employee): admin manages them, dispatcher only lists them.
const router = require('express').Router();
const { db } = require('../../lib/supabase');
const { wrap, fail } = require('../../lib/http');
const { z } = require('../../lib/validation');
const { auth, adminOnly, staffOnly } = require('../../middleware/auth');
const { audit } = require('../../services/audit');
const { BAN_FOREVER, mustBeEmployee, releaseTasks, setBan, createUser } = require('./employees.service');

router.post('/employees', auth, adminOnly, wrap(async (req, res) => {
  const b = z.object({ email: z.string().email(), password: z.string().min(8),
    full_name: z.string().min(2), phone: z.string().optional() }).parse(req.body);
  const id = await createUser({ email: b.email, password: b.password, profile: { full_name: b.full_name, phone: b.phone } });
  await audit(req.user.id, 'employee.create', id);
  res.status(201).json({ id });
}));

router.get('/employees', auth, staffOnly, wrap(async (req, res) => {
  const slim = req.user.role !== 'admin';          // dispatcher only needs names to assign work
  const { data, error } = await db.from('profiles').select(slim ? 'id, full_name, phone, status' : '*, last_locations(*)')
    .eq('role', 'employee').neq('status', 'deleted').order('created_at', { ascending: false });
  if (error) throw fail(500, error.message);
  res.json(data || []);
}));

for (const [path, ban] of [['ban', true], ['unban', false]]) {
  router.patch(`/employees/:id/${path}`, auth, adminOnly, wrap(async (req, res) => {
    const { id } = req.params;
    await mustBeEmployee(id);
    await setBan(id, ban);
    if (ban) await releaseTasks(req.user.id, id);
    await audit(req.user.id, ban ? 'employee.ban' : 'employee.unban', id);
    res.json({ ok: true });
  }));
}

// soft delete now; purge permanently via a scheduled job after 30 days
router.delete('/employees/:id', auth, adminOnly, wrap(async (req, res) => {
  const { id } = req.params;
  await mustBeEmployee(id);
  await db.auth.admin.updateUserById(id, { ban_duration: BAN_FOREVER });
  await db.from('profiles').update({ status: 'deleted', deleted_at: new Date().toISOString() }).eq('id', id);
  await releaseTasks(req.user.id, id);
  await audit(req.user.id, 'employee.delete', id);
  res.json({ ok: true });
}));

module.exports = router;
