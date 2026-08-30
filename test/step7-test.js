'use strict';
const assert = require('assert');
const ResearchPlanner = require('../src/services/ResearchPlannerService');
const SearchService = require('../src/services/SearchService');
const prisma = require('../src/lib/prisma');

async function runTests() {
  console.log('\n=== RUNNING STEP 7: LIVE HERMES PLANNING + TAVILY SEARCH TESTS ===\n');

  // Create test check & claim
  const check = await prisma.check.create({
    data: {
      inputType: 'TEXT',
      originalInput: 'India launched the Aditya-L1 solar observatory mission on September 2, 2023.',
      status: 'RESEARCHING',
    },
  });

  const claim = await prisma.claim.create({
    data: {
      checkId: check.id,
      claimText: 'ISRO launched the Aditya-L1 spacecraft on September 2, 2023.',
      originalWording: 'India launched the Aditya-L1 solar observatory mission on September 2, 2023.',
      domain: 'science',
      namedEntities: JSON.stringify(['ISRO', 'Aditya-L1']),
      location: 'India',
      timeReference: 'September 2, 2023',
      timeSensitivity: 'HISTORICAL',
      importance: 'HIGH',
      isVerifiable: true,
      status: 'RESEARCHING',
      claimOrder: 0,
    },
  });

  // Test 1: Live Hermes Research Plan Generation
  console.log('[Test 1] Generating Hermes research plan with Groq/Gemini...');
  const plan = await ResearchPlanner.createResearchPlan(claim, check.id);
  console.log('  -> Research Question:', plan.researchQuestion);
  console.log('  -> Search Queries:', plan.searchQueries);
  console.log('  -> Support Criteria:', plan.supportCriteria);
  assert.ok(plan.searchQueries && plan.searchQueries.length >= 1, 'Plan must contain search queries');
  console.log('  -> PASS: Hermes research plan formulated with targeted queries');

  // Test 2: Live Tavily Search & Authority Ranking
  console.log('\n[Test 2] Executing Tavily search & authority ranking...');
  const sources = await SearchService.searchForClaim(claim, plan, check.id);
  console.log(`  -> Retrieved & ranked ${sources.length} authoritative sources:`);
  sources.forEach((s, idx) => {
    console.log(`     [${idx + 1}] (${s.sourceType}) ${s.title}`);
    console.log(`         URL: ${s.url}`);
  });

  assert.ok(sources.length >= 1, 'Should have retrieved at least 1 source');
  assert.ok(sources[0].url.startsWith('http'), 'Source URL must be valid');
  assert.ok(sources[0].claimId === claim.id, 'claimId relation must match');
  console.log('  -> PASS: Authoritative sources discovered, ranked, and stored in DB');

  console.log('\n=== ALL STEP 7 TESTS PASSED SUCCESSFULLY! ===\n');
}

runTests().then(() => process.exit(0)).catch(err => {
  console.error('[TEST FAILED]', err);
  process.exit(1);
});
