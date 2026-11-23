// Audit log screen (admin), paged with ?before=<id>.
const router = require('express').Router();
const { db } = require('../../lib/supabase');
const { wrap, fail } = require('../../lib/http');
const { z } = require('../../lib/validation');
const { auth, adminOnly } = require('../../middleware/auth');

router.get('/audit', auth, adminOnly, wrap(async (req, res) => {
  const p = z.object({ action: z.string().max(60).optional(), actor: z.string().uuid().optional(),
    before: z.coerce.number().int().optional(), limit: z.coerce.number().int().min(1).max(200).optional() }).parse(req.query);
  const limit = p.limit || 50;
  let q = db.from('audit_logs').select('*').order('id', { ascending: false }).limit(limit + 1);
  if (p.action) q = q.like('action', `${p.action.replace(/[%_\\]/g, '')}%`);
  if (p.actor) q = q.eq('actor_id', p.actor);
  if (p.before) q = q.lt('id', p.before);
  const { data, error } = await q;
  if (error) throw fail(500, error.message);
  const more = (data || []).length > limit;
  const rows = (data || []).slice(0, limit);
  const ids = [...new Set(rows.flatMap((r) => [r.actor_id, r.target_id]).filter(Boolean))];
  const [{ data: ppl }, { data: tks }, { data: cus }] = ids.length ? await Promise.all([
    db.from('profiles').select('id,full_name,role').in('id', ids),
    db.from('tasks').select('id,title').in('id', ids),
    db.from('customers').select('id,name').in('id', ids)]) : [{ data: [] }, { data: [] }, { data: [] }];
  const who = Object.fromEntries((ppl || []).map((x) => [x.id, `${x.full_name} (${x.role})`]));
  const what = { ...Object.fromEntries((tks || []).map((x) => [x.id, `Task: ${x.title}`])),
    ...Object.fromEntries((cus || []).map((x) => [x.id, `Customer: ${x.name}`])), ...who };
  res.json({ rows: rows.map((r) => ({ ...r, actor_name: r.actor_id ? who[r.actor_id] || 'Unknown user' : 'System',
    target_name: r.target_id ? what[r.target_id] || null : null })), next_before: more ? rows[rows.length - 1].id : null });
}));

module.exports = router;
