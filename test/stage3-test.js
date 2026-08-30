'use strict';
/**
 * Stage 3 Test — Claim-Specific Research
 *
 * Tests:
 *  3a. ResearchPlannerService (Hermes/Groq) — produces valid research plan
 *  3b. SearchService (Tavily)               — returns sources, deduplicates, persists to DB
 *  3c. SearchService cache hit              — second search for same query uses cache
 *  3d. EvidenceReviewService               — Groq + Gemini run in parallel, stances set on sources
 *  3e. Budget enforcement                  — MAX_SEARCHES_PER_CLAIM, MAX_SOURCES_PER_CLAIM
 */
require('dotenv').config();
const prisma    = require('../src/lib/prisma');
const Research  = require('../src/services/ResearchPlannerService');
const Search    = require('../src/services/SearchService');
const Evidence  = require('../src/services/EvidenceReviewService');
const Cache     = require('../src/services/CacheService');
const config    = require('../src/config');

function ok(label, condition) {
  if (!condition) throw new Error(`FAIL: ${label}`);
  console.log(`  ✓ ${label}`);
}

// ── Setup: create a real check + claim to test against ───────────────────────
async function setupTestClaim() {
  const check = await prisma.check.create({
    data: { inputType: 'TEXT', originalInput: 'Test Stage 3', status: 'RESEARCHING' },
  });

  const claim = await prisma.claim.create({
    data: {
      checkId:         check.id,
      claimText:       'The Reserve Bank of India maintained the repo rate at 6.5% in August 2024.',
      originalWording: 'RBI kept repo rate at 6.5% in August 2024',
      domain:          'economy',
      namedEntities:   JSON.stringify(['Reserve Bank of India', 'India']),
      timeReference:   'August 2024',
      timeSensitivity: 'HISTORICAL',
      materialContext: 'Monetary policy decision affecting borrowing rates in India',
      importance:      'HIGH',
      isVerifiable:    true,
      status:          'RESEARCHING',
      claimOrder:      0,
    },
  });

  return { check, claim };
}

// ── Test 3a: Research Planner ─────────────────────────────────────────────────
async function testResearchPlanner(claim, checkId) {
  console.log('\n[Stage 3 — Test 3a] Research Planner (Hermes/Groq)');

  const plan = await Research.createResearchPlan(claim, checkId);

  ok('Plan is an object', typeof plan === 'object' && plan !== null);
  ok('researchQuestion present', typeof plan.researchQuestion === 'string' && plan.researchQuestion.length > 10);
  ok('searchQueries is an array', Array.isArray(plan.searchQueries));
  ok('searchQueries count ≤ MAX_SEARCHES_PER_CLAIM',
     plan.searchQueries.length <= config.budget.maxSearchesPerClaim);
  ok('supportCriteria present', typeof plan.supportCriteria === 'string' && plan.supportCriteria.length > 0);
  ok('contradictionCriteria present', typeof plan.contradictionCriteria === 'string');

  // Verify API usage logged
  const logs = await prisma.apiUsageLog.findMany({
    where: { checkId, claimId: claim.id, endpoint: 'hermes_research_plan' },
  });
  ok('Research plan API call logged', logs.length >= 1);

  console.log(`    Question: "${plan.researchQuestion?.slice(0, 80)}"`);
  console.log(`    Queries: ${JSON.stringify(plan.searchQueries)}`);

  return plan;
}

// ── Test 3b: Search Service (Tavily) ─────────────────────────────────────────
async function testSearchService(claim, plan, checkId) {
  console.log('\n[Stage 3 — Test 3b] Search Service (Tavily)');

  const sources = await Search.searchForClaim(claim, plan, checkId);

  ok('Sources returned as array', Array.isArray(sources));
  ok('At least 1 source found', sources.length >= 1);
  ok('Sources capped at MAX_SOURCES_PER_CLAIM', sources.length <= config.budget.maxSourcesPerClaim);

  // Validate structure of first source
  const s = sources[0];
  ok('Source has url', typeof s.url === 'string' && s.url.startsWith('http'));
  ok('Source has title', typeof s.title === 'string');
  ok('Source has sourceType', ['PRIMARY', 'ACADEMIC', 'NEWS', 'OTHER'].includes(s.sourceType));
  ok('Source stored in DB (has id)', typeof s.id === 'string' && s.id.length > 0);
  ok('wasInspected defaults to false', s.wasInspected === false);

  // Verify DB records
  const dbSources = await prisma.source.findMany({ where: { claimId: claim.id } });
  ok('Sources persisted to DB', dbSources.length >= 1);

  // Verify no duplicate URLs
  const urls = dbSources.map(s => s.url);
  const uniqueUrls = new Set(urls);
  ok('No duplicate URLs in DB', uniqueUrls.size === urls.length);

  // Verify Tavily API call logged
  const logs = await prisma.apiUsageLog.findMany({
    where: { checkId, provider: 'tavily' },
  });
  ok('Tavily API call logged', logs.length >= 1);

  sources.forEach((s, i) => {
    console.log(`    [${i+1}] [${s.sourceType}] ${s.publisher} — ${s.url.slice(0, 60)}`);
  });

  return sources;
}

// ── Test 3c: Search Cache Hit ─────────────────────────────────────────────────
async function testSearchCacheHit(claim, plan, checkId) {
  console.log('\n[Stage 3 — Test 3c] Search cache hit');

  // Run a second search for the same queries — should hit cache
  const check2 = await prisma.check.create({
    data: { inputType: 'TEXT', originalInput: 'Cache test', status: 'RESEARCHING' },
  });
  const claim2 = await prisma.claim.create({
    data: {
      checkId:         check2.id,
      claimText:       claim.claimText,
      originalWording: claim.originalWording,
      domain:          claim.domain,
      namedEntities:   claim.namedEntities,
      timeReference:   claim.timeReference,
      timeSensitivity: claim.timeSensitivity,
      importance:      'HIGH',
      isVerifiable:    true,
      status:          'RESEARCHING',
      claimOrder:      0,
    },
  });

  await Search.searchForClaim(claim2, plan, check2.id);

  const cacheLogs = await prisma.apiUsageLog.findMany({
    where: { checkId: check2.id, provider: 'cache', endpoint: 'tavily_search' },
  });
  ok('Cache hit logged for second search', cacheLogs.length >= 1);
  ok('wasFromCache = true', cacheLogs[0].wasFromCache === true);
}

// ── Test 3d: Evidence Review (Groq + Gemini) ──────────────────────────────────
async function testEvidenceReview(claim, sources, checkId) {
  console.log('\n[Stage 3 — Test 3d] Evidence Review (Groq + Gemini parallel)');

  const { groqReview, geminiReview } = await Evidence.reviewEvidence(claim, sources, checkId);

  // Groq review record
  ok('Groq EvidenceReview created', groqReview !== null);
  ok('Groq reviewer = GROQ', groqReview.reviewer === 'GROQ');
  ok('Groq role = LOGICAL_GAPS', groqReview.role === 'LOGICAL_GAPS');

  // Gemini review record
  ok('Gemini EvidenceReview created', geminiReview !== null);
  ok('Gemini reviewer = GEMINI', geminiReview.reviewer === 'GEMINI');
  ok('Gemini role = SCOPE_MATCH', geminiReview.role === 'SCOPE_MATCH');

  // Stances updated on sources
  const updatedSources = await prisma.source.findMany({ where: { claimId: claim.id } });
  const stancedSources = updatedSources.filter(s => s.stance !== null);
  ok('At least 1 source got a stance', stancedSources.length >= 1);

  const validStances = ['SUPPORTS', 'CONTRADICTS', 'INSUFFICIENT', 'IRRELEVANT'];
  ok('All stances are valid values',
     stancedSources.every(s => validStances.includes(s.stance)));

  // Evidence reviews in DB
  const dbReviews = await prisma.evidenceReview.findMany({ where: { claimId: claim.id } });
  ok('Both EvidenceReview records in DB', dbReviews.length >= 2);

  // API usage logs for both
  const groqLog  = await prisma.apiUsageLog.findMany({ where: { checkId, provider: 'groq',  endpoint: 'evidence_review_logical_gaps' } });
  const geminiLog = await prisma.apiUsageLog.findMany({ where: { checkId, provider: 'gemini', endpoint: 'evidence_review_scope_match' } });
  ok('Groq evidence review API logged',   groqLog.length >= 1);
  ok('Gemini evidence review API logged', geminiLog.length >= 1);

  // Print stances
  updatedSources.forEach(s => {
    console.log(`    Source: ${s.publisher} → stance: ${s.stance} | inspected: ${s.wasInspected}`);
  });

  if (groqReview.missingContext) {
    console.log(`    Groq missing context: "${groqReview.missingContext?.slice(0, 80)}"`);
  }
  if (geminiReview.scopeJudgement) {
    console.log(`    Gemini scope judgement: "${geminiReview.scopeJudgement?.slice(0, 80)}"`);
  }
}

// ── Test 3e: Source-type classification ──────────────────────────────────────
async function testSourceClassification() {
  console.log('\n[Stage 3 — Test 3e] Source type classification');
  const { classifySourceType } = Search;

  const cases = [
    ['https://pib.gov.in/press-release', 'PRIMARY'],
    ['https://www.who.int/health-topics/coronavirus', 'PRIMARY'],
    ['https://nature.com/articles/s41586-024', 'ACADEMIC'],
    ['https://www.reuters.com/business/finance/', 'NEWS'],
    ['https://example.com/blog', 'NEWS'],   // fallback to NEWS
  ];

  for (const [url, expected] of cases) {
    const got = classifySourceType(url);
    ok(`Classifies ${new URL(url).hostname} as ${expected}`, got === expected);
  }
}

// ── Runner ────────────────────────────────────────────────────────────────────
async function run() {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  STAGE 3 — Claim-Specific Research — Tests');
  console.log('══════════════════════════════════════════════════════');

  try {
    await testSourceClassification();

    const { check, claim } = await setupTestClaim();

    const plan    = await testResearchPlanner(claim, check.id);
    const sources = await testSearchService(claim, plan, check.id);
    await testSearchCacheHit(claim, plan, check.id);
    await testEvidenceReview(claim, sources, check.id);

    console.log('\n══════════════════════════════════════════════════════');
    console.log('  ✅ STAGE 3 ALL TESTS PASSED');
    console.log('══════════════════════════════════════════════════════\n');
  } catch (err) {
    console.error('\n❌ STAGE 3 TEST FAILED:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

run();
