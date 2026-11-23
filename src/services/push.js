// Push notifications (FCM). Optional: without FIREBASE_SERVICE_ACCOUNT nothing is sent.
// firebase-admin is loaded lazily so cold starts stay fast when push is not configured.
const env = require('../config/env');
const { db } = require('../lib/supabase');
const { background } = require('../lib/background');

let fcm;          // undefined = not initialised yet, null = disabled
function messaging() {
  if (fcm !== undefined) return fcm;
  fcm = null;
  if (!env.FIREBASE_SERVICE_ACCOUNT) return fcm;
  try {
    const admin = require('firebase-admin');
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)) });
    fcm = admin.messaging();
  } catch (e) { console.error('FCM init failed:', e.message); }
  return fcm;
}

const DEAD = ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'];

// never throws: a failed push must not break the request
const push = (userId, title, body) => background(sendPush(userId, title, body));
async function sendPush(userId, title, body) {
  try {
    const m = messaging();
    if (!m || !userId) return;
    const { data: rows } = await db.from('device_tokens').select('token').eq('employee_id', userId);
    const tokens = (rows || []).map((r) => r.token);
    if (!tokens.length) return;
    const r = await m.sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: { kind: 'refresh' },          // the app reloads its list when any push arrives
      // "tasks" = high-importance channel created by the app (MainActivity.kt): sound + banner
      android: { priority: 'high', notification: { channelId: 'tasks', sound: 'default' } },
    });
    const dead = tokens.filter((_, i) => !r.responses[i].success && DEAD.includes(r.responses[i].error?.code));
    if (dead.length) await db.from('device_tokens').delete().in('token', dead);
  } catch (e) { console.error('push failed:', e.message); }
}

module.exports = { push };
