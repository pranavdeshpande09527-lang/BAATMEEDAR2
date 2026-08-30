### Stage 4 — Independent verification

Grok and Gemini independently evaluate the original Stage 2 claim against the finalized Stage 3 evidence packet.

Each returns:

- `supported`, `contradicted`, or `inconclusive`
- Calibrated confidence
- Reasoning linked to evidence IDs
- Limitations
- Unresolved questions

Do not pass either evaluator the other evaluator’s output. Run both calls in parallel only after the evidence packet is complete.