const { createClient } = require('@supabase/supabase-js');
const env = require('../config/env');

// One client per serverless instance (reused across warm invocations on Vercel).
const db = createClient(env.SUPABASE_URL || 'http://localhost', env.SUPABASE_SERVICE_ROLE_KEY || 'missing',
  { auth: { persistSession: false, autoRefreshToken: false } });

// Supabase returns at most 1000 rows per request (API "max rows" setting), so .limit(5000) alone silently
// stops at 1000. selectAll() pages through with .range() until it has everything (or hits max).
// makeQuery must return a NEW query each call and should have a stable .order() (add 'id' as a tie-breaker).
async function selectAll(makeQuery, max = 50000, page = 1000) {
  const rows = [];
  for (let from = 0; from < max; from += page) {
    const { data, error } = await makeQuery().range(from, Math.min(from + page, max) - 1);
    if (error) return { data: null, error };
    rows.push(...(data || []));
    if (!data || data.length < page) break;
  }
  return { data: rows, error: null };
}

module.exports = { db, selectAll };
