// Error helpers shared by every route.
const { isProd } = require('../config/env');

// 5xx details (DB / provider messages) stay in the server log; in production the client only gets a generic text
const publicMessage = (status, message) => (status >= 500 && isProd ? 'Server error, please try again' : message || 'Server error');

// throw fail(404, 'Task not found') -> JSON { error } with that status
const fail = (status, message) => Object.assign(new Error(message), { status });

// wraps an async handler so thrown errors become JSON responses (zod errors -> 400)
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((e) => {
  const status = e.status || (e.errors ? 400 : 500);
  if (status >= 500) console.error(e);
  res.status(status).json({ error: e.errors ? 'Invalid input' : publicMessage(status, e.message) });
});

const notFound = (req, res) => res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });

// last middleware: errors thrown outside wrap() (e.g. invalid JSON body)
const errorHandler = (err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.type === 'entity.parse.failed' ? 'Invalid JSON body'
    : err.type === 'entity.too.large' ? 'Request is too large' : publicMessage(status, err.message) });
};

const sendFile = (res, { type, name, body }) => {
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(body);
};

module.exports = { fail, wrap, notFound, errorHandler, sendFile };
