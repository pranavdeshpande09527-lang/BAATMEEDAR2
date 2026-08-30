'use strict';
const prisma  = require('../lib/prisma');
const crypto  = require('crypto');
const config  = require('../config');

/**
 * CacheService — Prevents redundant API calls per API-load control rules.
 *
 * Cache keys are deterministic hashes of the input.
 * TTL windows are read from centralized config.
 * Cache types: ARTICLE_TEXT | YOUTUBE_TRANSCRIPT | SEARCH_RESULTS | SOURCE_SUMMARY
 */

function hashKey(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function ttlSeconds(cacheType) {
  const map = {
    ARTICLE_TEXT:       config.cache.articleTtl,
    YOUTUBE_TRANSCRIPT: config.cache.youtubeTtl,
    SEARCH_RESULTS:     config.cache.searchTtl,
    SOURCE_SUMMARY:     config.cache.sourceTtl,
  };
  return map[cacheType] ?? 3600;
}

async function get(rawKey, cacheType) {
  if (!config.cache.enabled) return null;
  const cacheKey = hashKey(`${cacheType}:${rawKey}`);
  const entry = await prisma.cacheEntry.findUnique({ where: { cacheKey } });
  if (!entry) return null;
  if (new Date() > entry.expiresAt) {
    // Stale — delete and return null
    await prisma.cacheEntry.delete({ where: { cacheKey } }).catch(() => {});
    return null;
  }
  return JSON.parse(entry.content);
}

async function set(rawKey, cacheType, data, checkId = null) {
  if (!config.cache.enabled) return;
  const cacheKey = hashKey(`${cacheType}:${rawKey}`);
  const ttl = ttlSeconds(cacheType);
  const expiresAt = new Date(Date.now() + ttl * 1000);
  await prisma.cacheEntry.upsert({
    where: { cacheKey },
    create: { cacheKey, cacheType, content: JSON.stringify(data), checkId, expiresAt },
    update: { content: JSON.stringify(data), fetchedAt: new Date(), expiresAt },
  });
}

async function has(rawKey, cacheType) {
  if (!config.cache.enabled) return false;
  return (await get(rawKey, cacheType)) !== null;
}

// ── Typed Cache Helpers ───────────────────────────────────────────────────

async function getArticle(url) {
  return get(url, config.cacheTypes.ARTICLE_TEXT);
}

async function setArticle(url, data, checkId = null) {
  return set(url, config.cacheTypes.ARTICLE_TEXT, data, checkId);
}

async function getYouTubeTranscript(videoId) {
  return get(videoId, config.cacheTypes.YOUTUBE_TRANSCRIPT);
}

async function setYouTubeTranscript(videoId, data, checkId = null) {
  return set(videoId, config.cacheTypes.YOUTUBE_TRANSCRIPT, data, checkId);
}

async function getSearchResults(query) {
  return get(query.trim().toLowerCase(), config.cacheTypes.SEARCH_RESULTS);
}

async function setSearchResults(query, results, checkId = null) {
  return set(query.trim().toLowerCase(), config.cacheTypes.SEARCH_RESULTS, { results }, checkId);
}

async function getSourceSummary(url) {
  return get(url, config.cacheTypes.SOURCE_SUMMARY);
}

async function setSourceSummary(url, summary, checkId = null) {
  return set(url, config.cacheTypes.SOURCE_SUMMARY, summary, checkId);
}

async function clearExpired() {
  const count = await prisma.cacheEntry.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}

module.exports = {
  get,
  set,
  has,
  hashKey,
  getArticle,
  setArticle,
  getYouTubeTranscript,
  setYouTubeTranscript,
  getSearchResults,
  setSearchResults,
  getSourceSummary,
  setSourceSummary,
  clearExpired,
};
