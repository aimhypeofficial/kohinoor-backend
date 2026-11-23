// Fire-and-forget work (push, timeline events) must survive after the response is sent.
// On Vercel the function can be frozen right after res.json(), so we hand the promise to
// waitUntil(). Locally (or if the package is missing) the promise simply runs on its own.
let waitUntil = null;
try { ({ waitUntil } = require('@vercel/functions')); } catch { /* not on Vercel */ }

function background(promise) {
  const p = Promise.resolve(promise).catch((e) => console.error('background task failed:', e.message));
  try { if (waitUntil) waitUntil(p); } catch { /* no request context (local dev, cron script) */ }
  return p;
}

module.exports = { background };
