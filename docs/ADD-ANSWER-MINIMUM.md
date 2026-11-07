# Add to this answer: minimum length (November 7)

The owner asked for a 50-character minimum on Add to this answer. Each new addition must contain at least 50 characters of text; the original answer and earlier additions do not contribute. The existing 20,000-character maximum per addition remains.

Use the initial-answer counting rule: ignore surrounding whitespace, formatting marks and attachment markers. Files alone do not satisfy the text minimum. Existing stored additions remain unchanged. The rule also applies when this form supplies a question's first answer or adds to Anything else.

The form shows the existing minimum counter and a red field error on a short press. The server checks before stop-once and again under the test lock. The normal test-only ANSWER_MIN_CHARS override applies as it does to initial answers; production always uses 50.

Tests: `tests/add-answer-minimum.test.ts` covers the boundary, independent additions, no write after refusal, formatting, whitespace and attachment markers.
