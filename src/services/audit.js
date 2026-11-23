const { db } = require('../lib/supabase');
const { background } = require('../lib/background');

// admin audit log (who did what)
const audit = (actor, action, target, meta = {}) =>
  db.from('audit_logs').insert({ actor_id: actor, action, target_id: target, meta })
    .then(({ error }) => { if (error) console.error('audit failed:', error.message); });

// task timeline + the data behind the reports (who rejected, how long, ...)
const logEvent = (task_id, event, { employee_id = null, actor_id = null, meta = null } = {}) => background(
  db.from('task_events').insert({ task_id, event, employee_id, actor_id, meta })
    .then(({ error }) => { if (error) console.error('event log failed:', error.message); }));

module.exports = { audit, logEvent };
