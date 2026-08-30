2. Design The Data Model / Database
Build the database structure before writing heavy backend logic.
Add caching early. This is where API savings begin.

checks:
- id
- input_type: text/article/youtube
- original_input
- status
- created_at

claims:
- id
- check_id
- claim_text
- importance
- verifiability
- status

sources:
- id
- claim_id
- url
- title
- publisher
- source_type
- credibility_notes

model_verifications:
- id
- claim_id
- model_name
- verdict
- reasoning
- evidence_used

api_usage_logs:
- provider
- endpoint
- tokens_used
- cost_estimate
- check_id