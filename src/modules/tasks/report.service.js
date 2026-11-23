// Service report / bill PDF: build it, email it.
const env = require('../../config/env');
const BRAND = require('../../config/brand');
const { db } = require('../../lib/supabase');
const { fail } = require('../../lib/http');
const { serviceReportPdf, billTotals } = require('../../lib/pdf');
const { sendMail, mailShell, esc } = require('../../services/mail');
const { logEvent } = require('../../services/audit');

const REPORT_AUTO = env.REPORT_MODE === 'auto';
const NO_EMAIL = 'This customer has no email. Download the PDF and send it on WhatsApp.';
const reportName = (t) => `service-report-${String(t.id).slice(0, 8)}.pdf`;

async function buildReport(t) {
  const [ac, tech] = await Promise.all([
    t.ac_id ? db.from('customer_acs').select('*').eq('id', t.ac_id).maybeSingle().then((r) => r.data) : null,
    t.assigned_to ? db.from('profiles').select('full_name,phone').eq('id', t.assigned_to).maybeSingle().then((r) => r.data) : null,
  ]);
  return serviceReportPdf({ brand: BRAND, task: t, technician: tech, ac });
}

async function emailReport(t) {
  if (!t.customer_email) throw fail(409, NO_EMAIL);
  const pdf = await buildReport(t);
  const bill = billTotals(t.bill_items, t.gst_percent);
  const what = bill.rows.length ? 'service report and bill' : 'service report';
  const total = bill.rows.length ? `<p>Total amount: <b>Rs. ${bill.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</b>${t.payment_status === 'paid' ? ' (paid)' : ''}</p>` : '';
  await sendMail(t.customer_email, `Your ${what} - ${BRAND.short}`, mailShell(
    `<p>Hi ${esc(t.customer_name)},</p><p>Thank you for choosing us. Your ${what} for <b>${esc(t.title)}</b> is attached as a PDF.</p>${total}
     <p>If anything looks wrong, just reply to this email or call us.</p>`),
    [{ filename: reportName(t), content: pdf.toString('base64') }]);
  await db.from('tasks').update({ report_sent_at: new Date().toISOString() }).eq('id', t.id);
  logEvent(t.id, 'report_emailed', { meta: { to: t.customer_email } });
}

module.exports = { REPORT_AUTO, NO_EMAIL, reportName, buildReport, emailReport };
