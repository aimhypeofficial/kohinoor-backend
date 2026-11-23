const { db } = require('../../lib/supabase');
const { fail } = require('../../lib/http');
const { phoneKey } = require('../../lib/phone');

// one customer record per email (or per phone number); fills in blanks with the latest details
async function upsertCustomer({ name, email, phone, address }) {
  const em = email ? String(email).trim().toLowerCase() : null;
  const pk = phoneKey(phone);
  let c = null;
  if (em) c = (await db.from('customers').select('*').eq('email', em).maybeSingle()).data;
  if (!c && pk) c = (await db.from('customers').select('*').eq('phone_key', pk).order('created_at').limit(1).maybeSingle()).data;
  if (c) {
    const patch = {};
    if (!c.phone && phone) { patch.phone = phone; patch.phone_key = pk; }
    if (!c.address && address) patch.address = address;
    if (!c.email && em) patch.email = em;
    if (Object.keys(patch).length) await db.from('customers').update(patch).eq('id', c.id);
    return c;
  }
  const { data, error } = await db.from('customers').insert({ name, email: em, phone: phone || null, phone_key: pk, address: address || null })
    .select().single();
  if (error) throw fail(400, error.message);
  return data;
}

module.exports = { upsertCustomer };
