'use strict';
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const path    = require('path');
const config  = require('./config');
const checksRouter = require('./routes/checks');

const app = express();

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
    },
  },
}));
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Serve frontend single page app
app.use(express.static(path.join(__dirname, '../public')));

// ── Routes ─────────────────────────────────────────────────────────────────
app.use('/checks', checksRouter);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'baatmeedar', ts: new Date().toISOString() });
});

// 404
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler — JSON parse errors (SyntaxError from express.json) → 400
app.use((err, _req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  }
  next(err);
});

// Generic error handler → 500
app.use((err, _req, res, _next) => {
  console.error('[Server Error]', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(config.port, () => {
  console.log(`[BAATMEEDAR] Server running on http://localhost:${config.port}`);
});

module.exports = app;
