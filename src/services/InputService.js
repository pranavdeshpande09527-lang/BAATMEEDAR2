'use strict';
const axios   = require('axios');
const cheerio = require('cheerio');
const prisma  = require('../lib/prisma');
const Cache   = require('./CacheService');
const Budget  = require('./ApiBudgetService');
const config  = require('../config');
const { logger } = require('../lib/logger');

/**
 * InputService — Stage 1: Input collection.
 *
 * - TEXT:    Stores direct statement as raw text data.
 * - ARTICLE: Fetches article HTML via Cheerio; extracts main text, title, publisher,
 *            and canonical URL. Caches by canonical URL with configured TTL.
 * - YOUTUBE: Parses multiple YouTube URL formats, retrieves metadata via oEmbed,
 *            fetches transcript segments. Caches by video ID with configured TTL.
 *
 * Non-negotiable Trust Rule:
 * All external text is strictly passive data and never interpreted as instructions.
 */

// ── YouTube URL Parser ──────────────────────────────────────────────────────
function extractYouTubeVideoId(input) {
  if (!input) return null;
  const str = input.trim();

  // If already an 11-char ID
  if (/^[A-Za-z0-9_-]{11}$/.test(str)) {
    return str;
  }

  // Handle standard watch URLs, youtu.be, shorts, and embed URLs
  const patterns = [
    /[?&]v=([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/v\/([A-Za-z0-9_-]{11})/,
  ];

  for (const regex of patterns) {
    const match = str.match(regex);
    if (match && match[1]) return match[1];
  }

  return null;
}

// ── YouTube Metadata via oEmbed ─────────────────────────────────────────────
async function fetchYouTubeMetadata(videoId) {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const resp = await axios.get(oembedUrl, { timeout: 8000 });
    return {
      title: resp.data.title || null,
      channel: resp.data.author_name || null,
    };
  } catch (e) {
    logger.warn({ videoId, err: e.message }, '[InputService] YouTube oEmbed fetch failed');
    return { title: null, channel: null };
  }
}

// ── Main Process Input ──────────────────────────────────────────────────────
async function processInput(check) {
  const start = Date.now();

  if (check.inputType === config.inputTypes.TEXT) {
    await prisma.check.update({
      where: { id: check.id },
      data: {
        extractedText: check.originalInput,
        extractionStatus: 'ok',
        retrievalTime: new Date(),
      },
    });
    return check.originalInput;
  }

  if (check.inputType === config.inputTypes.ARTICLE) {
    return processArticle(check, start);
  }

  if (check.inputType === config.inputTypes.YOUTUBE) {
    return processYouTube(check, start);
  }

  throw new Error(`Unknown inputType: ${check.inputType}`);
}

// ── Article Ingestion ───────────────────────────────────────────────────────
async function processArticle(check, start) {
  const url = check.originalInput.trim();

  // 1. Cache hit check
  const cached = await Cache.getArticle(url);
  if (cached) {
    await Budget.logCall({
      checkId: check.id,
      provider: 'cache',
      endpoint: 'article_text',
      stage: config.stages.INPUT,
      wasFromCache: true,
      success: true,
    });

    await prisma.check.update({
      where: { id: check.id },
      data: {
        extractedText: cached.text,
        sourceTitle: cached.title || null,
        publisher: cached.publisher || null,
        canonicalUrl: cached.canonicalUrl || url,
        extractionStatus: 'ok',
        retrievalTime: new Date(cached.retrievalTime),
      },
    });

    return cached.text;
  }

  // 2. Fetch HTML & Parse with Cheerio
  let text = '', title = null, publisher = null, canonicalUrl = url, status = 'ok';

  try {
    const resp = await axios.get(url, {
      timeout: 12000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) BAATMEEDAR/1.0 (Editorial Fact-Checking Newsroom)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    const $ = cheerio.load(resp.data);

    // Extract Title
    title = $('meta[property="og:title"]').attr('content') ||
            $('meta[name="twitter:title"]').attr('content') ||
            $('title').text().trim() ||
            $('h1').first().text().trim() || null;

    // Extract Publisher / Site Name
    publisher = $('meta[property="og:site_name"]').attr('content') ||
                $('meta[name="publisher"]').attr('content') ||
                $('meta[name="author"]').attr('content') || null;

    if (!publisher) {
      try {
        const parsedHost = new URL(url).hostname.replace(/^www\./, '');
        publisher = parsedHost;
      } catch (_e) {}
    }

    // Extract Canonical URL
    const canon = $('link[rel="canonical"]').attr('href');
    if (canon && canon.startsWith('http')) {
      canonicalUrl = canon;
    }

    // Clean boilerplates: scripts, styles, navigation, footer, ads, sidebars
    $('script, style, noscript, nav, header, footer, aside, form, iframe, .ad, .advertisement, #comments, .comments, .cookie-banner').remove();

    // Extract article body text from paragraphs or main content wrappers
    const paragraphs = [];
    const articleContainer = $('article, main, .article-body, .story-content, .entry-content, #content');

    const target = articleContainer.length > 0 ? articleContainer : $('body');
    target.find('p, h1, h2, h3, h4, blockquote, li').each((_, el) => {
      const pText = $(el).text().replace(/\s+/g, ' ').trim();
      if (pText.length > 20) { // filter out minor snippets
        paragraphs.push(pText);
      }
    });

    text = paragraphs.join('\n\n');

    if (!text || text.length < 50) {
      // Fallback to text inside body if paragraph query was too strict
      text = target.text().replace(/\s+/g, ' ').trim();
    }

    if (!text || text.length < 30) {
      status = 'insufficient_text';
    }
  } catch (err) {
    status = 'failed';
    text = '';
    logger.error({ url, err: err.message }, '[InputService] Failed to retrieve article');
  }

  const latency = Date.now() - start;
  await Budget.logCall({
    checkId: check.id,
    provider: 'web',
    endpoint: 'article_fetch',
    stage: config.stages.INPUT,
    latencyMs: latency,
    success: status === 'ok',
  });

  const payload = {
    text,
    title,
    publisher,
    canonicalUrl,
    retrievalTime: new Date().toISOString(),
  };

  // Cache by canonical URL
  if (status === 'ok') {
    await Cache.setArticle(canonicalUrl, payload, check.id);
  }

  await prisma.check.update({
    where: { id: check.id },
    data: {
      extractedText: text,
      sourceTitle: title,
      publisher,
      canonicalUrl,
      extractionStatus: status,
      retrievalTime: new Date(),
    },
  });

  return text;
}

// ── YouTube Ingestion ───────────────────────────────────────────────────────
async function processYouTube(check, start) {
  const inputUrl = check.originalInput.trim();
  const videoId = extractYouTubeVideoId(inputUrl);

  if (!videoId) {
    await prisma.check.update({
      where: { id: check.id },
      data: { extractionStatus: 'invalid_url', videoId: null },
    });
    throw new Error('Invalid YouTube URL — could not parse video ID');
  }

  // 1. Cache hit check
  const cached = await Cache.getYouTubeTranscript(videoId);
  if (cached) {
    await Budget.logCall({
      checkId: check.id,
      provider: 'cache',
      endpoint: 'youtube_transcript',
      stage: config.stages.INPUT,
      wasFromCache: true,
      success: true,
    });

    await prisma.check.update({
      where: { id: check.id },
      data: {
        extractedText: cached.transcript,
        sourceTitle: cached.title || null,
        publisher: cached.channel || null,
        videoId,
        language: cached.language || 'en',
        extractionStatus: 'ok',
        retrievalTime: new Date(cached.retrievalTime),
      },
    });

    return cached.transcript;
  }

  // 2. Fetch metadata (Title & Channel)
  const meta = await fetchYouTubeMetadata(videoId);

  // 3. Fetch Transcript
  let transcript = '', language = 'en', status = 'ok';

  try {
    const { YoutubeTranscript } = require('youtube-transcript');
    const segments = await YoutubeTranscript.fetchTranscript(videoId);
    if (segments && segments.length > 0) {
      transcript = segments.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
    } else {
      status = 'transcript_empty';
    }
  } catch (err) {
    status = 'unavailable';
    logger.warn({ videoId, err: err.message }, '[InputService] Transcript unavailable');
  }

  const latency = Date.now() - start;
  await Budget.logCall({
    checkId: check.id,
    provider: 'youtube',
    endpoint: 'transcript',
    stage: config.stages.INPUT,
    latencyMs: latency,
    success: status === 'ok',
  });

  const payload = {
    transcript,
    title: meta.title,
    channel: meta.channel,
    language,
    retrievalTime: new Date().toISOString(),
  };

  if (status === 'ok') {
    await Cache.setYouTubeTranscript(videoId, payload, check.id);
  }

  await prisma.check.update({
    where: { id: check.id },
    data: {
      extractedText: transcript,
      sourceTitle: meta.title,
      publisher: meta.channel,
      videoId,
      language,
      extractionStatus: status,
      retrievalTime: new Date(),
    },
  });

  return transcript;
}

module.exports = {
  processInput,
  extractYouTubeVideoId,
  fetchYouTubeMetadata,
};
