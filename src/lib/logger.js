'use strict';
const pino = require('pino');
const { AsyncLocalStorage } = require('async_hooks');

// ── Request-ID propagation ────────────────────────────────────────────────────
// Stores the active requestId so any logger call in the same async context
// automatically includes it without threading it through every function call.
const requestIdStorage = new AsyncLocalStorage();

function getRequestId() {
  return requestIdStorage.getStore()?.requestId ?? undefined;
}

function runWithRequestId(requestId, fn) {
  return requestIdStorage.run({ requestId }, fn);
}

// ── Pino Logger ────────────────────────────────────────────────────────────────
const isDev = process.env.NODE_ENV !== 'production';

const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
        },
      }
    : {}),
  // Always include requestId if one is set in the async context
  mixin() {
    const rid = getRequestId();
    return rid ? { requestId: rid } : {};
  },
  base: { service: 'baatmeedar' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

module.exports = { logger, getRequestId, runWithRequestId };
