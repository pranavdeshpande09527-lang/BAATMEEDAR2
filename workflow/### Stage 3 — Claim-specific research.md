### Stage 3 — Claim-specific research

For each material claim:

1. Hermes creates a compact research plan: precise research question, facts to establish, authoritative source types, support/contradiction criteria, and gaps.
2. Tavily retrieves targeted candidates using a configured query budget. Deduplicate domains, URLs, and near-identical results.
3. Inspect only the highest-value sources first. Stop retrieval when the configured evidence threshold is met; continue only if evidence conflicts, is insufficient, or requires a primary source.
4. Store each inspected source as an evidence record containing URL, title, publisher/author, publication date, retrieval date, relevant excerpt, stance, source type, authority rationale, relevance, and limitations.
5. Groq reviews the evidence packet for missing context, logical gaps, counterevidence, and unanswered questions.
6. Gemini reviews whether the evidence addresses the exact wording, scope, and material terms of the claim.

API efficiency: batch evidence review for claims sharing the same source packet; reuse evidence across claims only when it directly applies, while retaining separate claim-to-evidence links.