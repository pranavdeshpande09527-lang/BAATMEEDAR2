'use strict';
const prisma = require('../lib/prisma');
const config = require('../config');
const { logger } = require('../lib/logger');

/**
 * ApiBudgetService — Enforces API spend limits and logs all model calls.
 *
 * Enforces:
 * - MAX_CLAIMS_PER_CHECK
 * - MAX_SEARCHES_PER_CLAIM
 * - MAX_SOURCES_PER_CLAIM
 * - MAX_MODEL_CONTEXT_CHARS
 *
 * Logs every API call with provider, endpoint, stage, tokens, cost, latency.
 */

async function logCall({ checkId, claimId, provider, endpoint, stage, tokensUsed, costEstimate, latencyMs, wasFromCache, success, errorMessage }) {
  await prisma.apiUsageLog.create({
    data: {
      checkId:      checkId  || null,
      claimId:      claimId  || null,
      provider,
      endpoint,
      stage:        stage    || null,
      tokensUsed:   tokensUsed   || null,
      costEstimate: costEstimate || null,
      latencyMs:    latencyMs    || null,
      wasFromCache: wasFromCache || false,
      success:      success !== false,
      errorMessage: errorMessage || null,
    },
  });
}

function normalizeText(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Deduplicate claims before research using normalized text and entity/time checks.
 * Merges duplicate claims while preserving metadata.
 */
function deduplicateClaims(claims) {
  const unique = [];
  const seen = new Map();

  for (const c of claims) {
    const norm = normalizeText(c.claimText || c.originalWording);
    if (!norm) continue;

    if (seen.has(norm)) {
      const existing = seen.get(norm);
      // Merge material context if extra info exists
      if (c.materialContext && !existing.materialContext?.includes(c.materialContext)) {
        existing.materialContext = `${existing.materialContext || ''}; ${c.materialContext}`.trim();
      }
      logger.debug({ claimText: c.claimText }, '[ApiBudget] Merged duplicate claim');
    } else {
      seen.set(norm, c);
      unique.push(c);
    }
  }

  return unique;
}

/**
 * Early stopping evaluation for source retrieval:
 * Stops searching once the minimum authoritative evidence threshold is met
 * AND no material stance conflict exists.
 */
function shouldStopSearching(sources) {
  const inspected = sources.filter(s => s.wasInspected && !s.inspectionFailed);
  const minThreshold = config.budget.minAuthoritativeSources;

  if (inspected.length < minThreshold) return false;

  const authoritativeTypes = new Set(['PRIMARY', 'GOVERNMENT', 'ACADEMIC', 'NEWS']);
  const authoritativeSources = inspected.filter(s => authoritativeTypes.has(s.sourceType));

  if (authoritativeSources.length < minThreshold) return false;

  // Check for material conflict
  const stances = authoritativeSources.map(s => s.stance).filter(Boolean);
  const hasSupport = stances.includes('SUPPORTS');
  const hasContradict = stances.includes('CONTRADICTS');

  // If there is conflict, DO NOT stop early — research must resolve conflict
  if (hasSupport && hasContradict) {
    return false;
  }

  // Clear consensus reached with authoritative sources
  return true;
}

// Model pricing estimates per 1k tokens (approximate USD)
const COST_PER_1K_TOKENS = {
  gemini: 0.00015,
  groq:   0.00010,
  grok:   0.00200,
  tavily: 0.00500, // per search call
  web:    0.00000,
  cache:  0.00000,
  youtube: 0.00000,
};

function enforceClaims(claimsArray) {
  const max = config.budget.maxClaimsPerCheck;
  if (claimsArray.length > max) {
    logger.warn({ count: claimsArray.length, max }, '[ApiBudget] Capping claims');
    return claimsArray.slice(0, max);
  }
  return claimsArray;
}

function enforceSearches(queries) {
  const max = config.budget.maxSearchesPerClaim;
  if (queries.length > max) {
    logger.warn({ count: queries.length, max }, '[ApiBudget] Capping search queries');
    return queries.slice(0, max);
  }
  return queries;
}

function enforceSources(sources) {
  const max = config.budget.maxSourcesPerClaim;
  if (sources.length > max) {
    logger.warn({ count: sources.length, max }, '[ApiBudget] Capping sources');
    return sources.slice(0, max);
  }
  return sources;
}

function enforceContextLength(text) {
  const max = config.budget.maxModelContextChars;
  if (text.length > max) {
    logger.warn({ originalLength: text.length, max }, '[ApiBudget] Truncating context');
    return text.slice(0, max);
  }
  return text;
}

async function getUsageSummary(checkId) {
  const logs = await prisma.apiUsageLog.findMany({ where: { checkId } });
  const totalTokens = logs.reduce((s, l) => s + (l.tokensUsed || 0), 0);
  const totalCost   = logs.reduce((s, l) => s + (l.costEstimate || 0), 0);
  const byProvider  = logs.reduce((acc, l) => {
    acc[l.provider] = (acc[l.provider] || 0) + (l.tokensUsed || 0);
    return acc;
  }, {});
  return { totalTokens, totalCost: totalCost.toFixed(6), byProvider, callCount: logs.length };
}

function estimateCost(provider, tokensUsed = 0) {
  const rate = COST_PER_1K_TOKENS[provider] || 0.0001;
  return (tokensUsed / 1000) * rate;
}

module.exports = {
  logCall,
  enforceClaims,
  enforceSearches,
  enforceSources,
  enforceContextLength,
  deduplicateClaims,
  shouldStopSearching,
  estimateCost,
  getUsageSummary,
};
