const { z } = require('zod');
const { fail } = require('./http');

const UUID = z.string().uuid();
const DATE = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date');
const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use yyyy-mm-dd');

// validates a route param id, returns it
const uid = (v) => { if (!UUID.safeParse(v).success) throw fail(400, 'Invalid id'); return v; };

// strips characters that would break a PostgREST .or() / ilike filter
const searchTerm = (s, max = 80) => String(s || '').replace(/[,()*%\\]/g, ' ').trim().slice(0, max);

module.exports = { z, UUID, DATE, YMD, uid, searchTerm };
