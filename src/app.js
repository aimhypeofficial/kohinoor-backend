// Builds the Express app. No listen() here: Vercel imports it from api/index.js,
// and src/server.js starts it locally.
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const env = require('./config/env');
const routes = require('./routes');
const { notFound, errorHandler } = require('./lib/http');

const app = express();
app.set('trust proxy', 1);   // behind Vercel's / Render's proxy: req.ip must be the client, not the proxy
app.disable('x-powered-by');
app.use(helmet());
// CORS_ORIGIN=* allows every website. Safe here because the API uses Bearer tokens, not cookies:
// another site cannot call it as a signed-in user without that user's token.
const corsOrigin = env.CORS_ORIGIN.includes('*') ? '*' : env.CORS_ORIGIN.length ? env.CORS_ORIGIN : false;
app.use(cors({ origin: corsOrigin }));

// small JSON bodies everywhere, except the photo upload route which has its own bigger parser
const jsonSmall = express.json({ limit: '100kb' });
const PHOTO_UPLOAD = /^\/api\/tasks\/[^/]+\/photos$/;
app.use((req, res, next) => (req.method === 'POST' && PHOTO_UPLOAD.test(req.path) ? next() : jsonSmall(req, res, next)));

// per server instance (in memory); good enough against simple abuse
// Render sits behind Cloudflare, which puts the real client address in CF-Connecting-IP (and overwrites any
// value the client sends). Without this, req.ip could be a shared proxy address and all users would share
// one limit. Only trusted on Render; elsewhere the header could be faked, so req.ip is used.
const clientIp = (req) => (env.ON_RENDER && req.headers['cf-connecting-ip']) || req.ip;
app.use('/api', rateLimit({
  windowMs: 60_000, max: env.RATE_LIMIT_PER_MIN, standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: clientIp,
  skip: (req) => req.path === '/health',   // health checks and the keep-alive ping
}));

app.get('/', (_req, res) => res.json({ name: 'Kohinoor AC Field Service API', health: '/api/health' }));
app.use('/api', routes);
app.use(notFound);
app.use(errorHandler);

module.exports = app;
