# Batch 34 (owner, Oct 30)

This file wins over the earlier batches and the design doc where they differ.

## 1. Admins: opposite actions stop once; impossible ones name who and when (Claude)
- Every admin press sends its page time. When another admin (or the app) changed the SAME account, test, hold, dispute or outage since then and the press is still possible, it stops once in a blue box: "Your Delete didn't go through. Since this page loaded: admin2@… reinstated the tester side at 12:19 AM. Press Delete again to go ahead." The second press goes ahead.
  Pairs: Delete after a Suspend / Reinstate / $0 close-out; the $0 close-out after a Suspend / Reinstate; Pause after Lift the pause or Stop; Lift the pause after a Pause or Close now; Stop after Lift the pause / Extend; Close now ↔ Extend; chargeback Approve ↔ Don't approve; Approve a payment-hold lift after a Suspend; outage Approve ↔ Dismiss; Allow changes again; Mark replied.
- A press that's no longer possible is a plain refusal naming who and when: "That test was already paused (by admin2@… at 12:19 AM).", "…already stopped (by … at …)", "That hold was already approved (by … at …)", "That account was already deleted (by … at …)".
- Tests for every pair; screenshots of two admins side by side for each kind (desktop).

## 2. Accept / Decline, Invite and Cancel invite: stop only for what matters, named (Codex task 5)
- Accept and Decline on an application (and an ask to rejoin) stop once only when, since the page loaded, the tester's profile changed in a way that matters to THIS test (a device or language the test needs added or removed), named exactly as Invite names it ("fbbb no longer lists Chinese, which this test needs."), or their rating changed by 1 star or more ("fbbb's rating went from 4.6 to 3.5"). Any other profile save (bio, other devices, categories, a save with no change) no longer stops them, and the vague "changed their profile" line goes.
- Invite and Cancel invite stop the same way for those two reasons (Invite already does for the needs; the rating change is new; Cancel invite gets both).
- One line per tester (a newer change replaces their line), one time each.

## 3. The reserved Pay what you owe (Codex task 6)
- With a reservation in place the button is clearly off (grey, not the bright style) and reads "$10.00 is charged after the team approves" instead of "Pay what you owe ($10.00)".
