const { db, selectAll } = require('../../lib/supabase');
const { z, YMD } = require('../../lib/validation');
const { istToday, istDayStart, addMonths, DAY } = require('../../lib/dates');

// ?from=yyyy-mm-dd&to=yyyy-mm-dd (IST days, "to" inclusive). Default: the last month.
function range(query) {
  const p = z.object({ from: YMD.optional(), to: YMD.optional() }).parse(query);
  const to = p.to || istToday();
  const from = p.from || addMonths(to, -1);
  return { from, to, fromIso: istDayStart(from).toISOString(), toIso: new Date(istDayStart(to).getTime() + DAY).toISOString() };
}

async function employeeReport(query) {
  const r = range(query);
  const [{ data: emps }, { data: ev }, { data: done }] = await Promise.all([
    db.from('profiles').select('id,full_name,phone,status').eq('role', 'employee').neq('status', 'deleted'),
    selectAll(() => db.from('task_events').select('employee_id,event').in('event', ['assigned', 'accepted', 'rejected', 'cancelled'])
      .gte('created_at', r.fromIso).lt('created_at', r.toIso).order('id')),
    selectAll(() => db.from('tasks').select('assigned_to,started_at,completed_at,amount').eq('status', 'completed')
      .gte('completed_at', r.fromIso).lt('completed_at', r.toIso).order('id'), 20000),
  ]);
  const rows = (emps || []).map((e) => {
    const count = (name) => (ev || []).filter((x) => x.employee_id === e.id && x.event === name).length;
    const mine = (done || []).filter((t) => t.assigned_to === e.id);
    const timed = mine.filter((t) => t.started_at && t.completed_at)
      .map((t) => (new Date(t.completed_at) - new Date(t.started_at)) / 60000).filter((m) => m >= 0);
    const total = timed.reduce((s, m) => s + m, 0);
    return { employee_id: e.id, name: e.full_name, phone: e.phone || '', status: e.status,
      assigned: count('assigned'), accepted: count('accepted'), rejected: count('rejected'), cancelled: count('cancelled'),
      completed: mine.length, avg_minutes: timed.length ? Math.round(total / timed.length) : null,
      total_hours: Math.round((total / 60) * 10) / 10, revenue: Math.round(mine.reduce((s, t) => s + (Number(t.amount) || 0), 0)) };
  }).sort((a, b) => b.completed - a.completed);
  return { ...r, rows };
}

const EMP_COLS = [{ label: 'Employee', key: 'name' }, { label: 'Phone', key: 'phone' }, { label: 'Status', key: 'status' },
  { label: 'Assigned', key: 'assigned' }, { label: 'Accepted', key: 'accepted' }, { label: 'Rejected', key: 'rejected' },
  { label: 'Cancelled after assign', key: 'cancelled' }, { label: 'Completed', key: 'completed' },
  { label: 'Avg time per job (min)', key: 'avg_minutes' }, { label: 'Total work hours', key: 'total_hours' }, { label: 'Billed (Rs)', key: 'revenue' }];

module.exports = { range, employeeReport, EMP_COLS };
