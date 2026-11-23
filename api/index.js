// Vercel serverless entry. vercel.json rewrites every request to this function;
// Vercel's Node runtime calls the Express app as a (req, res) handler.
module.exports = require('../src/app');
