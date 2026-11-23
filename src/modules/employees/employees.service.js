const { db } = require('../../lib/supabase');
const { fail } = require('../../lib/http');
const { UUID } = require('../../lib/validation');
const { audit, logEvent } = require('../../services/audit');

const BAN_FOREVER = '876000h';

async function mustBeEmployee(id) {
  if (!UUID.safeParse(id).success) throw fail(400, 'Invalid id');
  const { data } = await db.from('profiles').select('role').eq('id', id).maybeSingle();
  if (!data || data.role !== 'employee') throw fail(404, 'Employee not found');
}

// open tasks (also in_progress: the technician can no longer finish them) go back to the pool; keep a record of it
const OPEN = ['assigned', 'accepted', 'in_progress'];
async function releaseTasks(actor, employeeId) {
  const { data } = await db.from('tasks').select('id').eq('assigned_to', employeeId).in('status', OPEN);
  await db.from('tasks').update({ status: 'created', assigned_to: null }).eq('assigned_to', employeeId).in('status', OPEN);
  (data || []).forEach((t) => logEvent(t.id, 'unassigned', { actor_id: actor, employee_id: employeeId, meta: { reason: 'Employee disabled' } }));
  if ((data || []).length) await audit(actor, 'employee.tasks_released', employeeId, { count: data.length });
}

async function setBan(id, ban) {
  await db.auth.admin.updateUserById(id, { ban_duration: ban ? BAN_FOREVER : 'none' });
  await db.from('profiles').update({ status: ban ? 'banned' : 'active' }).eq('id', id);
}

// creates the auth user + profile; removes the auth user again if the profile insert fails
async function createUser({ email, password, profile }) {
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw fail(400, error.message);
  const { error: pe } = await db.from('profiles').insert({ id: data.user.id, ...profile });
  if (pe) { await db.auth.admin.deleteUser(data.user.id); throw fail(400, pe.message); }
  return data.user.id;
}

module.exports = { BAN_FOREVER, mustBeEmployee, releaseTasks, setBan, createUser };
