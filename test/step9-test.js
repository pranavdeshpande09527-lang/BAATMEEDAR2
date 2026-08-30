'use strict';
const assert = require('assert');
const IndependentVerification = require('../src/services/IndependentVerificationService');
const prisma = require('../src/lib/prisma');

async function runTests() {
  console.log('\n=== RUNNING STEP 9: LIVE DUAL-BLIND INDEPENDENT VERIFICATION TESTS ===\n');

  // 1. Setup Check & Claim
  const check = await prisma.check.create({
    data: {
      inputType: 'TEXT',
      originalInput: 'India launched the Chandrayaan-3 mission on July 14, 2023.',
      status: 'VERIFYING',
    },
  });

  const claim = await prisma.claim.create({
    data: {
      checkId: check.id,
      claimText: 'ISRO launched the Chandrayaan-3 lunar mission on July 14, 2023.',
      originalWording: 'India launched the Chandrayaan-3 mission on July 14, 2023.',
      domain: 'science',
      namedEntities: JSON.stringify(['ISRO', 'Chandrayaan-3']),
      location: 'Sriharikota, India',
      timeReference: 'July 14, 2023',
      timeSensitivity: 'HISTORICAL',
      importance: 'HIGH',
      isVerifiable: true,
      status: 'VERIFYING',
      claimOrder: 0,
    },
  });

  // 2. Setup Inspected Evidence Records
  const source1 = await prisma.source.create({
    data: {
      claimId: claim.id,
      url: 'https://www.isro.gov.in/Chandrayaan3_Details.html',
      title: 'Chandrayaan-3 Mission Details - ISRO',
      publisher: 'isro.gov.in',
      sourceType: 'PRIMARY',
      stance: 'SUPPORTS',
      relevantExcerpt: 'Chandrayaan-3 was successfully launched on July 14, 2023 at 14:35 hrs IST by LVM3-M4 from SDSC SHAR, Sriharikota.',
      wasInspected: true,
    },
  });

  const source2 = await prisma.source.create({
    data: {
      claimId: claim.id,
      url: 'https://www.thehindu.com/sci-tech/science/isro-chandrayaan-3-launch/article123.ece',
      title: 'ISRO launches Chandrayaan-3 - The Hindu',
      publisher: 'thehindu.com',
      sourceType: 'NEWS',
      stance: 'SUPPORTS',
      relevantExcerpt: 'India began its historic lunar journey on Friday, July 14, 2023 with the successful launch of Chandrayaan-3.',
      wasInspected: true,
    },
  });

  const sources = [source1, source2];

  // 3. Run Live Independent Dual-Blind Verification
  console.log('[Test 1] Executing Dual-Blind Verification (Grok & Gemini Evaluators in parallel)...');
  const { grokVerification, geminiVerification } = await IndependentVerification.verifyIndependently(claim, sources, check.id);

  console.log('\n  [Evaluator A — Grok / Groq]:');
  console.log('   - Verdict:', grokVerification.verdict);
  console.log('   - Confidence:', grokVerification.confidence);
  console.log('   - Reasoning:', grokVerification.reasoning);
  console.log('   - Limitations:', grokVerification.limitations || 'None');
  console.log('   - Prompt Hash:', grokVerification.promptHash?.slice(0, 16) + '...');

  console.log('\n  [Evaluator B — Gemini]:');
  console.log('   - Verdict:', geminiVerification.verdict);
  console.log('   - Confidence:', geminiVerification.confidence);
  console.log('   - Reasoning:', geminiVerification.reasoning);
  console.log('   - Limitations:', geminiVerification.limitations || 'None');
  console.log('   - Prompt Hash:', geminiVerification.promptHash?.slice(0, 16) + '...');

  // 4. Assertions
  assert.ok(['SUPPORTED', 'CONTRADICTED', 'INCONCLUSIVE'].includes(grokVerification.verdict), 'Grok verdict invalid');
  assert.ok(['SUPPORTED', 'CONTRADICTED', 'INCONCLUSIVE'].includes(geminiVerification.verdict), 'Gemini verdict invalid');
  assert.strictEqual(grokVerification.verdict, 'SUPPORTED', 'Chandrayaan-3 launch fact should be SUPPORTED by Grok');
  assert.strictEqual(geminiVerification.verdict, 'SUPPORTED', 'Chandrayaan-3 launch fact should be SUPPORTED by Gemini');
  assert.ok(grokVerification.confidence >= 0.7, 'Grok confidence should be high for clear primary source');
  assert.ok(geminiVerification.confidence >= 0.7, 'Gemini confidence should be high for clear primary source');

  // Verify DB Isolation
  const dbVerifications = await prisma.modelVerification.findMany({ where: { claimId: claim.id } });
  assert.strictEqual(dbVerifications.length, 2, 'Must have exactly 2 independent verifications in DB');

  console.log('\n  -> PASS: Dual-blind evaluation executed in isolation, verified facts, and persisted to DB');
  console.log('\n=== ALL STEP 9 TESTS PASSED SUCCESSFULLY! ===\n');
}

runTests().then(() => process.exit(0)).catch(err => {
  console.error('[TEST FAILED]', err);
  process.exit(1);
});
