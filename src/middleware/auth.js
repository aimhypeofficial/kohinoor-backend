const env = require('../config/env');
const { db } = require('../lib/supabase');
const { fail } = require('../lib/http');

const STAFF = ['admin', 'dispatcher'];               // dispatcher: tasks + customers only
const isStaff = (u) => !!u && STAFF.includes(u.role);

const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '');

// Checks the login token and returns { id, email }, or null.
// getClaims() verifies the signature locally with the project's public keys (JWKS, cached by supabase-js),
// so a request no longer waits for a round trip to Supabase Auth. Projects that still use the old
// shared-secret (HS256) keys fall back to asking Supabase Auth automatically.
// A token stays valid until it expires (1 hour by default) even after sign-out; disabled accounts are
// still blocked straight away because every request also checks profiles.status.
async function verifyToken(token) {
  if (!token || token === 'undefined') return null;
  const { data, error } = await db.auth.getClaims(token);
  const c = data?.claims;
  if (error || !c?.sub || c.role !== 'authenticated') return null;
  return { id: c.sub, email: c.email };
}

// signed-in user with an active profile -> req.user
async function auth(req, res, next) {
  try {
    const token = bearer(req);
    if (!token || token === 'undefined') throw fail(401, 'Not signed in');
    const user = await verifyToken(token);
    if (!user) throw fail(401, env.missing.length ? 'Server Supabase key is not configured (backend env)' : 'Invalid or expired token');
    const { data: p } = await db.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (!p) throw fail(403, 'No profile for this account');
    if (p.status !== 'active') throw fail(403, 'Account disabled');
    req.user = p;
    next();
  } catch (e) { res.status(e.status || 401).json({ error: e.message }); }
}

// valid login, profile may not exist yet (customer sign-up) -> req.authUser, req.profile
async function authAny(req, res, next) {
  try {
    const user = await verifyToken(bearer(req));
    if (!user) throw fail(401, 'Invalid token');
    req.authUser = user;
    req.profile = (await db.from('profiles').select('*').eq('id', user.id).maybeSingle()).data;
    next();
  } catch (e) { res.status(e.status || 401).json({ error: e.message }); }
}

const adminOnly = (req, res, next) =>
  req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admin only' });

const staffOnly = (req, res, next) =>
  isStaff(req.user) ? next() : res.status(403).json({ error: 'Admin or dispatcher only' });

const employeeOnly = (req, res, next) =>
  req.user.role === 'employee' ? next() : res.status(403).json({ error: 'Employees only' });

const customerOnly = (req, res, next) =>
  req.profile?.role === 'customer' && req.profile.status === 'active' ? next()
    : res.status(403).json({ error: 'Account disabled' });

// Vercel Cron sends "Authorization: Bearer <CRON_SECRET>"
const cronAuth = (req, res, next) =>
  env.CRON_SECRET && req.headers.authorization === `Bearer ${env.CRON_SECRET}` ? next()
    : res.status(401).json({ error: 'Unauthorized' });

module.exports = { STAFF, isStaff, auth, authAny, adminOnly, staffOnly, employeeOnly, customerOnly, cronAuth };
