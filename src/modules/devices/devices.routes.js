// Push tokens (FCM) registered by the mobile app.
const router = require('express').Router();
const { db } = require('../../lib/supabase');
const { wrap } = require('../../lib/http');
const { z } = require('../../lib/validation');
const { auth } = require('../../middleware/auth');

router.post('/devices', auth, wrap(async (req, res) => {
  const { token } = z.object({ token: z.string().min(20) }).parse(req.body);
  await db.from('device_tokens').upsert({ token, employee_id: req.user.id, updated_at: new Date().toISOString() });
  res.json({ ok: true });
}));

// sign-out on the phone: stop sending this user's notifications to that phone
router.delete('/devices', auth, wrap(async (req, res) => {
  const { token } = z.object({ token: z.string().min(20) }).parse(req.body);
  await db.from('device_tokens').delete().eq('token', token).eq('employee_id', req.user.id);
  res.json({ ok: true });
}));

module.exports = router;
