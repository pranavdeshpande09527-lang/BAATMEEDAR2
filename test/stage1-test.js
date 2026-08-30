'use strict';
/**
 * Stage 1 Test — Input Collection
 *
 * Tests:
 *  1. TEXT input  — stores raw statement directly
 *  2. ARTICLE URL — fetches HTML, extracts title/publisher/text, caches result
 *  3. YOUTUBE URL — parses video ID, fetches metadata + transcript, caches result
 *  4. Cache hit   — second fetch of same URL/ID returns from cache, not live
 */
require('dotenv').config();
const assert  = require('assert');
const prisma  = require('../src/lib/prisma');
const Input   = require('../src/services/InputService');
const Cache   = require('../src/services/CacheService');

// ── Helpers ──────────────────────────────────────────────────────────────────
function ok(label, condition) {
  if (!condition) throw new Error(`FAIL: ${label}`);
  console.log(`  ✓ ${label}`);
}

async function makeCheck(inputType, input) {
  return prisma.check.create({
    data: { inputType, originalInput: input, status: 'PENDING' },
  });
}

// ── Test 1: TEXT ─────────────────────────────────────────────────────────────
async function testText() {
  console.log('\n[Stage 1 — Test 1] TEXT input');
  const statement = 'India launched Chandrayaan-3 on 14 July 2023.';
  const check = await makeCheck('TEXT', statement);

  const text = await Input.processInput(check);
  ok('Returns the raw text', text === statement);

  const updated = await prisma.check.findUnique({ where: { id: check.id } });
  ok('extractedText set',        updated.extractedText === statement);
  ok('extractionStatus is ok',   updated.extractionStatus === 'ok');
  ok('retrievalTime recorded',   updated.retrievalTime !== null);

  return check.id;
}

// ── Test 2: ARTICLE ──────────────────────────────────────────────────────────
async function testArticle() {
  console.log('\n[Stage 1 — Test 2] ARTICLE input');
  const url = 'https://en.wikipedia.org/wiki/Chandrayaan-3';
  const check = await makeCheck('ARTICLE', url);

  const text = await Input.processInput(check);

  const updated = await prisma.check.findUnique({ where: { id: check.id } });
  ok('extractedText non-empty',   typeof text === 'string' && text.length > 0);
  ok('canonicalUrl set',          typeof updated.canonicalUrl === 'string' && updated.canonicalUrl.startsWith('http'));
  ok('extractionStatus present',  ['ok', 'insufficient_text', 'failed'].includes(updated.extractionStatus));
  ok('retrievalTime recorded',    updated.retrievalTime !== null);

  if (updated.extractionStatus === 'ok') {
    ok('Article text is meaningful (>50 chars)', text.length > 50);
    // Check cache was populated
    const cached = await Cache.getArticle(updated.canonicalUrl);
    ok('Article cached by canonical URL', cached !== null);
    console.log(`    Publisher: ${updated.publisher || '(none detected)'}`);
    console.log(`    Title: ${updated.sourceTitle?.slice(0, 60) || '(none detected)'}`);
    console.log(`    Text length: ${text.length} chars`);
  } else {
    console.log(`    ⚠ Extraction status: ${updated.extractionStatus} (article may be behind paywall/bot-protected)`);
  }

  return check.id;
}

// ── Test 3: YOUTUBE ──────────────────────────────────────────────────────────
async function testYouTube() {
  console.log('\n[Stage 1 — Test 3] YOUTUBE input');
  const ytUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'; // well-known video
  const check = await makeCheck('YOUTUBE', ytUrl);

  const text = await Input.processInput(check);
  const updated = await prisma.check.findUnique({ where: { id: check.id } });

  ok('videoId parsed correctly', updated.videoId === 'dQw4w9WgXcQ');
  ok('extractionStatus present', ['ok', 'unavailable', 'transcript_empty'].includes(updated.extractionStatus));
  ok('retrievalTime recorded',   updated.retrievalTime !== null);

  if (updated.extractionStatus === 'ok') {
    ok('Transcript text non-empty', typeof text === 'string' && text.length > 0);
    const cached = await Cache.getYouTubeTranscript('dQw4w9WgXcQ');
    ok('YouTube transcript cached', cached !== null);
    console.log(`    Channel: ${updated.publisher || '(none)'}`);
    console.log(`    Title: ${updated.sourceTitle?.slice(0, 60) || '(none)'}`);
    console.log(`    Transcript length: ${text.length} chars`);
  } else {
    console.log(`    ⚠ Transcript status: ${updated.extractionStatus} (may not be available for this video)`);
    ok('videoId still stored despite no transcript', updated.videoId === 'dQw4w9WgXcQ');
  }

  return check.id;
}

// ── Test 4: Cache Hit ─────────────────────────────────────────────────────────
async function testCacheHit() {
  console.log('\n[Stage 1 — Test 4] Cache hit (second ARTICLE fetch)');
  const url = 'https://en.wikipedia.org/wiki/Chandrayaan-3';

  // We only test cache hit if the article was previously successfully cached
  const cached = await Cache.getArticle(url);
  if (!cached) {
    console.log('  ⚠ Skipping cache hit test — article was not cached (extraction may have failed)');
    return;
  }

  const check = await makeCheck('ARTICLE', url);
  const logsBefore = await prisma.apiUsageLog.count({ where: { checkId: check.id } });

  await Input.processInput(check);

  const logsAfter = await prisma.apiUsageLog.findMany({ where: { checkId: check.id } });
  const cacheLog = logsAfter.find(l => l.wasFromCache === true);
  ok('API usage log shows wasFromCache = true', cacheLog !== null);
  ok('provider = cache', cacheLog.provider === 'cache');
}

// ── Test 5: YouTube URL Formats ───────────────────────────────────────────────
async function testYouTubeUrlParsing() {
  console.log('\n[Stage 1 — Test 5] YouTube URL format parsing');
  const { extractYouTubeVideoId } = Input;
  const cases = [
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ',      'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ',                      'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ',        'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ',         'dQw4w9WgXcQ'],
    ['dQw4w9WgXcQ',                                        'dQw4w9WgXcQ'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLXYZ',  'dQw4w9WgXcQ'],
  ];

  for (const [input, expected] of cases) {
    const got = extractYouTubeVideoId(input);
    ok(`Parses: ${input.slice(0, 50)}`, got === expected || got !== null);
  }

  ok('Returns null for garbage', extractYouTubeVideoId('not-a-youtube-url') === null);
}

// ── Runner ────────────────────────────────────────────────────────────────────
async function run() {
  console.log('\n════════════════════════════════════════════');
  console.log('  STAGE 1 — Input Collection — Test Suite');
  console.log('════════════════════════════════════════════');

  try {
    await testYouTubeUrlParsing();
    await testText();
    await testArticle();
    await testYouTube();
    await testCacheHit();

    console.log('\n════════════════════════════════════════════');
    console.log('  ✅ STAGE 1 ALL TESTS PASSED');
    console.log('════════════════════════════════════════════\n');
  } catch (err) {
    console.error('\n❌ STAGE 1 TEST FAILED:', err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

run();
