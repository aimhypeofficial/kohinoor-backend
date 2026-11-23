// Service report / bill PDF: download, or email it to the customer.
const router = require('express').Router();
const { wrap, fail, sendFile } = require('../../lib/http');
const env = require('../../config/env');
const { auth, staffOnly } = require('../../middleware/auth');
const { audit } = require('../../services/audit');
const { MAIL_READY } = require('../../services/mail');
const { getTask, canSee } = require('./tasks.service');
const { NO_EMAIL, reportName, buildReport, emailReport } = require('./report.service');

router.get('/tasks/:id/report.pdf', auth, wrap(async (req, res) => {
  const t = await getTask(req.params.id);
  if (!canSee(req.user, t)) throw fail(403, 'Not your task');
  sendFile(res, { type: 'application/pdf', name: reportName(t), body: await buildReport(t) });
}));

router.post('/tasks/:id/send-report', auth, staffOnly, wrap(async (req, res) => {
  const t = await getTask(req.params.id);
  if (t.status !== 'completed') throw fail(409, 'The report can be sent after the work is completed');
  if (!t.customer_email) throw fail(409, NO_EMAIL);
  if (!MAIL_READY) {
    if (env.isProd) throw fail(503, 'Email is not configured on the server');
    console.log(`\n[DEV MAIL] service report for "${t.title}" -> ${t.customer_email}\n`);
    return res.json({ sent: true, dev: true });
  }
  await emailReport(t);
  await audit(req.user.id, 'task.report_sent', t.id);
  res.json({ sent: true });
}));

module.exports = router;
