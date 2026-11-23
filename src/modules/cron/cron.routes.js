// Scheduled jobs. Vercel Cron calls these (see vercel.json) with "Authorization: Bearer <CRON_SECRET>".
const router = require('express').Router();
const { db } = require('../../lib/supabase');
const { wrap, fail } = require('../../lib/http');
const { istToday, DAY } = require('../../lib/dates');
const { cronAuth } = require('../../middleware/auth');
const { audit } = require('../../services/audit');
const { ACTIVE } = require('../tasks/tasks.schemas');
const { sendReminder } = require('../acs/amc.service');

const BATCH = 5;          // 5 reminders at a time keeps the job inside serverless time limits
const PER_RUN = 60;       // max reminders actually sent per run
const CANDIDATES = 500;   // ACs that are already booked are skipped, so look at more than PER_RUN
const TIME_BUDGET = 22_000; // stop early, vercel.json maxDuration is 30s

// remind customers whose AMC is due within 7 days. One reminder per ~25 days.
router.get('/cron/amc-reminders', cronAuth, wrap(async (_req, res) => {
  const stale = new Date(Date.now() - 25 * DAY).toISOString();
  const { data } = await db.from('customer_acs').select('*, customer:customers(id,name,email,phone)')
    .eq('amc_active', true).not('next_service_due', 'is', null).lte('next_service_due', istToday(7))
    .or(`last_reminded_at.is.null,last_reminded_at.lt.${stale}`).order('next_service_due').limit(CANDIDATES);
  const todo = data || [];
  const started = Date.now();
  let sent = 0, tried = 0;
  for (let i = 0; i < todo.length && tried < PER_RUN && Date.now() - started < TIME_BUDGET; i += BATCH) {
    await Promise.all(todo.slice(i, i + BATCH).map(async (a) => {
      const { data: open } = await db.from('tasks').select('id').eq('ac_id', a.id).in('status', ACTIVE).limit(1);
      if (open?.length) return;                       // already booked
      tried++;
      try { const r = await sendReminder(a); if (r.email === 'sent' || r.whatsapp === 'sent') sent++; }
      catch (e) { console.error('reminder failed:', e.message); }
    }));
  }
  await audit(null, 'amc.cron', null, { checked: todo.length, tried, sent });
  res.json({ checked: todo.length, tried, sent });
}));

// housekeeping: GPS points older than 30 days, OTPs expired for a day
router.get('/cron/cleanup', cronAuth, wrap(async (_req, res) => {
  const cutoff = new Date(Date.now() - 30 * DAY).toISOString();
  const { error, count } = await db.from('locations').delete({ count: 'exact' }).lt('recorded_at', cutoff);
  if (error) throw fail(500, error.message);
  await db.from('task_otps').delete().lt('expires_at', new Date(Date.now() - DAY).toISOString());
  res.json({ deleted_locations: count || 0 });
}));

// Supabase free projects are PAUSED after 7 days without database activity. This runs a few real
// queries every night (00:00 India) so the project always counts as active, even when nobody uses the app.
router.get('/cron/db-ping', cronAuth, wrap(async (_req, res) => {
  const started = Date.now();
  const checks = await Promise.all([
    db.from('profiles').select('id', { count: 'exact', head: true }),
    db.from('tasks').select('id', { count: 'exact', head: true }),
    db.from('customers').select('id').limit(1),
    db.storage.from('task-photos').list('', { limit: 1 }),
  ]);
  const failed = checks.map((r, i) => r.error && `#${i}: ${r.error.message}`).filter(Boolean);
  if (failed.length) throw fail(500, `DB ping failed: ${failed.join('; ')}`);
  res.json({ ok: true, profiles: checks[0].count, tasks: checks[1].count, ms: Date.now() - started });
}));

module.exports = router;
