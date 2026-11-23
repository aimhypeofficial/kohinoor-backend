// Reports (admin): per-employee numbers and CSV exports.
const router = require('express').Router();
const { db, selectAll } = require('../../lib/supabase');
const { wrap, fail, sendFile } = require('../../lib/http');
const { toCsv } = require('../../lib/csv');
const { duration } = require('../../lib/pdf');
const { istStamp } = require('../../lib/dates');
const { auth, adminOnly } = require('../../middleware/auth');
const { range, employeeReport, EMP_COLS } = require('./reports.service');

const csv = (res, name, body) => sendFile(res, { type: 'text/csv; charset=utf-8', name, body });

router.get('/reports/employees', auth, adminOnly, wrap(async (req, res) => res.json(await employeeReport(req.query))));

router.get('/reports/employees.csv', auth, adminOnly, wrap(async (req, res) => {
  const r = await employeeReport(req.query);
  csv(res, `employee-report-${r.from}-to-${r.to}.csv`, toCsv(EMP_COLS, r.rows));
}));

router.get('/reports/tasks.csv', auth, adminOnly, wrap(async (req, res) => {
  const r = range(req.query);
  const { data: tasks, error } = await selectAll(() => db.from('tasks').select('*').gte('created_at', r.fromIso).lt('created_at', r.toIso)
    .order('created_at', { ascending: false }).order('id'), 20000);
  if (error) throw fail(500, error.message);
  const { data: ppl } = await db.from('profiles').select('id,full_name');
  const nm = Object.fromEntries((ppl || []).map((p) => [p.id, p.full_name]));
  csv(res, `tasks-${r.from}-to-${r.to}.csv`, toCsv([
    { label: 'Job ID', get: (t) => t.id.slice(0, 8).toUpperCase() }, { label: 'Created', get: (t) => istStamp(t.created_at) },
    { label: 'Scheduled', get: (t) => istStamp(t.scheduled_at) }, { label: 'Status', key: 'status' }, { label: 'Service', key: 'title' },
    { label: 'Customer', key: 'customer_name' }, { label: 'Phone', key: 'customer_phone' }, { label: 'Email', key: 'customer_email' },
    { label: 'Address', key: 'address' }, { label: 'Technician', get: (t) => nm[t.assigned_to] || '' },
    { label: 'Started', get: (t) => istStamp(t.started_at) }, { label: 'Completed', get: (t) => istStamp(t.completed_at) },
    { label: 'Time taken', get: (t) => (t.started_at && t.completed_at ? duration(t.started_at, t.completed_at) : '') },
    { label: 'Amount (Rs)', key: 'amount' }, { label: 'Payment', key: 'payment_status' },
    { label: 'Reject reason', key: 'reject_reason' }, { label: 'Cancel reason', key: 'cancel_reason' },
  ], tasks || []));
}));

module.exports = router;
