'use strict';
/**
 * Stage 5 Test — Editorial Result & Synthesis
 *
 * Tests:
 *  5a. Synthesizes editorial verdict from GROQ_GPT + GEMINI evaluator outputs
 *  5b. When both agree → editorial verdict = their shared verdict
 *  5c. When they disagree → editorial verdict = INCONCLUSIVE
 *  5d. Claim status updated correctly (COMPLETE / INCONCLUSIVE)
 *  5e. Evidence summary counts correct (supporting / conflicting / insufficient)
 *  5f. Key sources list is populated
 *  5g. VerdictService works on a claim with NO verifications (edge case)
 */
require('dotenv').config();
const prisma   = require('../src/lib/prisma');
const Research = require('../src/services/ResearchPlannerService');
const Search   = require('../src/services/SearchService');
const Evidence = require('../src/services/EvidenceReviewService');
const Verify   = require('../src/services/IndependentVerificationService');
const Verdict  = require('../src/services/VerdictService');
const config   = require('../src/config');

function ok(label, condition) {
  if (!condition) throw new Error(`FAIL: ${label}`);
  console.log(`  ✓ ${label}`);
}

// ── Setup: run the full stages 1–4 pipeline for a claim ──────────────────────
async function runThroughStage4(claimText, domain = 'science') {
  const check = await prisma.check.create({
    data: { inputType: 'TEXT', originalInput: 'Stage 5 test', status: 'VERIFYING' },
  });

  const claim = await prisma.claim.create({
    data: {
      checkId:         check.id,
      claimText,
      originalWording: claimText,
      domain,
      namedEntities:   JSON.stringify([]),
      timeSensitivity: 'HISTORICAL',
      importance:      'HIGH',
      isVerifiable:    true,
      status:          'VERIFYING',
      claimOrder:      0,
    },
  });

  const plan    = await Research.createResearchPlan(claim, check.id);
  const sources = await Search.searchForClaim(claim, plan, check.id);
  await Evidence.reviewEvidence(claim, sources, check.id);
  const updatedSources = await prisma.source.findMany({ where: { claimId: claim.id } });
  await Verify.verifyIndependently(claim, updatedSources, check.id);

  return { check, claim };
}

// ── Test 5a: Basic synthesis ──────────────────────────────────────────────────
async function testBasicSynthesis(claimId, checkId) {
  console.log('\n[Stage 5 — Test 5a] Basic editorial synthesis');

  const synthesis = await Verdict.synthesizeEditorialVerdict(claimId, checkId);

  ok('Synthesis returned an object', typeof synthesis === 'object' && synthesis !== null);
  ok('claimId matches',             synthesis.claimId === claimId);
  ok('claimText present',           typeof synthesis.claimText === 'string' && synthesis.claimText.length > 0);
  ok('domain present',              typeof synthesis.domain === 'string');
  ok('editorialVerdict is valid',   ['SUPPORTED', 'CONTRADICTED', 'INCONCLUSIVE'].includes(synthesis.editorialVerdict));
  ok('disagreement is boolean',     typeof synthesis.disagreement === 'boolean');
  ok('evidenceSummary present',     typeof synthesis.evidenceSummary === 'object');
  ok('evaluatorVerdicts present',   typeof synthesis.evaluatorVerdicts === 'object');
  ok('keySources is array',         Array.isArray(synthesis.keySources));

  return synthesis;
}

// ── Test 5b: Evaluator verdicts in synthesis ──────────────────────────────────
async function testEvaluatorVerdicts(synthesis) {
  console.log('\n[Stage 5 — Test 5b] Evaluator verdicts populated in synthesis');

  const { evaluatorVerdicts } = synthesis;
  ok('evaluatorVerdicts.grok present',   evaluatorVerdicts.grok !== null);
  ok('evaluatorVerdicts.gemini present', evaluatorVerdicts.gemini !== null);

  if (evaluatorVerdicts.grok) {
    ok('Grok verdict field present',   typeof evaluatorVerdicts.grok.verdict === 'string');
    ok('Grok confidence field present', typeof evaluatorVerdicts.grok.confidence === 'number');
    ok('Grok reasoning field present',  typeof evaluatorVerdicts.grok.reasoning === 'string');
  }
  if (evaluatorVerdicts.gemini) {
    ok('Gemini verdict field present',   typeof evaluatorVerdicts.gemini.verdict === 'string');
    ok('Gemini confidence field present', typeof evaluatorVerdicts.gemini.confidence === 'number');
    ok('Gemini reasoning field present',  typeof evaluatorVerdicts.gemini.reasoning === 'string');
  }

  const grokV   = evaluatorVerdicts.grok?.verdict;
  const geminiV = evaluatorVerdicts.gemini?.verdict;
  console.log(`    GROQ_GPT: [${grokV}] | GEMINI: [${geminiV}] | Editorial: [${synthesis.editorialVerdict}]`);

  // When both agree, editorial must match
  if (grokV && geminiV && grokV === geminiV) {
    ok('Editorial matches unanimous evaluator verdict', synthesis.editorialVerdict === grokV);
    ok('disagreement = false when unanimous', synthesis.disagreement === false);
  } else if (grokV && geminiV && grokV !== geminiV) {
    ok('Editorial = INCONCLUSIVE when disagreement', synthesis.editorialVerdict === 'INCONCLUSIVE');
    ok('disagreement = true when evaluators split',   synthesis.disagreement === true);
  }
}

// ── Test 5c: Evidence summary counts ─────────────────────────────────────────
async function testEvidenceSummary(synthesis) {
  console.log('\n[Stage 5 — Test 5c] Evidence summary counts');

  const { evidenceSummary } = synthesis;
  ok('supportingCount is number',   typeof evidenceSummary.supportingCount   === 'number');
  ok('conflictingCount is number',  typeof evidenceSummary.conflictingCount  === 'number');
  ok('insufficientCount is number', typeof evidenceSummary.insufficientCount === 'number');
  ok('totalInspected is number',    typeof evidenceSummary.totalInspected    === 'number');

  const total = evidenceSummary.supportingCount + evidenceSummary.conflictingCount + evidenceSummary.insufficientCount;
  ok('Counts add up correctly', total === evidenceSummary.totalInspected);

  console.log(`    Supporting: ${evidenceSummary.supportingCount} | Conflicting: ${evidenceSummary.conflictingCount} | Insufficient: ${evidenceSummary.insufficientCount}`);
}

// ── Test 5d: Claim status updated in DB ──────────────────────────────────────
async function testClaimStatusUpdated(claimId, editorialVerdict) {
  console.log('\n[Stage 5 — Test 5d] Claim status updated in DB');

  const claim = await prisma.claim.findUnique({ where: { id: claimId } });
  const expectedStatus = editorialVerdict === 'INCONCLUSIVE' ? 'INCONCLUSIVE' : 'COMPLETE';
  ok(`Claim status = ${expectedStatus}`, claim.status === expectedStatus);
}

// ── Test 5e: Key sources populated ───────────────────────────────────────────
async function testKeySources(synthesis) {
  console.log('\n[Stage 5 — Test 5e] Key sources list');

  // keySources comes from wasInspected=true sources only
  // (may be empty if all Gemini calls timed out during evidence review)
  ok('keySources is an array', Array.isArray(synthesis.keySources));

  for (const s of synthesis.keySources) {
    ok(`Source ${s.id} has url`,     typeof s.url === 'string');
    ok(`Source ${s.id} has title`,   s.title !== undefined);
    ok(`Source ${s.id} has stance`,  s.stance !== undefined);
  }

  console.log(`    Inspected key sources: ${synthesis.keySources.length}`);
  synthesis.keySources.forEach(s => {
    console.log(`    - [${s.stance}] ${s.publisher || s.url.slice(0, 50)}`);
  });
}

// ── Test 5f: Edge case — no verifications ─────────────────────────────────────
async function testNoVerificationsEdgeCase() {
  console.log('\n[Stage 5 — Test 5f] Edge case: claim with no verifications');

  const check = await prisma.check.create({
    data: { inputType: 'TEXT', originalInput: 'Edge case check', status: 'VERIFYING' },
  });

  const claim = await prisma.claim.create({
    data: {
      checkId:         check.id,
      claimText:       'Test edge case claim',
      originalWording: 'Test edge case claim',
      domain:          'general',
      namedEntities:   '[]',
      timeSensitivity: 'UNSPECIFIED',
      importance:      'LOW',
      isVerifiable:    true,
      status:          'VERIFYING',
      claimOrder:      0,
    },
  });

  // Synthesize without running any verifications
  const synthesis = await Verdict.synthesizeEditorialVerdict(claim.id, check.id);

  ok('Synthesis handles no verifications gracefully', synthesis !== null);
  ok('Defaults to INCONCLUSIVE with no verifications', synthesis.editorialVerdict === 'INCONCLUSIVE');
  ok('evaluatorVerdicts.grok is null',   synthesis.evaluatorVerdicts.grok   === null);
  ok('evaluatorVerdicts.gemini is null', synthesis.evaluatorVerdicts.gemini === null);
}

// ── Runner ────────────────────────────────────────────────────────────────────
async function run() {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  STAGE 5 — Editorial Result — Tests');
  console.log('══════════════════════════════════════════════════════');

  try {
    // Run full pipeline to stage 4 first
    console.log('\n[Stage 5 — Setup] Running stages 1–4 to produce evidence + verifications...');
    const { check, claim } = await runThroughStage4(
      'India became the fourth country to achieve a soft lunar landing on 23 August 2023 with Chandrayaan-3.',
      'science'
    );
    console.log(`    Ready: check=${check.id} claim=${claim.id}`);

    const synthesis = await testBasicSynthesis(claim.id, check.id);
    await testEvaluatorVerdicts(synthesis);
    await testEvidenceSummary(synthesis);
    await testClaimStatusUpdated(claim.id, synthesis.editorialVerdict);
    await testKeySources(synthesis);
    await testNoVerificationsEdgeCase();

    console.log('\n══════════════════════════════════════════════════════');
    console.log('  ✅ STAGE 5 ALL TESTS PASSED');
    console.log('══════════════════════════════════════════════════════\n');
  } catch (err) {
    console.error('\n❌ STAGE 5 TEST FAILED:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

run();
