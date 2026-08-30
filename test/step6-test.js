'use strict';
const assert = require('assert');
const ClaimExtraction = require('../src/services/ClaimExtractionService');
const prisma = require('../src/lib/prisma');

async function runTests() {
  console.log('\n=== RUNNING STEP 6: LIVE GEMINI CLAIM EXTRACTION TESTS ===\n');

  // Test 1: Real complex news statement with mix of factual assertions and opinion
  console.log('[Test 1] Extracting atomic claims from mixed factual/opinion statement with Gemini 3.5 Flash...');
  
  const testInput = `On August 23, 2023, ISRO's Chandrayaan-3 lander Vikram touched down near the lunar south pole, making India the first country to land near the south pole and the fourth country to achieve a soft landing on the Moon. In my personal opinion, this is the greatest achievement in human history and everyone must celebrate this incredible wonder.`;

  const check = await prisma.check.create({
    data: {
      inputType: 'TEXT',
      originalInput: testInput,
      extractedText: testInput,
      extractionStatus: 'ok',
      status: 'EXTRACTING_CLAIMS',
    },
  });

  const claims = await ClaimExtraction.extractClaims(check.id, testInput);

  console.log(`  -> Extracted ${claims.length} atomic claims:`);
  claims.forEach((c, idx) => {
    console.log(`     [Claim ${idx + 1}] "${c.claimText}" | Domain: ${c.domain} | Verifiable: ${c.isVerifiable} | Time: ${c.timeReference}`);
  });

  assert.ok(claims.length >= 1, 'Should have extracted at least 1 claim');
  assert.ok(claims[0].claimText && claims[0].claimText.length > 10, 'Claim text must not be empty');
  assert.ok(claims[0].isVerifiable === true, 'Factual Chandrayaan-3 claim should be verifiable');
  assert.strictEqual(claims[0].checkId, check.id, 'checkId relation must match');

  // Verify DB state
  const dbClaims = await prisma.claim.findMany({ where: { checkId: check.id } });
  assert.strictEqual(dbClaims.length, claims.length, 'DB claims count mismatch');
  console.log('  -> PASS: Atomic factual claims extracted with structured metadata and stored in DB');

  console.log('\n=== ALL STEP 6 TESTS PASSED SUCCESSFULLY! ===\n');
}

runTests().then(() => process.exit(0)).catch(err => {
  console.error('[TEST FAILED]', err);
  process.exit(1);
});
