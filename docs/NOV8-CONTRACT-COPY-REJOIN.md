# November 8: contract wording and rejoin display

- Edit uses the short prices/parts Keep/Switch explanation and links to Terms. Terms reuse the complete shared addition-pricing rule, avoiding drift between descriptions. Existing detailed rules for other listing edits, NDA acknowledgements and deadlines remain.
- The developer payment acknowledgement explicitly covers failure to review/Pay and saved old listing prices for past work.
- Agreed scope now distinguishes agreed prices/parts from other listing edits instead of saying the whole contract stays fixed.
- Session content is keyed to participation status and ending timestamp, resetting retained client panels across leaving/rejoining. A database regression verifies rejoining changes the existing polling fingerprint even with no listing edit. This is a safeguard; the owner's precise stale-page scenario has not been manually reproduced.
- No excerpt/block policy changed. Paid written excerpts can be requested after leaving or ending, subject to the current NDA and normal excerpt rules. An active block prevents rejoining; unblocking does not automatically restore participation.

Validation: addition and Terms suite 14 passed; new copy/rejoin and Terms suite 4 passed (the two Terms tests overlap). Typecheck and lint passed with existing warnings. Full check status is recorded in the chat. No database migration or real messages/payments were made.

Full npm run check: not green. It reproduced the existing codex8-separate-sides source assertion failure (other-side notice); stopped after that failure. No claim of a clean full suite or completed build for this change.
