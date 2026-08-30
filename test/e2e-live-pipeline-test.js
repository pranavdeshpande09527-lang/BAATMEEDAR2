'use strict';
const assert = require('assert');
const prisma = require('../src/lib/prisma');
const PipelineService = require('../src/services/PipelineService');
const Budget = require('../src/services/ApiBudgetService');

async function testFullPipeline() {
  console.log('\n=== RUNNING FULL END-TO-END 5-STAGE LIVE PIPELINE TEST ===\n');

  // Input statement
  const testInput = 'The Reserve Bank of India maintained the repo rate at 6.5 percent during its Monetary Policy Committee meeting in August 2024.';

  // 1. Submit Check
  console.log('[E2E Step 1] Creating Check record...');
  const check = await prisma.check.create({
    data: {
      inputType: 'TEXT',
      originalInput: testInput,
      status: 'PENDING',
    },
  });

  console.log(`  -> Check created with ID: ${check.id}`);

  // 2. Run Pipeline End-to-End
  console.log('\n[E2E Step 2] Executing 5-Stage Pipeline (Live APIs)...');
  await PipelineService.run(check.id);

  // 3. Verify Final Check State
  console.log('\n[E2E Step 3] Inspecting synthesized editorial result...');
  const result = await prisma.check.findUnique({
    where: { id: check.id },
    include: {
      claims: {
        include: {
          sources: true,
          evidenceReviews: true,
          verifications: true,
        },
      },
    },
  });

  console.log(`  -> Pipeline Status: ${result.status}`);
  assert.strictEqual(result.status, 'COMPLETE', 'Check status must be COMPLETE');
  assert.ok(result.claims.length >= 1, 'Must have at least 1 claim');

  result.claims.forEach((c, idx) => {
    console.log(`\n  ======================================================`);
    console.log(`  CLAIM ${idx + 1}: "${c.claimText}"`);
    console.log(`  Domain: ${c.domain} | Time: ${c.timeReference} | Status: ${c.status}`);
    console.log(`  Inspected Sources (${c.sources.length}):`);
    c.sources.forEach(s => {
      console.log(`    - [${s.sourceType}] ${s.publisher} (Stance: ${s.stance})`);
      console.log(`      Excerpt: "${s.relevantExcerpt?.slice(0, 90)}..."`);
    });

    console.log(`  Reviews (${c.evidenceReviews.length}):`);
    c.evidenceReviews.forEach(r => {
      console.log(`    - Reviewer: ${r.reviewer} (${r.role})`);
    });

    console.log(`  Dual-Blind Verifications (${c.verifications.length}):`);
    c.verifications.forEach(v => {
      console.log(`    - ${v.modelName} Verdict: [${v.verdict}] (Confidence: ${v.confidence})`);
      console.log(`      Reasoning: "${v.reasoning?.slice(0, 100)}..."`);
    });
  });

  // 4. Inspect Cost & Usage Summary
  const usage = await Budget.getUsageSummary(check.id);
  console.log('\n[E2E Step 4] API Budget & Usage Audit Trail:');
  console.log(`  -> Total API Calls: ${usage.callCount}`);
  console.log(`  -> Total Tokens: ${usage.totalTokens}`);
  console.log(`  -> Estimated Cost: $${usage.totalCost}`);
  console.log(`  -> Provider Breakdown:`, usage.byProvider);

  console.log('\n=== FULL END-TO-END 5-STAGE LIVE PIPELINE TEST PASSED! ===\n');
}

testFullPipeline().then(() => process.exit(0)).catch(err => {
  console.error('[E2E TEST FAILED]', err);
  process.exit(1);
});
