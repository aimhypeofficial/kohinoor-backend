// All environment variables are read here, once. Other files import from this module
// instead of touching process.env directly.

const PLACEHOLDER = /YAHAN|PASTE|your-|xxxx|_HERE/i;
const isSet = (v) => !!v && !PLACEHOLDER.test(v);

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: Number(process.env.PORT) || 4000,
  // requests per minute per IP on /api (raise only for load tests on a local copy)
  RATE_LIMIT_PER_MIN: Number(process.env.RATE_LIMIT_PER_MIN) || 300,

  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,

  CORS_ORIGIN: (process.env.CORS_ORIGIN || '').split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean),

  // Email: Gmail (or any SMTP) with an App Password is used when SMTP_USER + SMTP_PASS are set,
  // otherwise Resend when RESEND_API_KEY is set. See services/mail.js.
  SMTP_HOST: process.env.SMTP_HOST || 'smtp.gmail.com',
  SMTP_PORT: Number(process.env.SMTP_PORT) || 465,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: (process.env.SMTP_PASS || '').replace(/\s+/g, ''),   // Google shows app passwords as "abcd efgh ijkl mnop"
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  MAIL_FROM: process.env.MAIL_FROM,
  LOGO_URL: process.env.LOGO_URL,

  CRON_SECRET: process.env.CRON_SECRET,
  FIREBASE_SERVICE_ACCOUNT: process.env.FIREBASE_SERVICE_ACCOUNT,

  // auto = email the service report right after the OTP; manual = staff sends it from the website
  REPORT_MODE: process.env.REPORT_MODE === 'manual' ? 'manual' : 'auto',
};

// on Vercel or Render never fall back to "dev" behaviour such as printing OTPs to the log
env.ON_RENDER = !!process.env.RENDER;   // Render sets RENDER=true on every service
env.isProd = env.NODE_ENV === 'production' || !!process.env.VERCEL || env.ON_RENDER;

// Keep-alive (see lib/scheduler.js): ping our own PUBLIC url so Render's free plan does not sleep.
// Render sets RENDER_EXTERNAL_URL automatically; KEEP_ALIVE_URL overrides it; KEEP_ALIVE=false turns it off.
env.KEEP_ALIVE_URL = process.env.KEEP_ALIVE === 'false' ? ''
  : (process.env.KEEP_ALIVE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
env.KEEP_ALIVE_MINUTES = Math.max(1, Number(process.env.KEEP_ALIVE_MINUTES) || 2);

// Daily jobs inside the server process (AMC reminders, cleanup). On by default on an always-running
// production server (Render); off locally and on Vercel (vercel.json crons do it there). RUN_JOBS=true/false overrides.
env.RUN_JOBS = process.env.RUN_JOBS ? process.env.RUN_JOBS === 'true' : env.isProd && !process.env.VERCEL;
env.missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter((k) => !isSet(env[k]));
env.MAIL_PROVIDER = isSet(env.SMTP_USER) && isSet(env.SMTP_PASS) ? 'smtp'
  : isSet(env.RESEND_API_KEY) && !/xxx/i.test(env.RESEND_API_KEY) ? 'resend' : null;
env.MAIL_READY = !!env.MAIL_PROVIDER;
// Gmail only sends as the signed-in account, so default the sender to it
if (env.MAIL_PROVIDER === 'smtp' && !env.MAIL_FROM) env.MAIL_FROM = `Kohinoor AC <${env.SMTP_USER}>`;

if (env.missing.length) {
  console.error(`\n[config] ${env.missing.join(', ')} is missing or still a placeholder. Login/API will return 401 until it is set.\n`);
}
if (!env.MAIL_READY) console.warn('[config] Email not set up (SMTP_USER + SMTP_PASS, or RESEND_API_KEY): emails are NOT sent. In dev the OTP is printed in the console.');
else console.log(`[config] email via ${env.MAIL_PROVIDER === 'smtp' ? `SMTP ${env.SMTP_HOST} as ${env.SMTP_USER}` : 'Resend'}`);

module.exports = env;
