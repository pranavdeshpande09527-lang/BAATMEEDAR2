### Stage 1 — Input collection

- Accept a direct statement, article URL, or YouTube URL.
- For articles, extract text and record canonical URL, publisher, retrieval time, and extraction status.
- For YouTube, retrieve a transcript when available and record URL, title, channel, language, retrieval time, and transcript status.
- Cache extraction results by canonical URL or video ID. Do not retrieve the same source again within the configured freshness window.