'use strict';
const axios   = require('axios');
const prisma  = require('../lib/prisma');
const Cache   = require('./CacheService');
const Budget  = require('./ApiBudgetService');
const config  = require('../config');

/**
 * SearchService — Stage 3b: Tavily source discovery & evidence ingestion.
 *
 * Rules enforced:
 * - Search candidate sources via Tavily API with configured query budget.
 * - Cache search queries with TTL.
 * - Deduplicate domains and URLs.
 * - Classify and rank sources by authority (PRIMARY / GOVERNMENT > ACADEMIC > NEWS > OTHER).
 * - Store searchSnippet (lead) and relevantExcerpt (inspected content).
 * - Enforce MAX_SOURCES_PER_CLAIM.
 */

function classifySourceType(url) {
  if (!url) return 'NEWS';
  const u = url.toLowerCase();

  if (/\.gov(\.|\/|$)|nic\.in|isro\.gov\.in|rbi\.org\.in|who\.int|un\.org|pib\.gov\.in/.test(u)) {
    return 'PRIMARY';
  }
  if (/\.edu(\.|\/|$)|ac\.in|doi\.org|nature\.com|thelancet\.com|sciencedirect\.com|nih\.gov/.test(u)) {
    return 'ACADEMIC';
  }
  if (/reuters\.com|apnews\.com|bbc\.com|thehindu\.com|indianexpress\.com|ndtv\.com|bloomberg\.com|ft\.com|aljazeera\.com/.test(u)) {
    return 'NEWS';
  }
  return 'NEWS';
}

function computeAuthorityScore(sourceType, url) {
  let score = 50;
  if (sourceType === 'PRIMARY') score = 95;
  else if (sourceType === 'ACADEMIC') score = 90;
  else if (sourceType === 'NEWS') score = 75;

  // Boost for known gold-standard fact check / primary domains
  if (/pib\.gov\.in|isro\.gov\.in|rbi\.org\.in|who\.int/.test(url)) score += 5;
  return score;
}

async function searchForClaim(claim, plan, checkId) {
  const queries = plan.searchQueries || [claim.claimText.slice(0, 80)];
  const rawResults = [];

  for (const query of queries) {
    // 1. Cache Check
    const cached = await Cache.getSearchResults(query);
    if (cached) {
      await Budget.logCall({
        checkId,
        claimId: claim.id,
        provider: 'cache',
        endpoint: 'tavily_search',
        stage: config.stages.RESEARCH,
        wasFromCache: true,
        success: true,
      });
      rawResults.push(...(cached.results || []));
      continue;
    }

    // 2. Live Tavily Search
    const start = Date.now();
    let results = [];

    try {
      const resp = await axios.post('https://api.tavily.com/search', {
        api_key: config.apis.tavily,
        query,
        search_depth: 'basic',
        max_results: 5,
        include_answer: false,
        include_raw_content: false,
      }, { timeout: 15000 });

      results = (resp.data.results || []).map(r => ({
        url: r.url,
        title: r.title || 'Untitled Source',
        snippet: r.content || '',
        score: r.score || 0,
        publishedDate: r.published_date || null,
      }));
    } catch (err) {
      console.error(`[SearchService] Tavily search failed for query "${query}":`, err.response?.data || err.message);
    }

    const latency = Date.now() - start;
    await Budget.logCall({
      checkId,
      claimId: claim.id,
      provider: 'tavily',
      endpoint: 'search_basic',
      stage: config.stages.RESEARCH,
      costEstimate: Budget.estimateCost('tavily', 1000),
      latencyMs: latency,
      success: results.length > 0,
    });

    if (results.length > 0) {
      await Cache.setSearchResults(query, results, checkId);
      rawResults.push(...results);
    }
  }

  // 3. Deduplicate and filter by valid HTTP URL
  const seenUrls = new Set();
  const deduped = [];
  for (const r of rawResults) {
    if (!r.url || !r.url.startsWith('http') || seenUrls.has(r.url)) continue;
    seenUrls.add(r.url);
    deduped.push(r);
  }

  // 4. Classify & Rank Candidates
  const scored = deduped.map(r => {
    const sourceType = classifySourceType(r.url);
    const authorityScore = computeAuthorityScore(sourceType, r.url);
    let publisher = 'web';
    try {
      publisher = new URL(r.url).hostname.replace(/^www\./, '');
    } catch (_e) {
      publisher = 'web';
    }

    return {
      ...r,
      sourceType,
      authorityScore,
      publisher,
    };
  });

  // Sort by authority score descending
  scored.sort((a, b) => b.authorityScore - a.authorityScore);

  // 5. Cap to MAX_SOURCES_PER_CLAIM
  const topSources = Budget.enforceSources(scored);

  // 6. Persist initial Source records to DB
  const persistedSources = [];
  for (const s of topSources) {
    const record = await prisma.source.create({
      data: {
        claimId:            claim.id,
        url:                s.url,
        title:              s.title,
        publisher:          s.publisher,
        sourceType:         s.sourceType,
        searchSnippet:      s.snippet,
        relevantExcerpt:    s.snippet, // Initially snippet, refined during inspection
        publicationDate:    s.publishedDate,
        authorityRationale: `Authority Score: ${s.authorityScore} (${s.sourceType})`,
        wasInspected:       false,
      },
    });
    persistedSources.push(record);
  }

  return persistedSources;
}

module.exports = { searchForClaim, classifySourceType };
