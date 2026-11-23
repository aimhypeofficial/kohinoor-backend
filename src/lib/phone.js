// last 10 digits, used to match the same customer typed with/without +91
const phoneKey = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : null; };

module.exports = { phoneKey };
