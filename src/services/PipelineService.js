'use strict';
const prisma  = require('../lib/prisma');
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

async function run(checkId) {
  console.log(`[Pipeline] Starting verification for check: ${checkId}`);

  try {
    const check = await prisma.check.findUnique({ where: { id: checkId } });
    if (!check) throw new Error(`Check ${checkId} not found`);

    // ── STAGE 1: Input Collection ──────────────────────────────────────────
    await setStatus(checkId, 'INGESTING');
    console.log(`[Pipeline][Stage 1] Ingesting input (${check.inputType})...`);
    const extractedText = await InputService.processInput(check);

    if (!extractedText || extractedText.trim().length === 0) {
      throw new Error('No content could be extracted from input');
    }

    // ── STAGE 2: Claim Extraction & Classification (Gemini) ────────────────
    await setStatus(checkId, 'EXTRACTING_CLAIMS');
    console.log(`[Pipeline][Stage 2] Extracting atomic factual claims...`);
    const claims = await ClaimExtractionService.extractClaims(checkId, extractedText);
    console.log(`[Pipeline][Stage 2] Extracted ${claims.length} claims`);

    // ── STAGE 3 & 4: Claim-Specific Research & Independent Verification ───
    await setStatus(checkId, 'RESEARCHING');

    for (const claim of claims) {
      if (!claim.isVerifiable) {
        console.log(`[Pipeline] Skipping non-verifiable claim: ${claim.id}`);
        await prisma.claim.update({ where: { id: claim.id }, data: { status: 'SKIPPED' } });
        continue;
      }

      await prisma.claim.update({ where: { id: claim.id }, data: { status: 'RESEARCHING' } });

      // Stage 3a: Hermes Research Plan
      console.log(`[Pipeline][Stage 3a] Creating research plan for claim: ${claim.id}`);
      const plan = await ResearchPlannerService.createResearchPlan(claim, checkId);

      // Stage 3b: Tavily Search & Sourcing
      console.log(`[Pipeline][Stage 3b] Searching sources for claim: ${claim.id}`);
      const sources = await SearchService.searchForClaim(claim, plan, checkId);

      // Stage 3c & 3d: Groq & Gemini Evidence Review
      console.log(`[Pipeline][Stage 3c/d] Reviewing evidence for claim: ${claim.id}`);
      await EvidenceReviewService.reviewEvidence(claim, sources, checkId);

      // ── STAGE 4: Dual-Blind Independent Verification (Groq & Gemini) ─────
      await setStatus(checkId, 'VERIFYING');
      await prisma.claim.update({ where: { id: claim.id }, data: { status: 'VERIFYING' } });
      console.log(`[Pipeline][Stage 4] Running dual-blind verification for claim: ${claim.id}`);
      await IndependentVerificationService.verifyIndependently(claim, sources, checkId);

      // ── STAGE 5: Editorial Synthesis ─────────────────────────────────────
      console.log(`[Pipeline][Stage 5] Synthesizing editorial verdict for claim: ${claim.id}`);
      await VerdictService.synthesizeEditorialVerdict(claim.id, checkId);
    }

    await setStatus(checkId, 'COMPLETE');
    console.log(`[Pipeline] Verification completed successfully for check: ${checkId}`);
  } catch (err) {
    console.error(`[Pipeline] Check ${checkId} failed:`, err.message);
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
