// Dashboard numbers (exact counts, not "latest 300 tasks") and the unpaid-jobs list.
const router = require('express').Router();
const { db, selectAll } = require('../../lib/supabase');
const { wrap, fail } = require('../../lib/http');
const { istToday, istDayStart } = require('../../lib/dates');
const { auth, staffOnly } = require('../../middleware/auth');
const { STATUSES } = require('../tasks/tasks.schemas');

router.get('/summary', auth, staffOnly, wrap(async (_req, res) => {
  const today = istToday();
  const dayStart = istDayStart(today).toISOString();
  const monthStart = istDayStart(`${today.slice(0, 8)}01`).toISOString();
  const head = () => db.from('tasks').select('id', { count: 'exact', head: true });
  const [counts, doneToday, unpaid, paidMonth] = await Promise.all([
    Promise.all(STATUSES.map((s) => head().eq('status', s))),
    head().eq('status', 'completed').gte('completed_at', dayStart),
    selectAll(() => db.from('tasks').select('amount').eq('status', 'completed').neq('payment_status', 'paid').not('amount', 'is', null).order('id')),
    selectAll(() => db.from('tasks').select('amount').eq('payment_status', 'paid').gte('paid_at', monthStart).order('id')),
  ]);
  const sum = (rows) => Math.round((rows || []).reduce((s, r) => s + (Number(r.amount) || 0), 0));
  res.json({
    counts: Object.fromEntries(STATUSES.map((s, i) => [s, counts[i].count || 0])),
    completed_today: doneToday.count || 0,
    pending_amount: sum(unpaid.data), pending_count: (unpaid.data || []).length,
    collected_month: sum(paidMonth.data),
  });
}));

// completed jobs whose payment is not recorded yet
router.get('/payments/pending', auth, staffOnly, wrap(async (_req, res) => {
  const { data, error } = await db.from('tasks')
    .select('id,title,customer_name,customer_phone,amount,completed_at,assigned_to')
    .eq('status', 'completed').neq('payment_status', 'paid').order('completed_at', { ascending: false }).limit(300);
  if (error) throw fail(500, error.message);
  res.json(data || []);
}));

module.exports = router;
