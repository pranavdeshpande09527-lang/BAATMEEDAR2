'use strict';
const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const prisma  = require('../lib/prisma');
const config  = require('../config');
const { logger } = require('../lib/logger');
const { submitRateLimiter } = require('../middleware/rateLimiter');
const PipelineService = require('../services/PipelineService');

const router = express.Router();

// ── SSRF Guard ─────────────────────────────────────────────────────────────
// Blocks private, loopback, and link-local IP ranges to prevent SSRF.
const PRIVATE_IP_RE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|169\.254\.|0\.0\.0\.0|::1|fc00:|fd)/i;

function validateArticleUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch (_e) {
    throw new Error('input must be a valid URL for ARTICLE type');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('input URL must use http or https protocol');
  }
  if (!parsed.hostname || PRIVATE_IP_RE.test(parsed.hostname)) {
    throw new Error('input URL must not target private or loopback addresses');
  }
  return true;
}

// ── Validation middleware ──────────────────────────────────────────────────
function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
}

// ── POST /checks — Submit a new verification job ───────────────────────────
router.post('/',
  submitRateLimiter,
  body('inputType')
    .isIn(['TEXT', 'ARTICLE', 'YOUTUBE'])
    .withMessage('inputType must be TEXT, ARTICLE, or YOUTUBE'),
  body('input')
    .isString().trim().isLength({ min: 1, max: 10000 })
    .withMessage('input is required (max 10000 chars)')
    .if(body('inputType').equals('ARTICLE'))
    .custom(validateArticleUrl)
    .withMessage('ARTICLE input must be a valid http/https URL with a public hostname'),
  validate,
  async (req, res) => {
    try {
      const { inputType, input } = req.body;

      const check = await prisma.check.create({
        data: {
          inputType,
          originalInput: input,
          status: 'PENDING',
        },
      });

      // Kick off the pipeline asynchronously (don't await)
      PipelineService.run(check.id).catch(err => {
        logger.error({ checkId: check.id, err }, 'Pipeline run failed');
      });

      logger.info({ checkId: check.id, inputType }, 'Check submitted');
      res.status(202).json({
        checkId: check.id,
        status: check.status,
        message: 'Verification job accepted. Poll /checks/:id/status for progress.',
      });
    } catch (err) {
      logger.error({ err }, 'POST /checks failed');
      res.status(500).json({ error: 'Failed to create check' });
    }
  }
);

// ── GET /checks — List recent verification jobs (paginated) ──────────────
router.get('/',
  query('page').optional().isInt({ min: 1 }).toInt().withMessage('page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt().withMessage('limit must be 1–100'),
  validate,
  async (req, res) => {
    try {
      const page  = req.query.page  || 1;
      const limit = req.query.limit || 20;
      const skip  = (page - 1) * limit;

      const [checks, total] = await Promise.all([
        prisma.check.findMany({
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            inputType: true,
            originalInput: true,
            sourceTitle: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            claims: {
              select: {
                id: true,
                claimText: true,
                status: true,
                isVerifiable: true,
              },
            },
          },
        }),
        prisma.check.count(),
      ]);

      res.json({
        data: checks,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    } catch (err) {
      logger.error({ err }, 'GET /checks failed');
      res.status(500).json({ error: 'Failed to fetch checks' });
    }
  }
);

// ── GET /checks/:id — Full check record ───────────────────────────────────
router.get('/:id',
  param('id').isString().trim().isLength({ min: 1, max: 64 }),
  validate,
  async (req, res) => {
    try {
      const check = await prisma.check.findUnique({
        where: { id: req.params.id },
        include: {
          claims: {
            include: {
              sources: true,
              evidenceReviews: true,
              verifications: true,
            },
          },
          apiUsageLogs: {
            orderBy: { createdAt: 'asc' },
          },
        },
      });
      if (!check) return res.status(404).json({ error: 'Check not found' });
      res.json(check);
    } catch (err) {
      logger.error({ err, checkId: req.params.id }, 'GET /checks/:id failed');
      res.status(500).json({ error: 'Failed to fetch check' });
    }
  }
);

// ── GET /checks/:id/status — Lightweight status poll ─────────────────────
router.get('/:id/status',
  param('id').isString().trim().isLength({ min: 1, max: 64 }),
  validate,
  async (req, res) => {
    try {
      const check = await prisma.check.findUnique({
        where: { id: req.params.id },
        select: {
          id: true,
          status: true,
          updatedAt: true,
          claims: { select: { id: true, status: true, claimText: true } },
        },
      });
      if (!check) return res.status(404).json({ error: 'Check not found' });
      res.json(check);
    } catch (err) {
      logger.error({ err, checkId: req.params.id }, 'GET /checks/:id/status failed');
      res.status(500).json({ error: 'Failed to fetch status' });
    }
  }
);

// ── GET /checks/:id/result — Final editorial result ───────────────────────
router.get('/:id/result',
  param('id').isString().trim().isLength({ min: 1, max: 64 }),
  validate,
  async (req, res) => {
    try {
      const check = await prisma.check.findUnique({
        where: { id: req.params.id },
        include: {
          claims: {
            where: { isVerifiable: true },
            orderBy: { claimOrder: 'asc' },
            include: {
              sources: {
                where: { wasInspected: true },
                orderBy: { createdAt: 'asc' },
              },
              evidenceReviews: true,
              verifications: {
                orderBy: { createdAt: 'asc' },
              },
            },
          },
        },
      });

      if (!check) return res.status(404).json({ error: 'Check not found' });
      if (check.status !== 'COMPLETE') {
        return res.status(202).json({
          checkId: check.id,
          status: check.status,
          message: 'Verification is still in progress.',
        });
      }

      res.json(check);
    } catch (err) {
      logger.error({ err, checkId: req.params.id }, 'GET /checks/:id/result failed');
      res.status(500).json({ error: 'Failed to fetch result' });
    }
  }
);

module.exports = router;
