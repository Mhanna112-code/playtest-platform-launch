# Codex tasks (paste one prompt per Codex task)

Each prompt assumes Codex has read `AGENTS.md` (it does so automatically). Give each task its own number N (codex1, codex2, …):
it names the worktree's test schema and build folder so tasks never collide.

## Task 1: closed (Oct 29)

The "Not sent yet" label beside Request a time was correct: a call request refused before Keep was still unsent.

## Task 2: accept waiting applications when a test switches to "joins instantly" (ONLY if the owner says yes)

```
Read AGENTS.md first and follow it. Task number: 2 (schema codex2, build folder .next-codex2, branch codex/auto-accept,
worktree C:/Users/march/Projects/pl-codex-2).

Owner decision: when a developer changes a test from reviewing applications to "anyone who matches joins instantly", every
application still waiting that matches the test's needs is accepted at that moment, as if the tester had joined instantly (the
same spot limits: never past the test's tester cap, oldest application first; the rest stay waiting with their current line).
Each accepted tester gets the usual "joined" bell line and email; the developer's live box gets one line ("3 waiting applications
were accepted when you switched to joins instantly"). Applications that don't match the needs stay waiting.

Find the Edit save route and the existing join / accept code (search src/ for the instant-join setting and the accept route) and
reuse them; a race with the tester withdrawing must leave the application withdrawn. Tests: switch with 3 matching + 1 not
matching; cap reached part-way; a withdraw racing the switch. npm run check green. Commit on the branch; don't push or merge.
```

## Template for later batches

```
Read AGENTS.md first and follow it. Task number: <N> (schema codex<N>, build folder .next-codex<N>, branch codex/<name>,
worktree C:/Users/march/Projects/pl-codex-<N>).

Build docs/BATCH-<NN>.md §<a>, §<b> exactly as written (that file wins over the design doc where they differ). Only those
sections: other agents are building the rest at the same time, so don't refactor shared code beyond what your sections need.
Tests for every rule in your sections; npm run check green. Commit on the branch; don't push or merge.
```

Split a batch between Codex and Claude by area so two tasks never edit the same files (for example: payments, the join page,
admin, notifications). Claude merges every branch, runs the full check once, and pushes.

## Task 3: files placed at the cursor in written answers (the paperclip)

```
Read AGENTS.md first and follow it. Task number: 3 (schema codex3, build folder .next-codex3, branch codex/paperclip,
worktree C:/Users/march/Projects/pl-codex-3, made from the latest master).

Build docs/BATCH-27.md §3 ("Files placed at the cursor in written answers") exactly as written, with these owner decisions on top:
- Design: "marker plus live preview". The answer box stays a plain text box. 📎 and ⏺ go in each answer's toolbar (next to B, I, </>)
  and insert a short marker at the cursor, e.g. [📎 map.png] (one marker format for files and recordings, holding the upload's id).
  While uploading, the marker reads [Uploading map.png… 40%]. Under each answer box, a live preview renders the answer in order with
  the attachments in place (image thumbnails that open full size, a small player for videos, a chip with name and size for other
  files), each with × to remove it (removes the marker; the upload is deleted only if no other answer uses it). No rich-text editor.
- Limits (batch 31 §2 replaces the batch 27 numbers): every file up to 500 MB; at most 5 files and 5 recordings across the whole
  written part. Keep the existing upload route, storage (R2) and limit checks: search src/ for WrittenAttachments.tsx and the
  upload API it calls, and reuse them.
- Markers don't count toward the 50,000-character limit or the 50-character minimum per answer (batch 30 §14).
- Every place that shows written answers renders the markers as attachments in place: the developer's piece view and By question,
  previous question sets, admin "See the work", the emails. Search src/ for where written answers are rendered and route them all
  through one renderer. Old answers (attachments only in the box under the answers) still show exactly as today.
- Excerpts quote text only; an excerpt that crosses a marker shows "[file]".

Tests (vitest, tests/codex3-paperclip.test.ts) for the list at the end of §3. npm run check green with the schema and build
folder above. Commit on the branch; don't push or merge. In your final message, list every file and screen you changed.
```

## Task 4: the team's navigation (admin top bar)

```
Read AGENTS.md first and follow it. Task number: 4 (schema codex4, build folder .next-codex4, branch codex/admin-nav,
worktree C:/Users/march/Projects/pl-codex-4, made from the latest master).

Build docs/BATCH-32.md §6 exactly as written. Where things are: the app's top bar is in src/app/app/layout.tsx; the admin
console is src/app/admin/page.tsx (its header row has the green "Back to the app" and "Find tests" links; its "Accounts" list is
<PagedList kind="users">, backed by src/lib/server/adminLists.ts); admins are sent away from developer/tester pages by
adminAway() in src/lib/server/page-auth.ts. Developers and Testers can be new admin pages (e.g. /admin/developers,
/admin/testers) reusing the same PagedList / adminLists search with a filter for the side; Tests reuses what /app/find shows an
admin. Only admins reach these pages (same check as /admin). Phones: the bar wraps or collapses like the app's.

Don't touch the written-answers screens (another task is changing them). Tests (tests/codex4-admin-nav.test.ts): the admin
sees the four links and no "Back to the app"; the Developers and Testers lists return only that side and search by name/email;
a non-admin gets the usual refusal on the new pages. npm run check green. Commit on the branch; don't push or merge.
```

## Task 5: Accept / Decline, Invite and Cancel invite stop only for what matters

```
Read AGENTS.md first and follow it. Task number: 5 (schema codex5, build folder .next-codex5, branch codex/needs-stops,
worktree C:/Users/march/Projects/pl-codex-5, made from the latest master).

Build docs/BATCH-34.md §2 exactly as written. Where things are: Accept / Decline is decideApplication in
src/lib/server/joining.ts (today it pushes "<name> changed their profile" for ANY profile save); Invite's needs lines are
testerNeedsChangedLines / requirementsChangedLine in src/lib/server/invites.ts (reuse them, don't write new wording); Cancel invite
is cancelInvite in the same file; the developer's panels are src/app/app/tests/[id]/InvitePanel.tsx and the Needs you applications
rows. The pages must send what they showed (each tester's devices, languages and rating) with the press, the way Invite sends
seenTesters. Ratings: find how a tester's rating is computed and shown on these rows and compare to what the row showed.
Don't touch the admin pages or the written-answers screens (other tasks). Tests (tests/codex5-needs-stops.test.ts): a needed
language removed stops Accept once with Invite's line; a bio-only save doesn't stop; a rating change of 1 star stops, 0.5 doesn't;
Cancel invite gets both; one line per tester. npm run check green. Commit on the branch; don't push or merge.
```

## Task 6: the reserved Pay what you owe

```
Read AGENTS.md first and follow it. Task number: 6 (schema codex6, build folder .next-codex6, branch codex/reserved-button,
worktree C:/Users/march/Projects/pl-codex-6, made from the latest master).

Build docs/BATCH-34.md §3. The box is src/components/OwedBox.tsx (reservedOnce disables the button today but it keeps the bright
style). Keep its style as it is (owner: no grey) and relabel it "<amount> is charged after the team approves" while a
reservation is in place. Also drop the " $X added since will be charged right after." sentence from the developer's reserved line
(reservedAddedLine in src/lib/rules.ts, used by OwedBox): it reads only "Reserved $27.00: it's taken when the team approves lifting your
hold." Keep the admin's adminReservedLine as it is. Test (tests/codex6-reserved.test.ts): the label, still disabled, and no "added since" sentence on the developer's line. npm run check green. Commit on
the branch; don't push or merge.
```

## Task 7: the design doc for batches 32–34

```
Read AGENTS.md first and follow it. Task number: 7 (branch codex/design-doc-32, worktree C:/Users/march/Projects/pl-codex-7, made
from the latest master). Docs only: edit docs/DESIGN-DOC.md alone, no code, no tests to run.

Update the design doc for docs/BATCH-32.md (§1–§16) and BATCH-33.md (§1–§7): replace the rules that changed in place, add new
sections only where nothing fits, plain English, "they" for people. Confirm against the code (git log, the files each section
names); where the spec and the code differ, describe the code and list the differences in your final message. Commit on the
branch; don't push or merge.
```

## Task 8: the two sides as two separate accounts

```
Read AGENTS.md first and follow it. Task number: 8 (schema codex8, build folder .next-codex8, branch codex/separate-sides,
worktree C:/Users/march/Projects/pl-codex-8, made from the latest master).

Build docs/BATCH-34.md §5 exactly as written. Where things are: sides in src/lib/sides.ts (sideFor, sideForPath, sideLink, hasBoth)
and src/app/app/layout.tsx (the line that saves a page's side as the side used last: remove it; render the "This page is on your
<side> side." notice with the switch button instead of the page when the path's side isn't the current one); /app/switch in
src/app/app/switch/route.ts (remove the green in-between page: the GET redirects to `next` without switching; sideLink in
src/lib/sides.ts links straight to the page; the POST and src/app/api/account/side/route.ts stay the only things that change `side`); the Stripe returns src/app/api/payments/card-saved/route.ts and payout-return
(remove the side updates added in batch 32 §17); notifications: bell()/notify() in src/lib/server/notify.ts, the Notification model
in prisma/schema.prisma (add a nullable `side` column: "developer" | "tester" | null = the account's; hand-written migration, checked
with prisma migrate diff as AGENTS.md says), the bell count (unreadEntryCount), the Notifications page and the bell list, and the
email digest. Decide each line's side from what it's about (the caller knows: pass it explicitly where the link doesn't say; the
link's path decides otherwise: sideForPath; payments links by kind). Backfill existing rows the same way in the migration.
Don't touch the admin pages, the written-answers screens, or src/lib/server/joining.ts / invites.ts (other tasks).
Tests (tests/codex8-separate-sides.test.ts): an account with both sides: a developer page opened on the tester side shows the
notice and doesn't change `side`; only the switch POST changes it; the bell count and list per side; an email with both headings;
Payments/Account/Notifications per side (the delete warning and the settings help); update older tests that expected the old
automatic switching. npm run check green. Commit on the branch; don't push or merge.
```

## Task 9: a card before posting; expiry warnings; "Get started"

```
Read AGENTS.md first and follow it. Task number: 9 (schema codex9, build folder .next-codex9, branch codex/card-to-post,
worktree C:/Users/march/Projects/pl-codex-9, made from the latest master).

Build docs/BATCH-34.md §6 exactly as written. Where things are: posting is the "post" / "post-draft" test actions (search
src/lib/server/tests.ts and src/app/api/tests for the Post route) and the form src/app/app/tests/TestForm.tsx; cards are saved in
saveCardFromCheckout (src/lib/server/stripe.ts; add the expiry month/year columns to User with a hand-written migration checked by
prisma migrate diff, and read them from the PaymentMethod's card); the daily job is runDaily in src/lib/server/holds.ts; a Stripe "resource_missing" error on a charge (chargeError in stripe.ts) becomes the same card_failed path as a decline (see
batch 32 §15's NO_CARD_SAVED); no daily card check and no new hold kind; bell()/notify()
in src/lib/server/notify.ts (payment: true lines); the dashboard is src/app/app/page.tsx; payout setup state is payoutsReady /
stripeAccountId. With the fake Stripe (tests) a card counts as saved when stripePaymentMethodId is set; give it an expiry in tests.
Don't touch the admin pages, the written-answers screens, joining.ts / invites.ts, the bell/notifications side split (other tasks).
Tests (tests/codex9-card-to-post.test.ts): a resource_missing charge starts the usual payment hold with that charge owed; Post refused without a card (draft save allowed), posted with one; the expiry lines at
30 days, 7 days and the day (once each); Get started steps per side, ✓ and gone when done; update older tests that post without a
card (give their developer a card in the shared fixtures instead). npm run check green. Commit on the branch; don't push or merge.
```

## Task 10: the developer's test page Listing panel: done by Claude (Oct 30)

Built on master (batch 34 §14, with the owner's refinement: the panel replaces the Contract changes fold and only the fields the most recent save changed carry "Updated"). Don't give this prompt to Codex.

```
Read AGENTS.md first and follow it. Task number: 10 (schema codex10, build folder .next-codex10, branch codex/test-listing,
worktree C:/Users/march/Projects/pl-codex-10, made from the latest master; `npm ci` in it, never link node_modules).

Build docs/BATCH-34.md §14 exactly as written. Where things are: the developer's test page is src/app/app/tests/[id]/page.tsx (its
top overview panel is the first card); the tester's listing view with "Updated" tags is in src/app/app/sessions/[id]/page.tsx
("Your agreed scope") and src/components/ListingInfo.tsx (UpdatedTag) — reuse them; the listing-save lines and their "See it" are
listingSaveLines in src/lib/server/live.ts and the seeIt prop of src/components/ChangesBox.tsx / LiveTop (ListingSeeIt). Don't touch
the admin pages, the written-answers screens, or the bell/notifications. The join page part: src/app/app/find/[id]/page.tsx (listing section, id "listing") and JoinBox.tsx (the needs pop-up: its ChangesBox gets seeIt="#listing", See it closes the pop-up first, and press names Join / Apply / Ask to rejoin).
Tests (tests/codex10-test-listing.test.ts): the pop-up's listing line has See it and names the press; the panel
shows every field and an Updated tag after a save; a listing line in the top box and in a stop box carries See it to the panel.
npm run check green. Commit on the branch; don't push or merge.
```

## Task 11: a change you've answered never stops a later press (owner, Oct 31)

```
Read AGENTS.md first and follow it. Task number: 11 (schema codex11, build folder .next-codex11, branch codex/answered-seen,
worktree C:/Users/march/Projects/pl-codex-11, branched from master).

Owner's rule: once a person has ANSWERED a change, that change never shows again in any blue stop notice ("Your … didn't go
through. Since you opened this page: …") for any later press, on that page or in their other tabs and devices, on all three
sides (developer, tester, admin). Changes they haven't answered still stop once exactly as today.

What exists: docs/BATCH-35.md §79 added `answersIt` and the `Answers` type in src/lib/server/live.ts: the answering press itself
passes `answers`, so its own gate drops that line (devGate / devChanges in live.ts and tests.ts, testerGate in
src/lib/server/testerGate.ts, the join gate in joining.ts). §51 records a person's own actions in ActionLog with a per-page-load
id (x-load). What's missing: a LATER, different press still stops for a change already answered. Example: the tester Accepts the
developer's call request without the top box in view, then presses Request a call → it stops for "Nora Lane asked for a call…".

Build: when a gate collects change lines, drop every line whose item the pressing person already answered after that change
happened. Answering presses: Accept / Decline of a call request; Accept / Decline of an application or rejoin ask; Pay, Pay more
or Confirm with your bank on a piece (answers that piece's "sent" / "updated" lines); Switch / Keep (the terms offer); Join from an
invite (that invite's line); the developer adding their side to a dispute and the admin's Decide (that dispute's lines). Reuse
ActionLog (check what it records and whether it has the item id; add the id if missing) and the existing answersIt matching rather
than a new table. Apply it in every gate: developer (live.ts, tests.ts), tester (testerGate.ts), Join (joining.ts), Rate
(ratings.ts testerRateGate / devRateGate) and the admin's stops (src/lib/server/adminRace.ts).

Tests in tests/batch35-answered-seen.test.ts (fixtures like tests/batch35-answering-press.test.ts and
tests/batch35-decide-tick.test.ts): tester Accepts the developer's call request, then Request a call goes straight through;
developer Pays a just-sent piece, then another press doesn't stop for that piece's "sent" line but still stops for an unrelated
new change; the same from another tab (a different x-load); admin Decide isn't stopped by the dispute's own lines; an unanswered
change still stops once.

Docs: append "## §86 A change you've answered never stops a later press (owner, Oct 31)" to docs/BATCH-35.md in the style of
§79, and remove the docs/PENDING.md bullet that starts "**Answering a change counts as seen". npm run check green (known flaky,
rerun alone: batch22 "two admins at once", batch17-rate §12, codex9 resource_missing, batch34-invite-beats-application,
batch16-account-tabs). Commit on the branch; don't push or merge.
```

## Task 12: the tester's Rate stops for every blue notice (owner, Oct 31)

```
Read AGENTS.md first and follow it. Task number: 12 (schema codex12, build folder .next-codex12, branch codex/rate-all-stops,
worktree C:/Users/march/Projects/pl-codex-12, branched from master).

Owner decision: on the TESTER side, Rate stops once for everything any other tester press stops for (the same blue notices,
the same Alerts rules, the same "your own action in another tab always stops", the same batch 35 §90 rule that an update the
page has already shown never stops). Today Rate has its own short list (src/lib/server/ratings.ts testerRateGate: the
developer's Pay / Pay more / Reject on their work, a dispute decided, the test stopping / closing / their work ending, and on a
running test call changes). Why it matters: on a running test Rate ends the tester's part (calls ahead and requests close, nothing
more can be sent), so a new terms offer or a listing change they haven't seen must stop it once, like Send or Switch / Keep.

Build: make testerRateGate apply the shared tester gate (src/lib/server/testerGate.ts testerGate) in addition to, or instead of,
its own lines, without showing two stop boxes one after the other for one press (one box listing everything; the second press
goes ahead per the existing boxAt rule). Check the Rate press on the session page sends what testerGate needs (seenAt / boxAt /
loadedAt / x-load, like the other tester presses in src/lib/client.ts); add what's missing. Keep the developer's Rate (devRateGate)
exactly as it is. After a test has closed, keep Rate's current refusals ("Rating closed on <date>").

Tests in tests/batch35-rate-all-stops.test.ts (fixtures like tests/batch35-answering-press.test.ts): a new terms offer stops the
tester's Rate once and the second press rates; a listing edit stops it once (Alerts on) and not with Alerts off; the tester's own
Send in another tab stops it once even with Alerts off; the developer's Pay on their work still stops it; an update already
shown (seenAt after it) doesn't stop; only ONE stop box for a press that has both kinds of lines.

Docs: append "## §93 The tester's Rate stops for every blue notice (owner, Oct 31)" to docs/BATCH-35.md. npm run check green
(known flaky, rerun alone: batch22 "two admins at once", batch17-rate §12, codex9 resource_missing,
batch34-invite-beats-application, batch16-account-tabs, batch12 "a part already open to charging", batch34 outage Approve after
Dismiss). Commit on the branch; don't push or merge.
```

## Task 13: a refusal line flashes on and off after Charge in a closed window (owner, Oct 31)

```
Read AGENTS.md first and follow it. Task number: 13 (schema codex13, build folder .next-codex13, branch codex/refusal-flash,
worktree C:/Users/march/Projects/pl-codex-13, branched from master).

Bug (owner, local site, Oct 31): a tester's session page was left open while their written answers' Charge window closed
(the piece's close-out passed). Pressing Charge then showed the refusal "Your Charge didn't go through: charge and Let it go
closed on Oct 31, 2026." as a bulleted line that FLASHES ON AND OFF CONSTANTLY (several times a second), with an empty second
bullet under it.

Likely area (verify, don't assume): two things show a refused press's reason and hide when the other shows it:
- the line under the button: src/components/Err.tsx (hidden on a new page version via useGoneOnNewVersion, batch 35 §60) inside
  src/app/app/sessions/[id]/ChoiceBox.tsx (rendered only while !chargeShut on the session page,
  src/app/app/sessions/[id]/page.tsx);
- the kept refusal: src/components/KeptRefusal.tsx + src/lib/keptRefusal.ts (checks every 200 ms; hidden while the button is
  still on the page or `shownElsewhere` finds the same words; placed in the nearest section with an id, or fixed at the top).
Something toggles every check (e.g. the kept line counts its own copy or the Err line as "shown elsewhere" and hides, then
shows again; or the empty-bullet list is the FormMistakes / mistakes list rendering an empty item). Reproduce in a test
(jsdom or a Playwright-style check if the repo has one; otherwise unit-test the decision functions) and fix the root cause so the
reason shows ONCE, steadily, in one place, and never an empty bullet. Keep the existing rules: shown under the button while it's
there; after a redraw that removed the button, in its nearest section (or at the top), until the next press; dropped on another
page (batch 35 §85).

Also check the same flow for Let it go and for the developer's Pay after the Pay window closed.
Tests in tests/batch35-refusal-flash.test.ts. Append "## §95 A refusal line never flashes (owner, Oct 31)" to docs/BATCH-35.md.
npm run check green (known flaky, rerun alone: batch22 "two admins at once", batch17-rate §12, codex9 resource_missing,
batch34-invite-beats-application, batch16-account-tabs, batch12 "a part already open to charging", batch34 outage Approve after
Dismiss). Commit on the branch; don't push or merge.
```

## Task 14: payment tags on the tester's parts instead of blue notices (owner, Oct 31)

```
Read AGENTS.md first and follow it. Task number: 14 (schema codex14, build folder .next-codex14, branch codex/payment-tags,
worktree C:/Users/march/Projects/pl-codex-14, branched from master).

Owner decision: on the tester's session page ("Your parts": written answers, screen recording, each live call), each part shows a
small TAG saying where its payment stands, as it used to (check git history of src/app/app/sessions/[id]/page.tsx and
docs/BATCH-*.md for the earlier payment badges/tags, e.g. search "badge" near "Paid" / "delayed"): for example "Paid", "Payment
delayed" (a payment waiting for the developer's bank, owed during a hold, or deferred), "Waiting for review", "Not paid (closed on
<date>)", "Rejected". Use the same rules the page already uses for these states (delayedSubs / owedRows / disputeOwed /
chargedOwed / payShut in that page; batch 35 §82 and §88 for what counts as paid vs delayed). Keep the tags in the existing badge
style.

Then REMOVE the blue info notices about payment state inside the parts (e.g. "Payment may be delayed.", "Payment for this part may
be delayed.", chargedDelayedLine "Charged $X. Payment may be delayed until the test resumes.", DELAYED_CALL_LINE): the tag replaces
them. KEEP blue notices only for refusals of the tester's own Charge / Let it go presses, and make those behave like every other
blue refusal: gone after a reload or after going to another page/tab (batch 35 §60 useGoneOnNewVersion and §85 kept refusals).
Don't change the developer's pages.

Tests in tests/batch35-payment-tags.test.ts: a paid part shows "Paid" and no blue delay notice; a part whose dispute raise waits
for the bank shows "Payment delayed" (no blue notice); a closed-unpaid part shows "Not paid (closed on …)"; a refused Charge shows
its blue line, which is gone after a page reload. Append "## §97 Payment tags on the tester's parts (owner, Oct 31)" to
docs/BATCH-35.md (§95 is Codex task 13's). npm run check green (known flaky, rerun alone: batch22 "two admins at once",
batch17-rate §12, codex9 resource_missing, batch34-invite-beats-application, batch16-account-tabs, batch12 "a part already open
to charging", batch34 outage Approve after Dismiss, batch4 "Open until heads-ups wait while the test is paused"). Commit on the
branch; don't push or merge.
```

## Task 15: a catalog of every blue notice and refusal (owner, Oct 31)

```
Read AGENTS.md first and follow it. Task number: 15 (branch codex/notice-catalog, worktree C:/Users/march/Projects/pl-codex-15,
branched from master). Documentation only: change no app code.

Write docs/BLUE-NOTICES.md: EVERY blue notice a person can see, found from the code (not from memory), each with its exact
wording (placeholders like <dev>, <test>, $X, <date>), who sees it, what triggers it, which presses it stops, whether Alerts can
turn it off, and where it shows. Sections:
1. Stop-once lines ("Your <press> didn't go through. Since you opened this page: …"), developer side: every change kind from
   src/lib/server/live.ts (devChanges, ownChanges, testerPaymentChanges…), src/lib/server/tests.ts (devGate), invites.ts extra
   lines, src/lib/alerts.ts (alertOf: which Alerts type, or "always").
2. Stop-once lines, tester side: src/lib/server/testerGate.ts (testerChanges, KINDS, ALERTS_OFF_KINDS), joining.ts (join gate),
   ratings.ts (testerRateGate / devRateGate).
3. Admin stops: src/lib/server/adminRace.ts and the admin gates.
4. Final refusals (blue lines under a button, the kept refusal of src/components/KeptRefusal.tsx, and the tester page's jump to
   its top banner): every HttpError message thrown by a route a press calls (src/app/api/**, src/lib/server/**) that is shown as
   a refusal, grouped by press (Pay, Pay more, Confirm with your bank, Charge, Let it go, Dispute, Decide, Rate, Send, Join, Apply,
   Accept / Decline, Invite, Cancel invite, call requests, Leave, Stop, End early, Next round, Edit save, admin actions…).
5. Other blue (info) notices on pages: the live top box's "Updated …" lines, banners (paused / stopped / hold / chargeback /
   suspended), "Payment may be delayed", bank confirm lines, the closing-soon lines, the dashboard strips.
For each also say how it goes away (next press, reload, another page, the 20-second redraw, Dismiss).
Finish with "Things that look odd" if you find two lines saying the same thing, a line that can't happen any more, or wording
that contradicts another. Commit on the branch; don't push or merge.
```

## Task 16: a "Find testers" page for developers (owner, Nov 1)

```
Read AGENTS.md first and follow it. Task number: 16 (schema codex16, build folder .next-codex16, branch codex/find-testers,
worktree C:/Users/march/Projects/pl-codex-16, branched from master).

Owner request: developers can find testers without opening a test first. Today the only way is a test's "Invite testers" panel
(src/app/app/tests/[id]/InvitePanel.tsx with src/lib/server/invites.ts rankedTesters / testerRowInfo / whyNotInvitable).

Build /app/testers (developer side; tester side gets the usual other-side notice like /app/find's otherSideNotice; admins may use
it too). Nav link "Find testers" next to "Post a test" in src/app/app/layout.tsx (developer side, hidden while restricted like
Post a test). The page: the same search box, device / language chips and "People you've worked with" / "Suggested" sections as
the Invite panel, reusing its ranking and row data (no new ranking), each row showing name, rating, devices / languages, tests
with you, and opening the tester's profile (/app/testers/[id]). Blocked and deleted accounts never listed (as in rankedTesters).
Each row has "Invite to…": a small menu of the developer's open tests that can still invite (inviteTestRefusal / inviteBlocked
in rules.ts); choosing one sends the invite through the SAME server path as the Invite panel (sendInvites in invites.ts, with its
stops and refusals: needs gaps -> "Invite anyway", rated this test -> refused, already in / invited -> greyed per test). No open
test that can invite: the menu says why ("Post a test to invite testers" / "Your tests aren't taking testers right now").
Plain scroll box for the list (ScrollList), phones fine. Restricted developer: the page shows the restricted line, no invites.

Tests in tests/batch35-find-testers.test.ts: the list matches the Invite panel's ranking for a test-less view; blocked accounts
absent; Invite to… a test sends one invite and the same refusals apply (rated this test; needs gap asks Invite anyway); tester
side gets the other-side notice. Append "## §104 Find testers for developers (owner, Nov 1)" to docs/BATCH-35.md. npm run check
green (known flaky, rerun alone: batch22 "two admins at once", batch17-rate §12, codex9 resource_missing,
batch34-invite-beats-application, batch16-account-tabs, batch12 "a part already open to charging", batch34 outage Approve after
Dismiss, batch4 "Open until heads-ups wait while the test is paused"). Commit on the branch; don't push or merge.
```

## Task 17: Message anyone from their profile (owner, Nov 1)

```
Read AGENTS.md first and follow it. Task number: 17 (schema codex17, build folder .next-codex17, branch codex/profile-messages,
worktree C:/Users/march/Projects/pl-codex-17, branched from master).

Owner request: a "Message" button on every profile (developer profile /app/developers/[id] and tester profile /app/testers/[id])
so anyone can message anyone, not only people who share a test. Today chats exist only per test and tester
(src/lib/server/messages.ts: chatAccess, openTesterChat, sendChat; the Messages page src/app/app/messages).

Build: a direct conversation between two accounts that isn't tied to a test (new model + local migration under prisma/migrations;
never run migrations against a hosted DB). It shows in the Messages page next to the test chats (its own row: the other person's
name, "Direct message"), with the same message UI, unread counts, bell line and email rules as test chats, the same drafts
(useKept) and the same length limits. "Message" on a profile opens it (creating it on the first message, not on the press).
Rules to keep:
- Blocks either way: no button, and an old page's send is refused with the existing neutral line ("Unable to chat with this
  developer." / "… tester.").
- A suspended side, a deleted account, the sender's own restriction: same as test chats (refused with the existing lines;
  check chatRestriction / the restricted rules in src/lib/restricted.ts).
- No messaging yourself; admins keep their existing tools (no Message button needed on the admin views).
- Abuse guard: a simple per-sender limit on NEW conversations started per day (for example 20) with a plain refusal line; the
  Report button on profiles stays as it is.
- Testers never see "hold", "suspended", "failed" or "chargeback" about a developer in these lines.

Tests in tests/batch35-profile-messages.test.ts: a developer messages a tester they never worked with (both see it in Messages,
unread count and bell); blocked either way refused and no button; suspended side refused; the daily new-conversation limit
refuses the 21st; a test chat between the same two people stays separate. Append "## §105 Message anyone from their profile
(owner, Nov 1)" to docs/BATCH-35.md. npm run check green (known flaky, rerun alone: batch22 "two admins at once",
batch17-rate §12, codex9 resource_missing, batch34-invite-beats-application, batch16-account-tabs, batch12 "a part already open
to charging", batch34 outage Approve after Dismiss, batch4 "Open until heads-ups wait while the test is paused"). Commit on the
branch; don't push or merge.
```
