# Invites and applications: a reading guide

This guide follows the code for every press about invites and applications, in the order the code checks things. Read it side by side with the code: each
step names the function and the line where it starts (paths are from the project root, e.g. `src/lib/server/joining.ts:64`).

The people in the examples: **Nora Lane** is the developer, her test is **Harbor Run**. **Ana Silva** is a tester (she/her).

Words used below:

* **Refusal**: the press doesn't go through and a line shows under the button (blue). Nothing is saved.
* **Stop-once box** ("box"): the press stops once and shows what changed since the page loaded ("Nora Lane edited the listing · 3:05 PM … Press again to go
  ahead."). Pressing again goes ahead, unless something newer happened.
* **Red mistake**: something on the form itself is missing (a tick). Shown red at the field.
* **Silent**: the press was already done (in another tab, or by someone else); no line, the page just redraws.
* **Bell**: a line in the person's bell. Every bell line here is also an email, following the person's email settings, unless it says "always" (emailed whatever
  the setting).
* **The lock**: before the checks, some presses lock the test's row in the database (`SELECT … FOR UPDATE`). Two presses on the same test then run one after the
  other, never at the same time. See the last section.
* **Shared rule 4** (owner, Nov 27): refusals first, then the box, then red mistakes.

---

## 1. The shared refusals: `joinRefusal`

`src/lib/server/joining.ts:64`

Join, Apply to join, Ask to rejoin, the developer's Accept, the developer's Invite meeting an application, and the switch to "Anyone can join" all ask this
one function first. It returns ONE line, the first that applies, in this order:

| # | Check | Function, line | Bare line it returns |
|---|---|---|---|
| 1 | The test was stopped (a Stop, the team's Stop, a 7-day pause closure, the developer deleted their account) | `testNotTakingTesters`, joining.ts:92 | `This test was stopped.` |
| 2 | Open until passed | same, joining.ts:95 | `This test closed to new testers on Nov 20.` |
| 3 | Not open (the work window ended, so the test is "closed") | same, joining.ts:97 | `This test isn't taking new testers any more.` |
| 4 | Paused (the developer's hold or suspension, or the team's pause) | same, joining.ts:99 | `This test is paused right now.` |
| 5 | Already in the test | `earlierPartRefusal`, joining.ts:110 | `You've already joined this test.` |
| 6 | Rated it earlier | same, joining.ts:112 | `You rated this test, so you can't join it again.` (any other rating on that part: `You can't join this test again.`) |
| 7 | Nora ended her work, and she has no open invite (an Ask to rejoin skips this) | same, joining.ts:117 | `You can't join this test again.` |
| 8 | Every spot taken | `testFullRefusal`, joining.ts:123 | `This test is full.` With an open invite: `Harbor Run is full right now.` |
| 9 | The test uses access keys and none is free (skipped for the developer's own presses) | `hasNoFreeKey`, joining.ts:131 | `No access key is free right now, so this test can't take another tester until the developer adds one.` |
| 10 | A block. Ana blocked Nora / Nora blocked Ana | `blockRefusal`, joining.ts:141 | Ana's own block: `You blocked Nora Lane.` (for Nora's presses: neutral). Nora's block: `This test isn't taking new testers right now.` |
| 11 | Ana is in 10 tests already | joinRefusal, joining.ts:81 | `You can't join more tests right now.` |

Each press then words the line its own way:

* Join / Apply / Ask to rejoin use `joinPressRefusal` (`src/lib/refusal.ts`): stopped → `This test was stopped, so your Join didn't go through.`; Open until →
  `This test closed to new testers on Nov 20, so your Apply didn't go through.`; not open → `This test isn't taking new testers any more, so your Join didn't go
  through.`; paused and Nora's block → `This test isn't taking new testers right now, so your Join didn't go through.`; full → `This test is full, so your Join
  didn't go through.`; Ana's own block → `You blocked Nora Lane, so your Ask to rejoin didn't go through.` The others (already joined, rated, the key line, the
  10-test line, "Harbor Run is full right now.") stay as they are.
* Accept uses `acceptRefusalLine` (joining.ts:722): the same pattern with "Accept", plus `Ana Silva already joined this test.` and `Ana Silva can't join more
  tests right now.` Full stays plain: `This test is full.` (see "Differences to decide").

**Which one wins when several are true** (only the first is ever shown):

* Stopped AND past Open until → only "stopped".
* Paused AND full → only "paused" (4 before 8).
* Full AND no free key → only "full" (8 before 9). A test that is full and invite only, Join reads only "full" too (invite only is Join's own check, later).
* Full AND blocked → only "full". Blocked AND at 10 tests → only the block.
* Ana rated AND the test is full → only "rated" (6 before 8).

---

## 2. Tester presses on the join page (one pass under the lock)

Join, Apply to join and Ask to rejoin make ONE pass under the test's lock (owner, Nov 11, §377): the lock first, then every check in order, then the save.
Nothing is checked before the lock (except "are you a tester" and "does the test exist") and nothing again after it. So a Stop, a fill, an Edit, a Block or
another tab's press is either fully before the pass or fully after it. The plan of the pass is written above `j01` (joining.ts:363).

All three start in the route file `src/app/api/tests/[id]/[action]/route.ts` (the `run` switch: `case "join"` line 188, `case "apply"` line 192, `case
"rejoin-ask"` line 194). Before the press function runs, the route checks (in `POST`, line 59): the account is active (`requireActive`: a suspended
tester reads `Your account is paused, so your Join didn't go through.`), and for Join and Apply the confirmed email (`requireConfirmed`: `Confirm your email
first. We sent a link to ana@example.com.`).

### 2.1 Join

Starts at `join`, `src/lib/server/joining.ts:511`. The steps 2-6 are in `joinSteps`, joining.ts:454.

| Step | When | Exact words | Where |
|---|---|---|---|
| 0a | Ana's tester side is off | `Turn on “test apps, games and more” in your profile to join tests.` | `testerAndTest`, joining.ts:499 |
| 0b | The test was deleted (a draft) | `That test doesn't exist.` | same |
| — | The lock | | `onePass` (src/lib/server/tests.ts:1339) |
| 1a | Nora presses Join on her own test (from an old or hand-made request) | `You can't join your own test.` | joining.ts:518 |
| 1b | joinRefusal (section 1), in Join's words | see section 1 | `j01`, joining.ts:382 |
| 2a | Ana presses Join on an invite card and that invite was cancelled meanwhile (Nora's Cancel invite, a block since lifted, Open until passing and then moved later) | `This invite is no longer open.` | `closedInvite`, joining.ts:284 |
| 2b | Ana left (or was ended) earlier and has no open invite | `You left this test, so you ask to rejoin and the developer accepts.` | `leftWithoutInvite`, joining.ts:419 |
| 2c | Old invites only: an edit before Dec 10 replaced her invite and none was re-sent | `Nora Lane changed the listing at 3:05 PM, and this invite closed.` | `replacedInvite(…, "closed")`, joining.ts:302 |
| 2d | The test takes applications and Ana has no invite | `This test takes applications: press Apply to join.` | `applyOnlyRefusal`, joining.ts:426 |
| 3 | Ana's tester profile has no device or no language | `Save your tester profile first: pick the devices and languages you test on in Profile.` | `profileOrRefusal`, joining.ts:434 |
| 4a | Anything changed since the page loaded (an edit, the test filling, a spot opening, her own action in another tab …) | the stop-once box: each line with its time, then `Press again to go ahead.` | `listingGate` → `joinStopList`, joining.ts:234 / 244 |
| 4b | Old invites only: her invite was re-sent on a new listing; the first press | `Nora Lane changed the listing at 3:05 PM and sent you a new invite on it. Press Join to join on it.` | `replacedInvite(…, "fresh")`, joining.ts:302 |
| 4c | The test is invite only and Ana has no invite | `This test is invite only.` | joining.ts:479 |
| 5a | Her profile misses a device or language the test needs | `Your profile doesn't list a device this test needs (iPad).` + `Join anyway?` | `gapStop` (tests.ts) |
| 5b | The Terms of Use changed since she agreed (red) | `Tick to agree to the updated Terms of Use.` | `termsTick`, joining.ts:400 |
| 5c | The test has an NDA and the tick is off (red) | `Accept the NDA to join.` | `ndaRefusal`, joining.ts:441 |
| 6 | The join | — | `saveJoin` (tests.ts:1208) |

Inside the save (`saveJoin`) there is one more refusal, a backstop for two joins at the same moment on two tests: the 10-test count under a lock on Ana's own
row: `You can't join more tests right now.` After the commit, `noKeyLine` (joining.ts:390) turns a lost access key into joinRefusal's line (also a backstop:
step 1b already checked the key under the lock).

**What it writes.** The contract (new, or her old one restored with the time she had left), an access key, the "Ana Silva joined" line on Nora's page, her open
invite → "joined", any pending application or ask of hers → "joined". If she took the last spot: the "full" line (`closeOnFull`, section 5.9).

**Bells.** Nora: `Ana Silva joined “Harbor Run”` (lines: `Ana Silva joined your test “Harbor Run”.`, `Her deal: …`) — `afterJoin`, tests.ts:1256. If the test
filled: every invitee not told before reads `Harbor Run is full right now. Your invite stays open; we'll tell you when a spot opens.`

**Overlaps.**

* Stopped and the invite cancelled by the Stop → only "This test was stopped, so your Join didn't go through." (1b before 2a). For the same reason 2a's other
  wordings ("This test was stopped." / "“Harbor Run” closed to new testers on …") are **not reachable** from Join: the test's own state is checked first.
* Ana left, has no invite, and the test is full → only "full" (1b before 2b). Ended by Nora and no invite → "You can't join this test again." (1b, check 7),
  never 2b.
* Invite only AND the listing changed → the box first, then "This test is invite only." (owner's exception: invite only comes right after the box).
* Full AND invite only → only "full".
* The box AND the gap AND the NDA tick → the box first, then the gap box, then the red ticks.

### 2.2 Apply to join

Starts at `apply`, `src/lib/server/joining.ts:582`.

| Step | When | Exact words | Where |
|---|---|---|---|
| 0 | as Join's 0a / 0b | | `testerAndTest` |
| 1a | joinRefusal, in Apply's words | e.g. `This test is full, so your Apply didn't go through.` | joining.ts:586 |
| 1b | Ana holds an open invite. Her page had already shown it → refused; it came after the page loaded → she joins at once (Join's steps 2-6) | `Nora Lane invited you: press Join to join.` | `inviteMet` → `inviteBeforePress`, joining.ts:409 / 341 |
| 2a | She already applied in another tab | `You already applied to join this test in another tab.` | `alreadyWaiting`, joining.ts:322 |
| 2b | Apply-only test: her third application in 24 hours (applications and asks count together) | `You can apply or ask to rejoin this test twice in 24 hours. Try again later.` | `requestLimit`, joining.ts:531 |
| 3 | Profile not saved | `Save your tester profile first: …` | joining.ts:599 |
| 4a | The listing box | stop-once box | joining.ts:602 |
| 4b | The test became invite only | `This test is invite only.` | joining.ts:605 |
| — | The test now lets anyone join | she joins (Join's steps 2-6, past the box) | joining.ts:607 |
| 5a | Gap box | `Your profile doesn't list … ` + `Join anyway?` (Apply uses Join's words, as before) | joining.ts:609 |
| 5b | Terms tick | `Tick to agree to the updated Terms of Use.` | joining.ts:612 |
| 5c | NDA tick | `Accept the NDA to apply.` | joining.ts:615 |
| 6 | The application (note up to the limit, the listing as she saw it, the NDA time) and the "Ana Silva applied to join" line | | `storeJoinRequest`, joining.ts:544 |

**Bells.** Nora: `Ana Silva applied to join “Harbor Run”` (lines: `Ana Silva applied to join “Harbor Run”.`, `Her note: “…”`, `Accept or decline on the test
page.`), in "Applications · N" (one entry a day across tests). When she joined instead: as Join.

**Overlaps.** Full AND an invite her page showed → only "full" (1a before 1b). Already applied AND over the limit → "already applied" (2a before 2b). An apply
press on a test that switched to Anyone joins her (no application).

### 2.3 Ask to rejoin

Starts at `askToRejoin`, `src/lib/server/joining.ts:1005`. Its own refusals are in `askOwnRefusal`, joining.ts:971.

| Step | When | Exact words | Where |
|---|---|---|---|
| 0 | as Join | | |
| 1a | joinRefusal as a rejoin (check 7 is skipped), in Ask to rejoin's words | e.g. `You blocked Nora Lane, so your Ask to rejoin didn't go through.` | joining.ts:1010 |
| 1b | An open invite: shown → refused; new → she is back at once | `Nora Lane invited you: press Join to join.` | joining.ts:1013 |
| 2a | She was never in the test | `You haven't been in this test.` | joining.ts:972 |
| 2a | She is in it | `You've already joined this test.` — **not reachable**: joinRefusal check 5 says the same first | joining.ts:972 |
| 2b | Ana blocked Nora | `You blocked Nora Lane, so your Ask to rejoin didn't go through.` — **not reachable**: joinRefusal check 10 says the same first | joining.ts:978 |
| 2b | Nora blocked Ana | `This test isn't taking new testers right now, so your Ask to rejoin didn't go through.` — **not reachable** for the same reason | joining.ts:981 |
| 2c | Her part ended in a way that can't come back (a Stop, the test closing, or she left after her deadline passed) | `You can't ask to rejoin this test.` (Its other line, `You rated this test, so you can't join it again.`, is **not reachable**: joinRefusal check 6 says it first.) | joining.ts:982 |
| 2d | Already asked in another tab | `You already asked to rejoin this test in another tab.` | joining.ts:1021 |
| 2e | Third request in 24 hours | `You can apply or ask to rejoin this test twice in 24 hours. Try again later.` | joining.ts:1024 |
| 3 | Profile | `Save your tester profile first: …` | joining.ts:1027 |
| 4 | The listing box | stop-once box | joining.ts:1030 |
| 5a | Gap | `Your profile doesn't list … ` + `Ask to rejoin anyway?` | joining.ts:1033 |
| 5b | Terms tick | `Tick to agree to the updated Terms of Use.` | joining.ts:1036 |
| 5c | NDA tick | `Accept the NDA to ask to rejoin.` | joining.ts:1039 |
| 6 | The ask (kind "rejoin") and its "Ana Silva asks to rejoin" line; a suspension's "you were removed" card leaves her dashboard | | joining.ts:1042 |

Note the ask has no "invite only" or "takes applications" check: a tester who was in the test can always ask, whatever Who can join says.

**Bells.** Nora: `Ana Silva asks to rejoin “Harbor Run”` with `rejoinAskLine` (joining.ts:954): `Ana Silva asks to rejoin. If you accept, she gets back the
2 days she had left (deadline Dec 14, 11:59 PM).` (or `… She had no time left: her deadline stays passed.`), and her note. When an invite joined her:
`Ana Silva rejoined “Harbor Run”`.

### 2.4 Withdraw application

Starts at `withdrawApplication`, `src/lib/server/joining.ts:646` (route `case "withdraw-application"`, line 196). Not under the lock: only a still-pending
application is changed, so a race just finds nothing pending.

| Step | When | Exact words |
|---|---|---|
| 1 | She has a pending one and something changed since the page loaded | stop-once box (joining.ts:647) |
| 2 | The withdraw (joining.ts:650) | — |
| 3 | Nothing was pending: it was declined, withdrawn or closed (any reason) | silent (`applicationAlreadyOver`, joining.ts:674) |
| 3 | Nora accepted it (or she joined another way) | `Nora Lane accepted your application, so you're in this test.` (`withdrawGoneLine`, joining.ts:699) |
| 3 | There never was one | `There's no pending application to withdraw.` |

**Writes / bells.** The application → "withdrawn". Nora's live line `Ana Silva withdrew her application`, and her bell `Ana Silva withdrew her application to
“Harbor Run”` in "Applications withdrawn · N" (one entry a day across tests).

### 2.5 No thanks (decline an invite)

Starts at `POST`, `src/app/api/invites/[id]/route.ts:22` (its own route). Not under the lock.

| Step | When | Exact words | Line |
|---|---|---|---|
| 0 | Not her invite | `That invite doesn't exist.` | 28 |
| 1 | Old invites only: replaced by an edit before Dec 10, none re-sent | silent | 32 |
| 1 | Old invites only: re-sent; first press | stop-once box: `Nora Lane updated “Harbor Run”: your invite was sent again on the new listing` + `The new listing: …` | 35 |
| 2 | Already cancelled, declined, closed | silent | 56 |
| 2 | She already joined | `You already joined.` | 57 |
| 3 | Something changed since the page loaded (not the test filling or a spot opening) | stop-once box | 58 |
| 4 | Lost race: she joined a moment ago → `You already joined.`; cancelled a moment ago → silent | | 60 |

The `closed` helper's other two lines (`inviteClosedLine` for a cancelled invite, and `This invite is no longer open.`) are **not reachable**: step 2 and the
race at step 4 return silently for every status except "joined".

**Writes / bells.** The invite → "declined". Nora's live line and bell: `Ana Silva said no thanks to your invite` (a plain per-test line).

---

## 3. The developer's presses

All in `src/app/api/tests/[id]/[action]/route.ts`. Before the press function, the route refuses (in `POST`): a suspended developer
(`Your account is suspended, so your Invite didn't go through.`), a developer on a hold (`Your tests are paused until you pay what you owe, so your Invite
didn't go through.` — the cause words depend on the hold), the team's Stop (`This test was stopped, so your Accept didn't go through.`) and the team's pause
(`The team paused this test, so your Invite didn't go through.`).

### 3.1 Accept / Decline (an application or an ask to rejoin)

Starts at `decideApplication`, `src/lib/server/joining.ts:760` (route `case "application"`, line 198; the body's `action` says Accept or Decline). Not one pass:
the checks read the database, the box takes the lock, and the join (`joinTest`) claims the still-pending application under its own lock.

| Step | When | Exact words | Line |
|---|---|---|---|
| 0 | Not her test / no such application | `That application doesn't exist.` | 764 |
| 1 | Decline on one already withdrawn, closed or declined | silent | 771 |
| 2 | Accept: Nora blocked Ana | `You blocked Ana Silva, so your Accept didn't go through.` | 775 (`ownBlockStop`, blocks.ts:49) |
| 2 | Accept: Ana blocked Nora (still pending) | `Ana Silva's application was closed.` | 778 |
| 3 | No longer pending | closed: `Ana Silva's application closed when the test was stopped at 3:05 PM.` / `… when joining closed (Open until passed) on Nov 20, 2026.` / `… when the test became invite only at 3:05 PM.` / `… when you changed the listing in another tab at 3:05 PM.` / (old rows) `… when the test filled up at 3:05 PM.` / a block: `Ana Silva's application was closed.`; withdrawn: `Ana Silva withdrew her application.`; declined: `You already declined this application.`; accepted: `You already accepted this application.` | 781 (`answeredOrClosed`, 709; `appClosedForDev`, 685) |
| 4 | Accept: joinRefusal (as the developer: no key check; rejoin for an ask) | e.g. `This test was stopped, so your Accept didn't go through.`, `This test is full.`, `Ana Silva can't join more tests right now.` The paused line (`This test isn't taking new testers right now, so your Accept didn't go through.`) shows **only in a race**: the route refuses a held or suspended developer and a team-paused test first. The block lines likewise (step 2 says them first). | 784 |
| 5 | Box: Ana's rating changed since the row showed it, the listing changed, other changes | stop-once box | 790 |
| 6 | Decline: save (only if still pending) | lost race: silent, or step 3's line | `declineApplication`, 829 |
| 7 | Accept: joinRefusal again (something changed while the box showed) | as step 4 | 805 |
| 7 | Accept: the join (`joinTest`) | no free key: `No access key is free right now, so this test can't take another tester until the developer adds one.`; withdrawn a moment ago: step 3's line | 814 |

**Writes / bells.**

* Decline: the application → "declined". Ana: `Your application to “Harbor Run” wasn't accepted` (`Thanks for applying. There are other tests to find.`) or
  `Your ask to rejoin “Harbor Run” wasn't accepted` (`The developer didn't accept your ask to rejoin.`), in her "Joined" entry.
* Accept: the application → "accepted", the contract (as Join). Ana, always emailed (joining.ts:816): `You're in: Harbor Run` (`You're in:
  Harbor Run. Your contract: …`) or `You're back in Harbor Run: your deadline is Dec 14.` (with `Your session is restored on the current listing: …`). An ask's
  result line for Nora: `Ana Silva rejoined: her deadline is Dec 14, 11:59 PM.` No "joined" bell for Nora (she did it herself).

**Overlaps.** Nora blocked Ana AND the application closed → only "You blocked Ana Silva, so your Accept didn't go through." (2 before 3). Stopped AND full →
"stopped". The box AND full → "full" (refusals before the box, rule 4).

### 3.2 Invite

Starts at `inviteTesters`, `src/lib/server/invites.ts:319` (route `case "invite"`, line 155). One transaction under the lock for the checks and the invites;
joining a waiting applicant and the emails come after the commit.

| Step | When | Exact words | Where |
|---|---|---|---|
| 0 | No Invite perk (subscription ended) | the perk's line (`requirePerk`) | invites.ts:320 |
| 0 | Nothing ticked | `Tick at least one tester.` | invites.ts:325 |
| 1 | Stopped | `This test was stopped, so your Invite didn't go through.` | `wholePressRefusal`, invites.ts:408 → `inviteTestRefusal` (src/lib/rules.ts) |
| 1 | Open until passed | `Joining closed on Nov 20, 2026 (Open until), so nobody can be invited.` | same |
| 1 | Nora's hold | `This test is paused until you pay what you owe, so nobody can be invited.` / `… until the chargeback steps are done …` — **only in a race**: the route refuses a held developer first | same |
| 1 | Closed (work ended) | `This test isn't taking new testers, so nobody can be invited.` | same |
| 1 | Full | `Harbor Run is full. Add spots to invite more people.` | same |
| 2 | Every ticked tester rated this test | `Ana Silva rated this test, so she can't join it again.` | `ratersAmong`, invites.ts:423 |
| 2 | Some did | a line each in the done message: `Your Invite didn't go through for Ana Silva: Ana Silva rated this test, so she can't join it again.` | same |
| 3 | (worked out for step 6) what changed since the panel loaded | box lines: `The test's requirements changed: Devices: Windows PC → iPad`, a rating change, `Ana Silva joined this test, so she's no longer in your invite list`, `Ana Silva can't be invited right now`, `Ana Silva is no longer in your list`, `Ana Silva can't join more tests right now` | `changesSincePanel`, invites.ts:438 |
| 4 | Per ticked tester, in order (`whyNotInvited`, invites.ts:494): already in / already invited | silent (left out) | |
| 4 | her application or ask the page showed | `Ana Silva applied: answer her in Needs you.` | |
| 4 | Nora blocked her | `You blocked Ana Silva, so your Invite didn't go through.` (Invite anyway: `… your Invite anyway …`) | |
| 4 | account closed / suspended or she blocked Nora / 10 tests | `Ana Silva's account was closed, so she can't be invited.` / `Ana Silva can't be invited right now.` / `Ana Silva can't join more tests right now.` (`inviteTesterRefusal`, rules.ts) | |
| 4 | 2 invites to her on this test in 24 hours | `Ana Silva: you've invited her to this test 2 times today. You can invite her again tomorrow.` | |
| 5 | Over 100 invites in 24 hours across Nora's tests | `You can send up to 100 invites a day. You have 3 left today.` / `You've sent 100 invites today. You can invite more tomorrow.` | `dailyInviteLimit`, invites.ts:522 |
| 6 | Box | stop-once box (a ticked tester's new application is not a box line: it joins her below) | invites.ts:374 |
| 7 | Someone ticked misses a need, not Invite anyway | the Invite anyway box: `Ana Silva doesn't list a device this test needs (iPad)` | invites.ts:377 |
| 8 | The invites and Nora's line `You invited Ana Silva and Ben Cole` | | invites.ts:380 |
| 9 | After the commit: a ticked tester with a pending application or ask joins at once, as Accept (`matchInviteAndAsk`, joining.ts:1094) | done message: `Ana Silva had applied: she joined.` / `Ben Cole had asked to rejoin: he's back in.`; refused: the joinRefusal line, e.g. `This test is full.`; no key: `Ana Silva: no access key is free right now, …` | `joinWaitingApplicants`, invites.ts:533 |
| 10 | Bells | each invited tester (not those who joined): `Nora Lane invited you to “Harbor Run”` (`Nora Lane invited you to test “Harbor Run”.`, `What you get: …`, `Open it and press Join to join on these terms.`) | invites.ts:387 |
| 11 | Done message | `Invited Ana Silva and Ben Cole.` + the lines above; nothing at all: `Everyone you ticked was already invited or joined.` | invites.ts:397 |

**Overlaps.** Stopped AND full → only "stopped". All ticked rated AND over the daily limit → "rated" (2 before 5). Nora blocked Ana AND Ana is at 10 tests →
"You blocked Ana Silva…" (Nora's block is checked before `inviteTesterRefusal`). Over the daily limit AND a box → the limit (refusals before the box). An
invite never holds a spot: any number can be open; the first to join takes the spot.

### 3.3 Cancel invite

Starts at `cancelInvite`, `src/lib/server/invites.ts:570` (route `case "cancel-invite"`, line 181).

| Step | When | Exact words | Line |
|---|---|---|---|
| 0 | No such invite on this test | `That invite doesn't exist.` | 574 |
| 1 | Ana said No thanks, or it was cancelled/closed | silent | 575 |
| 2 | Ana joined | `She already joined.` | 595 |
| 2 | Old invites only: re-sent by an edit | `This invite is no longer valid: it was re-sent on the new listing.` | 595 |
| 3 | Box: Ana's rating changed, another tab's invite action on her, other changes | stop-once box | 596 |
| 4 | Lost race: joined a moment ago → `She already joined.`; declined a moment ago → silent | | 599 |

**Writes / bells.** The invite → "cancelled". Ana: `Your invite to “Harbor Run” was closed.` (`tellInvitesClosed`, invites.ts:655, in "Applications and
invites"; never why). Cancel invite is never limited.

---

## 4. Block, account deletion, suspension

### 4.1 Block (either side)

Starts at `blockUser`, `src/lib/server/blocks.ts:68` (route `src/app/api/blocks/route.ts`). Never a stop-once box.

Refusals: `Choose someone to block.`, `That person doesn't exist.`, a deleted account (`ACCOUNT_WAS_DELETED`); already blocked → silent.

ONE transaction (blocks.ts:89): the lock of every test either person develops (in test-id order), then both people's rows (`lockBothPeople`, blocks.ts:127),
the re-check (blocked in another tab → silent), the Block row, then:

* their working sessions together end ("blocked"), keys released (`endSessionsBetween`, blocks.ts:135);
* calls ahead between them cancelled (`cancelCallsAheadOf`, blocks.ts:145);
* every open invite between them cancelled (both directions: Nora's tests for Ana, and Ana's tests for Nora if Ana is also a developer);
* every pending application and ask between them closed with reason "blocked" (`closeApplicationsBetween`, blocks.ts:160).

**Bells** (after the commit): the side that didn't block reads `Your session on Harbor Run ended.` (tester) or `Ana Silva's session on Harbor Run ended.`
(developer), with the calls it cancelled; each closed invite: `Your invite to “Harbor Run” was closed.`; each closed application: `“Harbor Run”: your
application was closed.` (`tellApplicationsClosedByBlock`, blocks.ts:197). The developer is told nothing about applications. A spot opened (section 5.10).
Never the word "blocked" for the other person.

### 4.2 Account deletion

`deleteAccount`, `src/lib/server/restrictions.ts:293` (route `src/app/api/account/delete/route.ts`, or the admin's `delete-account`).

* The deleted person's own open invites (as a tester): cancelled, no line to anyone.
* A developer: each of her tests is stopped like the team's Stop (5.2): invites cancelled, applications and asks closed ("stopped"), and each person told:
  `Your invite to “Harbor Run” was closed.` / `“Harbor Run” was stopped, so your application was closed.` (`… so your ask to rejoin was closed.`).
* A tester: `removeTester` (restrictions.ts:82): she leaves every test, then her pending applications and asks are **withdrawn** silently (Nora's Needs you row
  just goes).

### 4.3 A tester's suspension

`suspendAccount` → `removeTester` (restrictions.ts:82): she leaves every test; her pending applications and asks are withdrawn (no line); **her open invites stay
open** (she can't press Join while suspended: the route says `Your account is paused, so your Join didn't go through.`; the daily invite reminders wait).

### 4.4 A developer's hold or suspension, the team's pause

Nothing closes. Invites and applications wait (owner, Oct 28; Dec 10 2026 for invites). Join, Apply, Ask to rejoin and Accept read the paused line
(joinRefusal check 4). Only the 7-day pause closure (5.3) closes them.

---

## 5. Automatic closures

### 5.1 Stop (the developer's)

`stopTest`, `src/lib/server/tests.ts:918` (route `case "stop"`, line 136). Under the lock: already stopped → silent; the box; the reason (red); then working
sessions end, calls/offers/requests close, pending applications and asks → closed "stopped", open invites → cancelled, the test → stopped.
**Bells**: `Your invite to “Harbor Run” was closed.`; `“Harbor Run” was stopped, so your application was closed.` (`tellAppsClosed`, blocks.ts:221); working
testers `“Harbor Run” was stopped` (always). Nora's done line: `You stopped the test; 3 open invites were closed.`

### 5.2 Team Stop

`adminStopTest`, `src/lib/server/restrictions.ts:540`. Same closings as Stop (invites cancelled, applications closed "stopped"), same tester lines. Nora's bell:
`The team stopped “Harbor Run”; … 3 open invites were closed`.

### 5.3 The 7-day pause closure

`closePausedTest`, `src/lib/server/pauseClosure.ts:27` (the daily job `closePausedTests`, or the team's Close now). Under the lock: stopped meanwhile →
nothing; otherwise like a Stop: invites cancelled, applications closed "stopped", the test stopped with `pauseClosedAt`. **Bells**: `Your invite to “Harbor
Run” was closed.`; `“Harbor Run” closed, so your application was closed.`; working testers `“Harbor Run” ended`; Nora: `“Harbor Run” was closed. <reason> … 3
open invites were closed.`

### 5.4 Open until passing

`closeJoiningAfterOpenUntil`, `src/lib/server/tests.ts:1805`, run by the daily job (`runDaily`, holds.ts). Not on a paused test (it waits: Open until moves on
by the pause when it lifts). Pending applications → closed "joining_closed"; open invites → cancelled. **Bell** to each: `“Harbor Run” closed to new testers on
Nov 20.` (one line for applicants and invitees alike). Working testers carry on.

### 5.5 The test closing on its own (work window ended)

`closeWorkIfDueIn`, `src/lib/server/workWindow.ts:52` (from `finishWorkIfDue`, the live beat, the daily job, or a tester's Send in its own pass). Not on a
paused, stopped or already closed test. Sessions end ("closed"), invites cancelled, applications closed "stopped", the test → "closed". **Bells**
(`afterWorkClosed`, workWindow.ts:83): working testers `“Harbor Run” ended`; `Your invite to “Harbor Run” was closed.`; `“Harbor Run” closed, so your application
was closed.`

### 5.6 An edit (the Save)

`editTest`, `src/lib/server/tests.ts:381`; the part about invites and applications runs after the Save's transaction, from tests.ts:631, in this order:

1. New terms offered to working testers (`offerNewTerms`).
2. Pending applications close (`closeApplicationsAfterEdit`, joining.ts:932) when the Save switched to invite only (reason "invite_only": `“Harbor Run” is now
   invite only, so your application was closed.`) or changed a closing field (`CLOSING_FIELDS`: NDA, prices, parts, questions, devices, languages,
   description, build link; reason "listing": `“Harbor Run”'s listing changed, so your application was closed. You can apply again on the current listing.`).
   Never on the NDA-only edit of a paused, stopped or closed test. Switching to invite only wins over a closing field.
3. Spots changed: the test now full → the "full" line (5.9); otherwise a spot may have opened (5.10).
4. A key added to a test full for want of one → a spot opened (5.10, `keyAdded`).
5. Switched to Anyone can join → `onSwitchToAnyone` (5.7).
6. The Save's Contract changes entry gets `2 applications closed`.
7. The working testers' bells (questions, NDA, edited).
8. Keys given.

**Open invites are never touched by an edit** (owner, Dec 10 2026: nothing is re-sent). The invitee's join page shows the edit in its live box and Join stops
once for it.

### 5.7 Switching who can join to "Anyone can join"

`onSwitchToAnyone`, `src/lib/server/joining.ts:866`. Each pending application, oldest first:

1. The test is full → stop; the rest keep waiting (untold).
2. The listing changed since she applied (anything but Who can join and spots) → the application is marked changed and Ana is told `“Harbor Run” changed since
   you applied: join on the current listing, or withdraw your application.` (`markApplicationChanged`, joining.ts:912).
3. Her profile misses a need → skipped (keeps waiting, untold).
4. joinRefusal (no key check) → skipped (keeps waiting, untold).
5. The join, as Nora's acceptance → Ana: `You're in: Harbor Run` (always). No free key → she and everyone after her wait; Nora's Save note and live line:
   `No access key is free, so these applications stay waiting: Ana Silva, Ben Cole. Add keys in Edit to let them join.`

Nora's live line: `2 waiting applications were accepted when you switched to joins instantly`.

Switching to invite only: see 5.6 step 2. Switching to "Apply": nothing closes.

### 5.8 Access keys

A test that uses keys with none free (but a spot open) reads as full for want of a key: joinRefusal check 9 (`No access key is free right now, …`), Find
leaves it out, nothing closes. The developer's presses skip check 9 and meet it at the join: Accept → the key line; Invite meeting an application → `Ana Silva:
no access key is free right now, …` (her invite stays sent, her application waits); the switch to Anyone → the "stay waiting" line. Adding a key → a spot
opened (5.10).

### 5.9 The test filling

`closeOnFull`, `src/lib/server/tests.ts:182`, inside the transaction that took the last spot (a join, or an edit lowering spots). Nothing closes (owner, Dec
10 2026: applications and invites stay open). Nora's line: `Harbor Run is full. 2 invites stay open until a spot opens`. Each invitee never told before:
`Harbor Run is full right now. Your invite stays open; we'll tell you when a spot opens.` (`tellFull`, tests.ts:206). Applicants are told nothing.

### 5.10 A spot opening

`spotOpened`, `src/lib/server/tests.ts:215` (after a leave, an end, a block, a suspension, more spots, a key added). Only when the latest of "full" / "spot
open" was "full" (or a key was added), a spot really is open, and a key is free. Nora's line and each invitee never told before: `A spot opened on Harbor Run:
you can accept Nora Lane's invite now.` Applicants are told nothing.

---

## 6. Differences to decide

Things that behave differently in similar cases. None of these were changed.

1. **A tester's own suspension withdraws her applications but keeps her invites** (restrictions.ts `removeTester`). Reinstated, she still has her invites but
   must apply again. Her account deletion cancels her invites too (but silently).
2. **Applications are "withdrawn" by a suspension or deletion, but "closed" by everything else.** Nora's Accept on them then reads `Ana Silva withdrew her
   application.` although Ana didn't.
3. **Accept on a full test reads `This test is full.`** (no press pattern), while Join, Apply and Ask to rejoin read `This test is full, so your Join didn't go
   through.` Accept uses `asPressRefusal`, the tester presses `joinPressRefusal`.
4. **The switch to "Anyone can join" tells some waiting applicants and not others**: a changed listing → told; a profile gap, a refusal or the test filling
   during the switch → silently left pending.
5. **Applicants hear nothing when the test fills or a spot opens; invitees hear both.**
6. **Open until passing has its own line for both applicants and invitees** (`“Harbor Run” closed to new testers on Nov 20.`), while every other closure tells
   invitees `Your invite to “Harbor Run” was closed.` and applicants `“Harbor Run” was stopped / closed, so your application was closed.`.
7. **A Block tells the tester `“Harbor Run”: your application was closed.`** (no cause), a Stop says `was stopped`, an edit says why. (On purpose: a block is
   never revealed. Listed for completeness.)
8. **Applicants vs invitees after an edit**: a closing-field edit closes applications but leaves invites open.
9. **The Ask to rejoin has no invite-only / apply-only check**, unlike Join and Apply.
10. **Invite's "paused" check covers only the developer's hold**: a team pause and a developer suspension are refused earlier, at the route, with different
    words (`The team paused this test, so your Invite didn't go through.` / `Your account is suspended, …`).
11. **Withdraw, No thanks, Cancel invite and Accept/Decline are not one pass under the lock** (Join, Apply, Ask to rejoin and Invite are). They rely on "only a
    still-pending / still-open row is changed", which is safe, but a pause or block landing between Accept's checks and its join is refused by `joinTest` with
    its own words (see Bugs noticed, 1).

---

## 7. How to step through one press yourself

1. **Find the button's route.** Most presses on a test page post to `/api/tests/<id>/<action>`: open `src/app/api/tests/[id]/[action]/route.ts` and find
   `case "<action>"` in `run` (e.g. `case "join"`, `case "invite"`, `case "application"`). The action name is the last part of the address the page posts to
   (search the page's component for `/api/tests/${…}/`). No thanks has its own route `src/app/api/invites/[id]/route.ts`; Block is
   `src/app/api/blocks/route.ts`; account deletion is `src/app/api/account/delete/route.ts`; the team's buttons are in `src/app/api/admin/[action]/route.ts`.
   The daily closures run from `runDaily` in `src/lib/server/holds.ts`.
2. **Read the route's own checks first.** `POST` in the route runs, in order: the account (`requireActive`: suspended, held), the body, the confirmed email
   (Join, Apply), the silent "already done", the team's Stop / pause, then `run`.
3. **Open the press function** the `case` calls (e.g. `join` in joining.ts). Each press function starts with a header comment listing its steps in order; the
   code below has the same numbers in its `// 1.`, `// 2a.` comments. Read them top to bottom: the first check that returns `{ stop: … }` (inside a pass) or
   `throw`s ends the press with that line.
4. **The one-pass lock.** `onePass` (`src/lib/server/tests.ts:1339`) opens a transaction, locks the test row (`lockTest`, tests.ts:158: `SELECT … FOR UPDATE`),
   runs the steps, and commits. Every read inside uses `tx`, so it sees the database as it is under the lock. A step that stops returns `{ stop: error }`
   instead of throwing (throwing would undo the transaction); `stopOf` (tests.ts:1353) turns a check that throws into such a value. After the commit, `onePass`
   throws the stop (the page shows it) or returns what was saved. Any other press that takes the same lock (a Stop, an Edit's Save, a Block, another Join)
   waits until this one commits, so it sees everything this press did, or this press sees everything it did.
5. **Look at what happens after the commit.** Bells and emails are sent after the transaction (`afterJoin`, `tellInvitesClosed`, `tellAppsClosed`,
   `tellFull`, the `notify` calls at the end of each press), so a refused press never sends one.
6. **Test it.** `tests/join-one-pass-377.test.ts`, `tests/invites-apps-dec10.test.ts`, `tests/refusal-order-11.test.ts` and `tests/refusal-matrix.test.ts` press
   these buttons through the real functions; run one with `npx vitest run tests/<file>`.

---

## 8. Bugs noticed (not fixed)

1. **Accept refused with "Join" in the line (race only).** `decideApplication` checks joinRefusal outside the lock, then `joinTest` re-checks under its lock. A
   pause landing in between is refused by `joinTest` with `This test isn't taking new testers right now, so your Join didn't go through.` — the press was
   Accept. (src/lib/server/tests.ts, `joinTest`, the `testPaused` line.)
2. **Dead wordings in No thanks** (`src/app/api/invites/[id]/route.ts`, the `closed` helper): only its "joined" branch can run (see 2.5).
3. **Dead wordings in Join's closed invite** (`closedInvite` → `inviteClosedLine`): "This test was stopped." and "“…” closed to new testers on …" can't show
   from Join (see 2.1).
4. **Ask to rejoin's own "already joined" and block refusals duplicate joinRefusal** and can't show (see 2.3).
