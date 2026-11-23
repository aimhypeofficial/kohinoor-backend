// Long-running server: local development (npm run dev) and hosts like Render (npm start).
// On Vercel, api/index.js exports the app instead and this file is not used.
const app = require('./app');
const env = require('./config/env');
const { startKeepAlive, startDailyJobs, stopAll } = require('./lib/scheduler');

const server = app.listen(env.PORT, () => {
  console.log(`API on http://localhost:${env.PORT}  (health: /api/health)`);
  if (env.RUN_JOBS) startDailyJobs();
  startKeepAlive();
});

// Render sends SIGTERM before a deploy or restart: finish open requests, then exit.
const shutdown = (signal) => {
  console.log(`${signal} received, shutting down`);
  stopAll();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
