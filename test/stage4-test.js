'use strict';
/**
 * Stage 4 Test — Independent Verification (Dual-Blind)
 *
 * Tests:
 *  4a. Both GROQ_GPT and GEMINI evaluators run in parallel
 *  4b. Neither evaluator sees the other's output (isolation enforced by design)
 *  4c. Verdict is one of SUPPORTED | CONTRADICTED | INCONCLUSIVE
 *  4d. Confidence is clamped [0.0 – 1.0]
 *  4e. Prompt hashes are recorded and different between evaluators (isolation proof)
 *  4f. Both ModelVerification records persisted to DB with correct schema
 *  4g. API usage logged for both evaluators
 */
require('dotenv').config();
const prisma   = require('../src/lib/prisma');
const Search   = require('../src/services/SearchService');
const Research = require('../src/services/ResearchPlannerService');
const Evidence = require('../src/services/EvidenceReviewService');
const Verify   = require('../src/services/IndependentVerificationService');
const config   = require('../src/config');

function ok(label, condition) {
  if (!condition) throw new Error(`FAIL: ${label}`);
  console.log(`  ✓ ${label}`);
}

// ── Setup: full Stage 1-3 setup to produce a real evidence packet ─────────────
async function setupWithEvidence() {
  console.log('[Stage 4 — Setup] Creating check + claim + evidence packet...');

  const check = await prisma.check.create({
    data: { inputType: 'TEXT', originalInput: 'Stage 4 test', status: 'VERIFYING' },
  });

  const claim = await prisma.claim.create({
    data: {
      checkId:         check.id,
      claimText:       'India became the fourth country to land on the Moon on 23 August 2023 with Chandrayaan-3.',
      originalWording: 'India is the fourth country to land on the Moon',
      domain:          'science',
      namedEntities:   JSON.stringify(['India', 'Chandrayaan-3', 'Moon']),
      timeReference:   'August 2023',
      timeSensitivity: 'HISTORICAL',
      materialContext: 'Chandrayaan-3 south pole moon landing',
      importance:      'HIGH',
      isVerifiable:    true,
      status:          'VERIFYING',
      claimOrder:      0,
    },
  });

  // Create research plan + search + evidence review (reuse Stage 3 services)
  const plan    = await Research.createResearchPlan(claim, check.id);
  const sources = await Search.searchForClaim(claim, plan, check.id);
  await Evidence.reviewEvidence(claim, sources, check.id);

  // Re-fetch sources with updated stances for verifier
  const updatedSources = await prisma.source.findMany({ where: { claimId: claim.id } });

  console.log(`    Check: ${check.id} | Claim: ${claim.id}`);
  console.log(`    Sources for evidence packet: ${updatedSources.length}`);

  return { check, claim, sources: updatedSources };
}

// ── Test 4a: Dual-blind parallel execution ────────────────────────────────────
async function testDualBlindVerification(claim, sources, checkId) {
  console.log('\n[Stage 4 — Test 4a/b] Dual-blind parallel verification');

  const { grokVerification, geminiVerification } = await Verify.verifyIndependently(claim, sources, checkId);

  // Both records returned
  ok('Grok verification returned',   grokVerification  !== null && grokVerification  !== undefined);
  ok('Gemini verification returned', geminiVerification !== null && geminiVerification !== undefined);

  return { grokVerification, geminiVerification };
}

// ── Test 4c: Verdict values ───────────────────────────────────────────────────
async function testVerdictValues(grokV, geminiV) {
  console.log('\n[Stage 4 — Test 4c] Verdict values');
  const validVerdicts = ['SUPPORTED', 'CONTRADICTED', 'INCONCLUSIVE'];

  ok('Grok verdict is valid',   validVerdicts.includes(grokV.verdict));
  ok('Gemini verdict is valid', validVerdicts.includes(geminiV.verdict));

  console.log(`    Grok   verdict: [${grokV.verdict}] (confidence: ${grokV.confidence})`);
  console.log(`    Gemini verdict: [${geminiV.verdict}] (confidence: ${geminiV.confidence})`);
}

// ── Test 4d: Confidence clamped ───────────────────────────────────────────────
async function testConfidenceClamping(grokV, geminiV) {
  console.log('\n[Stage 4 — Test 4d] Confidence clamped [0, 1]');

  ok('Grok confidence 0–1',   grokV.confidence  >= 0 && grokV.confidence  <= 1);
  ok('Gemini confidence 0–1', geminiV.confidence >= 0 && geminiV.confidence <= 1);
  ok('Grok confidence is a number',   typeof grokV.confidence  === 'number');
  ok('Gemini confidence is a number', typeof geminiV.confidence === 'number');
}

// ── Test 4e: Prompt hash isolation ────────────────────────────────────────────
async function testPromptHashIsolation(grokV, geminiV) {
  console.log('\n[Stage 4 — Test 4e] Prompt hash isolation (dual-blind)');

  ok('Grok has promptHash',   grokV.promptHash  !== null && grokV.promptHash  !== undefined);
  ok('Gemini has promptHash', geminiV.promptHash !== null && geminiV.promptHash !== undefined);
  ok('Prompt hashes are different (evaluators isolated)', grokV.promptHash !== geminiV.promptHash);
}

// ── Test 4f: DB records ───────────────────────────────────────────────────────
async function testDbRecords(claimId) {
  console.log('\n[Stage 4 — Test 4f] ModelVerification DB records');

  const records = await prisma.modelVerification.findMany({
    where: { claimId },
  });

  ok('Exactly 2 verification records', records.length === 2);

  const modelNames = records.map(r => r.modelName);
  ok('GROQ_GPT record exists', modelNames.includes('GROQ_GPT'));
  ok('GEMINI record exists',   modelNames.includes('GEMINI'));

  for (const r of records) {
    ok(`${r.modelName} has reasoning`, typeof r.reasoning === 'string' && r.reasoning.length > 5);
    ok(`${r.modelName} verdict is valid`, ['SUPPORTED', 'CONTRADICTED', 'INCONCLUSIVE'].includes(r.verdict));
    ok(`${r.modelName} confidence is float`, typeof r.confidence === 'number');
    ok(`${r.modelName} promptHash stored`, typeof r.promptHash === 'string');
  }
}

// ── Test 4g: API usage logs ───────────────────────────────────────────────────
async function testApiLogs(checkId, claimId) {
  console.log('\n[Stage 4 — Test 4g] API usage logs for both evaluators');

  const grokLog = await prisma.apiUsageLog.findMany({
    where: { checkId, claimId, endpoint: 'independent_verification_evaluator_a' },
  });
  const geminiLog = await prisma.apiUsageLog.findMany({
    where: { checkId, claimId, endpoint: 'independent_verification_evaluator_b' },
  });

  ok('Grok evaluator API call logged',   grokLog.length  >= 1);
  ok('Gemini evaluator API call logged', geminiLog.length >= 1);
  ok('Grok log stage = VERIFICATION',   grokLog[0].stage  === config.stages.VERIFICATION);
  ok('Gemini log stage = VERIFICATION', geminiLog[0].stage === config.stages.VERIFICATION);
}

// ── Test 4h: Upsert idempotency (re-run doesn't create duplicates) ────────────
async function testUpsertIdempotency(claim, sources, checkId) {
  console.log('\n[Stage 4 — Test 4h] Upsert idempotency (re-run = update, not duplicate)');

  // Run verification again
  await Verify.verifyIndependently(claim, sources, checkId);

  const records = await prisma.modelVerification.findMany({ where: { claimId: claim.id } });
  ok('Still exactly 2 records after re-run (upsert)', records.length === 2);
}

// ── Runner ────────────────────────────────────────────────────────────────────
async function run() {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  STAGE 4 — Independent Verification — Tests');
  console.log('══════════════════════════════════════════════════════');

  try {
    const { check, claim, sources } = await setupWithEvidence();

    const { grokVerification, geminiVerification } = await testDualBlindVerification(claim, sources, check.id);

    await testVerdictValues(grokVerification, geminiVerification);
    await testConfidenceClamping(grokVerification, geminiVerification);
    await testPromptHashIsolation(grokVerification, geminiVerification);
    await testDbRecords(claim.id);
    await testApiLogs(check.id, claim.id);
    await testUpsertIdempotency(claim, sources, check.id);

    console.log('\n  Grok reasoning:');
    console.log(`    "${grokVerification.reasoning?.slice(0, 150)}..."`);
    console.log('\n  Gemini reasoning:');
    console.log(`    "${geminiVerification.reasoning?.slice(0, 150)}..."`);

    console.log('\n══════════════════════════════════════════════════════');
    console.log('  ✅ STAGE 4 ALL TESTS PASSED');
    console.log('══════════════════════════════════════════════════════\n');
  } catch (err) {
    console.error('\n❌ STAGE 4 TEST FAILED:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

run();
