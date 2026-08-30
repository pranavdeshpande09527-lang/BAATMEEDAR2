'use strict';
const axios   = require('axios');
const prisma  = require('../lib/prisma');
const Budget  = require('./ApiBudgetService');
const config  = require('../config');
const crypto  = require('crypto');

// ── Safe JSON parser ─────────────────────────────────────────────────────────
function safeParseJson(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try { return JSON.parse(raw); } catch (_e) {}
  const blockMatch = raw.match(/\{[\s\S]*\}/);
  if (blockMatch) {
    try { return JSON.parse(blockMatch[0]); } catch (_e) {}
  }
  const lastBrace = raw.lastIndexOf('}');
  if (lastBrace > 0) {
    try { return JSON.parse(raw.slice(0, lastBrace + 1)); } catch (_e) {}
  }
  return null;
}

/**
 * IndependentVerificationService — Stage 4: Dual-blind Independent Verification.
 *
 * NON-NEGOTIABLE TRUST RULE:
 * - Groq Evaluator (model: openai/gpt-oss-120b, stored as GROQ_GPT) and Gemini Evaluator are strictly isolated.
 * - Neither evaluator receives or sees the other's prompt, reasoning, or verdict.
 * - Both evaluators receive the EXACT same Stage 3 evidence packet in parallel.
 * - Verdict standard: SUPPORTED | CONTRADICTED | INCONCLUSIVE.
 * - INCONCLUSIVE is the correct verdict whenever evidence is missing, weak, stale,
 *   contradictory, or too broad for the wording of the claim.
 */

const EVALUATOR_SYSTEM_PROMPT = `You are an Independent Judicial Fact-Checking Evaluator in the BAATMEEDAR AI newsroom.
Your role is to independently judge whether an atomic factual claim is SUPPORTED, CONTRADICTED, or INCONCLUSIVE based solely on the provided evidence packet.

Strict Verification Standards:
1. "SUPPORTED": Direct, high-quality, authoritative evidence unequivocally proves the exact claim and numbers/dates.
2. "CONTRADICTED": Credible evidence directly refutes the claim or proves the opposite fact.
3. "INCONCLUSIVE": Evidence is missing, weak, indirect, stale, contradictory, or does not address the exact scope/wording.
4. Cite specific source IDs (e.g. "[sourceId]") in your reasoning.
5. Calibrate confidence between 0.0 (zero confidence) and 1.0 (airtight certainty).
6. State explicit limitations and unresolved questions honestly.

Return JSON in this format:
{
  "verdict": "SUPPORTED | CONTRADICTED | INCONCLUSIVE",
  "confidence": 0.85,
  "reasoning": "Clear, evidence-backed explanation citing exact source IDs",
  "evidenceIdsUsed": ["sourceId1", "sourceId2"],
  "limitations": "Specific limitations of the evidence gathered, or null",
  "unresolvedQuestions": "Any questions that remain open, or null"
}`;

async function verifyIndependently(claim, sources, checkId) {
  const evidencePacket = buildEvidencePacket(claim, sources);

  // Run BOTH evaluators in parallel — strict isolation, zero cross-contamination
  const [grokResult, geminiResult] = await Promise.all([
    _runGrokEvaluator(claim, evidencePacket, checkId),
    _runGeminiEvaluator(claim, evidencePacket, checkId),
  ]);

  // Persist both model verifications to DB
  const [grokVerification, geminiVerification] = await Promise.all([
    prisma.modelVerification.upsert({
      where: { claimId_modelName: { claimId: claim.id, modelName: 'GROQ_GPT' } },
      create: buildVerificationRecord(claim.id, 'GROQ_GPT', grokResult),
      update: buildVerificationRecord(claim.id, 'GROQ_GPT', grokResult),
    }),
    prisma.modelVerification.upsert({
      where: { claimId_modelName: { claimId: claim.id, modelName: 'GEMINI' } },
      create: buildVerificationRecord(claim.id, 'GEMINI', geminiResult),
      update: buildVerificationRecord(claim.id, 'GEMINI', geminiResult),
    }),
  ]);

  return { grokVerification, geminiVerification };
}

function buildEvidencePacket(claim, sources) {
  return {
    claimId:   claim.id,
    claimText: claim.claimText,
    domain:    claim.domain,
    timeRef:   claim.timeReference,
    sources: sources.map(s => ({
      id:       s.id,
      url:      s.url,
      title:    s.title,
      publisher: s.publisher,
      sourceType: s.sourceType,
      stance:   s.stance,
      excerpt:  s.relevantExcerpt || s.searchSnippet || '',
      pubDate:  s.publicationDate,
    })),
  };
}

function buildVerificationRecord(claimId, modelName, result) {
  const validVerdict = ['SUPPORTED', 'CONTRADICTED', 'INCONCLUSIVE'].includes(result.verdict)
    ? result.verdict : 'INCONCLUSIVE';

  return {
    claimId,
    modelName,
    verdict:             validVerdict,
    confidence:          typeof result.confidence === 'number' ? Math.max(0, Math.min(1, result.confidence)) : 0.5,
    reasoning:           result.reasoning || 'Evaluation completed based on available evidence packet.',
    evidenceIdsUsed:     JSON.stringify(result.evidenceIdsUsed || []),
    limitations:         result.limitations || null,
    unresolvedQuestions: result.unresolvedQuestions || null,
    promptHash:          result.promptHash || null,
    rawResponse:         result.rawResponse || null,
    tokensUsed:          result.tokensUsed || null,
  };
}

// ── Evaluator A: Grok / Groq Evaluator ──────────────────────────────────────
async function _runGrokEvaluator(claim, evidencePacket, checkId) {
  const start = Date.now();
  const promptBody = `TARGET CLAIM TO EVALUATE:\n"${claim.claimText}"\nDomain: ${claim.domain}\nTemporal Reference: ${claim.timeReference || 'none'}\n\nEVIDENCE PACKET:\n${JSON.stringify(evidencePacket.sources, null, 2)}`;
  
  const promptHash = crypto.createHash('sha256').update(`GROK:${promptBody}`).digest('hex');

  let result = null;
  let rawText = '';
  let tokensUsed = 0;

  try {
    const resp = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: 'openai/gpt-oss-120b',
      messages: [
        { role: 'system', content: EVALUATOR_SYSTEM_PROMPT },
        { role: 'user', content: promptBody },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    }, {
      headers: {
        Authorization: `Bearer ${config.apis.groq}`,
        'Content-Type': 'application/json',
      },
      timeout: 20000,
    });

    rawText = resp.data.choices?.[0]?.message?.content || '{}';
    result = safeParseJson(rawText);
    if (!result) throw new Error('Failed to parse Grok evaluator JSON');
    tokensUsed = resp.data.usage?.total_tokens || 500;
  } catch (err) {
    console.error('[Evaluator Grok] Call failed:', err.response?.data || err.message);
    result = {
      verdict: 'INCONCLUSIVE',
      confidence: 0.2,
      reasoning: 'Evaluator call experienced connection error; defaulting conservatively to inconclusive.',
      evidenceIdsUsed: [],
      limitations: 'Connection timeout',
      unresolvedQuestions: 'Verification could not be finalized.',
    };
  }

  const latency = Date.now() - start;
  const cost = Budget.estimateCost('grok', tokensUsed);

  await Budget.logCall({
    checkId,
    claimId: claim.id,
    provider: 'grok',
    endpoint: 'independent_verification_evaluator_a',
    stage: config.stages.VERIFICATION,
    tokensUsed,
    costEstimate: cost,
    latencyMs: latency,
    success: true,
  });

  return {
    ...result,
    promptHash,
    rawResponse: rawText,
    tokensUsed,
  };
}

// ── Evaluator B: Gemini Evaluator ───────────────────────────────────────────
async function _runGeminiEvaluator(claim, evidencePacket, checkId) {
  const start = Date.now();
  const promptBody = `TARGET CLAIM TO EVALUATE:\n"${claim.claimText}"\nDomain: ${claim.domain}\nTemporal Reference: ${claim.timeReference || 'none'}\n\nEVIDENCE PACKET:\n${JSON.stringify(evidencePacket.sources, null, 2)}`;
  
  const promptHash = crypto.createHash('sha256').update(`GEMINI:${promptBody}`).digest('hex');

  let result = null;
  let rawText = '';
  let tokensUsed = 0;

  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${config.apis.gemini}`;

    const resp = await axios.post(geminiUrl, {
      systemInstruction: { parts: [{ text: EVALUATOR_SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: promptBody }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    }, { timeout: 35000 });

    rawText = resp.data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    result = safeParseJson(rawText);
    if (!result) throw new Error('Failed to parse Gemini evaluator JSON');
    tokensUsed = resp.data.usageMetadata?.totalTokenCount || 500;
  } catch (err) {
    console.error('[Evaluator Gemini] Call failed:', err.response?.data || err.message);
    result = {
      verdict: 'INCONCLUSIVE',
      confidence: 0.2,
      reasoning: 'Evaluator call experienced connection error; defaulting conservatively to inconclusive.',
      evidenceIdsUsed: [],
      limitations: 'Connection timeout',
      unresolvedQuestions: 'Verification could not be finalized.',
    };
  }

  const latency = Date.now() - start;
  const cost = Budget.estimateCost('gemini', tokensUsed);

  await Budget.logCall({
    checkId,
    claimId: claim.id,
    provider: 'gemini',
    endpoint: 'independent_verification_evaluator_b',
    stage: config.stages.VERIFICATION,
    tokensUsed,
    costEstimate: cost,
    latencyMs: latency,
    success: true,
  });

  return {
    ...result,
    promptHash,
    rawResponse: rawText,
    tokensUsed,
  };
}

module.exports = { verifyIndependently };
