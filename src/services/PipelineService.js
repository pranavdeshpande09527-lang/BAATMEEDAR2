'use strict';
const prisma  = require('../lib/prisma');
const { logger } = require('../lib/logger');
const config  = require('../config');
const InputService = require('./InputService');
const ClaimExtractionService = require('./ClaimExtractionService');
const ResearchPlannerService = require('./ResearchPlannerService');
const SearchService = require('./SearchService');
const EvidenceReviewService = require('./EvidenceReviewService');
const IndependentVerificationService = require('./IndependentVerificationService');
const VerdictService = require('./VerdictService');

/**
 * PipelineService — Orchestrates the complete 5-stage BAATMEEDAR verification pipeline.
 *
 * Stage 1: Input Collection (InputService)
 * Stage 2: Claim Extraction & Classification (ClaimExtractionService)
 * Stage 3: Research Planning, Sourcing & Review (ResearchPlannerService, SearchService, EvidenceReviewService)
 * Stage 4: Dual-Blind Independent Verification (IndependentVerificationService)
 * Stage 5: Editorial Result & Synthesis (VerdictService)
 */

function pipelineTimeout(ms) {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Pipeline timed out after ${ms}ms`)), ms)
  );
}

async function _runPipeline(checkId) {
  logger.info({ checkId }, '[Pipeline] Starting verification');

  const check = await prisma.check.findUnique({ where: { id: checkId } });
  if (!check) throw new Error(`Check ${checkId} not found`);

  // ── STAGE 1: Input Collection ──────────────────────────────────────────
  await setStatus(checkId, 'INGESTING');
  logger.info({ checkId, inputType: check.inputType }, '[Stage 1] Ingesting input');
  const extractedText = await InputService.processInput(check);

  if (!extractedText || extractedText.trim().length === 0) {
    throw new Error('No content could be extracted from input');
  }

  // ── STAGE 2: Claim Extraction & Classification (Gemini) ────────────────
  await setStatus(checkId, 'EXTRACTING_CLAIMS');
  logger.info({ checkId }, '[Stage 2] Extracting atomic factual claims');
  const claims = await ClaimExtractionService.extractClaims(checkId, extractedText);
  logger.info({ checkId, claimCount: claims.length }, '[Stage 2] Claims extracted');

  // ── STAGE 3 & 4: Claim-Specific Research & Independent Verification ───
  await setStatus(checkId, 'RESEARCHING');

  for (const claim of claims) {
    if (!claim.isVerifiable) {
      logger.info({ checkId, claimId: claim.id }, '[Pipeline] Skipping non-verifiable claim');
      await prisma.claim.update({ where: { id: claim.id }, data: { status: 'SKIPPED' } });
      continue;
    }

    await prisma.claim.update({ where: { id: claim.id }, data: { status: 'RESEARCHING' } });

    // Stage 3a: Hermes Research Plan
    logger.info({ checkId, claimId: claim.id }, '[Stage 3a] Creating research plan');
    const plan = await ResearchPlannerService.createResearchPlan(claim, checkId);

    // Stage 3b: Tavily Search & Sourcing
    logger.info({ checkId, claimId: claim.id }, '[Stage 3b] Searching sources');
    const sources = await SearchService.searchForClaim(claim, plan, checkId);

    // Stage 3c & 3d: Groq & Gemini Evidence Review
    logger.info({ checkId, claimId: claim.id }, '[Stage 3c/d] Reviewing evidence');
    await EvidenceReviewService.reviewEvidence(claim, sources, checkId);

    // ── STAGE 4: Dual-Blind Independent Verification (Groq & Gemini) ─────
    await setStatus(checkId, 'VERIFYING');
    await prisma.claim.update({ where: { id: claim.id }, data: { status: 'VERIFYING' } });
    logger.info({ checkId, claimId: claim.id }, '[Stage 4] Running dual-blind verification');
    await IndependentVerificationService.verifyIndependently(claim, sources, checkId);

    // ── STAGE 5: Editorial Synthesis ─────────────────────────────────────
    logger.info({ checkId, claimId: claim.id }, '[Stage 5] Synthesizing editorial verdict');
    await VerdictService.synthesizeEditorialVerdict(claim.id, checkId);
  }

  await setStatus(checkId, 'COMPLETE');
  logger.info({ checkId }, '[Pipeline] Verification completed successfully');
}

async function run(checkId) {
  try {
    await Promise.race([
      _runPipeline(checkId),
      pipelineTimeout(config.pipelineTimeoutMs),
    ]);
  } catch (err) {
    logger.error({ checkId, err }, '[Pipeline] Check failed');
    await setStatus(checkId, 'FAILED').catch(() => {});
    throw err;
  }
}

async function setStatus(checkId, status) {
  await prisma.check.update({
    where: { id: checkId },
    data: { status },
  });
}

module.exports = { run };
