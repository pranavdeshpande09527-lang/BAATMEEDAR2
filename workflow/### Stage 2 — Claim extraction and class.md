### Stage 2 — Claim extraction and classification

Gemini extracts only independently verifiable factual claims. It excludes opinions, predictions, advice, rhetoric, and unverifiable statements while retaining omitted context.

For every claim, record:

- Stable claim ID
- Original wording
- Domain
- Named entities
- Location
- Time reference and sensitivity
- Material context
- Ambiguity or scope notes

Gemini must not verify, reinterpret, or silently rewrite claims.

API efficiency: process all claims from one input in a single structured extraction request. Skip research for claims classified as non-verifiable or immaterial.
