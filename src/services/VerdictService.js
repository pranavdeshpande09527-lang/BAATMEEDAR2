'use strict';
const prisma = require('../lib/prisma');
const Budget = require('./ApiBudgetService');
const config = require('../config');

/**
 * VerdictService — Stage 5: Editorial result & synthesis.
 *
 * Synthesizes:
 * - Claim text, domain, temporal scope
 * - Supporting vs Conflicting vs Insufficient evidence records
 * - Independent Grok and Gemini verification outputs
 * - Final editorial status for each claim (SUPPORTED, CONTRADICTED, INCONCLUSIVE)
 * - Identifies evaluator disagreements, remaining uncertainties, and limitations
 */

async function synthesizeEditorialVerdict(claimId, checkId) {
  const claim = await prisma.claim.findUnique({
    where: { id: claimId },
    include: {
      sources: {
        where: { wasInspected: true },
      },
      evidenceReviews: true,
      verifications: true,
    },
  });

  if (!claim) throw new Error(`Claim not found: ${claimId}`);

  // Separate evidence by stance
  const supporting = claim.sources.filter(s => s.stance === 'SUPPORTS');
  const conflicting = claim.sources.filter(s => s.stance === 'CONTRADICTS');
  const insufficient = claim.sources.filter(s => s.stance === 'INSUFFICIENT' || !s.stance);

  const grokVerification   = claim.verifications.find(v => v.modelName === 'GROQ_GPT');
  const geminiVerification = claim.verifications.find(v => v.modelName === 'GEMINI');

  // Determine editorial verdict: evidence-first rule (not a simple majority vote)
  let editorialVerdict = config.verdicts.INCONCLUSIVE;
  let disagreement = false;

  if (grokVerification && geminiVerification) {
    if (grokVerification.verdict === geminiVerification.verdict) {
      editorialVerdict = grokVerification.verdict || config.verdicts.INCONCLUSIVE;
    } else {
      disagreement = true;
      // When evaluators disagree or evidence is mixed, default to INCONCLUSIVE
      editorialVerdict = config.verdicts.INCONCLUSIVE;
    }
  } else if (grokVerification) {
    editorialVerdict = grokVerification.verdict || config.verdicts.INCONCLUSIVE;
  } else if (geminiVerification) {
    editorialVerdict = geminiVerification.verdict || config.verdicts.INCONCLUSIVE;
  }

  // Update claim status with final verdict
  await prisma.claim.update({
    where: { id: claimId },
    data: {
      status: editorialVerdict === config.verdicts.INCONCLUSIVE ? 'INCONCLUSIVE' : 'COMPLETE',
    },
  });

  const synthesis = {
    claimId: claim.id,
    claimText: claim.claimText,
    domain: claim.domain,
    timeReference: claim.timeReference,
    timeSensitivity: claim.timeSensitivity,
    materialContext: claim.materialContext,
    ambiguityNotes: claim.ambiguityNotes,
    editorialVerdict,
    disagreement,
    evidenceSummary: {
      supportingCount: supporting.length,
      conflictingCount: conflicting.length,
      insufficientCount: insufficient.length,
      totalInspected: claim.sources.length,
    },
    evaluatorVerdicts: {
      grok: grokVerification ? {
        verdict: grokVerification.verdict,
        confidence: grokVerification.confidence,
        reasoning: grokVerification.reasoning,
        limitations: grokVerification.limitations,
      } : null,
      gemini: geminiVerification ? {
        verdict: geminiVerification.verdict,
        confidence: geminiVerification.confidence,
        reasoning: geminiVerification.reasoning,
        limitations: geminiVerification.limitations,
      } : null,
    },
    keySources: claim.sources.map(s => ({
      id: s.id,
      url: s.url,
      title: s.title,
      publisher: s.publisher,
      stance: s.stance,
      relevantExcerpt: s.relevantExcerpt,
    })),
  };

  return synthesis;
}

module.exports = { synthesizeEditorialVerdict };
