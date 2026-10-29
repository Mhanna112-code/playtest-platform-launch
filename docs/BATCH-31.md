# Batch 31: a flat 10 testers per test (owner, Oct 29; build TONIGHT)

This file wins over the earlier batches and the design doc where they differ.

## 1. Every test takes at most 10 testers
Remove the developer's growing tester limit (10 to start, +10% per 10 good ratings, at most 50).
- Spots on Post and Edit: 1–10 ("At most 10 testers per test."), the server refuses more; Next round the same.
- Remove the tester-limit card from the developer's own profile ("Can take up to N testers per test · Next: +10% after N more ratings") and the rating-based growth code; keep ratings themselves.
- Tests that already have more than 10 spots keep them (Edit can lower them, never raise above 10 or above what they have).
- Unchanged: a tester can be in at most 10 tests at once.
- Update HANDOVER / Terms / landing text if they mention the growing limit or 50 (doc agent does the design doc).
- Tests: Post with 11 refused; 10 ok; an existing 20-spot test keeps 20 and can't go to 21; the card is gone.

## Check and report
- Run `NEXT_DIST_DIR=.next-build npm run check`; it must be green. No migration expected.
- Don't touch port 3400. Don't edit docs/DESIGN-DOC.md. Never print secrets from .env.
- Commit on master and never push. End the commit message with:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Report what changed.
