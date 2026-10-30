# Batch 32 (owner, Oct 29 night)

This file wins over the earlier batches and the design doc where they differ.

## 1. Money waiting for payout setup (owner, Oct 29)
- A tester can join and work before their payout setup is done (unchanged). Their share of a payment waits ("· delayed until your payout account is ready") and goes out on its own once the setup is done (batch 22 §3).
- New: as soon as a share waits, a bell line and the payment email: "$8.00 is waiting for you: finish your payout setup to receive it." (the total waiting), linking to Payments; again every 3 days until the setup is done. Not to deleted accounts.
- New: a grey line on the join page (under Your deadline) and the session page (above Your agreed scope) while the setup isn't done: "You can join and work now; payments wait until you finish your payout setup. Finish setup".

## 2. Apply twice (owner's finding, Oct 29)
- Apply or Ask to rejoin when that tester already has one waiting (sent in another tab) is refused, with nothing changed (the first note stays; the developer isn't told again): "You already applied to join this test in another tab." / "You already asked to rejoin this test in another tab." The page redraws to the waiting state ("You applied to join. You'll hear back…", Withdraw application) with that line.

## 3. Everything you sent counts every payment (owner's finding, Oct 29)
- The tester's Payments → Everything you sent shows a paid part's total, Pay more and extra pay included: "Paid $1,000.00 · you get $800.00" (it showed only the first payment).

## 4. "Answer at least one question" sits above the questions (owner, Oct 29)
- With no question answered (and none Required), Send shows "Answer at least one question before sending (any one; none is required)." under Send (owner, Oct 30: it was above the questions, out of view), with no box red (it used to sit under the first box, which read as if that one was required). It goes as soon as any answer has text.

## 5. The team's Account page (owner, Oct 29)
- An admin account's Account → Settings doesn't list Payments or Blocked people (a team account has neither; Payments sent an admin back to the console).

## 6. The team's navigation (owner, Oct 29)
- An admin account's top bar, styled like the app's own bar (white text with icons; no green text links): **Dashboard** (today's admin console), **Developers** (every developer account, with a search box), **Testers** (every tester account, with a search box), **Tests** (every test, searchable, with its state: today's "Find tests" for admins), and the usual account menu (password, sign out).
- "Back to the app" goes (an admin has no developer or tester side; it only bounced back to the console). The console's own "Accounts" list can stay lower on the Dashboard.

## 7. New terms block Charge, Let it go and Dispute too (owner, Oct 29)
- An open new-terms offer now blocks the tester's Charge, Let it go and Dispute as it already blocks Send and every call press (batch 27 §1): every press is refused with "Answer the new terms first: Switch or Keep." under the button and the page goes up to the Switch / Keep box; Switch or Keep unlocks them. Replaces batch 27 §1's "not blocked: Let it go (Charge) and Dispute keep their stop-once".
- It can only arise for a tester past their own deadline who is still working (Charge opens only after their deadline; they still get new terms until they rate, leave, or the test stops or closes). An offer whose work closed blocks nothing.

## 8. One moment, one line in a stop box (owner's finding, Oct 29)
- A stop box listed the same stop twice: the server's "This test was stopped at 3:22 PM." and the live update's "This test was stopped · 3:22 PM". A box now treats two lines that say the same thing in the same minute (one ending "at 3:22 PM.") as one, and keeps its own wording. Every press a stop or pause interrupts (Charge, Let it go, Pay, Pay more, Rate) is covered.

## 9. One change, one stop; every box names its press (owner's findings, Oct 29)
- Invite / Invite anyway: a stop now carries what each ticked tester misses NOW, and the Invite anyway box redraws to it, so after one stop the next Invite anyway goes through (one change used to stop twice: the box kept its old list, so "What's missing changed since you looked" followed).
- "Everyone you ticked now meets this test's needs. Press Invite to send." is information only (no "didn't go through"); another Invite anyway failure reads "Your Invite anyway didn't go through. …". The join page's stop box names Join / Apply / Ask to rejoin on every path (it said "Your press").

## 10. A refused press's line sits in the page (owner, Oct 29)
- When a refused press's button disappears in the redraw (Join call after a block, Pay after another tab paid, Charge after the developer paid, Withdraw on a closed request, Send after the test stopped…), its line ("Your Charge didn't go through: Yara Quint paid $10.00 for this meanwhile.") is a blue notice INSIDE the part or row the button was in, pushing what's below down (it used to float over the text). With none of those sections left, at the top of the screen.
- It stays until the next press anywhere on the page (it used to go after 10 seconds).
- Never twice: it stays hidden while the button is there or the page already says the same thing anywhere, in any style.

## 11. The admin console drops "Needs the team today" (owner, Oct 29)
- The list stays in the daily admin email.

## 12. Fixes from the Oct 30 screenshot run (owner, Oct 30)
- Another device's or tab's changes stop the next press until the top box was in view: lines that arrived while it was out of view (the pill up) used to count as seen at once, so device B's Send went straight through and replaced what device A had sent. Answer boxes nobody touched take what was sent elsewhere (typed text stays).
- "$X is waiting for you: finish your payout setup to receive it." goes out with the 5-minute sweep (it only went out with the daily job).
- Refusals name the press: Charge / Let it go ("Your Charge didn't go through: …"; "Answer the new terms first: Switch or Keep." reads exactly so), Leave, and the Invite anyway box ("Your Invite anyway didn't go through.", "Press Invite anyway again to go ahead.").
- The in-page refusal notice no longer blinks: one notice element, put back at once when a live redraw replaces its section.
