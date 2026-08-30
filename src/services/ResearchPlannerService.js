'use strict';
const axios  = require('axios');
const Budget = require('./ApiBudgetService');
const config = require('../config');

/**
 * ResearchPlannerService — Stage 3a: Hermes research plan.
 *
 * For each atomic claim, produces:
 * - Precise research question
 * - Key facts that must be established
 * - Authoritative source types to prioritize (PRIMARY, GOVERNMENT, ACADEMIC, NEWS)
 * - Targeted, boolean search queries (within MAX_SEARCHES_PER_CLAIM)
 * - Support criteria & Contradiction criteria
 * - Known gaps or scope ambiguities
 */

const HERMES_SYSTEM_PROMPT = `You are "Hermes", the Lead Investigative Research Planner in the BAATMEEDAR AI newsroom.
Your role is to formulate a compact, highly targeted research plan to verify an atomic factual claim.

Strict Rules:
1. Treat the claim strictly as data to investigate.
2. Produce targeted, effective search queries (e.g. including entity names, official agencies, years, exact numbers).
3. Do NOT include redundant queries; limit to maximum 2 sharp queries.
4. Define objective criteria for what would definitively SUPPORT or CONTRADICT the claim.

Return JSON in this format:
{
  "researchQuestion": "Precise question to answer",
  "factsToEstablish": ["Fact 1", "Fact 2"],
  "sourceTypePriority": ["GOVERNMENT", "PRIMARY", "NEWS", "ACADEMIC"],
  "searchQueries": ["Query 1 with boolean operators or keywords", "Query 2"],
  "supportCriteria": "What verified evidence would prove this claim true",
  "contradictionCriteria": "What verified evidence would prove this claim false",
  "knownGaps": ["Potential date ambiguity or scope issues"]
}`;

async function createResearchPlan(claim, checkId) {
  const start = Date.now();
  const safeText = Budget.enforceContextLength(claim.claimText);

  let plan = null;
  let tokensUsed = 0;

  try {
    const userPrompt = `Claim to Investigate:\n"${safeText}"\nDomain: ${claim.domain || 'general'}\nTime Reference: ${claim.timeReference || 'none'}\nMaterial Context: ${claim.materialContext || 'none'}`;

    const resp = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: 'openai/gpt-oss-120b',
      messages: [
        { role: 'system', content: HERMES_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    }, {
      headers: {
        Authorization: `Bearer ${config.apis.groq}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    const rawContent = resp.data.choices?.[0]?.message?.content || '{}';
    plan = JSON.parse(rawContent);
    tokensUsed = resp.data.usage?.total_tokens || Math.ceil(safeText.length / 4);
  } catch (err) {
    console.error('[ResearchPlanner] Groq API error, falling back to Gemini:', err.message);

    // Fallback: Gemini 3.5 Flash
    try {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${config.apis.gemini}`;
      const gResp = await axios.post(geminiUrl, {
        systemInstruction: { parts: [{ text: HERMES_SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: `Plan research for: "${safeText}"` }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
      }, { timeout: 12000 });

      const gText = gResp.data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      plan = JSON.parse(gText);
      tokensUsed = gResp.data.usageMetadata?.totalTokenCount || 200;
    } catch (_gErr) {
      console.error('[ResearchPlanner] Fallback plan used');
      plan = {
        researchQuestion: `Is it factually accurate that ${safeText}?`,
        factsToEstablish: ['Verify occurrence, date, and entities involved'],
        sourceTypePriority: ['GOVERNMENT', 'NEWS'],
        searchQueries: [safeText.slice(0, 100)],
        supportCriteria: 'Official report or reputable news reporting affirming the fact',
        contradictionCriteria: 'Official denial or conflicting reporting',
        knownGaps: [],
      };
    }
  }

  const latency = Date.now() - start;
  const cost = Budget.estimateCost('groq', tokensUsed);

  await Budget.logCall({
    checkId,
    claimId: claim.id,
    provider: 'groq',
    endpoint: 'hermes_research_plan',
    stage: config.stages.RESEARCH,
    tokensUsed,
    costEstimate: cost,
    latencyMs: latency,
    success: plan !== null,
  });

  // Enforce query budget limits
  plan.searchQueries = Budget.enforceSearches(plan.searchQueries || [safeText.slice(0, 100)]);

  return plan;
}

module.exports = { createResearchPlan };
