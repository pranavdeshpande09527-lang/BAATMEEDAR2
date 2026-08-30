## API-load controls

- Cache extraction, transcripts, search results, source inspections, and evidence packets with configurable freshness windows.
- Deduplicate claims before research using semantic similarity plus exact-entity/time checks.
- Use structured, compact JSON outputs with token limits per stage.
- Batch claim extraction and shared-source evidence reviews.
- Set configurable limits for claims per input, searches per claim, sources inspected per claim, follow-up rounds, and maximum model context.
- Use early stopping only after the minimum authoritative-evidence threshold is met and no material conflict remains.
- Escalate to follow-up research only for unresolved, high-impact, or conflicting claims.
- Never call a model merely to restate data already available in structured form.