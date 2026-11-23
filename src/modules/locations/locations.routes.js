// Live GPS from the technician app, and route history for the admin.
const router = require('express').Router();
const { db, selectAll } = require('../../lib/supabase');
const { wrap, fail } = require('../../lib/http');
const { z, uid } = require('../../lib/validation');
const { auth, adminOnly, employeeOnly } = require('../../middleware/auth');

router.post('/location', auth, employeeOnly, wrap(async (req, res) => {
  const b = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180),
    accuracy: z.number().optional(), speed: z.number().optional(), battery: z.number().int().optional(),
    recorded_at: z.string().optional() }).parse(req.body);   // recorded_at lets the offline queue sync later
  const now = Date.now();
  const at = b.recorded_at ? Date.parse(b.recorded_at) : now;
  // offline queue may send old points, but never from the future (bad phone clock) or older than 7 days
  if (Number.isNaN(at) || at > now + 2 * 60_000 || at < now - 7 * 24 * 3600_000) throw fail(400, 'Invalid recorded_at');
  const row = { ...b, employee_id: req.user.id, recorded_at: new Date(at).toISOString() };
  // a late-synced old point goes into the history only; it must not move the live marker backwards
  const live = now - at < 5 * 60_000;
  const [a, b2] = await Promise.all([db.from('locations').insert(row), live ? db.from('last_locations').upsert(row) : { error: null }]);
  if (a.error || b2.error) throw fail(500, (a.error || b2.error).message);   // last_locations upsert triggers Realtime on the admin map
  res.json({ ok: true });
}));

router.get('/employees/:id/route', auth, adminOnly, wrap(async (req, res) => {
  const id = uid(req.params.id);
  const okDate = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
  const since = okDate(req.query.since) ? req.query.since : new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data, error } = await selectAll(() => {
    let q = db.from('locations').select('lat,lng,speed,recorded_at')
      .eq('employee_id', id).gte('recorded_at', since).order('recorded_at').order('id');
    if (okDate(req.query.until)) q = q.lt('recorded_at', req.query.until);
    return q;
  }, 20000);
  if (error) throw fail(500, error.message);
  res.json(data || []);
}));

module.exports = router;
