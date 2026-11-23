// Tiny dependency-free PDF writer (A4, built-in Helvetica) + the service report / bill layout.
// No npm package needed, so it works the same on Vercel and on your PC.
// Limitation: built-in PDF fonts are Latin only. Devanagari (Hindi script) characters print as "?".
// Write names/addresses in English letters for the PDF to look right.

const W = 595.28, H = 841.89;

// Helvetica advance widths (1/1000 em) for ASCII 32..126
const REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,
  667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,
  556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const BOLD_UP = { A:722,B:722,C:722,D:722,E:667,F:611,G:778,H:722,I:278,J:556,K:722,L:611,M:833,N:722,O:778,P:667,Q:778,R:722,S:667,T:611,U:722,V:667,W:944,X:667,Y:667,Z:611 };
const BOLD_LO = { a:556,b:611,c:556,d:611,e:556,f:333,g:611,h:611,i:278,j:278,k:556,l:278,m:889,n:611,o:611,p:611,q:611,r:389,s:556,t:333,u:611,v:556,w:778,x:556,y:556,z:500 };

const CP1252 = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99 };
function clean(s) {
  return String(s ?? '').replace(/[\u00a0\u2009\u202f]/g, ' ').replace(/[\r\n\t]+/g, ' ');
}
function toBytes(s) {                       // string -> latin1/WinAnsi string safe for PDF
  let out = '';
  for (const ch of clean(s)) {
    const c = ch.codePointAt(0);
    if (c < 32) continue;
    if (c < 127 || (c >= 160 && c <= 255)) out += ch;
    else if (CP1252[ch]) out += String.fromCharCode(CP1252[ch]);
    else out += '?';
  }
  return out;
}
const esc = (s) => toBytes(s).replace(/([\\()])/g, '\\$1');
const num = (n) => (Math.round(n * 100) / 100).toString();
const rgb = (c) => c.map((v) => num(v / 255)).join(' ');

class Pdf {
  constructor() { this.pages = []; this.newPage(); }
  newPage() { this.cur = []; this.pages.push(this.cur); }
  width(s, size, bold = false) {
    let w = 0;
    for (const ch of toBytes(s)) {
      const c = ch.charCodeAt(0);
      let a = c >= 32 && c <= 126 ? REG[c - 32] : 556;
      if (bold) a = BOLD_UP[ch] || BOLD_LO[ch] || (c >= 48 && c <= 57 ? 556 : a);
      w += a;
    }
    return (w * size) / 1000;
  }
  wrap(s, maxW, size, bold = false) {
    const lines = [];
    for (const para of clean(s).split(/\s*\|\|\s*/)) {       // "||" forces a line break
      let line = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        let w = word;
        while (this.width(w, size, bold) > maxW) {            // very long word: hard split
          let i = w.length;
          while (i > 1 && this.width(w.slice(0, i), size, bold) > maxW) i--;
          if (line) { lines.push(line); line = ''; }
          lines.push(w.slice(0, i)); w = w.slice(i);
        }
        const t = line ? `${line} ${w}` : w;
        if (this.width(t, size, bold) <= maxW) line = t; else { lines.push(line); line = w; }
      }
      lines.push(line);
    }
    return lines.length ? lines : [''];
  }
  // y values are measured from the TOP of the page
  text(x, y, s, { size = 10, bold = false, color = [20, 38, 77], align = 'left' } = {}) {
    const w = this.width(s, size, bold);
    const px = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    this.cur.push(`BT /${bold ? 'F2' : 'F1'} ${num(size)} Tf ${rgb(color)} rg ${num(px)} ${num(H - y)} Td (${esc(s)}) Tj ET`);
  }
  rect(x, y, w, h, { fill, stroke, lw = 0.7 } = {}) {
    const p = [];
    if (fill) p.push(`${rgb(fill)} rg`);
    if (stroke) p.push(`${rgb(stroke)} RG ${num(lw)} w`);
    p.push(`${num(x)} ${num(H - y - h)} ${num(w)} ${num(h)} re ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`);
    this.cur.push(p.join(' '));
  }
  line(x1, y1, x2, y2, { color = [213, 220, 216], lw = 0.7 } = {}) {
    this.cur.push(`${rgb(color)} RG ${num(lw)} w ${num(x1)} ${num(H - y1)} m ${num(x2)} ${num(H - y2)} l S`);
  }
  build() {
    const objs = [];                                  // index = object number - 1
    const add = (body) => { objs.push(body); return objs.length; };
    const cat = add(''), pagesObj = add('');
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids = [];
    for (const page of this.pages) {
      const content = page.join('\n');
      const c = add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${num(W)} ${num(H)}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`));
    }
    objs[cat - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
    objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
    let out = '%PDF-1.4\n';
    const offsets = [];
    objs.forEach((b, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${b}\nendobj\n`; });
    const xref = Buffer.byteLength(out, 'latin1');
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
      offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
      `trailer\n<< /Size ${objs.length + 1} /Root ${cat} 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(out, 'latin1');
  }
}

// ---------- formatting helpers ----------
const IST = 'Asia/Kolkata';
const fmtDateTime = (x) => (x ? clean(new Date(x).toLocaleString('en-IN', { timeZone: IST, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })) : '-');
const fmtDate = (x) => (x ? clean(new Date(x).toLocaleDateString('en-IN', { timeZone: IST, day: '2-digit', month: 'short', year: 'numeric' })) : '-');
const money = (n) => `Rs. ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function duration(a, b) {
  if (!a || !b) return '-';
  const m = Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
// bill maths shared with the API
function billTotals(items, gstPercent) {
  const rows = (Array.isArray(items) ? items : []).map((i) => {
    const qty = Number(i.qty) || 0, rate = Number(i.rate) || 0;
    return { desc: String(i.desc || '').slice(0, 200), qty, rate, amount: Math.round(qty * rate * 100) / 100 };
  }).filter((r) => r.desc && r.qty > 0);
  const subtotal = Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
  const gst = Math.round(subtotal * (Number(gstPercent) || 0)) / 100;
  return { rows, subtotal, gst, total: Math.round((subtotal + gst) * 100) / 100 };
}

const NAVY = [20, 38, 77], BLUE = [45, 111, 186], GOLD = [247, 200, 0], GREY = [90, 106, 101], LINE = [213, 220, 216], PALE = [238, 241, 239];

/**
 * serviceReportPdf({ brand, task, technician, ac, billNo })
 * Returns a Buffer. Includes the bill section only when the task has bill items.
 */
function serviceReportPdf({ brand, task, technician, ac }) {
  const d = new Pdf();
  const L = 40, R = W - 40, CW = R - L;
  let y = 0;
  const footer = () => {
    d.line(L, H - 62, R, H - 62);
    d.text(W / 2, H - 46, `${brand.name} - ${brand.since}`, { size: 8, color: GREY, align: 'center', bold: true });
    d.text(W / 2, H - 34, `${brand.phone}  |  ${brand.email}  |  ${brand.hours}`, { size: 8, color: GREY, align: 'center' });
    d.text(W / 2, H - 22, brand.address, { size: 7.5, color: GREY, align: 'center' });
  };
  const ensure = (h) => { if (y + h > H - 80) { footer(); d.newPage(); y = 50; } };

  // header band
  d.rect(0, 0, W, 78, { fill: NAVY });
  d.rect(0, 78, W, 4, { fill: GOLD });
  d.text(L, 40, brand.name, { size: 20, bold: true, color: [255, 255, 255] });
  d.text(L, 58, `${brand.tagline}  |  ${brand.since}`, { size: 9.5, color: [207, 217, 238] });
  d.text(R, 40, 'SERVICE REPORT', { size: 13, bold: true, color: GOLD, align: 'right' });
  d.text(R, 58, `Job #${String(task.id).slice(0, 8).toUpperCase()}`, { size: 9.5, color: [255, 255, 255], align: 'right' });
  y = 104;

  // two info boxes
  const colW = (CW - 14) / 2;
  const box = (x, title, rows) => {
    const lines = rows.map(([k, v]) => ({ k, ls: d.wrap(v || '-', colW - 92, 9.5) }));
    const h = 30 + lines.reduce((s, r) => s + r.ls.length * 12.5 + 3, 0);
    d.rect(x, y, colW, h, { fill: [250, 251, 250], stroke: LINE });
    d.rect(x, y, colW, 18, { fill: PALE });
    d.text(x + 10, y + 12.5, title, { size: 9, bold: true, color: BLUE });
    let yy = y + 34;
    for (const r of lines) {
      d.text(x + 10, yy, r.k, { size: 9, color: GREY });
      r.ls.forEach((l, i) => d.text(x + 82, yy + i * 12.5, l, { size: 9.5, bold: i === 0 && r.k === 'Name' }));
      yy += r.ls.length * 12.5 + 3;
    }
    return h;
  };
  const acLine = ac ? [ac.type, ac.brand, ac.model].filter(Boolean).join(' ') + (ac.location_label ? ` (${ac.location_label})` : '') : '';
  const h1 = box(L, 'CUSTOMER', [['Name', task.customer_name], ['Phone', task.customer_phone], ['Email', task.customer_email], ['Address', task.address]]);
  const h2 = box(L + colW + 14, 'SERVICE DETAILS', [
    ['Service', task.title], ['AC', acLine], ['Technician', technician?.full_name], ['Scheduled', task.scheduled_at ? fmtDateTime(task.scheduled_at) : ''],
    ['Started', fmtDateTime(task.started_at)], ['Completed', fmtDateTime(task.completed_at)], ['Time taken', duration(task.started_at, task.completed_at)]]);
  y += Math.max(h1, h2) + 16;

  // work notes
  const para = (title, text) => {
    const ls = d.wrap(text, CW - 20, 9.5);
    ensure(30 + ls.length * 12.5);
    d.text(L, y + 10, title, { size: 10, bold: true, color: BLUE });
    y += 18;
    ls.forEach((l) => { d.text(L + 10, y + 8, l, { size: 9.5 }); y += 12.5; });
    y += 10;
  };
  if (task.description) para('JOB DESCRIPTION', task.description);
  para('TECHNICIAN NOTES', task.notes || 'No notes recorded.');

  // bill
  const bill = billTotals(task.bill_items, task.gst_percent);
  if (bill.rows.length) {
    ensure(60);
    d.text(L, y + 10, 'BILL', { size: 10, bold: true, color: BLUE }); y += 18;
    const cx = { desc: L + 8, qty: R - 190, rate: R - 100, amt: R - 8 };
    d.rect(L, y, CW, 20, { fill: NAVY });
    d.text(cx.desc, y + 13.5, 'Description', { size: 9, bold: true, color: [255, 255, 255] });
    d.text(cx.qty, y + 13.5, 'Qty', { size: 9, bold: true, color: [255, 255, 255], align: 'right' });
    d.text(cx.rate, y + 13.5, 'Rate', { size: 9, bold: true, color: [255, 255, 255], align: 'right' });
    d.text(cx.amt, y + 13.5, 'Amount', { size: 9, bold: true, color: [255, 255, 255], align: 'right' });
    y += 20;
    bill.rows.forEach((r, i) => {
      const ls = d.wrap(r.desc, cx.qty - cx.desc - 50, 9.5);
      const h = ls.length * 12.5 + 8;
      ensure(h);
      if (i % 2) d.rect(L, y, CW, h, { fill: [247, 249, 248] });
      ls.forEach((l, j) => d.text(cx.desc, y + 14 + j * 12.5, l, { size: 9.5 }));
      d.text(cx.qty, y + 14, String(r.qty), { size: 9.5, align: 'right' });
      d.text(cx.rate, y + 14, money(r.rate), { size: 9.5, align: 'right' });
      d.text(cx.amt, y + 14, money(r.amount), { size: 9.5, align: 'right' });
      y += h;
    });
    d.line(L, y, R, y); y += 6;
    const tot = (label, v, bold) => {
      ensure(18);
      d.text(cx.rate, y + 12, label, { size: bold ? 11 : 9.5, bold, align: 'right' });
      d.text(cx.amt, y + 12, money(v), { size: bold ? 11 : 9.5, bold, align: 'right' });
      y += bold ? 20 : 16;
    };
    tot('Subtotal', bill.subtotal);
    if (bill.gst) tot(`GST ${Number(task.gst_percent)}%`, bill.gst);
    tot('Total', bill.total, true);
    ensure(24);
    const paid = task.payment_status === 'paid';
    d.rect(L, y + 2, 80, 18, { fill: paid ? [216, 241, 226] : [253, 239, 196] });
    d.text(L + 40, y + 14.5, paid ? 'PAID' : 'PAYMENT DUE', { size: 8.5, bold: true, color: paid ? [23, 105, 58] : [140, 100, 0], align: 'center' });
    y += 34;
  }

  ensure(60);
  if (task.status === 'completed') {
    d.text(L, y + 10, 'Work completion was verified by the customer with a one-time code.', { size: 9, color: GREY });
    y += 18;
  }
  d.text(L, y + 10, 'Thank you for choosing us. For any issue with this service, call or WhatsApp us within 7 days.', { size: 9, color: GREY });
  footer();
  return d.build();
}

module.exports = { Pdf, serviceReportPdf, billTotals, duration, fmtDate, fmtDateTime };
