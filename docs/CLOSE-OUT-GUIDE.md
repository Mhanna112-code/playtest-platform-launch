# The close-out and every deadline

A code-reading guide to how Playtest works out each date after a test ends: the test close, the close-out, each piece's one closing date (Pay / Pay more / Charge / Let it go / Dispute), Charge opening, the automatic call charge, and both Rate windows.

Written against branch `b6-guides` at `948cfd27` (Dec 10 2026). Every statement below comes from the code at that commit. Links go to the file and line, like [`src/lib/server/closeOut.ts:145`](../src/lib/server/closeOut.ts#L145). Anything that looks wrong is listed in [Things that look off](#things-that-look-off) at the end. Nothing has been fixed.

The people in the examples:

- **Nora** is the developer. Her test is "Harbor Run".
- **Ana** is a tester on it.

The companion guide [SPANS-GUIDE.md](SPANS-GUIDE.md) covers spans (the stretches of time that pause a deadline) in more depth, plus an audit of every place that reads the team's pause.

---

## Contents

0. [Words used in this guide](#0-words-used-in-this-guide)
1. [The test close](#1-the-test-close)
2. [Windows that pause: `windowEnd` and `mergeSpans`](#2-windows-that-pause-windowend-and-mergespans)
3. [Tonight's removals: `testSpans` and `closeOutOf`](#3-tonights-removals-testspans-and-closeoutof)
4. [The review date and Charge opening](#4-the-review-date-and-charge-opening)
5. [How pauses and outages move the stored dates](#5-how-pauses-and-outages-move-the-stored-dates)
6. [Each piece's one closing date: `pieceCloseOut`](#6-each-pieces-one-closing-date-piececloseout)
7. [Calls: the automatic charge](#7-calls-the-automatic-charge)
8. [Ana's Rate window and Rate box](#8-anas-rate-window-and-rate-box)
9. [Nora's Rate window and the reveal](#9-noras-rate-window-and-the-reveal)
10. [The Dispute window](#10-the-dispute-window)
11. [Reminders that count to these dates](#11-reminders-that-count-to-these-dates)
12. [One worked timeline](#12-one-worked-timeline)
13. [Things that look off](#things-that-look-off)

---

## 0. Words used in this guide

| Word | Meaning in the code |
|---|---|
| **Test close** | The moment the test's work is over. Worked out by `closeOutBase` ([`src/lib/rules.ts:2064`](../src/lib/rules.ts#L2064)). It is the later of the last tester deadline and Open until, or the Stop. |
| **Close-out** | The test close plus 14 days (`CLOSE_OUT_DAYS = 14`, [`src/lib/rules.ts:2043`](../src/lib/rules.ts#L2043)). There is **no single test-wide close-out date any more**. Each date (each piece, Ana's Rate, Nora's Rate) counts its own 14 days from the test close and is moved by its own spans. |
| **Span** | A stretch of time `{ start, end, open }` during which a window stops counting. `open: true` means "still going on now". Type at [`src/lib/server/closeOut.ts:14`](../src/lib/server/closeOut.ts#L14). |
| **Window** | "N days from a start date, paused during some spans". Computed by `windowEnd` ([`src/lib/server/closeOut.ts:30`](../src/lib/server/closeOut.ts#L30)). |
| **Review date** | When Charge opens for a piece Nora hasn't paid: the later of 7 days after sending (`payBy`) and Ana's own deadline. `reviewDateOf` ([`src/lib/rules.ts:1601`](../src/lib/rules.ts#L1601)). |
| **Piece** | One part Ana sent (written answers or a recording, a `Submission` row) or one listed or unlisted call that took place (a `Call` row). |
| **Frozen** | Money can't move right now: Nora's hold, Nora's developer-side suspension, or the team's pause still in force. `moneyFrozen` ([`src/lib/restricted.ts:95`](../src/lib/restricted.ts#L95)). |

Nothing in this guide is stored as "the close-out date". Every closing date is **computed when a page or a job asks for it**. Only these are stored and moved in place: the testers' deadlines (`Contract.dueAt`), Open until (`Test.openUntil`), each piece's review clock (`payBy`), each piece's stamped deadline (`stintDueAt`) and `choiceBy`.

---

## 1. The test close

### 1.1 `workDeadlineOf`: when the work window ends while the test is running

[`src/lib/rules.ts:2059`](../src/lib/rules.ts#L2059)

```ts
export function workDeadlineOf(t, contracts) {
  if (t.status === "draft") return null;
  const times = [...contracts.map((c) => c.dueAt.getTime()), ...(t.openUntil ? [t.openUntil.getTime()] : [])];
  return times.length ? new Date(Math.max(...times)) : null;
}
```

Line by line:

1. A draft has no work window, so it returns `null`.
2. It collects every contract's deadline (`dueAt`), working or not, plus Open until when there is one.
3. It returns the latest of them.

Example: Open until is Dec 3, 11:59 PM. Ana's deadline is Dec 10, 11:59 PM. Ben (another tester) has Dec 6, 11:59 PM. The work window ends **Dec 10, 11:59 PM**.

### 1.2 The test closing on its own: `closeWorkIfDueIn`

[`src/lib/server/workWindow.ts:52`](../src/lib/server/workWindow.ts#L52)

This is what turns an open test into a closed one when that deadline passes:

- Line 55: it does nothing for a draft, a stopped test, a test already closed (`workEndedAt` set), **or a test paused in any way** (`testPaused`). A paused test never closes on its own. Its deadlines move when the pause lifts (section 5).
- Lines 56-57: `workDeadlineOf` must be in the past.
- Line 62: every working contract ends with `endKind: "closed"` and `endedAt` set to the deadline itself (`at`), not to the moment the job ran.
- Line 75: the test gets `status: "closed"` and **`workEndedAt: at`**, where `at` is the deadline.

It runs from the 5-minute sweep and the daily job (`closeWorkAfterDeadlines`, [`src/lib/server/workWindow.ts:100`](../src/lib/server/workWindow.ts#L100), which only picks tests with no team pause and no hold or suspension of the developer, line 102-103), and when a press checks `finishWorkIfDue` ([`src/lib/server/workWindow.ts:29`](../src/lib/server/workWindow.ts#L29)).

So for "Harbor Run": if Ana's deadline (the latest) is Dec 10, 11:59 PM and nothing is paused, `workEndedAt` becomes **Dec 10, 11:59 PM** even if the sweep notices it at 12:03 AM on Dec 11.

### 1.3 The two `workEndOf` functions (same name, different meanings)

There are two functions called `workEndOf`.

**`workEndOf` in `workWindow.ts`** ([`src/lib/server/workWindow.ts:14`](../src/lib/server/workWindow.ts#L14)) reads the database and returns `workEndedAt ?? workDeadlineOf(...)`. It answers **"when does (or did) the work window end?"** For a running test that is the upcoming deadline. The session page uses it for the call window (`callEnd`, [`src/app/app/sessions/[id]/page.tsx:253`](../src/app/app/sessions/%5Bid%5D/page.tsx#L253)), and so do the call requests in `requests.ts`.

**`workEndOf` in `pause.ts`** ([`src/lib/pause.ts:20`](../src/lib/pause.ts#L20)) is a pure function:

```ts
export const workEndOf = (t) => t?.workEndedAt ?? t?.pauseClosedAt ?? (t?.status === "stopped" ? t?.stoppedAt ?? null : null);
```

It answers **"did the work already end, and when?"** It returns:

1. `workEndedAt` when the test closed on its own;
2. else `pauseClosedAt` when the 7-day pause closure closed it;
3. else `stoppedAt` when the test is stopped (Nora's Stop or the team's Stop);
4. else `null`, meaning the work hasn't ended.

The span code (`moneySpans`, `devRateStates`, `callChargeAt`) uses the `pause.ts` one.

### 1.4 `closeOutBase`: the test close

[`src/lib/rules.ts:2064`](../src/lib/rules.ts#L2064)

```ts
export function closeOutBase(t, contracts, now = new Date()) {
  if (t.status === "draft") return null;                                  // 2065
  if (t.workEndedAt) return t.workEndedAt;                                 // 2066
  const stopped = t.status === "stopped";                                  // 2067
  if (!stopped && (!t.openUntil || t.openUntil.getTime() > now.getTime())) return null;                       // 2068
  if (!stopped && contracts.some((c) => c.status === "working" && c.dueAt.getTime() > now.getTime())) return null; // 2069
  const from = stopped ? (t.stoppedAt ?? now) : t.openUntil!;             // 2070
  return new Date(Math.max(from.getTime(), ...contracts.map((c) => c.dueAt.getTime()))); // 2071
}
```

Line by line:

- **2065.** A draft has no test close.
- **2066.** A test that closed on its own: the test close is `workEndedAt`, which is the deadline itself (1.2).
- **2067.** Remember whether it is stopped.
- **2068.** A test that isn't stopped and has no Open until, or whose Open until is still ahead: testers can still join, so the test close **isn't known yet** (`null`).
- **2069.** A test that isn't stopped with a working tester whose deadline is still ahead: not known yet (`null`).
- **2070.** Where to count from: the Stop time for a stopped test, else Open until.
- **2071.** The later of that and **every** contract's deadline (working or not).

Examples:

- **Closed on its own.** Ana's deadline was Dec 10, 11:59 PM, the latest. `workEndedAt` = Dec 10, 11:59 PM, so the test close is **Dec 10**, and the unmoved close-out is **Dec 24**.
- **Paused past its deadline (not closed yet).** Open until Dec 3 passed and Ana's Dec 10 deadline passed while the team's pause is on. Line 2068 and 2069 don't stop it (both passed), so the test close is Dec 10, 11:59 PM even though `workEndedAt` is still empty. The open pause span then pauses every window counting from it (section 2).
- **Stopped early.** Nora presses Stop on Dec 5 at 3 PM. Ana's deadline was Dec 10, 11:59 PM. The Stop ends Ana's contract, but its `dueAt` stays Dec 10. Line 2071 takes the later: the test close is **Dec 10, 11:59 PM**, not Dec 5. A Stop never makes the test close earlier than any tester's deadline. (If every deadline were before Dec 5, the test close would be the Stop moment, Dec 5, 3 PM.) Open until is not used for a stopped test (line 2070 picks `stoppedAt`).
- **7-day pause closure.** `closePausedTest` sets `status: "stopped"`, `stoppedAt: now` and `pauseClosedAt: now` ([`src/lib/server/pauseClosure.ts:53`](../src/lib/server/pauseClosure.ts#L53)). `closeOutBase` treats it like any Stop.

### 1.5 Test close versus close-out

- **Test close** = `closeOutBase`. For "Harbor Run": Dec 10.
- **Close-out** = test close + 14 days. Unmoved: **Dec 24**. Each date below starts from Dec 24 and is then moved by its own spans. Ana's Rate might end Dec 29, the written answers' Pay more Dec 29, the recording's Charge Jan 3, and Nora's Rate Jan 12 (section 12 shows how).

The comment at the top of `closeOut.ts` says this: "There is no test-wide close-out date of its own any more: each date counts its 14 days from the test close with its own spans" ([`src/lib/server/closeOut.ts:6-11`](../src/lib/server/closeOut.ts#L6)).

---

## 2. Windows that pause: `windowEnd` and `mergeSpans`

### 2.1 `mergeSpans`

[`src/lib/server/closeOut.ts:17`](../src/lib/server/closeOut.ts#L17)

```ts
export function mergeSpans(list) {
  const merged = [];
  for (const x of [...list].sort((a, b) => a.start - b.start)) {   // 19: oldest start first
    const last = merged[merged.length - 1];
    if (last && x.start <= last.end) {                                // 21: overlaps (or touches) the previous one
      last.end = Math.max(last.end, x.end);                           // 22: stretch it
      last.open = last.open || x.open;                                // 23: still on if either is
    } else merged.push({ ...x });                                     // 24: a new, separate stretch
  }
  return merged;
}
```

Why it exists: two causes that overlap must count **once**. If Nora's hold runs Dec 12 to Dec 15 and Ana's dispute runs Dec 14 to Dec 16, the window is paused Dec 12 to Dec 16 (4 days), not 3 + 2 = 5 days.

It copies each span (`{ ...x }`), so the caller's list is never changed.

### 2.2 `windowEnd`

[`src/lib/server/closeOut.ts:30`](../src/lib/server/closeOut.ts#L30)

```ts
export function windowEnd(from, spans, now, days) {
  let left = days * DAY;                                   // 31: time still to count
  let t = from.getTime();                                  // 32: where counting has reached
  for (const x of spans) {
    if (x.end <= t && !x.open) continue;                   // 34: finished before we got here: ignore
    if (x.start > t) {                                     // 35: a gap of counting time before this span
      if (x.start - t >= left) return { end: new Date(t + left), paused: false }; // 36: window ends before the span
      left -= x.start - t;                                 // 37: use up the gap
      t = x.start;                                         // 38
    }
    if (x.open) return { end: new Date(Math.max(now.getTime(), t) + left), paused: true }; // 40: still on: end = now + what's left
    t = Math.max(t, x.end);                                // 41: skip over the span
  }
  return { end: new Date(t + left), paused: false };       // 43: no more spans: count the rest
}
```

It expects the spans **merged and sorted** (every caller passes `mergeSpans(...)`).

Step by step, with the test close at Dec 10, 11:59 PM and 14 days to count:

- **No spans.** Line 43: Dec 10, 11:59 PM + 14 days = **Dec 24, 11:59 PM**.
- **Nora's hold Dec 12, 12:00 PM to Dec 15, 12:00 PM (lifted).** Line 35: the hold starts after the counting point, so the gap (1 day 12 h 1 min) is used up (line 37), `t` jumps to the hold's start, then line 41 skips to its end. Left: 12 days 11 h 59 min from Dec 15, 12:00 PM = **Dec 27, 11:59 PM**. Three days later than Dec 24, exactly the hold's length.
- **The same hold, still on, looked at on Dec 14, 12:00 PM.** Line 40: `paused: true`, end = now + 12 days 11 h 59 min = **Dec 26, 11:59 PM**. Looked at the next day it says Dec 27, 11:59 PM. **An open span makes the end move forward with the clock, day by day,** and `paused: true` tells the caller it is moving.
- **A span that ended before the window started** (say the team's pause Nov 28 to Nov 30). Line 34 skips it. That pause already moved the deadlines themselves (section 5), so counting it again here would count it twice.
- **A span that started before the window and ends inside it** (Ana suspended Dec 18 to Dec 20, a window starting Dec 19 at noon). Line 35 is false (it started earlier), line 41 moves `t` to Dec 20, noon. Only the part **after** the window's start counts: 1 day.

### 2.3 `lastLift`

[`src/lib/server/closeOut.ts:109`](../src/lib/server/closeOut.ts#L109) returns the end of the latest **closed** span that ended at or before now. Reminders use it to send one fresh line after a freeze lifts (section 11).

---

## 3. Tonight's removals: `testSpans` and `closeOutOf`

Commit `0ae56f5a` ("Rate windows (Owner, Dec 10 2026)") removed two functions from `closeOut.ts`.

**What they did:**

- `testSpans(t, from, now)` built "everything that moves a test's close-out": Nora's holds and suspensions, the team's pauses, and outages. It **dropped** any hold, suspension or team pause that **began after the work ended** (the old §358 rule). It also **clipped** every span at the Stop on a stopped test.
- `closeOutOf(testId)` was the one test-wide close-out: `windowEnd(closeOutBase, testSpans, 14 days)`. Both Rate windows counted from it. Before tonight Ana's Rate window also added her own suspension, and Nora's never-rated tester case opened her Rate at this test-wide date.

**What replaced them:**

- There is no test-wide date. Each date calls `windowEnd(closeOutBase(...), <its own spans>, 14 days)`.
- The spans are now `moneySpans` ([`src/lib/server/closeOut.ts:120`](../src/lib/server/closeOut.ts#L120)), which **keeps** holds and suspensions that began after the work ended, cuts the team's pause at the Stop, cuts everything at Nora's account deletion, and adds outages. Guide 2 explains it line by line.
- Ana's Rate: `testerRatingClosesAt` now uses `moneySpans` + her disputes, and **no longer** her own suspension (section 8).
- Nora's Rate: `devRateStates` opens at **Ana's** Rate close (section 9), computed inline with the same inputs.

**What changed in practice:** a hold Nora gets **after** the test closed used to leave Ana's Rate window alone. Now it moves it later by the hold's length.

---

## 4. The review date and Charge opening

### 4.1 `payBy`: the review clock

When Ana sends a part, its `payBy` is set to **sent + 7 days**: `payByFrom` ([`src/lib/rules.ts:933`](../src/lib/rules.ts#L933)), `REVIEW_DAYS = 7` ([`src/lib/rules.ts:924`](../src/lib/rules.ts#L924)). Written answers: [`src/lib/server/tests.ts:1616`](../src/lib/server/tests.ts#L1616). For a call, `payBy` is 7 days after the call's measured end ([`src/lib/server/calls.ts:180`](../src/lib/server/calls.ts#L180) and [`src/lib/server/calls.ts:486`](../src/lib/server/calls.ts#L486)).

`payBy` is **stored**, and pauses and outages move it in place (section 5).

### 4.2 `chargeOpensAt`, `reviewDateOf`, `pieceDueAt`, `chargeIsOpen`

[`src/lib/rules.ts:1585-1605`](../src/lib/rules.ts#L1585)

```ts
export function chargeOpensAt(s, test, contract, now) {
  void test; void now;                                   // kept for older callers; unused
  if (!s.payBy) return null;                             // nothing sent yet (or a call not measured yet)
  return reviewDateOf(s.payBy, pieceDueAt(s, contract));
}
export const pieceDueAt = (piece, contract) => piece.stintDueAt ?? contract.dueAt;
export const reviewDateOf = (sevenDaysAfter, dueAt) => new Date(Math.max(sevenDaysAfter.getTime(), dueAt.getTime()));
export const chargeIsOpen = (...a) => { const at = chargeOpensAt(...a); return !!at && at.getTime() <= (a[3] ?? new Date()).getTime(); };
```

- The **review date** is the later of `payBy` and Ana's deadline. Both must have passed before Charge opens.
- `pieceDueAt` picks the deadline the piece counts to. Normally Ana's contract deadline. When the piece has a stamped `stintDueAt` (work sent in an earlier stint before a rejoin, or a deadline moved by a pause after Ana's part ended, section 5.4) that one wins.
- `chargeIsOpen` is "the review date has passed".

Example: Ana sends her written answers Nov 27 at noon, so `payBy` = Dec 4, noon. Her deadline is Dec 10, 11:59 PM. Review date = **Dec 10, 11:59 PM**. If she had sent them on Dec 9 at noon, `payBy` = Dec 16, noon, and the review date = **Dec 16, noon**.

### 4.3 `openCharges`: Charge actually opening

[`src/lib/server/holds.ts:1568`](../src/lib/server/holds.ts#L1568). It runs every 5 minutes (`runSweep`, [`src/lib/server/holds.ts:1397`](../src/lib/server/holds.ts#L1397)) and in the daily job.

- Line 1572: only pieces with no review, `payBy` in the past, on a test whose money **isn't frozen** (`MONEY_FREE`, [`src/lib/server/holds.ts:53`](../src/lib/server/holds.ts#L53)), and a tester who can be paid.
- Line 1580: unlisted work (no listing price) never gets Charge.
- Line 1583: late work never gets Charge.
- Line 1585: `chargeIsOpen` must be true (both 7 days and Ana's deadline passed).
- Lines 1587-1588: if both the piece's Pay and Charge are already closed (its `pieceCloseOut` passed), nothing more.
- Lines 1604: if nothing is left to charge (Nora already paid something), no Charge.
- Lines 1605-1610: the first time, it stamps `choiceOfferedAt: now`, `choiceBy: now + 7 days`, `remindedAt: now`, records the event and may prompt Ana's Rate.

`choiceOfferedAt` is the real "Charge is open" flag. `choiceBy` is still written and moved by pauses and outages, but the code only checks that it is not null (see [Things that look off](#things-that-look-off)). **The date Charge and Let it go close is `pieceCloseOut`** (section 6), not `choiceBy`.

While the money is frozen, `openCharges` skips the piece (`MONEY_FREE`), so Charge opens late, at the first sweep after the freeze lifts. The lift also moves `payBy` (section 5), so the review date usually moved past the lift anyway.

---

## 5. How pauses and outages move the stored dates

A pause moves the stored dates **once, when the last cause lifts**, by the whole paused stretch. While anything still pauses the test, nothing moves.

### 5.1 `pauseShiftMs`

[`src/lib/rules.ts:1007`](../src/lib/rules.ts#L1007): returns 0 when `PAUSE_DEFAULTS.shiftDeadlines` is off or when another pause is still on (`others`), else `now - start`.

### 5.2 `shiftAfterPause`: one test's dates after a lift

[`src/lib/server/holds.ts:276`](../src/lib/server/holds.ts#L276)

- **282.** Another pause still on (`others`): move nothing yet.
- **283-285.** The stretch starts at the earlier of this pause's start and the test's `pausedSince` (the one clock started by the first pause cause, section 5.6). Overlapping causes count once.
- **286-287.** `ms` = the stretch length.
- **293-296.** Open until moves later by `ms`, rounded to the nearest end of day, only if it was still ahead when the pause began, and only on a test that isn't stopped and isn't closed.
- **299.** Every **working** tester's deadline still ahead when the pause began moves later by `ms`, rounded up to 11:59 PM (`movedDue`, [`src/lib/rules.ts:400`](../src/lib/rules.ts#L400)).
- **300.** `shiftPieceDeadlines` (5.4) for pieces whose deadline doesn't move with a working contract.
- **301-306.** Each unreviewed part's `payBy` and `choiceBy`: moved by the part of the stretch after the part was sent (`updatedAt`, set when Ana sends it or adds to it, [`src/lib/server/tests.ts:1613`](../src/lib/server/tests.ts#L1613)). Only if the date was still ahead when the pause began (a passed `payBy` stays: that piece's Charge was already open, and `pieceCloseOut` counts the pause instead).
- **308-312.** Each unreviewed booked call's `payBy` and `choiceBy` the same way, counted from the later of the pause start and when the call's length became final.

Since Dec 9, this also runs for a pause that began **after** the work ended (the comment at lines 277-280). Then Open until and the working deadlines don't move (the test is closed or stopped), but `payBy` does. So a hold after the close gives Nora back the review days it took, and Ana's Charge opens that much later.

### 5.3 Who calls it

| Lift | Where | Notes |
|---|---|---|
| Nora's hold lifted | `liftHoldIfClear` → `resumeTests` ([`src/lib/server/holds.ts:528`](../src/lib/server/holds.ts#L528)) | `start` = `holdStartedAt`; `others` = her suspension if still on |
| Nora's developer side reinstated | `reinstateAccount` → `resumeTests` ([`src/lib/server/restrictions.ts:256`](../src/lib/server/restrictions.ts#L256)) | `others` = her hold if still on |
| The team lifts its pause | `unpauseTest` ([`src/lib/server/restrictions.ts:517`](../src/lib/server/restrictions.ts#L517)) | only when the pause began before the work ended; `others` = Nora's hold and suspension |
| A Stop during the team's pause | `shiftAtStop` ([`src/lib/server/holds.ts:324`](../src/lib/server/holds.ts#L324)), called by Nora's Stop ([`src/lib/server/tests.ts:954`](../src/lib/server/tests.ts#L954)), the team's Stop ([`src/lib/server/restrictions.ts:569`](../src/lib/server/restrictions.ts#L569)) and the 7-day closure ([`src/lib/server/pauseClosure.ts:54`](../src/lib/server/pauseClosure.ts#L54)) | the Stop counts as the lift |

`resumeTests` ([`src/lib/server/holds.ts:194`](../src/lib/server/holds.ts#L194)) goes through **all** of Nora's tests. For each one it adds the team's pause to `others` only if it is still in force (`teamPausedNow`, line 199), calls `shiftAfterPause`, and when nothing pauses it any more, clears `pausedSince` (line 203) and records "Your tests are running again" (line 204, not for a stopped test or one the pause never paused).

`shiftAtStop` ([`src/lib/server/holds.ts:324`](../src/lib/server/holds.ts#L324)):

- **326.** Only for a stopped test with a team pause recorded (`adminPausedAt`) and a `stoppedAt`.
- **327.** If Nora's own hold or suspension is still on, nothing now: her own lift moves the whole stretch later.
- **328.** `shiftAfterPause(tx, t, adminPausedAt, stoppedAt)`: the stretch from the team's pause to the Stop.
- **329.** Clears `pausedSince` so a later lift never counts that stretch again.

The team's pause stays recorded on a stopped test (`adminPausedAt` is never cleared by a Stop). Guide 2 explains why that matters.

### 5.4 `shiftPieceDeadlines`

[`src/lib/server/holds.ts:251`](../src/lib/server/holds.ts#L251). For pieces still in review (no review, no Charge open) whose deadline would **not** move with a working contract: Ana's part already ended (left, rated, ended early, or the test closed or stopped), or work from an earlier stint. If that deadline was still ahead when the pause began, it is moved by `ms` (rounded up to the end of the day) and stamped on the piece as `stintDueAt`. Ana's contract deadline itself is left alone.

### 5.5 Outages: `applyOutage`

[`src/lib/server/outages.ts:330`](../src/lib/server/outages.ts#L330). An outage of 15 minutes or more is recorded. One longer than 24 hours (`OUTAGE_APPROVE_OVER_MS`, [`src/lib/server/outages.ts:82`](../src/lib/server/outages.ts#L82)) moves nothing until an admin approves it ([`src/lib/server/outages.ts:286`](../src/lib/server/outages.ts#L286), [`src/lib/server/outages.ts:292`](../src/lib/server/outages.ts#L292)).

When applied, it moves at once, by its length: every unreviewed part's and call's `payBy` that was after the outage's start (lines 337, 342), `choiceBy` (338), working deadlines (355), `stintDueAt` (358), Open until of open tests (360), Nora's `holdStartedAt` (351), and the 14-day rating clock of an unrevealed tester rating (`Rating.createdAt`, 363).

Except for **tests paused through it** (`pausedThrough`, [`src/lib/server/outages.ts:310`](../src/lib/server/outages.ts#L310)): their dates wait for the pause's lift, which counts the outage inside the whole stretch. See [Things that look off](#things-that-look-off) for a gap here.

The windows in sections 6, 8 and 9 also count outages as spans (via `moneySpans`). They don't double-count with the moved `payBy`, because `windowEnd` skips spans that ended before the window's start (line 34), and an outage that moved `payBy` always ends before the moved `payBy`.

### 5.6 `markPaused` and `pausedSince`

[`src/lib/server/holds.ts:240`](../src/lib/server/holds.ts#L240) sets `pausedSince = now` on **open** tests that don't have it yet. It is called when a hold starts ([`src/lib/server/holds.ts:156`](../src/lib/server/holds.ts#L156)), when Nora's developer side is suspended ([`src/lib/server/restrictions.ts:212`](../src/lib/server/restrictions.ts#L212)) and when the team pauses one test ([`src/lib/server/restrictions.ts:457`](../src/lib/server/restrictions.ts#L457)). It is the start of the one 7-day pause closure clock (`pauseSince`, [`src/lib/pause.ts:42`](../src/lib/pause.ts#L42); `pauseClosesAt`, [`src/lib/pause.ts:53`](../src/lib/pause.ts#L53)) and the start of the stretch in `shiftAfterPause`. A closed or stopped test never gets a new `pausedSince` (status must be `"open"`).

---

## 6. Each piece's one closing date: `pieceCloseOut`

[`src/lib/server/closeOut.ts:193`](../src/lib/server/closeOut.ts#L193)

One date per piece closes **all** of these together: Ana's Charge and Let it go, Nora's Pay and Pay more on that piece, and Ana's Dispute on it (Dec 9 rule, comment lines 185-191).

```ts
export async function pieceCloseOut(where, now = new Date()) {
  const piece = /* the submission or call: payBy, contractId, stintDueAt */;          // 194-198
  if (!piece) return null;                                                            // 199
  const c = /* its contract: testId, dueAt, tester { id, testerSuspendedAt } */;      // 200
  if (!c) return null;                                                                // 201
  const t = /* the test with developer and every contract's status/dueAt */;          // 202
  if (!t) return null;                                                                // 203
  const base = closeOutBase(t, t.contracts, now);                                     // 204
  if (!base) return null;                                                             // 205
  const opens = piece.payBy ? reviewDateOf(piece.payBy, pieceDueAt(piece, c)) : null; // 206
  const tEvents = /* Ana's "suspended" / "reinstated" account events */;              // 207
  const from = new Date(Math.min(base.getTime(), opens?.getTime() ?? Infinity));     // 208
  const spans = mergeSpans([...(await moneySpans(t, from, now)), ...testerPauseSpans(tEvents, c.tester.testerSuspendedAt, now)]); // 210
  const testEnd = windowEnd(base, spans, now, CLOSE_OUT_DAYS).end;                    // 211
  const own = opens ? windowEnd(opens, spans, now, CLOSE_OUT_DAYS).end : null;        // 212
  return own && own > testEnd ? own : testEnd;                                        // 213
}
```

Line by line:

- **204-205.** No test close yet means no closing date yet (`null`). Callers treat `null` as "still open".
- **206.** `opens`: the piece's review date (when its Charge opened or opens). Same formula as `chargeOpensAt`.
- **207.** Ana's own suspension history.
- **208.** `from` is the earlier of the test close and `opens`. It only limits which outages `moneySpans` loads (those ending after `from`).
- **210.** The spans: everything that froze the money (Nora's holds and suspensions whenever they ran, the team's pause cut at the Stop, outages; cut at Nora's deletion) **plus Ana's own tester-side suspensions**. Her Charge box is hidden while she is suspended, so she gets that time back.
- **211.** `testEnd`: 14 days from the test close, paused by those spans.
- **212.** `own`: 14 days from the piece's own review date, paused by the same spans. This is the "at least 14 days of Charge from when Charge opened" rule.
- **213.** The later of the two.

Example (no pauses): the test close is Dec 10, 11:59 PM.

- Written answers with review date Dec 10, 11:59 PM: `testEnd` = Dec 24, `own` = Dec 24. **Dec 24.**
- A recording sent Dec 9, noon, review date Dec 16, noon: `testEnd` = Dec 24, 11:59 PM; `own` = Dec 30, noon. **Dec 30, noon.**

Disputes are **not** spans here. An open dispute doesn't move a piece's closing date.

Who reads it (each with its own line):

| Reader | Where |
|---|---|
| Nora's Pay | [`src/lib/server/payments.ts:139`](../src/lib/server/payments.ts#L139) ("Pay closed on …") |
| Nora's Pay more | [`src/lib/server/payments.ts:780`](../src/lib/server/payments.ts#L780) |
| Ana's Charge / Let it go | `chargeCloseOutGate` [`src/lib/server/holds.ts:2258`](../src/lib/server/holds.ts#L2258) ("Charge and Let it go closed on …") |
| Ana's Dispute | `disputesClosed` [`src/lib/server/closeOut.ts:245`](../src/lib/server/closeOut.ts#L245) |
| Session page lines "Charge or let go by …", "Dispute until …", "Pay more until …" | [`src/app/app/sessions/[id]/page.tsx:286`](../src/app/app/sessions/%5Bid%5D/page.tsx#L286), [`:344`](../src/app/app/sessions/%5Bid%5D/page.tsx#L344), [`:351`](../src/app/app/sessions/%5Bid%5D/page.tsx#L351) |
| Nora's test page "Pay by …", "Pay more until …" | [`src/app/app/tests/[id]/page.tsx:206`](../src/app/app/tests/%5Bid%5D/page.tsx#L206), [`:274`](../src/app/app/tests/%5Bid%5D/page.tsx#L274) |
| Dashboards | [`src/app/app/page.tsx:218`](../src/app/app/page.tsx#L218), [`:425`](../src/app/app/page.tsx#L425), [`:431`](../src/app/app/page.tsx#L431); [`src/lib/server/dashboardNeeds.ts:32`](../src/lib/server/dashboardNeeds.ts#L32) |
| Team's "Close open reviews for $0" (skips closed pieces) | [`src/lib/server/teamClose.ts:34`](../src/lib/server/teamClose.ts#L34) |
| Reminders | section 11 |

While the money is frozen, the session page shows "Waits while the test is paused" (`FROZEN_WAITS_LINE`, [`src/lib/rules.ts:2089`](../src/lib/rules.ts#L2089)) instead of the date ([`src/app/app/sessions/[id]/page.tsx:291`](../src/app/app/sessions/%5Bid%5D/page.tsx#L291)). The date is moving day by day then (an open span).

A piece that reaches its date unpaid stays unpaid ("Not paid (closed on <date>)"). Nothing is charged automatically for parts.

---

## 7. Calls: the automatic charge

### 7.1 `callChargeAt`

[`src/lib/server/closeOut.ts:222`](../src/lib/server/closeOut.ts#L222)

```ts
export async function callChargeAt(callId, now = new Date()) {
  const x = /* call: payBy, startsAt, measuredAt, contractId */;
  if (!x?.payBy) return null;                                                         // 224: not measured yet
  const t = /* its test, with developer */;
  if (!t) return x.payBy;                                                             // 227
  const from = x.measuredAt && x.measuredAt > x.startsAt ? x.measuredAt : x.startsAt; // 228: the countdown's start
  const end = workEndOf(t)?.getTime() ?? Infinity;                                    // 229: when the work ended (pause.ts version)
  const spans = (await moneySpans(t, from, now, false)).filter((sp) => sp.open && sp.start >= end && sp.end > from.getTime()); // 232
  if (!spans.length || x.payBy <= from) return x.payBy;                               // 233
  return windowEnd(from, mergeSpans(spans), now, (x.payBy.getTime() - from.getTime()) / DAY).end; // 234
}
```

- **The stored `payBy` is the answer** in nearly every case. Pauses during the work and pauses after it already moved `payBy` when they lifted (section 5). Outages moved `payBy` when they were recorded, which is why line 232 asks `moneySpans` **without** outages (`false`).
- **Line 232** keeps only a freeze that is **still on now** and **began after the work ended**. Only that one has not reached `payBy` yet. While it's on, line 234 moves the date day by day: a window of (payBy − from) days from `from`, paused by the open freeze.

Example: Ana's listed call ($40 an hour) runs Dec 9, 10:00 to 10:30 AM. `payBy` = Dec 16, 10:30 AM. The test closed Dec 10. Nora's hold starts Dec 12 at noon.

- On Dec 14 at noon, `callChargeAt` returns Dec 14 noon + (7 days − the 3 days 1 h 29 min already counted) = about **Dec 18, 10:30 AM**, and it moves a day for each day the hold lasts.
- Nora's hold lifts Dec 15 at noon. `shiftAfterPause` moves `payBy` by 3 days to **Dec 19, 10:30 AM**. `callChargeAt` now returns that stored date.

### 7.2 `autoChargeCalls`

[`src/lib/server/holds.ts:1991`](../src/lib/server/holds.ts#L1991), every 5 minutes and daily.

- **1997.** Booked calls with no review, `payBy` in the past, a payable tester, on a test whose money is live (`MONEY_LIVE`, [`src/lib/server/holds.ts:51`](../src/lib/server/holds.ts#L51): not frozen, or a deleted developer's).
- **2000.** A call with no measured length is skipped.
- **2003-2004.** Read the test again: frozen since the list was read → wait.
- **2006-2007.** `callChargeAt` still ahead → wait.
- **2011-2018.** **Unlisted call** (no rate): closes with $0, "Closed with nothing paid (it wasn't listed)."
- **2025-2026.** Listed call: the amount from `callChargeCap` ([`src/lib/server/holds.ts:1971`](../src/lib/server/holds.ts#L1971)): rate × measured minutes, less what's paid, within what's left of the $500 for that tester's calls. Under 50 cents (`MIN_CHARGE_CENTS`) it closes with $0.
- **2041-2071.** The charge itself. A decline adds it to what Nora owes and starts a hold.

In the example, the $20 charge happens at the first sweep after Dec 19, 10:30 AM.

Calls have no Charge / Let it go for Ana ("There's nothing to choose for a call", `AUTO_CHARGE_NO_CHOICE`, [`src/lib/rules.ts:1622`](../src/lib/rules.ts#L1622)). `pieceCloseOut` still gives a call a closing date, which closes Nora's Pay and Pay more on it and Ana's Dispute.

---

## 8. Ana's Rate window and Rate box

### 8.1 `testerRatingClosesAt`: when Ana's Rate closes

[`src/lib/server/closeOut.ts:145`](../src/lib/server/closeOut.ts#L145)

```ts
export async function testerRatingClosesAt(contractId, now = new Date()) {
  const c = /* contract: testId */;               if (!c) return null;
  const t = /* test with developer, contracts */; if (!t) return null;
  const base = closeOutBase(t, t.contracts, now); if (!base) return null;            // 150-151
  const disputes = /* this contract's disputes created up to now */;                  // 152
  return windowEnd(base, mergeSpans([...(await moneySpans(t, base, now)), ...disputeSpansOf(disputes, now)]), now, CLOSE_OUT_DAYS).end; // 153
}
```

Ana's Rate closes **14 days after the test close**, moved by:

- **Nora's side** (`moneySpans`): Nora's holds and suspensions whenever they ran (also after the close), the team's pause cut at the Stop, outages.
- **Ana's own disputes on this contract** while they wait for the team (`disputeSpansOf`, [`src/lib/server/closeOut.ts:135`](../src/lib/server/closeOut.ts#L135): an open one runs to now, a decided one ends at `decidedAt`, a withdrawn one never counts).

**Tonight's change:** Ana's own tester-side suspension **no longer** moves it. Her Rate is still hidden while she is suspended (8.2, line 63).

Example: test close Dec 10, 11:59 PM. Nora's hold Dec 12 to Dec 15 (3 days). Ana's dispute Dec 21 to Dec 23 (2 days). Ana suspended Dec 18 to Dec 20 (doesn't count). Ana's Rate closes **Dec 29, 11:59 PM** (Dec 24 + 3 + 2).

### 8.2 `testerRateState`: Ana's Rate box

[`src/lib/server/ratings.ts:59`](../src/lib/server/ratings.ts#L59). The checks run in this order; the first that applies wins:

| Line | Check | Box | Line Ana reads |
|---|---|---|---|
| 61 | Either account deleted | hidden | "Rating is unavailable because an account was deleted." |
| 62 | Ana already rated | rated | |
| 63 | Ana's tester side suspended | hidden | "You can rate once your account is active again." |
| 64-65 | Nothing sent and no call took place | hidden | "Rating opens once some work was sent or a call took place." |
| 67-68 | `testerRatingClosesAt` passed | closed | "Rating closed on Dec 29, 2026." |
| 71 | A piece with Charge open, unreviewed, not late | disabled | "Charge or let go of your unreviewed work first." |
| 72 | Ana has an open dispute | disabled | "Rating opens once the team decides your dispute." |
| 78-83 | Money frozen **and** work waiting for review | hidden | "You can rate once this test resumes." |
| 84-87 | Work waiting for review (not frozen) | disabled | "Rating opens on Dec 19, or sooner if Nora Lane reviews everything you sent." (or "…once Nora Lane reviews everything you sent." for a call still being measured) |
| 89 | Otherwise | open | |

**Tonight's freeze rule (lines 74-83):**

- **78.** `frozen` = `moneyFrozen(Nora, test)`: Nora's suspension, Nora's hold, or the team's pause in force.
- **79.** `judgedAt`: while frozen, the waiting work is judged **at the freeze's start** (the start of the open span in `moneySpans`, without outages), not now. Reason in the comment: a review date still ahead when the freeze began moves with the freeze at the lift, so during the freeze that piece counts as still waiting even if its stored date has "passed" on the calendar.
- **80-81.** Waiting = no review and Charge not open at `judgedAt` (for a call: paid, or its review date passed).
- **83.** Frozen and something waits → **hidden** with `RATE_TEST_PAUSED`.
- Nothing waits → the box is **open, freeze or not**. Before tonight it was hidden during every freeze.

On the session page, an open or disabled Rate shows "Rate until Dec 29", or "Waits while the test is paused" while the money is frozen ([`src/app/app/sessions/[id]/page.tsx:224-225`](../src/app/app/sessions/%5Bid%5D/page.tsx#L224)).

### 8.3 `testerRateLiftedAt`

[`src/lib/server/closeOut.ts:165`](../src/lib/server/closeOut.ts#L165). Only for reminders: when Ana's Rate last came back from a freeze **that hid it**:

- her own tester-side suspensions (always: her Rate is hidden through one), and
- a money freeze (`moneySpans` without outages) **only if** some piece was waiting for review during it (`hidRate`, lines 172-179: sent before the freeze ended, not reviewed by the later of the freeze start and its sending, and its review date still ahead then).

---

## 9. Nora's Rate window and the reveal

[`src/lib/server/ratings.ts:95`](../src/lib/server/ratings.ts#L95) `devRateStates(contractIds)`

### 9.1 What it loads (lines 98-116)

- The contracts with tester, test, developer, parts and calls (98).
- Both sides' ratings, open-dispute counts, and Nora's hold / suspension account events (99-103).
- **All** outages that count (not waiting for approval) as closed spans (109).
- Each contract's disputes except withdrawn ones (110).
- For each test: `base` = `closeOutBase`, and `money` = `moneySpans(t, base, now)` (111-116). This is the same clock as Ana's Rate window.

### 9.2 Per contract (lines 117-160)

- **123.** `spans` for the test: Nora's own holds and suspensions (`devPauseSpans`) + the team's pauses (`teamPauseSpans`), the team's pause cut at `workEndOf` on a stopped test (tonight). This is "Nora couldn't rate" time.
- **124-125.** `mine` = Nora's rating; `theirs` = Ana's rating.
- **127-128.** `settled`: every part, and every booked call that already started, has a review (paid, charged, let go, auto-charged, or closed at $0).
- **132.** `disputeSpans`: Ana's disputes on this contract.
- **134.** `hers`: **Ana's Rate window**, `windowEnd(base, money + Ana's disputes, 14 days)`. Same inputs as `testerRatingClosesAt`.
- **135.** `lastSettled`: when the last piece got its review.
- **136.** **`opensAt`**:
  - not settled → `null` (Nora can't rate);
  - Ana rated → the later of Ana's rating time and `lastSettled`;
  - Ana never rated → only once **Ana's Rate window has closed** (`hers` passed) and Ana sent something or had a call: the later of `hers.end` and `lastSettled`.
  - otherwise `null`.
- **141-142.** If the window opened at Ana's rating, outages that already moved that rating's `createdAt` (section 5.5) are not counted again.
- **143.** **`own`**: 14 days from `opensAt`, paused by Nora's spans, Ana's disputes and outages.
- **144.** **`byClose`**: 14 days from the test close, paused by `money` + Nora's spans + Ana's disputes. (Nora's spans are already inside `money`; merging them again changes nothing.)
- **145.** **`w`**: the later of `own` and `byClose`. So Nora's window ends at the later of "14 days after it opened" and "Ana's close-out".
- **148.** **`revealAt`**: when Ana's stars show to Nora (if Nora hasn't rated first; `devRate` reveals them at once, [`src/lib/server/ratings.ts:374`](../src/lib/server/ratings.ts#L374)):
  - stored `revealedAt` if set;
  - else if the window opened within 14 days of Ana's rating → `w.end`;
  - else Ana's rating + 14 days (so a slow-settling Nora can't hold the reveal back).
- **149.** `liftedAt`: when Nora's last freeze ended (`lastLift` of `spans`), for reminders.

Then the state, first match wins:

| Line | Check | Box | Nora reads |
|---|---|---|---|
| 150 | Either account deleted | hidden | "Rating is unavailable because an account was deleted." |
| 151 | Nora rated | rated | |
| 152 | Nora's own hold or developer-side suspension | hidden | "You can rate once your account is active again." |
| 154 | The team's pause in force (`teamPausedNow`) | hidden | "The team paused this test: you can rate once the pause is lifted." |
| 156 | Not open yet | hidden | `ratePendingLine` (9.3) |
| 157 | `w` passed | hidden | "The 14 days to rate Ana have passed." |
| 158 | Ana has an open dispute | disabled | "Rating opens once the team decides Ana's dispute." |
| 159 | Otherwise | open | |

### 9.3 `ratePendingLine`

[`src/lib/rules.ts:1982`](../src/lib/rules.ts#L1982), called at [`src/lib/server/ratings.ts:156`](../src/lib/server/ratings.ts#L156) with Ana's Rate end in Nora's time zone:

- Test close not known yet (`hers` null): "You can rate Ana once she's rated you and everything she sent is settled."
- Ana's Rate still running: "You can rate Ana once she's rated you (or her time to rate ends on Dec 29, 2026) and everything she sent is settled."
- Ana's Rate ended: "You can rate Ana once everything she sent is settled."

### 9.4 Example

Test close Dec 10, 11:59 PM. Ana's Rate ends Dec 29, 11:59 PM (8.1). Everything settled by Dec 21.

- **Ana never rates.** `opensAt` = Dec 29, 11:59 PM. `own` = **Jan 12, 11:59 PM**. `byClose` = Dec 29. Nora's window: **Dec 29 to Jan 12**. Her opening bell ("Ana Silva finished Harbor Run. You can rate her for 14 days.") is sent by `maybeOpenDevRating` ([`src/lib/server/ratings.ts:222`](../src/lib/server/ratings.ts#L222)) from the reminder job.
- **Ana rates Dec 26 at noon.** `opensAt` = Dec 26, noon. `own` = **Jan 9, noon**; `byClose` = Dec 29. Window ends Jan 9, noon. Ana's stars show to Nora on Jan 9 at noon, or the moment Nora rates.
- **Ana rates Dec 1, during the test, with everything settled by Dec 3.** `opensAt` = Dec 3. `own` = Dec 17. `byClose` = Dec 24 (test close + 14, no spans). Window ends **Dec 24**: the close-out part wins.

---

## 10. The Dispute window

There is no separate dispute window any more. Since Dec 9, **a piece's Dispute closes on its `pieceCloseOut` date**, the same as its Charge and Pay (comment at [`src/lib/server/closeOut.ts:190-191`](../src/lib/server/closeOut.ts#L190)).

`disputesClosed` ([`src/lib/server/closeOut.ts:245`](../src/lib/server/closeOut.ts#L245)):

- **249, 252.** Ana rated this test → every piece's Dispute is closed ("You rated this test, so its disputes are closed.").
- **253-254.** Else a piece whose `pieceCloseOut` passed is closed ("This part closed on Dec 29, 2026, so it can't be disputed any more.").
- A dispute already open is not touched. It stays until the team decides.

`disputeClosedFor` ([`src/lib/server/closeOut.ts:260`](../src/lib/server/closeOut.ts#L260)) is the one-piece version used by the Dispute press ([`src/lib/server/payments.ts:364`](../src/lib/server/payments.ts#L364), [`:382`](../src/lib/server/payments.ts#L382)).

Disputes as **spans** only affect the two Rate windows (sections 8 and 9), never a piece's date.

---

## 11. Reminders that count to these dates

Only how they read the dates. The 5-minute sweep (`runSweep`, [`src/lib/server/holds.ts:1380`](../src/lib/server/holds.ts#L1380)) sends first lines; the daily job (`runDaily`, [`src/lib/server/holds.ts:1410`](../src/lib/server/holds.ts#L1410)) also sends repeats. Both look up each piece's closing date once per run (`closeOutMemo`, [`src/lib/server/holds.ts:1681`](../src/lib/server/holds.ts#L1681), wraps `pieceCloseOut`).

| Reminder | Function | Date it counts to | Waits while |
|---|---|---|---|
| Nora: "review Ana's written answers within 3 days (Dec 10)" | `reviewReminders` [`src/lib/server/holds.ts:1625`](../src/lib/server/holds.ts#L1625) | the review date (`chargeOpensAt`, 1630); stops once Pay closed (1634) | frozen (`MONEY_FREE`, 1628) |
| Nora: "pay Ana's call on … within 3 days (Dec 19)" | same, 5b | `callChargeAt` (1658), only the 3-day and 1-day marks | frozen (1655) |
| Nora: "… wasn't reviewed by …: pay it." (Ana can't Charge) | `openCharges` [`src/lib/server/holds.ts:1593`](../src/lib/server/holds.ts#L1593) | review date | frozen |
| Nora: "Pay now: … Ana can charge or let it go (until Dec 29)" | `payNowLines` [`src/lib/server/holds.ts:1886`](../src/lib/server/holds.ts#L1886) | `pieceCloseOut`; one fresh line after a freeze lifts (`moneyLiftedAt`, 1845) | frozen (`MONEY_FREE`, 1889) |
| Ana: "Charge or let go: your recording on “Harbor Run” ($20.00, by Jan 3)" | `testerChargeLines` [`src/lib/server/holds.ts:1926`](../src/lib/server/holds.ts#L1926) | `pieceCloseOut`; a fresh line when it moved later than the "tc:" mark (1938); one after a freeze or her own suspension lifts (`testerChargeLiftedAt`, 1857) | frozen (`MONEY_LIVE`, 1930); Ana suspended (1931) |
| Nora: "Closing soon: Ana's recording on “Harbor Run” closes on Jan 3" | `closeOutReminders` [`src/lib/server/holds.ts:1743`](../src/lib/server/holds.ts#L1743) | `pieceCloseOut` with marks 30 / 7 / 3 / 1 days (`CLOSE_SOON_MARKS`, 1699; `closeSoonMarkDue`, 1713), keyed by the date so a moved date restarts the countdown | frozen (`MONEY_FREE`, 1746) |
| Ana: "Reminder: rate Nora on “Harbor Run”: rating closes on Dec 29" | `ratingReminders` [`src/lib/server/ratings.ts:396`](../src/lib/server/ratings.ts#L396) | `testerRatingClosesAt` (421); a fresh line when it moved later than the "ratec:" mark (422-423); one after a freeze that hid her Rate lifts (`testerRateLiftedAt`, 429); the last one before the date ignores email Off (439) | Ana suspended (417); Rate not open (431) |
| Nora: "Reminder: rate Ana for “Harbor Run” (until Jan 12)" | same, developer half | `devRateStates` `endsAt` (470); one after her freeze lifts (`liftedAt`, 456, 464); the last one ignores email Off (469) | Rate not open, or `paused` (453) |

---

## 12. One worked timeline

"Harbor Run", Nora's test. All times in Nora's zone. Deadlines are 11:59 PM; other events at noon unless said.

### 12.1 The events

| When | Event |
|---|---|
| Nov 24 | Ana joins with 14 tester days → deadline **Dec 8, 11:59 PM** (`dueFromJoin`, [`src/lib/rules.ts:384`](../src/lib/rules.ts#L384)). Open until is **Dec 1, 11:59 PM**. |
| Nov 27, noon | Ana sends written answers ($10 listed) → `payBy` **Dec 4, noon**. |
| Nov 28, noon | **The team pauses the test.** `pausedSince` = Nov 28, noon. |
| Nov 30, noon | **The team lifts the pause** (48 h). |
| Dec 9, noon | Ana sends her recording ($20 listed) → `payBy` **Dec 16, noon**. |
| Dec 10, 9 AM | Nora pays $5 for the written answers (a review now exists). |
| Dec 10, 11:59 PM | The last deadline passes; the test closes on its own. |
| Dec 12, noon | **Nora's payment hold starts** (after the close). |
| Dec 15, noon | **Nora's hold lifts** (72 h). |
| Dec 18, noon | **Ana's tester side is suspended.** |
| Dec 20, noon | **Ana is reinstated** (48 h). |
| Dec 21, noon | Ana charges the recording ($20), then **opens a dispute** on the written answers' $5. |
| Dec 23, noon | **The team decides the dispute** (48 h). |

### 12.2 How every date moves

**At the team's lift, Nov 30 noon** (`unpauseTest` → `shiftAfterPause`, stretch 48 h from `pausedSince`):

| Date | Before | After | Why |
|---|---|---|---|
| Open until | Dec 1, 11:59 PM | **Dec 3, 11:59 PM** | line 293-296: ahead at the pause start |
| Ana's deadline | Dec 8, 11:59 PM | **Dec 10, 11:59 PM** | line 299 |
| Written `payBy` | Dec 4, noon | **Dec 6, noon** | line 301-306: sent before the pause, so the whole 48 h |
| Written review date | Dec 8, 11:59 PM | **Dec 10, 11:59 PM** | `max(payBy, deadline)` |

**Dec 9:** the recording's review date = max(Dec 16 noon, Dec 10 11:59 PM) = **Dec 16, noon**.

**The test close, Dec 10, 11:59 PM:** `closeWorkIfDueIn` sets `workEndedAt` = Dec 10, 11:59 PM. Test close = **Dec 10**; unmoved close-out **Dec 24, 11:59 PM**. The team's pause (Nov 28-30) ended before the test close, so `windowEnd` ignores it from here on (it already moved the deadline).

**During Nora's hold, Dec 12-15:** the hold began after the work ended. Money is frozen (`moneyFrozen` = "hold").

- Recording: `payBy` still Dec 16, noon. Charge can't open (`MONEY_FREE`). Its closing date, looked at on Dec 14 noon, is Dec 30, noon, marked `paused` (the hold is an open span); the page shows "Waits while the test is paused".
- Ana's Rate: the recording was waiting at the hold's start (its review date Dec 16 was still ahead) → **hidden**: "You can rate once this test resumes."
- Ana's Rate end, looked at on Dec 14: about Dec 26, 11:59 PM and moving.

**At Nora's lift, Dec 15 noon** (`liftHoldIfClear` → `resumeTests` → `shiftAfterPause` on the closed test; `pausedSince` is empty on a closed test, so the stretch is the hold's 72 h):

| Date | Before | After | Why |
|---|---|---|---|
| Open until, Ana's deadline | Dec 3, Dec 10 | unchanged | test closed (lines 293, 299) |
| Written `payBy` | Dec 6, noon | unchanged | it has a review |
| Recording `payBy` | Dec 16, noon | **Dec 19, noon** | ahead at the hold start (line 305) |
| Recording `stintDueAt` | none | none | Ana's deadline Dec 10 was already behind the hold start (`shiftPieceDeadlines`) |
| Recording review date | Dec 16, noon | **Dec 19, noon** | |

Ana's Rate (Dec 15-18): disabled, "Rating opens on Dec 19, or sooner if Nora Lane reviews everything you sent."

**Ana's suspension, Dec 18-20:** no stored date moves (a tester-side suspension never calls `resumeTests`). Ana's Rate is hidden: "You can rate once your account is active again." On Dec 19 at noon the recording's review date passes and `openCharges` opens its Charge (`choiceOfferedAt` ≈ Dec 19, 12:05 PM). Ana doesn't get the Charge line while suspended (line 1931).

**Dec 20-21:** Ana's Rate: disabled, "Charge or let go of your unreviewed work first."

**Dec 21-23:** Ana charged, then disputed. Ana's Rate: disabled, "Rating opens once the team decides your dispute."

**Dec 23 onward:** Ana's Rate is open: "Rate until Dec 29".

### 12.3 The final dates

| Date | Function | Calculation | Result |
|---|---|---|---|
| Test close | `closeOutBase` | `workEndedAt` | **Dec 10, 11:59 PM** |
| Unmoved close-out | | + 14 days | Dec 24, 11:59 PM |
| **Ana's Rate closes** | `testerRatingClosesAt` | Dec 24 + hold 3 days + dispute 2 days. Her suspension doesn't count. | **Dec 29, 11:59 PM** |
| **Written answers: Pay more and Dispute close** | `pieceCloseOut` | `testEnd` = Dec 24 + hold 3 + her suspension 2 = Dec 29, 11:59 PM; `own` (review date Dec 10, 11:59 PM) is the same. The dispute doesn't count. | **Dec 29, 11:59 PM** |
| **Recording: Charge, Let it go, Pay, Pay more, Dispute close** | `pieceCloseOut` | `testEnd` = Dec 29, 11:59 PM. `own` = 14 days from Dec 19 noon, plus the part of her suspension after Dec 19 noon (1 day) = Jan 3, noon. Later wins. | **Jan 3, 2027, noon** |
| **Nora's Rate, Ana never rates** | `devRateStates` | opens at Ana's Rate end Dec 29, 11:59 PM (all settled Dec 21); `own` = +14 days; `byClose` = Dec 29 | **Dec 29 → Jan 12, 11:59 PM** |
| **Nora's Rate, Ana rates Dec 26 noon** | `devRateStates` | opens Dec 26, noon; `own` = Jan 9, noon; `byClose` = Dec 29 | **Dec 26 → Jan 9, noon**; Ana's stars show Jan 9 noon unless Nora rates first |

### 12.4 Before tonight's changes, for comparison

With `testSpans` / `closeOutOf` (removed tonight):

- The test-wide close-out ignored Nora's hold because it began after the work ended: **Dec 24**.
- Ana's Rate added `moneySpans`, her disputes **and** her suspension: Dec 24 + 3 + 2 + 2 = **Dec 31**.
- A never-rated tester's Nora Rate opened at the test-wide close-out, **Dec 24**.

Now: Ana's Rate ends **Dec 29**, and Nora's Rate opens when Ana's ends (**Dec 29**).

---

## Things that look off

Listed, not fixed. Each comes from reading the code; none was checked by running it.

1. **An outage during a post-close suspension may be counted twice in `payBy`.** `applyOutage` skips the tests "paused through" the outage so the pause's lift can count it inside its whole stretch ([`src/lib/server/outages.ts:333-342`](../src/lib/server/outages.ts#L333)). But `pausedThrough` ([`src/lib/server/outages.ts:310-315`](../src/lib/server/outages.ts#L310)) only looks at tests with status `open` or `closed`, and through `pauseSince` → `pauseCauses` ([`src/lib/pause.ts:28-36`](../src/lib/pause.ts#L28)) it only counts causes that began **before** the work ended. Since Dec 9, `shiftAfterPause` also moves `payBy` for a pause that began **after** the work ended ([`src/lib/server/holds.ts:277-280`](../src/lib/server/holds.ts#L277)). So for a developer suspension that began after the close, an outage during it moves `payBy` at once (lines 337 and 342), and the reinstatement then moves it again by the whole stretch (`reinstateAccount` passes the unmoved `devSuspendedAt` as the start, [`src/lib/server/restrictions.ts:246`](../src/lib/server/restrictions.ts#L246)). Holds seem to escape this on a closed test because the outage also moves `holdStartedAt` ([`src/lib/server/outages.ts:351`](../src/lib/server/outages.ts#L351)) and `pausedSince` is empty there. The same can happen on a **stopped** test (never in `pausedThrough`) for a hold or suspension that began during the work, because `pausedSince` survives the Stop when no team pause was on (`shiftAtStop` returns early, [`src/lib/server/holds.ts:326`](../src/lib/server/holds.ts#L326)) and `shiftAfterPause` takes the earlier of the cause's start and `pausedSince` (line 283-285). Worth a test.
2. **`choiceBy` is written and moved but never read as a date.** `openCharges` sets it to 7 days after Charge opens ([`src/lib/server/holds.ts:1607`](../src/lib/server/holds.ts#L1607)); `shiftAfterPause` and `applyOutage` keep moving it ([`src/lib/server/holds.ts:305`](../src/lib/server/holds.ts#L305), [`:311`](../src/lib/server/holds.ts#L311); [`src/lib/server/outages.ts:338`](../src/lib/server/outages.ts#L338)). The only reads check that it is not null ([`src/app/app/sessions/[id]/page.tsx:337`](../src/app/app/sessions/%5Bid%5D/page.tsx#L337), [`:651`](../src/app/app/sessions/%5Bid%5D/page.tsx#L651)). The real Charge deadline is `pieceCloseOut`.
3. **`closeOutMark` and `CLOSE_OUT_REMINDER_DAYS` are not used in `src/`.** `closeOutMark` ([`src/lib/server/holds.ts:1692`](../src/lib/server/holds.ts#L1692)) and `CLOSE_OUT_REMINDER_DAYS = [3, 1]` ([`src/lib/rules.ts:2082`](../src/lib/rules.ts#L2082), "The bell reminders before close-out") are only imported by `tests/batch17-close-out.test.ts`. The live countdown uses `CLOSE_SOON_MARKS = [30, 7, 3, 1]`.
4. **A call's review date and its automatic charge use different dates.** `chargeOpensAt` / `reviewDateOf` give a call the later of `payBy` and Ana's deadline. `testerRateState` uses that for waiting calls and names it in "Rating opens on …" ([`src/lib/server/ratings.ts:81`](../src/lib/server/ratings.ts#L81), [`:85-87`](../src/lib/server/ratings.ts#L85)), and `pieceCloseOut` counts a call's "own" 14 days from it ([`src/lib/server/closeOut.ts:206`](../src/lib/server/closeOut.ts#L206)). But a listed call is charged automatically at `payBy` alone (`autoChargeCalls`, [`src/lib/server/holds.ts:1997`](../src/lib/server/holds.ts#L1997); `callChargeAt`). Example: Ana's call Dec 1 ends at 10:30 AM, `payBy` Dec 8, her deadline Dec 10. Her Rate line says "Rating opens on Dec 10", but the call is charged Dec 8 and stops waiting then. Calls also have no Charge, so "14 days from Charge opening" means "14 days from the later of `payBy` and her deadline" for them.
5. **Ana's suspension hides her Rate but no longer extends it.** By tonight's rule. Consequence: a suspension that runs past her Rate end takes her Rate away for good. While she is still suspended after that date she reads "You can rate once your account is active again." because the suspension check ([`src/lib/server/ratings.ts:63`](../src/lib/server/ratings.ts#L63)) runs before the "Rating closed" check (line 67-68). Her suspension **does** still extend `pieceCloseOut`, so her Charge and Dispute (and Nora's Pay on those pieces) get the time back but her Rate doesn't. Worth confirming with the owner that this split is intended.
6. **A tester who sent nothing gets a misleading line for Nora.** With no parts and no calls, `opensAt` stays `null` forever ([`src/lib/server/ratings.ts:136`](../src/lib/server/ratings.ts#L136): `pieces.length > 0` is required). Once Ana's Rate time passes, Nora's hidden box reads "You can rate Ana once everything she sent is settled." ([`src/lib/rules.ts:1984`](../src/lib/rules.ts#L1984)), although it will never open. Only an old page's press shows it (the box is hidden).
7. **Two functions are both called `workEndOf`, and they disagree on a stopped test.** [`src/lib/server/workWindow.ts:14`](../src/lib/server/workWindow.ts#L14) returns `workEndedAt ?? workDeadlineOf(...)`, so for a stopped test it gives the deadline, not the Stop. [`src/lib/pause.ts:20`](../src/lib/pause.ts#L20) gives the Stop time. They're imported under the same name in different files (`requests.ts` and the session page use the first; `closeOut.ts` and `ratings.ts` the second).
8. **`callChargeAt` doesn't move the date while a pre-close freeze is still on after a Stop.** Line 232 ([`src/lib/server/closeOut.ts:232`](../src/lib/server/closeOut.ts#L232)) keeps only open freezes that began **after** the work ended. A hold that began during the work and is still on after a Stop leaves the returned date at the stored `payBy` (possibly in the past) until the lift moves `payBy`. `autoChargeCalls` waits anyway (frozen), and the session page shows "Waits while the test is paused", but any other reader of `callChargeAt` (Nora's test page, [`src/app/app/tests/[id]/page.tsx:163`](../src/app/app/tests/%5Bid%5D/page.tsx#L163); the 3-day and 1-day call reminders, which wait while frozen) would see the stale date.
9. **A missing "hold-lifted" event erases the whole hold from the spans.** `liftHoldIfClear` writes the `hold-lifted` account event after its transaction ([`src/lib/server/holds.ts:533`](../src/lib/server/holds.ts#L533)). If that write fails, `devPauseSpans` sees a `hold` with no lift and `holdStartedAt` already empty, and pushes no span for it ([`src/lib/server/closeOut.ts:54-64`](../src/lib/server/closeOut.ts#L54)). Every window would then forget the hold. Only on a failed write.

The team's-pause-after-a-Stop findings are in [SPANS-GUIDE.md → Things that look off](SPANS-GUIDE.md#things-that-look-off).
