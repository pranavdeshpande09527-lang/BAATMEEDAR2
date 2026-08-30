'use strict';
const assert = require('assert');
const EvidenceReview = require('../src/services/EvidenceReviewService');
const prisma = require('../src/lib/prisma');

async function runTests() {
  console.log('\n=== RUNNING STEP 8: LIVE GROQ & GEMINI EVIDENCE REVIEW TESTS ===\n');

  // 1. Setup test Check & Claim
  const check = await prisma.check.create({
    data: {
      inputType: 'TEXT',
      originalInput: 'ISRO launched Aditya-L1 on September 2, 2023.',
      status: 'RESEARCHING',
    },
  });

  const claim = await prisma.claim.create({
    data: {
      checkId: check.id,
      claimText: 'ISRO launched the Aditya-L1 solar observatory mission on September 2, 2023.',
      originalWording: 'ISRO launched Aditya-L1 on September 2, 2023.',
      domain: 'science',
      namedEntities: JSON.stringify(['ISRO', 'Aditya-L1']),
      location: 'Sriharikota, India',
      timeReference: 'September 2, 2023',
      timeSensitivity: 'HISTORICAL',
      importance: 'HIGH',
      isVerifiable: true,
      status: 'RESEARCHING',
      claimOrder: 0,
    },
  });

  // 2. Create sample Sources
  const s1 = await prisma.source.create({
    data: {
      claimId: claim.id,
      url: 'https://www.isro.gov.in/Aditya_L1-MissionDetails.html',
      title: 'ADITYA-L1 Mission Details - ISRO',
      publisher: 'isro.gov.in',
      sourceType: 'PRIMARY',
      searchSnippet: 'Aditya-L1 was successfully launched on September 2, 2023 at 11:50 hrs IST by PSLV-C57 from Satish Dhawan Space Centre SHAR, Sriharikota.',
      wasInspected: false,
    },
  });

  const s2 = await prisma.source.create({
    data: {
      claimId: claim.id,
      url: 'https://www.thehindu.com/sci-tech/science/isro-aditya-l1-launch-success/article123.ece',
      title: 'ISRO launches Aditya-L1 solar mission - The Hindu',
      publisher: 'thehindu.com',
      sourceType: 'NEWS',
      searchSnippet: 'India on Saturday, September 2, 2023 successfully launched its maiden solar mission Aditya-L1 from the spaceport in Sriharikota.',
      wasInspected: false,
    },
  });

  const sources = [s1, s2];

  // 3. Run Live Evidence Review
  console.log('[Test 1] Executing Dual Evidence Review (Groq Logic Audit + Gemini Scope Match)...');
  const { groqReview, geminiReview } = await EvidenceReview.reviewEvidence(claim, sources, check.id);

  console.log('\n  [Groq Review - LOGICAL_GAPS]:');
  console.log('   - Missing Context:', groqReview.missingContext);
  console.log('   - Logical Issues:', groqReview.logicalIssues || 'None');
  console.log('   - Counterevidence:', groqReview.counterevidence || 'None');
  console.log('   - Unanswered Questions:', groqReview.unansweredQuestions);

  console.log('\n  [Gemini Review - SCOPE_MATCH]:');
  console.log('   - Material Terms:', geminiReview.materialTerms);
  console.log('   - Ambiguity Flags:', geminiReview.ambiguityFlags || 'None');
  console.log('   - Scope Judgement:', geminiReview.scopeJudgement);

  assert.ok(groqReview.id, 'Groq review record must exist');
  assert.ok(geminiReview.id, 'Gemini review record must exist');

  // 4. Verify that sources were updated with inspected excerpts and stances
  console.log('\n[Test 2] Verifying Source Inspection Updates in Database...');
  const updatedSources = await prisma.source.findMany({ where: { claimId: claim.id } });
  
  updatedSources.forEach((s, idx) => {
    console.log(`   Source ${idx + 1} (${s.publisher}): wasInspected=${s.wasInspected} | Stance=${s.stance}`);
    console.log(`     Excerpt: "${s.relevantExcerpt?.slice(0, 100)}..."`);
    assert.strictEqual(s.wasInspected, true, 'Source must be marked as inspected');
    assert.ok(['SUPPORTS', 'CONTRADICTS', 'INSUFFICIENT'].includes(s.stance), 'Valid stance required');
  });

  console.log('  -> PASS: Sources updated with inspected status and stances');
  console.log('\n=== ALL STEP 8 TESTS PASSED SUCCESSFULLY! ===\n');
}

runTests().then(() => process.exit(0)).catch(err => {
  console.error('[TEST FAILED]', err);
  process.exit(1);
});
