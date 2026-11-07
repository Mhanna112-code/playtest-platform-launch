# Addition pricing and Charge preservation — November 7, 2026

Owner-approved replacement for the earlier addition rules. Applies equally to new written answers, Add to answer, and additional recordings.

- Before the tester deadline, while unpaid and before Charge opens, additions adopt the current agreed contract price (including zero or unlisted), restart the seven-day review period, and use the current stint deadline.
- After the deadline or after Charge opens, additions preserve the existing saved price, late/on-time status, review dates and Charge closing date. They create no additional Charge entitlement.
- A paid or charged part retains its price and cannot reopen Charge. Existing after-payment update handling continues.
- A first submission after its deadline remains late and cannot open Charge. An already-late part stays late.
- Keep retains the old contract price; Switch changes the contract price. Switching alone never reprices submitted work.

Implementation: shared `additionTerms` used inside the test lock by all three submission paths. No database migration for this rule. Terms and the shared offer explanation describe the same behavior.

Validation: `consistent-addition-charge.test.ts` covers price increase/decrease/zero/unlisted, late originals, first late submission, an opened window with a subsequently extended deadline, settled work, and real request integration for all three addition paths. Full repository check status must be reported separately from focused checks.

Focused validation: 73 tests passed across the new rule, edit wording and batch20; another 30 passed across the new rule, edit wording and batch30 money. Typecheck, lint and production build passed (existing warnings remain). A full check was attempted in codex64 and stopped after reproducing unrelated existing source/markup assertion failures; the full check is not green.
