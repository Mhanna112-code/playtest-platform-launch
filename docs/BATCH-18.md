# Batch 18: Terms, call cap, small decisions (owner, Oct 28 evening)

This file wins over the earlier batches and the design doc where they differ. Build it after batch 17.

## 1. Re-accepting updated Terms of Use
- Store which Terms version each account accepted (at sign-up today). The current version is a constant bumped when the Terms change.
- When an account's accepted version is older, the first press of **Post a test / post a draft** (developer) or **Join, Apply, Accept an invite, Ask to rejoin** (tester) shows a box under the button: "We updated our Terms of Use. Read what changed." (link to the Terms, opening at a short "What changed" note at the top) with a tick "I agree to the updated Terms". The press goes through once ticked (one press: tick, then press again). The server refuses an unticked press with the same line.
- Nothing else is blocked: work in progress, paying, charging, disputes, chat and everything on running tests carry on under the terms they started with.
- Tests: an old version on each of those presses; ticked goes through; other presses unaffected.

## 2. The Terms' content rule matches the Mature line
The Terms of Use open the content rule with "No graphic content: …", contradicting Post/Edit's Mature line. Reword that part to: "Never allowed: sexual content involving minors, illegal content, real-world gore. Other graphic or mature content must be marked Mature (18+), with a reason." Bump the Terms version (§1). The Terms stay marked DRAFT for the lawyer's review.

## 3. A call ends when its pay would pass the $1,000 for that tester's calls
The 150% cap on the measured length stays. Add: while a call is on, the app works out when its pay at the call's rate (the contract rate for a listed call, $200/h for an unlisted one) would reach what's left of the $1,000 for that tester's calls on this test, and the call ends then for both sides.
- The call page shows a line from 10 minutes before: "This call ends at 3:42 PM: the $1,000 for calls with Ana on this test is reached." At that time the page says "Call ended: the $1,000 for calls with Ana on this test is reached.", measuring stops, and Join is refused for that call ("This call is over.").
- The video room is outside the app (Jitsi or the developer's own link), so people could keep talking there; those minutes never count. Say so on the ended line: "Minutes after this don't count."
- The measured length used for pay is capped at that point (as well as 150% of the booked length).
- Tests: a call reaching the cap mid-way, the warning line, Join refused after, an unlisted call at $200/h.

## 4. Avatar row: "+8 more joined · 30 open"
The developer's Testers avatar row shows the overflow as "+N more joined · M open" (joined testers beyond the shown avatars, and spots still open) instead of "+N more".

## 5. Confirmed as built (no change; tests exist)
- The bell line when a tester asks to show an excerpt: one line per request, stacked in that test's day.

## 6. Booking calls: the length is capped by what's left of the $1,000 (owner, Oct 28)
In Request a time (both sides) and Accept, the Length box's maximum is the smaller of 180 minutes and the minutes left of the $1,000 for that tester's calls on this test at the call's rate (contract rate for a listed call, $200/h unlisted), rounded down to whole minutes. The hint shows it: "10–95 min (the $1,000 for calls with Ana)". A longer length is red at the box ("At most 95 minutes: the $1,000 for calls with Ana on this test.") and refused on the server, for each tester ticked (the smallest applies, named). No "Max call time per tester" field (dropped by the owner).

## 7. Excerpts: no "Don't name the product" tick; NDA tests stay hidden (owner, Oct 28)
- Remove the "Don't name the product" tick from the excerpt request: an excerpt always reads "From <test>" (no "a <category> test" wording any more). Excerpts already shown or pending with the product hidden keep their "a <category> test" wording (the tester chose that; changing it would name the product without asking).
- Unchanged: excerpts from a test that has an NDA now are hidden from profiles ("Hidden while <test> has an NDA" in the tester's list) and come back if the NDA is removed.
- **Change:** a request still pending when the test gets an NDA can still be Allowed: it's accepted straight into hidden ("Allowed · hidden while <test> has an NDA"), and shows if the NDA is later removed. (Today Allow is refused.) New requests from a test with an NDA stay impossible.

## 8. Old answers stay payable; say so when switching (owner, Oct 28)
- In the tester's Switch / Keep box, when the questions changed, add: "Switching means answering the new questions: send your updated answers. Answers you already sent stay payable at $<their price>."
- Unchanged and confirmed: answers sent for earlier questions keep "Sent for the questions until <date>" in the developer's Needs you and are paid at the price they were sent at (any amount, with a reason when under it).

## 9. A call in progress keeps counting until the people on it leave (owner, Oct 28)
When a pause (any cause), a block, a suspension of either side, a leave, End early or a Stop happens while a call is in progress (both, or one, already on the call page), the call is **not cancelled and not cut**: the people already on it keep being measured, as today, until they leave the call page (the usual 5-minute gap rule) or it hits 150% of the booked length or the $1,000 (§3). Its minutes are payable as usual (listed: Pay / Charge on its usual dates; unlisted: Pay).
- **No new joins:** Join and any re-Join after leaving are refused with the existing lines ("This test is paused.", "This call isn't available.", …); someone who left can't come back into the measured call. A reload of the call page within the 5-minute gap still counts as staying (as today).
- The test page and the other side's pages show the call as "In progress: it ends when you both leave" (developer) / "In progress" (tester), then "Call ended at <time>" with its measured length. Calls ahead are cancelled as today.
- This keeps today's behaviour (in-progress calls are already left alone by blocks; check pauses, suspensions, leaves, End early and Stop do the same and don't cancel a call already started).

## 10. Calls use only the app's Jitsi room (owner, Oct 28)
Remove the developer's own call link option (slot.link: Zoom, Meet or any outside link) everywhere: the field on call times, `roomUrl`'s use of it, its wording and tests. Every call uses its Jitsi room (`https://meet.jit.si/playtest-<callId>`). Existing call times with a link keep working until they pass but no new link can be entered. On the call page, a short line under Join: "The call opens in Jitsi in a new tab. Keep this page open: it measures the call."

## 11. (Dropped by the owner: no Minutes box. The call's Pay box stays Rate + Amount from the measured length, with the Note as today.)

## 12. Calls: get the Jitsi sign-in out of the way early (owner, Oct 28)
meet.jit.si asks the first person in a room to sign in (Google, GitHub or Facebook) as the host; the other waits on "Waiting for the host" until then.
- **Reminder before each call** (new): bell and email (following the email setting) 15 minutes before a booked call, to both: "Your call with <name> on “<test>” starts at <time>." The developer's version adds: "Open it a few minutes early: Jitsi asks the first person to sign in with Google, GitHub or Facebook." Stacks in that test's day; no reminder for a call booked less than 15 minutes ahead.
- **Call page lines:** developer, under Join (from the 10 minutes before): "Join a few minutes early: Jitsi asks the host to sign in with Google, GitHub or Facebook." Tester: "If Jitsi says it's waiting for the host, <dev> is on the way: keep this page open."
- Join still opens 10 minutes before the start (unchanged); measuring only counts the booked time window as today.
- Add the new bell line to the design doc's bell table later (not in this batch).

## 13. "Check your call setup": a private Jitsi practice room (owner, Oct 28)
- From the moment a call is booked, both people get a "Check your call setup" link (call page, the call's row in Live session / Call history, and the 15-minute reminder): it opens a private practice room in a new tab, `https://meet.jit.si/playtest-check-<random id per account>` (unguessable, the same for that account), where they can sign in to Jitsi as host and test camera and microphone. A short line next to it: "Sign in to Jitsi and test your camera and microphone ahead of time. Jitsi usually remembers you in this browser."
- It never counts as a call, is never measured, and is unrelated to the booked room. **Join for the real call still opens only 10 minutes before the start** (unchanged).
- Also on the developer's and tester's dashboards' Calls box, once per upcoming call.
- No change to the call Pay box: the "× N min" next to Rate already shows the measured length; nothing is added twice.

## Check and report
- Tests for each item. Run `NEXT_DIST_DIR=.next-build npm run check`; it must be green.
- §1 needs a migration (the accepted Terms version per account): hand-write it, check it with `prisma migrate diff … --shadow-database-url …playtest_lite_shadow --exit-code`, apply it only to the local playtest_lite DB, and say the 3400 server needs a restart.
- Don't touch port 3400. Don't edit docs/DESIGN-DOC.md.
- Commit on master and never push. End the commit message with:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Report what changed and any interpretations.
