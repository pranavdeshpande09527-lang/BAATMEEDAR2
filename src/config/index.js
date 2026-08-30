'use strict';
require('dotenv').config();

// ── Validated centralized configuration (Non-negotiable trust rule) ──────────
// All env / operational / budget / model / API settings live here.
// No hardcoded values anywhere else in the codebase.

function required(key) {
  const val = process.env[key];
  if (!val) throw new Error(`[Config] Missing required env var: ${key}`);
  return val;
}

function optional(key, fallback) {
  return process.env[key] || fallback;
}

function num(key, fallback) {
  const v = process.env[key];
  const n = v ? parseInt(v, 10) : fallback;
  if (isNaN(n)) throw new Error(`[Config] ${key} must be a number, got: ${v}`);
  return n;
}

function bool(key, fallback) {
  const v = process.env[key];
  if (v === undefined || v === null || v === '') return fallback;
  return v === 'true' || v === '1';
}

const config = {
  // ── Server ────────────────────────────────
  port:    num('PORT', 3000),
  nodeEnv: optional('NODE_ENV', 'development'),
  isProduction: process.env.NODE_ENV === 'production',

  // ── Logging ───────────────────────────────
  logLevel: optional('LOG_LEVEL', process.env.NODE_ENV === 'production' ? 'info' : 'debug'),

  // ── CORS ─────────────────────────────────
  // Comma-separated list of allowed origins; '*' to allow all (dev only)
  allowedOrigins: optional('ALLOWED_ORIGINS', '*'),

  // ── Rate Limiting ─────────────────────────
  rateLimit: {
    windowMs: num('RATE_LIMIT_WINDOW_MS', 60000), // 1 minute
    max:      num('RATE_LIMIT_MAX', 30),           // 30 req/min per IP
  },

  // ── Pipeline ─────────────────────────────
  pipelineTimeoutMs: num('PIPELINE_TIMEOUT_MS', 300000), // 5 minutes

  // ── Database ──────────────────────────────
  databaseUrl: required('DATABASE_URL'),

  // ── API Keys ──────────────────────────────
  apis: {
    gemini:  required('GEMINI_API_KEY'),
    groq:    required('GROQ_API_KEY'),
    tavily:  required('TAVILY_API_KEY'),
    youtube: required('YOUTUBE_API_KEY'),
  },

  // ── API Budget Controls ───────────────────
  budget: {
    maxClaimsPerCheck:       num('MAX_CLAIMS_PER_CHECK', 8),
    maxSearchesPerClaim:     num('MAX_SEARCHES_PER_CLAIM', 2),
    maxSourcesPerClaim:      num('MAX_SOURCES_PER_CLAIM', 4),
    maxModelContextChars:    num('MAX_MODEL_CONTEXT_CHARS', 12000),
    minAuthoritativeSources: num('MIN_AUTHORITATIVE_SOURCES', 2),
  },

  // ── Cache Controls ────────────────────────
  cache: {
    enabled:       bool('ENABLE_CACHE', true),
    articleTtl:    num('CACHE_ARTICLE_TTL', 86400),    // 24h
    youtubeTtl:    num('CACHE_YOUTUBE_TTL', 86400),    // 24h
    searchTtl:     num('CACHE_SEARCH_TTL', 3600),      // 1h
    sourceTtl:     num('CACHE_SOURCE_TTL', 43200),     // 12h
  },

  // ── Pipeline Stage Identifiers ────────────
  stages: {
    INPUT:        1,
    EXTRACTION:   2,
    RESEARCH:     3,
    VERIFICATION: 4,
    EDITORIAL:    5,
  },

  // ── Model Names (for DB enum parity) ─────
  models: {
    gemini: 'GEMINI',
    groq:   'GROQ',
    grok:   'GROK',
  },

  // ── Verdict Values ────────────────────────
  verdicts: {
    SUPPORTED:    'SUPPORTED',
    CONTRADICTED: 'CONTRADICTED',
    INCONCLUSIVE: 'INCONCLUSIVE',
  },

  // ── Cache Types ───────────────────────────
  cacheTypes: {
    ARTICLE_TEXT:       'ARTICLE_TEXT',
    YOUTUBE_TRANSCRIPT: 'YOUTUBE_TRANSCRIPT',
    SEARCH_RESULTS:     'SEARCH_RESULTS',
    SOURCE_SUMMARY:     'SOURCE_SUMMARY',
  },

  // ── Input Types ───────────────────────────
  inputTypes: {
    TEXT:    'TEXT',
    ARTICLE: 'ARTICLE',
    YOUTUBE: 'YOUTUBE',
  },
};

module.exports = config;
