# Limits proof (§127 card attempts, §128 invites)

Recorded on Nov 2 with Playwright (Chrome) against a dev server run from the `feat/card-limits` worktree on port 3483: local database (its own `limits` schema), the fake Stripe (`STRIPE_FAKE=1`), throwaway `@playtest.test` accounts. Earlier attempts and invites were made beforehand (presses in an unrecorded browser, or invite rows added to the database), so each clip shows the press that hits the limit.

| File | What it shows |
| --- | --- |
| `01-add-card-6th-refused.png` | Payments, Your card: the 6th Add a card press in a day is refused. "Too many card attempts today. Try again tomorrow, or contact us." shows under the button. The 5 earlier presses were real presses; with the fake Stripe (no Checkout) each one came back with "We couldn't save the card", and each counted. |
| `01b-add-card-6th-refused-page.png` | The same, the whole page: the line is under the button, not at the top. |
| `v01-add-card-6th-refused.webm` | Video: pressing Add a card the 6th time, and the line appearing under it. |
| `02-verify-card-6th-refused.png` | Chargeback steps: the 6th Verify a card press is refused (HTTP 429), with the same line under the button. Reachable with the fake Stripe: each earlier press opened the stand-in for the bank's check. |
| `v02-verify-card-6th-refused.webm` | Video: pressing Verify a card the 6th time, and the line appearing. |
| `03-invite-press-of-3-with-2-left.png` | Invite testers with 98 invites sent today: a press of 3 is refused whole: "You can send up to 100 invites a day. You have 2 left today." Nothing was sent (still 98). |
| `04-invite-0-left.png` | At 100 sent today: "You've sent 100 invites today. You can invite more tomorrow." |
| `05-cancel-invite-at-the-limit.png` | At 100, Cancel invite still works: "Cancelled Ana …'s invite." |
| `05b-cancel-invite-at-the-limit-after.png` | The same panel a moment later: Ana is out of Invited. |
| `v03-invites-2-left-0-left-cancel.webm` | Video: inviting Ana, the press of 3 with 2 left refused, the press at 0 left refused, then Cancel invite at the limit. |
| `06-per-test-3-skip-others-invited.png` | Ana was invited and cancelled 3 times on this test today. A press ticking Ana and Ben invites Ben and skips Ana: "Invited Ben …. Ana …: you've invited them to this test 3 times today. You can invite them again tomorrow." |
| `v04-per-test-3-skip.webm` | Video: the 3 invite + Cancel invite rounds through the page, then the press that skips Ana and invites Ben. |
