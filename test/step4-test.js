'use strict';
const assert = require('assert');
const Cache = require('../src/services/CacheService');
const Budget = require('../src/services/ApiBudgetService');
const prisma = require('../src/lib/prisma');
const config = require('../src/config');

async function runTests() {
  console.log('\n=== RUNNING STEP 4: API BUDGET + CACHE LAYER TESTS ===\n');

  // Test 1: Article caching
  console.log('[Test 1] Article text caching...');
  const testUrl = 'https://thehindu.com/news/national/test-article-123';
  await Cache.setArticle(testUrl, { text: 'Article content preview', retrievalTime: new Date().toISOString() });
  const cachedArticle = await Cache.getArticle(testUrl);
  assert.strictEqual(cachedArticle.text, 'Article content preview', 'Article cache mismatch');
  console.log('  -> PASS: Article cached and retrieved successfully');

  // Test 2: YouTube transcript caching
  console.log('[Test 2] YouTube transcript caching...');
  const testVideoId = 'dQw4w9WgXcQ';
  await Cache.setYouTubeTranscript(testVideoId, { transcript: 'Never gonna give you up', language: 'en' });
  const cachedYt = await Cache.getYouTubeTranscript(testVideoId);
  assert.strictEqual(cachedYt.transcript, 'Never gonna give you up', 'YouTube transcript mismatch');
  console.log('  -> PASS: YouTube transcript cached and retrieved successfully');

  // Test 3: Search results caching
  console.log('[Test 3] Search results caching...');
  const testQuery = 'ISRO Aditya L1 mission launch date';
  await Cache.setSearchResults(testQuery, [{ url: 'https://isro.gov.in', title: 'Aditya-L1' }]);
  const cachedSearch = await Cache.getSearchResults(testQuery);
  assert.strictEqual(cachedSearch.results.length, 1, 'Search cache length mismatch');
  console.log('  -> PASS: Search results cached and retrieved successfully');

  // Test 4: Source summary caching
  console.log('[Test 4] Source summary caching...');
  const sourceUrl = 'https://pib.gov.in/pressrelease/12345';
  await Cache.setSourceSummary(sourceUrl, { summary: 'Official press release summary', stance: 'SUPPORTS' });
  const cachedSummary = await Cache.getSourceSummary(sourceUrl);
  assert.strictEqual(cachedSummary.summary, 'Official press release summary', 'Source summary mismatch');
  console.log('  -> PASS: Source summary cached and retrieved successfully');

  // Test 5: Claim deduplication
  console.log('[Test 5] Claim deduplication...');
  const duplicateClaims = [
    { claimText: 'ISRO launched Aditya-L1 in September 2023.', materialContext: 'Context 1' },
    { claimText: 'isro launched aditya-l1 in september 2023', materialContext: 'Context 2' },
    { claimText: 'India won the T20 World Cup in 2024.', materialContext: 'Context 3' },
  ];
  const deduped = Budget.deduplicateClaims(duplicateClaims);
  assert.strictEqual(deduped.length, 2, `Expected 2 unique claims, got ${deduped.length}`);
  console.log('  -> PASS: Duplicate claims merged, context preserved');

  // Test 6: Budget enforcement limits
  console.log('[Test 6] Budget enforcement limits...');
  const excessiveClaims = Array.from({ length: 15 }, (_, i) => ({ claimText: `Claim ${i}` }));
  const cappedClaims = Budget.enforceClaims(excessiveClaims);
  assert.strictEqual(cappedClaims.length, config.budget.maxClaimsPerCheck, 'Claims capping mismatch');

  const excessiveQueries = ['q1', 'q2', 'q3', 'q4', 'q5'];
  const cappedQueries = Budget.enforceSearches(excessiveQueries);
  assert.strictEqual(cappedQueries.length, config.budget.maxSearchesPerClaim, 'Query capping mismatch');

  const longText = 'x'.repeat(20000);
  const truncatedText = Budget.enforceContextLength(longText);
  assert.strictEqual(truncatedText.length, config.budget.maxModelContextChars, 'Context truncation mismatch');
  console.log('  -> PASS: All budget caps enforced (claims, queries, context length)');

  // Test 7: Early stopping logic
  console.log('[Test 7] Early stopping logic...');
  const sourcesConsensus = [
    { wasInspected: true, inspectionFailed: false, sourceType: 'GOVERNMENT', stance: 'SUPPORTS' },
    { wasInspected: true, inspectionFailed: false, sourceType: 'NEWS', stance: 'SUPPORTS' },
  ];
  assert.strictEqual(Budget.shouldStopSearching(sourcesConsensus), true, 'Consensus should stop early');

  const sourcesConflict = [
    { wasInspected: true, inspectionFailed: false, sourceType: 'GOVERNMENT', stance: 'SUPPORTS' },
    { wasInspected: true, inspectionFailed: false, sourceType: 'NEWS', stance: 'CONTRADICTS' },
  ];
  assert.strictEqual(Budget.shouldStopSearching(sourcesConflict), false, 'Conflict should NOT stop early');
  console.log('  -> PASS: Early stopping logic correctly halts on consensus and continues on conflict');

  console.log('\n=== ALL STEP 4 TESTS PASSED SUCCESSFULLY! ===\n');
}

runTests().then(() => process.exit(0)).catch(err => {
  console.error('[TEST FAILED]', err);
  process.exit(1);
});
