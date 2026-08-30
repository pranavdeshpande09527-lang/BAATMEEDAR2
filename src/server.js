'use strict';
require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const path     = require('path');
const crypto   = require('crypto');
const { version } = require('../package.json');

const config  = require('./config');
const prisma  = require('./lib/prisma');
const { logger, runWithRequestId } = require('./lib/logger');
const { checksRateLimiter } = require('./middleware/rateLimiter');
const checksRouter = require('./routes/checks');

const app = express();

// ── Trust proxy (for correct IP behind Nginx / load balancer) ──────────────
app.set('trust proxy', 1);

// ── CORS ───────────────────────────────────────────────────────────────────
const rawOrigins = config.allowedOrigins;
const corsOptions = rawOrigins === '*'
  ? { origin: '*' }
  : {
      origin: rawOrigins.split(',').map(o => o.trim()),
      methods: ['GET', 'POST'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    };
app.use(cors(corsOptions));

// ── Helmet (security headers) ──────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],       // No unsafe-inline
      styleSrc:   ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:    ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:     ["'self'", 'data:'],
      connectSrc: ["'self'"],
    },
  },
}));

// ── Request ID ─────────────────────────────────────────────────────────────
// Assigns a unique ID to every incoming request for end-to-end tracing.
app.use((req, res, next) => {
  const requestId = crypto.randomUUID();
  res.setHeader('X-Request-Id', requestId);
  runWithRequestId(requestId, next);
});

// ── Body parser ────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));

// ── HTTP request logger ─────────────────────────────────────────────────────
app.use((req, _res, next) => {
  logger.info({ method: req.method, url: req.url }, 'incoming request');
  next();
});

// ── Static frontend ─────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../public')));

// ── Routes ─────────────────────────────────────────────────────────────────
app.use('/checks', checksRateLimiter, checksRouter);

// ── Health check ────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  let dbStatus = 'ok';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (e) {
    dbStatus = 'error';
    logger.error({ err: e }, 'Health check DB ping failed');
  }

  const status = dbStatus === 'ok' ? 200 : 503;
  res.status(status).json({
    status:   dbStatus === 'ok' ? 'ok' : 'degraded',
    service:  'baatmeedar',
    version,
    env:      config.nodeEnv,
    uptime:   Math.floor(process.uptime()),
    db:       dbStatus,
    ts:       new Date().toISOString(),
  });
});

// ── 404 ─────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Error handlers ──────────────────────────────────────────────────────────
// JSON parse errors (SyntaxError from express.json) → 400
app.use((err, _req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  }
  next(err);
});

// Generic error handler → 500
app.use((err, req, res, _next) => {
  logger.error({ err, method: req.method, url: req.url }, 'unhandled server error');
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Start ───────────────────────────────────────────────────────────────────
const server = app.listen(config.port, () => {
  logger.info({ port: config.port, env: config.nodeEnv, version }, 'BAATMEEDAR server started');
});

// ── Graceful shutdown ───────────────────────────────────────────────────────
// Stops accepting new connections, waits up to 30s for in-flight requests,
// then closes the Prisma connection pool cleanly.
let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ signal }, 'Shutdown signal received — draining connections...');

  const forceExitTimer = setTimeout(() => {
    logger.error('Forced exit after 30s drain timeout');
    process.exit(1);
  }, 30_000);
  forceExitTimer.unref();

  server.close(async () => {
    try {
      await prisma.$disconnect();
      logger.info('Graceful shutdown complete');
      clearTimeout(forceExitTimer);
      process.exit(0);
    } catch (e) {
      logger.error({ err: e }, 'Error during Prisma disconnect');
      process.exit(1);
    }
  });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

// Catch unhandled promise rejections — log and exit so the process manager restarts cleanly
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
  gracefulShutdown('unhandledRejection');
});

module.exports = app;
