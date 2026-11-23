// Business dates are in India time (IST, UTC+5:30).
const IST_OFFSET = 5.5 * 3600_000;
const DAY = 86400_000;

// yyyy-mm-dd in India, optionally n days from now
const istToday = (plusDays = 0) => new Date(Date.now() + IST_OFFSET + plusDays * DAY).toISOString().slice(0, 10);

// start of an IST day as a Date
const istDayStart = (ymd) => new Date(`${ymd}T00:00:00+05:30`);

function addMonths(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`), day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + n);
  if (d.getUTCDate() !== day) d.setUTCDate(0);        // Jan 31 + 1 month -> Feb 28/29, not Mar 3
  return d.toISOString().slice(0, 10);
}

const fmtYmd = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' }) : '-');

// ISO -> "yyyy-mm-dd hh:mm" in IST (CSV exports)
const istStamp = (x) => (x ? new Date(new Date(x).getTime() + IST_OFFSET).toISOString().slice(0, 16).replace('T', ' ') : '');

const nowIso = () => new Date().toISOString();

module.exports = { DAY, istToday, istDayStart, addMonths, fmtYmd, istStamp, nowIso };
