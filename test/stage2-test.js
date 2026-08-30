'use strict';
/**
 * Stage 2 Test — Claim Extraction & Classification
 *
 * Tests:
 *  1. Single factual sentence → extracts ≥1 claim with correct schema
 *  2. Mixed text (facts + opinions) → opinions excluded, facts extracted
 *  3. Claim fields: domain, namedEntities, timeSensitivity, isVerifiable, importance
 *  4. Budget enforcement (MAX_CLAIMS_PER_CHECK)
 *  5. Duplicate claims are deduplicated
 */
require('dotenv').config();
const assert  = require('assert');
const prisma  = require('../src/lib/prisma');
const ClaimEx = require('../src/services/ClaimExtractionService');
const Budget  = require('../src/services/ApiBudgetService');
const config  = require('../src/config');

function ok(label, condition) {
  if (!condition) throw new Error(`FAIL: ${label}`);
  console.log(`  ✓ ${label}`);
}

async function makeCheck(text) {
  return prisma.check.create({
    data: { inputType: 'TEXT', originalInput: text, status: 'EXTRACTING_CLAIMS' },
  });
}

// ── Test 1: Basic factual sentence ────────────────────────────────────────────
async function testBasicFactualExtraction() {
  console.log('\n[Stage 2 — Test 1] Basic factual sentence');
  const text = `India's Chandrayaan-3 mission successfully landed on the Moon's south pole on 23 August 2023, 
making India the fourth country to land on the Moon and the first to reach the south polar region.`;

  const check = await makeCheck(text);
  const claims = await ClaimEx.extractClaims(check.id, text);

  ok('At least 1 claim extracted', claims.length >= 1);

  // Inspect the first claim
  const c = claims[0];
  ok('claimText is a non-empty string', typeof c.claimText === 'string' && c.claimText.length > 5);
  ok('originalWording is present', typeof c.originalWording === 'string');
  ok('domain is set', typeof c.domain === 'string' && c.domain.length > 0);
  ok('timeSensitivity is valid', ['CURRENT', 'HISTORICAL', 'UNSPECIFIED'].includes(c.timeSensitivity));
  ok('importance is valid', ['HIGH', 'MEDIUM', 'LOW'].includes(c.importance));
  ok('namedEntities is a string (JSON array)', typeof c.namedEntities === 'string');
  ok('isVerifiable is boolean true or false', typeof c.isVerifiable === 'boolean');
  ok('status is QUEUED or SKIPPED', ['QUEUED', 'SKIPPED'].includes(c.status));
  ok('claimOrder is a number', typeof c.claimOrder === 'number');

  // Verify DB records
  const dbClaims = await prisma.claim.findMany({ where: { checkId: check.id } });
  ok('Claims persisted to DB', dbClaims.length >= 1);

  // Verify API usage log written
  const usageLogs = await prisma.apiUsageLog.findMany({ where: { checkId: check.id, provider: 'gemini' } });
  ok('Gemini API usage logged', usageLogs.length >= 1);
  ok('Stage logged correctly', usageLogs[0].stage === config.stages.EXTRACTION);

  console.log(`    Claims extracted: ${claims.length}`);
  claims.forEach((c, i) => {
    console.log(`    [${i+1}] "${c.claimText?.slice(0,80)}" — domain:${c.domain} verifiable:${c.isVerifiable}`);
  });

  return { checkId: check.id, claims };
}

// ── Test 2: Mixed text (facts + opinions) ─────────────────────────────────────
async function testMixedTextFiltering() {
  console.log('\n[Stage 2 — Test 2] Mixed text: facts + opinions');
  const text = `The Indian economy grew at 8.2% in FY2024, according to government data. 
This is wonderful news and the government has done a great job! 
Experts believe India will become a $10 trillion economy by 2050. 
The Reserve Bank of India kept the repo rate unchanged at 6.5% in its June 2024 meeting.`;

  const check = await makeCheck(text);
  const claims = await ClaimEx.extractClaims(check.id, text);

  ok('At least 1 claim extracted', claims.length >= 1);

  const verifiableClaims = claims.filter(c => c.isVerifiable);
  ok('At least 1 verifiable claim', verifiableClaims.length >= 1);

  // Opinions ("wonderful news", "great job") should not appear as isVerifiable claims
  const texts = verifiableClaims.map(c => c.claimText.toLowerCase());
  const hasOpinion = texts.some(t => t.includes('wonderful') || t.includes('great job'));
  ok('Opinions not included as verifiable claims', !hasOpinion);

  console.log(`    Total claims: ${claims.length} | Verifiable: ${verifiableClaims.length}`);
  verifiableClaims.forEach((c, i) => {
    console.log(`    [Verifiable ${i+1}] "${c.claimText?.slice(0, 80)}"`);
  });
}

// ── Test 3: Structured metadata fields ───────────────────────────────────────
async function testClaimMetadataFields() {
  console.log('\n[Stage 2 — Test 3] Claim metadata field validation');
  const text = `ISRO launched its Aditya-L1 solar observation spacecraft on 2 September 2023. 
The spacecraft was inserted into the L1 orbit on 6 January 2024.`;

  const check = await makeCheck(text);
  const claims = await ClaimEx.extractClaims(check.id, text);

  ok('Claims extracted', claims.length >= 1);

  for (const c of claims) {
    // namedEntities must parse as valid JSON array
    let entities;
    try {
      entities = JSON.parse(c.namedEntities);
    } catch (_e) {
      throw new Error(`FAIL: namedEntities is not valid JSON: ${c.namedEntities}`);
    }
    ok(`namedEntities is JSON array for claim: "${c.claimText?.slice(0,40)}"`, Array.isArray(entities));
  }

  // Check at least one claim has ISRO or Aditya-L1 in entities
  const allEntities = claims.flatMap(c => {
    try { return JSON.parse(c.namedEntities); } catch { return []; }
  });
  const hasRelevantEntity = allEntities.some(e =>
    typeof e === 'string' && (e.includes('ISRO') || e.includes('Aditya') || e.includes('L1'))
  );
  ok('Named entities contain relevant proper nouns', hasRelevantEntity);
}

// ── Test 4: Budget enforcement ────────────────────────────────────────────────
async function testBudgetEnforcement() {
  console.log('\n[Stage 2 — Test 4] Budget enforcement (MAX_CLAIMS_PER_CHECK)');
  const max = config.budget.maxClaimsPerCheck;

  // Build text with many distinct claims (more than budget)
  const sentences = [];
  for (let i = 1; i <= max + 3; i++) {
    sentences.push(`Statement ${i}: The country ${['India','China','USA','UK','Germany','France','Japan','Brazil','Canada','Australia'][i%10]} passed Law ${i} in year ${2000 + i}.`);
  }
  const text = sentences.join(' ');

  const check = await makeCheck(text);
  const claims = await ClaimEx.extractClaims(check.id, text);

  ok(`Claims capped at MAX_CLAIMS_PER_CHECK (${max})`, claims.length <= max);
  console.log(`    Claims returned: ${claims.length} (max is ${max})`);
}

// ── Test 5: Deduplication ─────────────────────────────────────────────────────
async function testDeduplication() {
  console.log('\n[Stage 2 — Test 5] Claim deduplication');
  // Text that repeats the same claim twice
  const text = `India launched Chandrayaan-3 on 14 July 2023. India launched Chandrayaan-3 on 14 July 2023.`;

  const check = await makeCheck(text);
  const claims = await ClaimEx.extractClaims(check.id, text);

  // After deduplication, the repeated identical claim should appear only once
  const texts = claims.map(c => c.claimText.toLowerCase().replace(/\s+/g, ' ').trim());
  const unique = new Set(texts);
  ok('Duplicate claims deduplicated', unique.size === claims.length);
  console.log(`    Claims after dedup: ${claims.length}`);
}

// ── Runner ────────────────────────────────────────────────────────────────────
async function run() {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  STAGE 2 — Claim Extraction & Classification — Tests');
  console.log('══════════════════════════════════════════════════════');

  try {
    await testBasicFactualExtraction();
    await testMixedTextFiltering();
    await testClaimMetadataFields();
    await testBudgetEnforcement();
    await testDeduplication();

    console.log('\n══════════════════════════════════════════════════════');
    console.log('  ✅ STAGE 2 ALL TESTS PASSED');
    console.log('══════════════════════════════════════════════════════\n');
  } catch (err) {
    console.error('\n❌ STAGE 2 TEST FAILED:', err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

run();
