'use strict';
const assert = require('assert');
const InputService = require('../src/services/InputService');
const Cache = require('../src/services/CacheService');
const prisma = require('../src/lib/prisma');

async function runTests() {
  console.log('\n=== RUNNING STEP 5: INPUT COLLECTION TESTS ===\n');

  // Test 1: Direct text input
  console.log('[Test 1] Direct text input collection...');
  const textCheck = await prisma.check.create({
    data: {
      inputType: 'TEXT',
      originalInput: 'India successfully launched the Chandrayaan-3 mission on July 14, 2023.',
      status: 'PENDING',
    },
  });
  const textResult = await InputService.processInput(textCheck);
  assert.strictEqual(textResult, textCheck.originalInput, 'Direct text mismatch');

  const updatedTextCheck = await prisma.check.findUnique({ where: { id: textCheck.id } });
  assert.strictEqual(updatedTextCheck.extractionStatus, 'ok', 'Status should be ok');
  assert.ok(updatedTextCheck.extractedText.length > 20, 'Extracted text should be preserved');
  console.log('  -> PASS: Direct text preserved and recorded');

  // Test 2: YouTube URL Regex & Parser
  console.log('[Test 2] YouTube URL formats parsing...');
  const sampleUrls = [
    { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' },
    { url: 'https://youtu.be/dQw4w9WgXcQ?si=abcdef', expected: 'dQw4w9WgXcQ' },
    { url: 'https://www.youtube.com/shorts/dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' },
    { url: 'https://www.youtube.com/embed/dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' },
    { url: 'dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' },
  ];

  for (const item of sampleUrls) {
    const extracted = InputService.extractYouTubeVideoId(item.url);
    assert.strictEqual(extracted, item.expected, `Failed to parse ${item.url}`);
  }
  console.log('  -> PASS: All 5 YouTube URL formats parsed correctly');

  // Test 3: Article ingestion & caching
  console.log('[Test 3] Article ingestion & caching...');
  const testArticleUrl = 'https://example.com/press-release/1';
  // Pre-seed cache to simulate cached article fetch
  await Cache.setArticle(testArticleUrl, {
    text: 'This is a verified test article body text about national infrastructure developments.',
    title: 'National Infrastructure Update 2024',
    publisher: 'example.com',
    canonicalUrl: testArticleUrl,
    retrievalTime: new Date().toISOString(),
  });

  const articleCheck = await prisma.check.create({
    data: {
      inputType: 'ARTICLE',
      originalInput: testArticleUrl,
      status: 'PENDING',
    },
  });

  const articleResult = await InputService.processInput(articleCheck);
  assert.ok(articleResult.includes('infrastructure'), 'Article text was not extracted from cache');

  const updatedArticleCheck = await prisma.check.findUnique({ where: { id: articleCheck.id } });
  assert.strictEqual(updatedArticleCheck.sourceTitle, 'National Infrastructure Update 2024');
  assert.strictEqual(updatedArticleCheck.publisher, 'example.com');
  assert.strictEqual(updatedArticleCheck.canonicalUrl, testArticleUrl);
  console.log('  -> PASS: Article extracted with metadata & cached properly');

  // Test 4: YouTube ingestion & caching
  console.log('[Test 4] YouTube transcript & metadata caching...');
  const testYtId = 'dQw4w9WgXcQ';
  await Cache.setYouTubeTranscript(testYtId, {
    transcript: 'Official speech transcript segment on renewable energy targets.',
    title: 'Energy Policy Address',
    channel: 'Official Channel',
    language: 'en',
    retrievalTime: new Date().toISOString(),
  });

  const ytCheck = await prisma.check.create({
    data: {
      inputType: 'YOUTUBE',
      originalInput: `https://www.youtube.com/watch?v=${testYtId}`,
      status: 'PENDING',
    },
  });

  const ytResult = await InputService.processInput(ytCheck);
  assert.ok(ytResult.includes('renewable energy'), 'Transcript was not extracted from cache');

  const updatedYtCheck = await prisma.check.findUnique({ where: { id: ytCheck.id } });
  assert.strictEqual(updatedYtCheck.videoId, testYtId);
  assert.strictEqual(updatedYtCheck.sourceTitle, 'Energy Policy Address');
  assert.strictEqual(updatedYtCheck.publisher, 'Official Channel');
  console.log('  -> PASS: YouTube transcript & metadata extracted & cached properly');

  console.log('\n=== ALL STEP 5 TESTS PASSED SUCCESSFULLY! ===\n');
}

runTests().then(() => process.exit(0)).catch(err => {
  console.error('[TEST FAILED]', err);
  process.exit(1);
});
