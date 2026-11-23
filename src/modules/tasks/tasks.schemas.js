const { z, DATE } = require('../../lib/validation');

const STATUSES = ['created', 'assigned', 'accepted', 'rejected', 'in_progress', 'completed', 'cancelled'];
const OPEN = ['created', 'assigned', 'accepted', 'rejected', 'in_progress'];
const ACTIVE = ['created', 'assigned', 'accepted', 'in_progress'];      // an AC with one of these is "already booked"
const PRIORITY = z.enum(['low', 'normal', 'high']);
const PAY_METHOD = z.enum(['cash', 'upi', 'card', 'bank']);

const BILL = z.array(z.object({ desc: z.string().max(200), qty: z.number().positive().max(10000),
  rate: z.number().min(0).max(10_000_000) })).max(30);

const CREATE_TASK = z.object({ title: z.string().min(2).max(200), description: z.string().max(2000).optional(),
  customer_name: z.string().min(1).max(120), customer_email: z.string().email().nullish(), customer_phone: z.string().max(30).optional(),
  address: z.string().min(3).max(500), lat: z.number().optional(), lng: z.number().optional(),
  priority: PRIORITY.optional(), scheduled_at: DATE.optional(),
  assigned_to: z.string().uuid().optional(), ac_id: z.string().uuid().optional() });

const EDIT_FIELDS = z.object({
  title: z.string().min(2).max(200), description: z.string().max(2000).nullable(),
  customer_name: z.string().min(1).max(120), customer_email: z.string().email().nullable(), customer_phone: z.string().max(30).nullable(),
  address: z.string().min(3).max(500), lat: z.number().nullable(), lng: z.number().nullable(),
  priority: PRIORITY, scheduled_at: DATE.nullable(), ac_id: z.string().uuid().nullable(),
}).partial();

const BILL_FIELDS = z.object({ bill_items: BILL.nullable(), gst_percent: z.number().min(0).max(100),
  payment_status: z.enum(['unpaid', 'paid']), payment_method: PAY_METHOD.nullable(), notes: z.string().max(2000).nullable() }).partial();
const BILL_ONLY = Object.keys(BILL_FIELDS.shape);

const LIST_QUERY = z.object({ status: z.string().optional(), employee: z.string().optional(), q: z.string().max(80).optional(),
  from: DATE.optional(), to: DATE.optional(), date_by: z.enum(['created', 'scheduled', 'completed']).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional() });

// fields the technician cares about: changing one sends them a push
const TECH_FIELDS = ['title', 'address', 'scheduled_at', 'description', 'priority', 'customer_phone', 'lat', 'lng'];

module.exports = { STATUSES, OPEN, ACTIVE, PAY_METHOD, CREATE_TASK, EDIT_FIELDS, BILL_FIELDS, BILL_ONLY, LIST_QUERY, TECH_FIELDS };
