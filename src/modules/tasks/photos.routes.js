// Before / after photos, stored in the private Supabase bucket "task-photos".
const router = require('express').Router();
const express = require('express');
const crypto = require('crypto');
const { db } = require('../../lib/supabase');
const { wrap, fail } = require('../../lib/http');
const { z, uid } = require('../../lib/validation');
const { auth, isStaff } = require('../../middleware/auth');
const { logEvent } = require('../../services/audit');
const { BUCKET, getTask } = require('./tasks.service');

const MAX_BYTES = 3 * 1024 * 1024;      // Vercel request body limit is 4.5 MB and base64 adds ~33%
const MAX_PER_TASK = 20;
// base64 photos (the app compresses to ~300 KB); this route skips the small global JSON parser
const jsonPhoto = express.json({ limit: '4.5mb' });

const MAGIC = [[[0xff, 0xd8, 0xff], 'image/jpeg', 'jpg'], [[0x89, 0x50, 0x4e, 0x47], 'image/png', 'png']];
function sniff(buf) {
  for (const [sig, type, ext] of MAGIC) if (sig.every((b, i) => buf[i] === b)) return { type, ext };
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return { type: 'image/webp', ext: 'webp' };
  return null;
}

router.post('/tasks/:id/photos', auth, jsonPhoto, wrap(async (req, res) => {
  const b = z.object({ kind: z.enum(['before', 'after']), image_base64: z.string().min(100) }).parse(req.body);
  const t = await getTask(req.params.id);
  const mine = t.assigned_to === req.user.id && ['accepted', 'in_progress'].includes(t.status);
  if (!mine && !(isStaff(req.user) && t.status !== 'cancelled')) throw fail(403, 'You cannot add photos to this task');
  const buf = Buffer.from(b.image_base64.replace(/^data:[^,]+,/, ''), 'base64');
  if (buf.length > MAX_BYTES) throw fail(413, 'Photo is too large (max 3 MB)');
  const kind = sniff(buf);
  if (!kind) throw fail(400, 'Only JPEG, PNG or WebP photos are allowed');
  const { count } = await db.from('task_photos').select('id', { count: 'exact', head: true }).eq('task_id', t.id);
  if ((count || 0) >= MAX_PER_TASK) throw fail(400, `Photo limit reached (${MAX_PER_TASK} per task)`);
  const path = `${t.id}/${b.kind}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${kind.ext}`;
  const up = await db.storage.from(BUCKET).upload(path, buf, { contentType: kind.type, upsert: false });
  if (up.error) throw fail(500, `Photo upload failed: ${up.error.message}`);
  const { data, error } = await db.from('task_photos').insert({ task_id: t.id, kind: b.kind, path, uploaded_by: req.user.id }).select().single();
  if (error) { await db.storage.from(BUCKET).remove([path]); throw fail(500, error.message); }
  logEvent(t.id, 'photo', { actor_id: req.user.id, employee_id: t.assigned_to, meta: { kind: b.kind } });
  res.status(201).json({ id: data.id, kind: data.kind });
}));

router.delete('/tasks/:id/photos/:photoId', auth, wrap(async (req, res) => {
  const t = await getTask(req.params.id);
  const { data: p } = await db.from('task_photos').select('*').eq('id', uid(req.params.photoId)).eq('task_id', t.id).maybeSingle();
  if (!p) throw fail(404, 'Photo not found');
  const own = p.uploaded_by === req.user.id && ['accepted', 'in_progress'].includes(t.status);
  if (!own && !isStaff(req.user)) throw fail(403, 'Not allowed');
  await db.storage.from(BUCKET).remove([p.path]);
  await db.from('task_photos').delete().eq('id', p.id);
  res.json({ ok: true });
}));

module.exports = router;
