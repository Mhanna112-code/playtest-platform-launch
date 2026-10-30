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
src/app/app/switch/route.ts (the GET page always waits for the press; the POST stays the only thing that changes `side`, plus the
existing src/app/api/account/side/route.ts button); the Stripe returns src/app/api/payments/card-saved/route.ts and payout-return
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
