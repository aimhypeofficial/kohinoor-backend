const router = require('express').Router();
const env = require('../../config/env');

// open: Vercel / uptime checks. ok:false lists the env vars to fix.
router.get('/health', (_req, res) => res.json({ ok: env.missing.length === 0, missing: env.missing }));

module.exports = router;
