# Payment caps — November 7, 2026

Owner decision: replace the $1,000 monetary caps with $500. This supersedes older cap amounts in batch notes. All existing data is test data, so no grandfathering is required.

- Written answers: at most $500 per part, including Pay, Pay more and dispute awards.
- Recordings: the same $500 total per part.
- Calls: at most $500 combined per tester per test, including extra pay and dispute awards; call-room measurement ends at the remaining allowance. Booking remains allowed past the allowance.
- Listing prices: written and recording at most $500. Existing saved sample prices above $500 cannot produce a Charge above $500.
- The $200/hour call-rate limit, $200 confirmation ticks, minimum payments, text/upload limits and Stripe's transaction limit are unchanged. Historical payments are not rewritten.
- Forms, notices, Terms and the design document use $500. No schema migration is needed for this change.

Validation: added payment-cap-500.test.ts for shared caps, old sample Charge ceilings and real written/recording Pay + Pay more boundary requests. Updated existing listing, dispute, call-ending, race and payment fixtures for the lower allowance. Production build passes. The broad repository check remains non-green due to existing unrelated assertions; the run was stopped after reproducing them.

Focused results: all three new cap tests pass. The nine-file follow-up passed 184 existing tests; its two remaining failures were in the new test's below-minimum final press, corrected and rerun successfully. Typecheck, lint and production build pass (existing warnings remain). No migrations or historical payment edits were made.
