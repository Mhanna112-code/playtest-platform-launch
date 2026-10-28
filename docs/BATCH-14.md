# Batch 14: the 3-change limit, wider (owner, Oct 29)

This file wins over the earlier batches and the design doc where they differ. Build it after batch 13.

## 1. Two more limited fields
Each of these has its own 3 changes (batch 6's per-field counts, stored in `criticalCounts`; no migration, just new keys):
- what to do (steps)
- NDA
- questions
- languages
- devices
- **build link** (new)
- **parts and prices** (new): one counter for the part ticks, prices, Required ticks, Free ticks, the live rate and call length. One Save that changes any of them uses one change.

Unchanged: Changes left shows next to each field's label, a field at 0 locks on its own, and admin "Allow 3 more" gives 3 more to every field at 0.

## 2. When the count starts
The count starts as soon as **anyone is affected**: the first tester joins, the first application arrives, or the first invite is sent, whichever comes first. This replaces "after the first tester joins".
- Before that, edits are free and nobody is told.
- Owner OK'd (Oct 29). Background, from my reading of the owner's "remove the after-a-tester-joins rule, because applicants and invited testers are told too". The other option, counting from posting, would make a typo fixed right after posting use up a change.
- Store when the count started, so a test whose only applicant withdrew keeps counting.

## 3. Applicants and invited testers are told, stacked
This exists today: a Save changing `CLOSING_FIELDS` closes pending applications and re-sends open invites. Add `buildUrl` to `CLOSING_FIELDS`. Then make their bell lines stack across tests by kind, one entry per kind per day:
- **"Listing changed, application closed":** "<test>'s listing changed, so your application was closed. You can apply again on the current listing." Several tests in a day become one entry: "3 tests you applied to changed: your applications were closed", which opens to list them.
- **"Invite re-sent":** "<dev> updated <test>: your invite was sent again on the new listing." This stacks the same way.
- Add both kinds to the stacking list in rules.ts (batch 4 E2).

## 4. Quieter Switch/Keep for the developer (owner asked; DEFAULT)
With 7 limited fields, each with 3 changes, and many testers, a line per choice gets noisy.
- **Keep:** the developer is told nothing. The tester row still says "On their terms from <date>".
- **Switch:** one quiet line in the live top box ("Ana switched to the new terms" + "See their contract", as now). It is NOT a stop-once kind any more: a press never stops for it, because work already sent keeps its price, so no pending Pay changes. Several switches in a day stack into one line: "3 testers switched to the new terms".
- Remove "terms" from the developer's stop-once kinds and from the under-button notice (batch 5 §1's link stays in the live box). Remove the "switched or kept terms" line from the Alerts menu.
- No bell lines for either, as today.

## 5. Written answers: 50,000 characters (owner, Oct 29)
Raise batch 11 §7's limit from 10,000 to **50,000 characters per written part** (all its answers together), with the counter "N / 50,000". Batch 10's per-piece scroll box already keeps long answers tidy on the developer's side.

## 6. Access keys: no "Assign a free key"; a live Free keys box instead (owner, Oct 29; final)
- **Remove "Assign a free key" completely:** the button, the `assign-key` route, `assignFreeKey`, its stop-once logging and its refusals. Remove any automatic replacement of a reported key as well (check accessKeys.ts around line 101; nothing should replace a key on its own).
- **Replace the yellow "keys not working" box** on the developer test page with a **read-only Free keys notice** in the same place, with no buttons, shown only when the test uses keys:
  - Title "Access keys". Two compact parts, both read-only:
    - **"Free (not given to anyone yet)"**: the free keys as small chips that wrap, with the count and the open spots: "4 free · 2 open spots: each new tester gets one."
    - **"Given"**: each assigned key with its tester ("KEY-1111 · Ana Silva"), compact rows. A key reported as not working shows crossed out.
    - Each part sits in its own scroll box about 4 lines tall, so 50 keys never push the page down. Names are cut with "…" and shown in full on hover.
    - On phones the two parts stack.
  - One line: "If a tester's key doesn't work, delete a free key in Edit and send it to them in a message." "in Edit" opens Edit's access keys section (`/app/tests/<id>/edit#keys`) in a new tab.
  - It updates live (the page's existing poll): when keys are added or deleted in Edit (any tab), and when a joining tester is given one automatically.
- **A tester's report "This key doesn't work" stays** (session page). The key shows crossed out in that tester's row and in Edit's "In use" box (as today), and the developer's live box gets one quiet line, "Ana reported their key doesn't work". That line is not a stop-once kind, and there's no bell.
- Keys reported as not working, or given to a tester who left, still can't be added again.
- Automatic assignment at join is unchanged: a new tester gets the oldest free key, and free keys must cover the open spots, as Edit already checks.

## Check and report
- Tests for every item. Run `NEXT_DIST_DIR=.next-build npm run check`. A stale Prisma client from batch 13's migration is the only acceptable failure.
- Don't touch port 3400. Don't edit docs/DESIGN-DOC.md.
- Commit on master and never push. End the commit message with:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Report what changed and any interpretations.
