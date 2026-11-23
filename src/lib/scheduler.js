// Timers for an always-running server (Render, a VPS, or local `npm start`).
// Not used on Vercel: there api/index.js only exports the app, and vercel.json runs the cron jobs.
const env = require('../config/env');

const timers = [];
const MINUTE = 60_000;

// ---------- keep-alive ----------
// Render's free plan puts a web service to sleep after 15 minutes without incoming traffic, and the
// next request then waits ~30-60 s while it wakes up. Calling our own public /api/health URL counts as
// incoming traffic, so the service never goes to sleep. It has to be the PUBLIC url: a call to
// localhost never reaches Render's proxy and would not count.
function startKeepAlive() {
  const base = env.KEEP_ALIVE_URL;
  if (!base) return;
  const url = `${base}/api/health`;
  const ping = async () => {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { 'User-Agent': 'keep-alive' } });
      if (!r.ok) console.warn(`[keep-alive] ${url} -> ${r.status}`);
    } catch (e) { console.warn(`[keep-alive] ${url} failed: ${e.message}`); }
  };
  timers.push(setInterval(ping, env.KEEP_ALIVE_MINUTES * MINUTE));
  console.log(`[keep-alive] pinging ${url} every ${env.KEEP_ALIVE_MINUTES} min`);
}

// ---------- daily jobs ----------
// Same jobs and times (UTC) as the "crons" in vercel.json. They call the existing /api/cron/* routes with
// CRON_SECRET, so the logic lives in one place. Each job runs once per UTC day, at or after its time.
// After a restart a job may run once more that day; both jobs are safe to repeat (reminders skip ACs
// reminded in the last 25 days, cleanup only deletes old rows).
const JOBS = [
  { path: '/api/cron/amc-reminders', at: '04:00' },   // 9:30 am India
  { path: '/api/cron/cleanup', at: '21:30' },         // 3:00 am India
  { path: '/api/cron/db-ping', at: '18:30' },         // 00:00 India: keeps the Supabase free project from pausing
];

function startDailyJobs() {
  if (!env.CRON_SECRET) {
    console.warn('[jobs] CRON_SECRET is not set: AMC reminders and cleanup will NOT run');
    return;
  }
  const lastRun = {};   // path -> 'YYYY-MM-DD' (UTC)
  const tick = async () => {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const hhmm = now.toISOString().slice(11, 16);
    for (const job of JOBS) {
      if (hhmm < job.at || lastRun[job.path] === day) continue;
      lastRun[job.path] = day;
      try {
        const r = await fetch(`http://127.0.0.1:${env.PORT}${job.path}`, {
          headers: { Authorization: `Bearer ${env.CRON_SECRET}` }, signal: AbortSignal.timeout(5 * MINUTE) });
        console.log(`[jobs] ${job.path} -> ${r.status} ${(await r.text()).slice(0, 200)}`);
      } catch (e) { console.error(`[jobs] ${job.path} failed: ${e.message}`); }
    }
  };
  timers.push(setInterval(tick, MINUTE));
  console.log(`[jobs] daily jobs on: ${JOBS.map((j) => `${j.path} at ${j.at} UTC`).join(', ')}`);
}

function stopAll() { timers.splice(0).forEach(clearInterval); }

module.exports = { startKeepAlive, startDailyJobs, stopAll };
