'use strict';
const rateLimit = require('express-rate-limit');
const config    = require('../config');

/**
 * Standard rate limiter for the /checks routes.
 * Window and max are configurable via env vars.
 * Returns 429 JSON (not the default HTML) on breach.
 */
const checksRateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max:      config.rateLimit.max,
  standardHeaders: true,   // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders:   false,  // Disable the `X-RateLimit-*` headers
  handler: (_req, res) => {
    res.status(429).json({
      error: 'Too many requests. Please slow down.',
      retryAfterMs: config.rateLimit.windowMs,
    });
  },
});

/**
 * Strict rate limiter for write operations (POST /checks).
 * Half the window, half the allowance of the read limiter.
 */
const submitRateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max:      Math.max(1, Math.floor(config.rateLimit.max / 2)),
  standardHeaders: true,
  legacyHeaders:   false,
  handler: (_req, res) => {
    res.status(429).json({
      error: 'Submission rate limit exceeded. Please wait before submitting another check.',
      retryAfterMs: config.rateLimit.windowMs,
    });
  },
});

module.exports = { checksRateLimiter, submitRateLimiter };
