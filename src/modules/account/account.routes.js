// The signed-in user's own account (any role).
const router = require('express').Router();
const { db } = require('../../lib/supabase');
const { wrap } = require('../../lib/http');
const { z } = require('../../lib/validation');
const { auth } = require('../../middleware/auth');

// who am I (admin site uses this to pick the menu and to force the first password change)
router.get('/me', auth, wrap(async (req, res) => {
  const { id, full_name, role, phone, must_change_password } = req.user;
  res.json({ id, full_name, role, phone, must_change_password });
}));

router.post('/me/password', auth, wrap(async (req, res) => {
  const { password } = z.object({ password: z.string().min(8) }).parse(req.body);
  await db.auth.admin.updateUserById(req.user.id, { password });
  await db.from('profiles').update({ must_change_password: false }).eq('id', req.user.id);
  res.json({ ok: true });
}));

module.exports = router;
