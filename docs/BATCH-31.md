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

## 2. Files on written answers: 500 MB each (owner, Oct 29; added tonight)
Files attached to written answers go from 25 MB to 500 MB each (still 5 files; images, PDF, plain text, zip). Recordings stay 500 MB each (5 per part).
- The file box's check and line ("Files can be at most 500 MB."), the server's checks (start, the local upload route, R2's check at Done) and every "25 MB" line.
- The upload keeps its percentage; a failed upload is abandoned (its row and any partial file go), so a retry starts clean and nothing shows as still uploading.
- Tests: 500 MB accepted, 500 MB + 1 byte refused with the updated line.

## Check and report
- Run `NEXT_DIST_DIR=.next-build npm run check`; it must be green. No migration expected.
- Don't touch port 3400. Don't edit docs/DESIGN-DOC.md. Never print secrets from .env.
- Commit on master and never push. End the commit message with:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Report what changed.
