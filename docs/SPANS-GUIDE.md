# Spans: what pauses which deadline

A code-reading guide to the stretches of time ("spans") that pause Playtest's deadlines, the "is it paused right now?" checks, and an audit of every place that reads the team's pause (`adminPausedAt`).

Written against branch `b6-guides` at `948cfd27` (Dec 10 2026). Every statement below comes from the code at that commit. Links go to the file and line, like [`src/lib/server/closeOut.ts:120`](../src/lib/server/closeOut.ts#L120). Anything that looks wrong is in [Things that look off](#things-that-look-off). Nothing has been fixed.

**Nora** is the developer of "Harbor Run"; **Ana** is a tester on it. The companion guide [CLOSE-OUT-GUIDE.md](CLOSE-OUT-GUIDE.md) explains every deadline these spans move.

---

## Contents

1. [What a span is](#1-what-a-span-is)
2. [Each kind of span](#2-each-kind-of-span)
3. [Table: which span moves which deadline](#3-table-which-span-moves-which-deadline)
4. ["Frozen right now" checks versus spans](#4-frozen-right-now-checks-versus-spans)
5. [Audit: every read of `adminPausedAt`](#5-audit-every-read-of-adminpausedat)
6. [Worked examples, one per span kind](#6-worked-examples-one-per-span-kind)
7. [Things that look off](#things-that-look-off)

---

## 1. What a span is

[`src/lib/server/closeOut.ts:14`](../src/lib/server/closeOut.ts#L14)

```ts
export type Span = { start: number; end: number; open: boolean };
```

- `start` and `end` are times in milliseconds.
- `open: true` means the cause is **still on now**. Its `end` is set to "now" when the span is built, but `windowEnd` treats an open span as never ending (the deadline keeps moving forward with the clock).
- `open: false` means it ended at `end`.

### 1.1 `mergeSpans`

[`src/lib/server/closeOut.ts:17`](../src/lib/server/closeOut.ts#L17). Sorts by start; when one span starts at or before the previous one's end, the two become one (the later end, open if either is open). This is why overlapping causes count once: Nora's hold Dec 12-15 plus Ana's dispute Dec 14-16 pause a window for 4 days (Dec 12-16), not 5.

### 1.2 `windowEnd`

[`src/lib/server/closeOut.ts:30`](../src/lib/server/closeOut.ts#L30). "N days from `from`, not counting the spans." Three rules matter here:

- A span that ended before `from` is ignored (line 34).
- Only the part of a span after `from` counts (lines 35-41).
- An open span ends the loop: the result is `now + whatever is left` with `paused: true` (line 40).

Full walk-through in [CLOSE-OUT-GUIDE.md §2.2](CLOSE-OUT-GUIDE.md#22-windowend).

### 1.3 `lastLift`

[`src/lib/server/closeOut.ts:109`](../src/lib/server/closeOut.ts#L109)

```ts
export function lastLift(spans, now) {
  const ends = spans.filter((x) => !x.open && x.end <= now.getTime()).map((x) => x.end);
  return ends.length ? new Date(Math.max(...ends)) : null;
}
```

The end of the latest finished span, or `null`. Used only by reminders, to send one fresh line after a freeze lifts:

- Nora's Rate: `liftedAt` ([`src/lib/server/ratings.ts:149`](../src/lib/server/ratings.ts#L149)).
- Ana's Rate: `testerRateLiftedAt` ([`src/lib/server/closeOut.ts:181`](../src/lib/server/closeOut.ts#L181)).
- Pay now: `moneyLiftedAt` ([`src/lib/server/holds.ts:1848`](../src/lib/server/holds.ts#L1848)).
- Ana's Charge lines: `testerChargeLiftedAt` ([`src/lib/server/holds.ts:1863`](../src/lib/server/holds.ts#L1863)).

---

## 2. Each kind of span

### 2.1 `devPauseSpans`: Nora's holds and suspensions

[`src/lib/server/closeOut.ts:47`](../src/lib/server/closeOut.ts#L47)

Input: Nora's `AccountEvent` rows of kind `hold`, `hold-lifted`, `suspended`, `reinstated`, plus her current `holdStartedAt` and `devSuspendedAt`.

- **51.** Walk the events oldest first.
- **53.** A suspension event counts for Nora's developer side when its `side` is `"developer"` or `""` (old rows had no side).
- **54-57.** `hold` starts a hold (if none is open); `hold-lifted` closes it into a span.
- **58-62.** `suspended` (developer side) starts one; `reinstated` (developer side) closes it.
- **64.** A hold still on (`holdStartedAt` set): an **open** span from the earlier of the `hold` event and `holdStartedAt`. (Outages move `holdStartedAt` later, [`src/lib/server/outages.ts:351`](../src/lib/server/outages.ts#L351); taking the earlier keeps the real start.)
- **65.** The same for a suspension still on.
- **66.** Merged.

Where the events are written: hold start [`src/lib/server/holds.ts:142`](../src/lib/server/holds.ts#L142); hold lift [`src/lib/server/holds.ts:533`](../src/lib/server/holds.ts#L533); suspension [`src/lib/server/restrictions.ts:210`](../src/lib/server/restrictions.ts#L210); reinstatement [`src/lib/server/restrictions.ts:255`](../src/lib/server/restrictions.ts#L255).

**Not cut at the Stop or the close.** Since §386 a hold or suspension freezes the money whenever it runs, after the test closed or stopped too. The only cut is Nora's account deletion, done in `moneySpans` (2.6).

### 2.2 `teamPauseSpans`: the team's pause

[`src/lib/server/closeOut.ts:89`](../src/lib/server/closeOut.ts#L89)

```ts
export async function teamPauseSpans(testId, adminPausedAt, now, stoppedAt?) {
  if (adminPausedAt && stoppedAt) {                                                         // 90
    const spans = await teamPauseSpans(testId, adminPausedAt, stoppedAt);                   // 91
    return spans.map((s) => (s.open ? { start: s.start, end: Math.max(s.start, stoppedAt.getTime()), open: false } : s)); // 92
  }
  const evs = /* testEvent rows: kind "paused" with text "The team paused this test",
                 kind "resumed" with text "The team lifted the pause on this test", oldest first */; // 94
  const out = []; let on = null;
  for (const e of evs) {
    if (e.kind === "paused" && on == null) on = e.createdAt.getTime();                      // 98
    else if (e.kind === "resumed" && on != null) { out.push({ start: on, end: e.createdAt.getTime(), open: false }); on = null; } // 99-102
  }
  if (adminPausedAt) out.push({ start: Math.min(on ?? Infinity, adminPausedAt.getTime()), end: now.getTime(), open: true }); // 104
  return out;
}
```

- **94-103.** Past pauses come from the test's events, matched by their exact wording, paired "paused" → "resumed".
- **104.** A pause still recorded on the test (`adminPausedAt` set) is an **open** span.
- **90-92. The cut at the Stop.** When the caller passes `stoppedAt`, the function calls itself with `now = stoppedAt`, so the open span ends at the Stop, and then marks it closed. The pause stops counting at the Stop instead of running forever.

**Who passes the cut:**

- `moneySpans` ([`src/lib/server/closeOut.ts:124`](../src/lib/server/closeOut.ts#L124)) and `devRateStates` ([`src/lib/server/ratings.ts:123`](../src/lib/server/ratings.ts#L123)) pass `workEndOf(t) ?? now` for a stopped test. `workEndOf` here is the `pause.ts` one ([`src/lib/pause.ts:20`](../src/lib/pause.ts#L20)): `workEndedAt ?? pauseClosedAt ?? stoppedAt`. On a stopped test that is the Stop moment (or the 7-day closure moment).
- On a test that isn't stopped they pass `null`: a pause still on stays open.

**Why `adminPausedAt` is kept after a Stop.** None of the three Stops clears it: Nora's Stop writes only `status` and `stoppedAt` ([`src/lib/server/tests.ts:953`](../src/lib/server/tests.ts#L953)); the team's Stop adds `adminStoppedAt`, `adminNote`, `adminStoppedById` ([`src/lib/server/restrictions.ts:567`](../src/lib/server/restrictions.ts#L567)); the 7-day closure adds `pauseClosedAt` and its reason ([`src/lib/server/pauseClosure.ts:53`](../src/lib/server/pauseClosure.ts#L53)). Nothing can clear it later: `unpauseTest` refuses a stopped test ([`src/lib/server/restrictions.ts:500`](../src/lib/server/restrictions.ts#L500), [`:510`](../src/lib/server/restrictions.ts#L510)). The code then relies on it:

1. `shiftAtStop` reads it right after the Stop, in the same transaction, as the start of the paused stretch, and moves every unreviewed piece's `payBy` by "pause start → Stop" ([`src/lib/server/holds.ts:326-328`](../src/lib/server/holds.ts#L326)).
2. `teamPauseSpans` uses it as the open span's start (line 104), which the Stop then cuts (lines 90-92). So every window that counts the team's pause still counts "pause start → Stop".
3. The admin list shows a 7-day-closed test as "closed", not paused, using `pauseClosedAt` next to it ([`src/lib/server/adminLists.ts:372-374`](../src/lib/server/adminLists.ts#L372)).

The comments say it plainly: "a stopped test isn't paused any more (its kept adminPausedAt …)" ([`src/lib/server/holds.ts:41`](../src/lib/server/holds.ts#L41)); "a stopped test's kept adminPausedAt doesn't count" ([`src/lib/server/holds.ts:46`](../src/lib/server/holds.ts#L46)). So every reader that asks "is it paused **now**?" must ignore `adminPausedAt` on a stopped test. Section 5 checks each one.

### 2.3 `testerPauseSpans`: Ana's suspensions

[`src/lib/server/closeOut.ts:70`](../src/lib/server/closeOut.ts#L70)

- **74.** Only events whose `side` is `"tester"` or `""`.
- **75-79.** `suspended` → `reinstated` pairs become closed spans.
- **81.** Her suspension still on (`testerSuspendedAt`): an open span.

Where used:

- `pieceCloseOut` ([`src/lib/server/closeOut.ts:210`](../src/lib/server/closeOut.ts#L210)): Ana gets her suspension time back for Charge, Let it go and Dispute, and Nora's Pay and Pay more on those pieces close later with them.
- `testerRateLiftedAt` ([`src/lib/server/closeOut.ts:181`](../src/lib/server/closeOut.ts#L181)): her Rate reminder after a reinstatement.
- `testerChargeLiftedAt` ([`src/lib/server/holds.ts:1863`](../src/lib/server/holds.ts#L1863)): her Charge line after a reinstatement.

**Not** used by `testerRatingClosesAt` since tonight: her suspension no longer extends her Rate.

### 2.4 `disputeSpansOf`: Ana's disputes

[`src/lib/server/closeOut.ts:135`](../src/lib/server/closeOut.ts#L135)

```ts
rows.filter((d) => d.status !== "withdrawn").map((d) => ({
  start: d.createdAt.getTime(),
  end: Math.min((d.status === "open" ? now : d.decidedAt ?? d.createdAt).getTime(), now.getTime()),
  open: d.status === "open",
}));
```

- A withdrawn dispute never counts.
- An open one runs to now (open span).
- A decided one ends at `decidedAt`. A decided one with no `decidedAt` is zero length.

Used by Ana's Rate (`testerRatingClosesAt`, [`src/lib/server/closeOut.ts:152-153`](../src/lib/server/closeOut.ts#L152)) and Nora's Rate (`devRateStates`, [`src/lib/server/ratings.ts:132`](../src/lib/server/ratings.ts#L132), lines 134, 143, 144). **Not** by `pieceCloseOut`: an open dispute doesn't move any piece's closing date.

### 2.5 Outages

A row in `Outage` counts as a span only when it doesn't need approval, or it was approved:

```ts
OR: [{ needsApproval: false }, { approvedAt: { not: null } }]
```

([`src/lib/server/closeOut.ts:123`](../src/lib/server/closeOut.ts#L123), [`src/lib/server/ratings.ts:109`](../src/lib/server/ratings.ts#L109)).

- An outage over 24 hours is recorded with `needsApproval: true` ([`src/lib/server/outages.ts:82`](../src/lib/server/outages.ts#L82), [`:282`](../src/lib/server/outages.ts#L282)) and moves nothing until an admin approves it (`approveOutage`, [`src/lib/server/outages.ts:292`](../src/lib/server/outages.ts#L292), sets `approvedAt` then runs `applyOutage`).
- A gap the heartbeat found and an admin approves (`approveGap`, [`src/lib/server/outages.ts:144`](../src/lib/server/outages.ts#L144)) is saved approved at once if long.

Outages are counted two ways:

- **Stored dates are moved at once** by `applyOutage` ([`src/lib/server/outages.ts:330`](../src/lib/server/outages.ts#L330)): `payBy`, `choiceBy`, deadlines, Open until, `holdStartedAt`, the tester rating's 14-day clock. Tests "paused through" the outage are skipped; their lift counts it.
- **Computed windows** add them as spans through `moneySpans` (when `withOutages` is true) and in `devRateStates`.

### 2.6 `moneySpans`: the money freeze, after the close too

[`src/lib/server/closeOut.ts:120`](../src/lib/server/closeOut.ts#L120)

```ts
export async function moneySpans(t, from, now, withOutages = true) {
  const [devEvents, outages, team] = await Promise.all([
    /* Nora's hold / hold-lifted / suspended / reinstated events */,                           // 122
    /* outages ending after `from`, approved or not needing approval */,                       // 123
    teamPauseSpans(t.id, t.adminPausedAt, now, t.status === "stopped" ? workEndOf(t) ?? now : null), // 124
  ]);
  const gone = t.developer.deletedAt?.getTime();                                                // 127
  const upTo = (list) => (gone == null ? list : list.filter((x) => x.start < gone).map((x) => ({ start: x.start, end: Math.min(x.open ? gone : x.end, gone), open: false }))); // 128
  return mergeSpans([...upTo(devPauseSpans(devEvents, t.developer, now)), ...upTo(team), ...(withOutages ? outages : []).map(/* closed spans */)]); // 129
}
```

What it merges:

1. Nora's holds and developer-side suspensions, whenever they ran (before the close, after it, after a Stop).
2. The team's pause, cut at the Stop on a stopped test.
3. Outages (only when `withOutages` is true), only those that ended after `from`.

**The deletion cut (127-128).** If Nora deleted her account, any span that started after the deletion is dropped, and every span is closed at the deletion at the latest. A deleted account can never be reinstated or have its hold lifted, so the freeze ends there (§386 F). The same idea is in `moneyFrozen` ([`src/lib/restricted.ts:99`](../src/lib/restricted.ts#L99)). Outages are not cut.

**The `withOutages` flag.** `false` means "the freeze alone". Callers that pass `false`:

- `callChargeAt` ([`src/lib/server/closeOut.ts:232`](../src/lib/server/closeOut.ts#L232)): outages already moved the call's stored `payBy`, so counting them again would double them.
- `testerRateState` ([`src/lib/server/ratings.ts:79`](../src/lib/server/ratings.ts#L79)): to find when the current freeze began. An outage is no freeze.
- `testerRateLiftedAt` ([`src/lib/server/closeOut.ts:181`](../src/lib/server/closeOut.ts#L181)) and `moneyLiftedAt` ([`src/lib/server/holds.ts:1848`](../src/lib/server/holds.ts#L1848)): "when did the freeze lift". Outages don't hide anything.

Callers that pass `true` (the default): `pieceCloseOut`, `testerRatingClosesAt`, `devRateStates`.

---

## 3. Table: which span moves which deadline

"Moves" means the deadline ends later by the span's length (the part after the deadline's own start; overlaps once). "Stored, at the lift" means the date is written to the database when the cause lifts; a computed window then ignores that span (it ended before the window's start).

| Deadline (guide 1 section) | Nora's hold / suspension (`devPauseSpans`) | Team's pause (`teamPauseSpans`) | Ana's suspension (`testerPauseSpans`) | Ana's disputes (`disputeSpansOf`) | Outages |
|---|---|---|---|---|---|
| **Ana's working deadline, Open until** (§5) | Stored, at the last lift, only if it began during the work ([`holds.ts:293-299`](../src/lib/server/holds.ts#L293)). After the close: doesn't move. | Stored, at the lift ([`restrictions.ts:517`](../src/lib/server/restrictions.ts#L517)). At a Stop: doesn't move (contracts ended, Open until skipped on a stopped test, [`holds.ts:293`](../src/lib/server/holds.ts#L293)). | Doesn't move. | Doesn't move. | Stored, at once ([`outages.ts:355`](../src/lib/server/outages.ts#L355), [`:360`](../src/lib/server/outages.ts#L360)); a test paused through waits for the lift. |
| **`payBy`, the review clock** (§4.1, §5) | Stored, at the last lift, during or after the work ([`holds.ts:301-311`](../src/lib/server/holds.ts#L301)); only a `payBy` still ahead at the start. | Stored, at the lift, or at the Stop (`shiftAtStop`, [`holds.ts:324`](../src/lib/server/holds.ts#L324)). | Doesn't move. | Doesn't move. | Stored, at once ([`outages.ts:337`](../src/lib/server/outages.ts#L337), [`:342`](../src/lib/server/outages.ts#L342)); paused-through tests wait. |
| **Review date / Charge opening** (§4.2-4.3) | Through `payBy` (above) and the stamped `stintDueAt` ([`holds.ts:251`](../src/lib/server/holds.ts#L251)); Charge also waits while frozen (`MONEY_FREE`, [`holds.ts:1572`](../src/lib/server/holds.ts#L1572)). | Same; a stopped test isn't frozen. | Doesn't move (Charge opens; she just doesn't see it while suspended). | Doesn't move. | Through `payBy` / `stintDueAt`. |
| **Test close** (`closeOutBase`, §1.4) | Only through stored deadlines during the work. Never after. | Same. | No. | No. | Through stored deadlines. |
| **Each piece's closing date** (`pieceCloseOut`, §6): Pay, Pay more, Charge, Let it go, Dispute | **Moves**, whenever it ran; cut at Nora's deletion ([`closeOut.ts:210`](../src/lib/server/closeOut.ts#L210) via `moneySpans`). | **Moves** while in force; **cut at the Stop** ([`closeOut.ts:124`](../src/lib/server/closeOut.ts#L124)). | **Moves** ([`closeOut.ts:207-210`](../src/lib/server/closeOut.ts#L207)). | Doesn't move. | **Moves** ([`closeOut.ts:123`](../src/lib/server/closeOut.ts#L123)). |
| **Call automatic charge** (`callChargeAt`, §7) | Finished ones through `payBy`. One **still on that began after the work ended** moves it day by day ([`closeOut.ts:232`](../src/lib/server/closeOut.ts#L232)). The charge waits while frozen ([`holds.ts:2004`](../src/lib/server/holds.ts#L2004)). | Through `payBy` at the lift or Stop; waits while in force. | Doesn't move. | Doesn't move. | Through `payBy` only (`withOutages = false`). |
| **Ana's Rate closes** (`testerRatingClosesAt`, §8.1) | **Moves**, whenever; cut at deletion ([`closeOut.ts:153`](../src/lib/server/closeOut.ts#L153)). | **Moves**; cut at the Stop. | **Doesn't move** (tonight). Her Rate is hidden while suspended ([`ratings.ts:63`](../src/lib/server/ratings.ts#L63)). | **Moves** ([`closeOut.ts:152-153`](../src/lib/server/closeOut.ts#L152)). | **Moves**. |
| **Nora's Rate opens**, Ana never rated (`devRateStates`, §9) | Moves (it is Ana's Rate close, [`ratings.ts:134`](../src/lib/server/ratings.ts#L134), [`:136`](../src/lib/server/ratings.ts#L136)). | Moves; cut at the Stop. | Doesn't move. | Moves. | Moves. |
| **Nora's Rate opens**, Ana rated | Doesn't (her rating time / last settled). | Doesn't. | Doesn't. | Doesn't. | An outage while the rating's first 14 days run moves `Rating.createdAt` ([`outages.ts:363`](../src/lib/server/outages.ts#L363)). |
| **Nora's Rate ends**, "14 days after opening" part (`own`, [`ratings.ts:143`](../src/lib/server/ratings.ts#L143)) | **Moves** (no deletion cut here). | **Moves**; cut at the Stop ([`ratings.ts:123`](../src/lib/server/ratings.ts#L123)). | Doesn't. | **Moves**. | **Moves**, minus those already applied to Ana's rating ([`ratings.ts:142`](../src/lib/server/ratings.ts#L142)). |
| **Nora's Rate ends**, close-out part (`byClose`, [`ratings.ts:144`](../src/lib/server/ratings.ts#L144)) | **Moves**. | **Moves**; cut at the Stop. | Doesn't. | **Moves**. | **Moves**. |
| **Reveal of Ana's stars** (`revealAt`, [`ratings.ts:148`](../src/lib/server/ratings.ts#L148)) | Follows Nora's Rate end, capped at Ana's rating + 14 days when Nora's window opened late. | Same. | Same. | Same. | Same. |
| **7-day pause closure** (`pauseClosesAt`, [`pause.ts:53`](../src/lib/pause.ts#L53)) | Not a window: 7 days from `pausedSince` (the first cause), or a later date the team set. No span moves it. | Same. | No. | No. | Not moved. |

---

## 4. "Frozen right now" checks versus spans

Spans answer **"how long was it frozen between two dates?"** (history, for windows). The checks below answer **"is it paused right now?"** (for buttons, refusals and jobs).

| Check | What it answers | Stopped test with a kept `adminPausedAt` | Main callers |
|---|---|---|---|
| `teamPausedNow` [`src/lib/restricted.ts:66`](../src/lib/restricted.ts#L66) | Is the team's pause in force? `!!adminPausedAt && status !== "stopped"`. | **Not paused.** A closed test's pause would count, but see 5.9. | `moneyFrozen`; the developer's test route ([`src/app/api/tests/[id]/[action]/route.ts:107`](../src/app/api/tests/%5Bid%5D/%5Baction%5D/route.ts#L107)); `ndaOnlyEdit` ([`src/lib/ndaEditing.ts:7`](../src/lib/ndaEditing.ts#L7)); `dashboardNeeds` ([`src/lib/server/dashboardNeeds.ts:21`](../src/lib/server/dashboardNeeds.ts#L21)); `resumeTests` ([`src/lib/server/holds.ts:199`](../src/lib/server/holds.ts#L199)); chat ([`src/lib/server/messages.ts:43`](../src/lib/server/messages.ts#L43)); Nora's Rate ([`src/lib/server/ratings.ts:154`](../src/lib/server/ratings.ts#L154)). |
| `moneyFrozen` [`src/lib/restricted.ts:95`](../src/lib/restricted.ts#L95) | Can money move on this test now? Returns `"suspension"`, `"hold"`, `"team"` or `null`. A deleted developer: always `null`. | **Not frozen** by the team's pause (uses `teamPausedNow`). Still frozen by Nora's own hold or suspension. | Pay ([`src/lib/server/payments.ts:100`](../src/lib/server/payments.ts#L100)), Pay more ([`:762`](../src/lib/server/payments.ts#L762)) via `moneyFrozenRefusal` ([`:249`](../src/lib/server/payments.ts#L249)); Charge / Let it go via `testerFrozenRefusal` ([`:257`](../src/lib/server/payments.ts#L257), called at [`src/lib/server/holds.ts:2099`](../src/lib/server/holds.ts#L2099)) and `claimChoice` ([`src/lib/server/holds.ts:2196`](../src/lib/server/holds.ts#L2196)); Confirm with your bank ([`src/lib/server/confirm.ts:463`](../src/lib/server/confirm.ts#L463)); Confirm all ([`src/lib/server/confirmAll.ts:153`](../src/lib/server/confirmAll.ts#L153), [`:159`](../src/lib/server/confirmAll.ts#L159)); `autoChargeCalls` ([`src/lib/server/holds.ts:2004`](../src/lib/server/holds.ts#L2004)); bank check running out ([`src/lib/server/owedOnce.ts:435`](../src/lib/server/owedOnce.ts#L435)); Ana's Rate ([`src/lib/server/ratings.ts:78`](../src/lib/server/ratings.ts#L78)); "Waits while the test is paused" on both pages ([`src/app/app/sessions/[id]/page.tsx:225`](../src/app/app/sessions/%5Bid%5D/page.tsx#L225), [`:234`](../src/app/app/sessions/%5Bid%5D/page.tsx#L234); [`src/app/app/tests/[id]/page.tsx:204`](../src/app/app/tests/%5Bid%5D/page.tsx#L204)). |
| `MONEY_LIVE`, `MONEY_FREE`, `PAUSE_FREE` [`src/lib/server/holds.ts:43-53`](../src/lib/server/holds.ts#L43) | The same as `moneyFrozen`, written as database filters: `status: "stopped"` **or** `adminPausedAt: null`. | **Not frozen** by the team's pause. | Charge opening, reminders, automatic call charge (CLOSE-OUT-GUIDE §11). |
| `testPaused` [`src/lib/rules.ts:996`](../src/lib/rules.ts#L996) | Is the test paused for its testers? If the work ended on its own (`workEndedAt`) or by the 7-day closure (`pauseClosedAt`): any cause that began before that end. Otherwise: **any** cause (`holdStartedAt`, `devSuspendedAt`, `adminPausedAt`). | **Paused**: it has **no status check**. A Stop by Nora or the team sets neither `workEndedAt` nor `pauseClosedAt`, so a kept `adminPausedAt` reads as paused forever. (After the 7-day closure the pause began before `pauseClosedAt`, so also paused.) | See 5.6. |
| `testerPaused` [`src/lib/rules.ts:998`](../src/lib/rules.ts#L998) | Do the paused-test rules for testers apply (no sending)? Same as `testPaused`, with the team's pause counted only when `PAUSE_DEFAULTS.teamPauseSameRules` (true, [`src/lib/rules.ts:954`](../src/lib/rules.ts#L954)). | **Paused** (same reason). | Session page ([`src/app/app/sessions/[id]/page.tsx:231`](../src/app/app/sessions/%5Bid%5D/page.tsx#L231)); sending ([`src/lib/server/tests.ts:1381`](../src/lib/server/tests.ts#L1381)); draft uploads ([`src/app/api/sessions/[id]/[action]/route.ts:85`](../src/app/api/sessions/%5Bid%5D/%5Baction%5D/route.ts#L85)). |
| `pauseCauses` / `pauseSince` / `pauseClosesAt` [`src/lib/pause.ts:28`](../src/lib/pause.ts#L28), [`:42`](../src/lib/pause.ts#L42), [`:53`](../src/lib/pause.ts#L53) | Why it is paused, since when (the one clock), and when the 7-day closure hits. Only for `open` or `closed` tests; on a closed test only causes that began before the work ended. | **Not paused** (`[]` for a stopped test, line 29). | Nora's dashboard reasons; admin lists; the 7-day closure job ([`src/lib/server/pauseClosure.ts:88`](../src/lib/server/pauseClosure.ts#L88)); `pausedThrough` for outages ([`src/lib/server/outages.ts:310`](../src/lib/server/outages.ts#L310)). |
| `markPaused` / `pausedSince` [`src/lib/server/holds.ts:240`](../src/lib/server/holds.ts#L240) | Starts the one 7-day clock on **open** tests that have none. Cleared at the last lift ([`src/lib/server/holds.ts:203`](../src/lib/server/holds.ts#L203); [`src/lib/server/restrictions.ts:512`](../src/lib/server/restrictions.ts#L512)) and at a Stop during the team's pause ([`src/lib/server/holds.ts:329`](../src/lib/server/holds.ts#L329)). | Not set on a stopped or closed test. | Hold start ([`src/lib/server/holds.ts:156`](../src/lib/server/holds.ts#L156)); developer suspension ([`src/lib/server/restrictions.ts:212`](../src/lib/server/restrictions.ts#L212)); team pause ([`src/lib/server/restrictions.ts:457`](../src/lib/server/restrictions.ts#L457)). Read by `pauseSince` and `shiftAfterPause` (stretch start, [`src/lib/server/holds.ts:283`](../src/lib/server/holds.ts#L283)). |

---

## 5. Audit: every read of `adminPausedAt`

`grep -rn adminPausedAt src` finds **88 lines** in 32 files. They're grouped below by what they do. For each: what it decides, and whether a **stopped** test (whose `adminPausedAt` is kept on purpose, 2.2) could still be treated as paused there.

Verdicts:

- **Safe**: a stopped test is not treated as paused.
- **Intended**: it reads the kept value on purpose after a Stop.
- **History**: it describes a past moment, not "paused now".
- **LEAK**: a stopped test is treated or described as paused.

### 5.1 The span builders (intended)

| Line | What it decides | Verdict |
|---|---|---|
| [`src/lib/server/closeOut.ts:89`](../src/lib/server/closeOut.ts#L89), [`:90`](../src/lib/server/closeOut.ts#L90), [`:91`](../src/lib/server/closeOut.ts#L91), [`:104`](../src/lib/server/closeOut.ts#L104) | `teamPauseSpans`: the open span's start; cut at `stoppedAt` when given | Intended |
| [`src/lib/server/closeOut.ts:120`](../src/lib/server/closeOut.ts#L120) (type), [`:124`](../src/lib/server/closeOut.ts#L124) | `moneySpans` passes the Stop as the cut | Intended |
| [`src/lib/server/ratings.ts:123`](../src/lib/server/ratings.ts#L123) | Nora's Rate spans; the same cut (tonight) | Intended |
| [`src/lib/server/holds.ts:326`](../src/lib/server/holds.ts#L326), [`:328`](../src/lib/server/holds.ts#L328) | `shiftAtStop`: the stretch "team pause → Stop" moves `payBy` | Intended |

### 5.2 Guarded by `teamPausedNow` / `moneyFrozen` (safe)

| Line | What it decides | Verdict |
|---|---|---|
| [`src/lib/restricted.ts:66`](../src/lib/restricted.ts#L66) | `teamPausedNow` itself: `status !== "stopped"` | Safe |
| [`src/lib/restricted.ts:97`](../src/lib/restricted.ts#L97) | `moneyFrozen`'s parameter (uses `teamPausedNow`, line 102) | Safe |
| [`src/lib/ndaEditing.ts:6`](../src/lib/ndaEditing.ts#L6) | NDA-only editing (a stopped test is NDA-only anyway) | Safe |
| [`src/app/api/tests/[id]/[action]/route.ts:96`](../src/app/api/tests/%5Bid%5D/%5Baction%5D/route.ts#L96) | Nora's presses: team Stop first (101-102), then `teamPausedNow` (107) | Safe |
| [`src/lib/server/messages.ts:41`](../src/lib/server/messages.ts#L41) | Chat restriction (`teamPausedNow`, line 43) | Safe |
| [`src/lib/server/confirm.ts:462`](../src/lib/server/confirm.ts#L462) | Confirm with your bank refused while frozen | Safe |
| [`src/lib/server/confirmAll.ts:159`](../src/lib/server/confirmAll.ts#L159) | Confirm all refused while frozen | Safe |
| [`src/lib/server/owedOnce.ts:434`](../src/lib/server/owedOnce.ts#L434) | A bank check running out during a freeze waits instead of declining | Safe |
| [`src/lib/server/payments.ts:249`](../src/lib/server/payments.ts#L249), [`:257`](../src/lib/server/payments.ts#L257) | `moneyFrozenRefusal`, `testerFrozenRefusal` | Safe |
| [`src/lib/server/holds.ts:2003`](../src/lib/server/holds.ts#L2003) | `autoChargeCalls` re-check | Safe |
| [`src/lib/server/holds.ts:2195`](../src/lib/server/holds.ts#L2195) | `claimChoice` re-check under the lock | Safe |
| [`src/lib/server/holds.ts:199`](../src/lib/server/holds.ts#L199) | `resumeTests`: the team's pause is "still on" only if in force (Dec 9) | Safe |
| [`src/app/app/tests/[id]/page.tsx:155`](../src/app/app/tests/%5Bid%5D/page.tsx#L155) | Nora's restricted view: `adminPausedAt && status !== "stopped"` | Safe |

### 5.3 Guarded by a status filter in the query or just before (safe)

| Line | What it decides | Verdict |
|---|---|---|
| [`src/lib/server/holds.ts:43`](../src/lib/server/holds.ts#L43), [`:51`](../src/lib/server/holds.ts#L51), [`:53`](../src/lib/server/holds.ts#L53) | `PAUSE_FREE`, `MONEY_LIVE`, `MONEY_FREE`: `status: "stopped"` or no pause | Safe |
| [`src/lib/server/holds.ts:172`](../src/lib/server/holds.ts#L172) | Hold start: which testers to tell "paused" (tests listed are `open` / `draft` only, line 161) | Safe |
| [`src/lib/server/holds.ts:215`](../src/lib/server/holds.ts#L215) | "A test the team paused stays paused" line: `status: { not: "stopped" }` | Safe |
| [`src/lib/server/holds.ts:378`](../src/lib/server/holds.ts#L378) | Waiting charges held back for team-paused tests: excludes stopped | Safe |
| [`src/lib/server/holds.ts:1504`](../src/lib/server/holds.ts#L1504) | Invite reminders wait while paused (line 1503 already skips a test that isn't open) | Safe |
| [`src/lib/server/restrictions.ts:62`](../src/lib/server/restrictions.ts#L62) | Calls cancelled 3 days ahead during the team's pause: excludes stopped | Safe |
| [`src/lib/server/restrictions.ts:215`](../src/lib/server/restrictions.ts#L215) | Suspension: testers told "paused" (`status: "open"`) | Safe |
| [`src/lib/server/restrictions.ts:453`](../src/lib/server/restrictions.ts#L453), [`:464`](../src/lib/server/restrictions.ts#L464) | Pause refused when already paused (after the stopped and closed refusals) | Safe |
| [`src/lib/server/restrictions.ts:500`](../src/lib/server/restrictions.ts#L500), [`:503`](../src/lib/server/restrictions.ts#L503), [`:510`](../src/lib/server/restrictions.ts#L510) | Lift the pause: refused on a stopped test (this is why it's never cleared) | Safe (by design) |
| [`src/lib/server/adminRace.ts:202`](../src/lib/server/adminRace.ts#L202), [`:203`](../src/lib/server/adminRace.ts#L203) | "That test was already paused …" (only reached after the stopped check) | Safe |
| [`src/lib/server/adminDaily.ts:63`](../src/lib/server/adminDaily.ts#L63), [`:83`](../src/lib/server/adminDaily.ts#L83) | Admin's daily "You paused …": `status: open / closed` | Safe |
| [`src/lib/server/adminLists.ts:236`](../src/lib/server/adminLists.ts#L236), [`:384`](../src/lib/server/adminLists.ts#L384), [`:408`](../src/lib/server/adminLists.ts#L408), [`:417`](../src/lib/server/adminLists.ts#L417) | Admin: "still paused", the Lift button, the Paused tick, "Tests you paused": all exclude stopped | Safe |
| [`src/lib/server/adminLists.ts:404`](../src/lib/server/adminLists.ts#L404) | Admin ticks Open / Joining closed / Draft: only `open` / `closed` / `draft` tests | Safe |
| [`src/lib/server/outages.ts:312`](../src/lib/server/outages.ts#L312) | `pausedThrough`: `open` / `closed` only (but see CLOSE-OUT-GUIDE "looks off" 1) | Safe |
| [`src/lib/server/pauseClosure.ts:90`](../src/lib/server/pauseClosure.ts#L90), [`:129`](../src/lib/server/pauseClosure.ts#L129) | The 7-day closure job and its admin list: `open` / `closed` | Safe |
| [`src/lib/server/tests.ts:1088`](../src/lib/server/tests.ts#L1088) | Find: `status: "open"` | Safe |
| [`src/lib/server/tests.ts:1813`](../src/lib/server/tests.ts#L1813) | Joining closes after Open until: `status: "open"` | Safe |
| [`src/lib/server/workWindow.ts:102`](../src/lib/server/workWindow.ts#L102) | Natural close job: `open` / `closed` | Safe |
| [`src/lib/server/profileOpenTests.ts:58`](../src/lib/server/profileOpenTests.ts#L58) | Profile's open tests: `open` / `closed` | Safe |
| [`src/lib/pause.ts:34`](../src/lib/pause.ts#L34), [`:44`](../src/lib/pause.ts#L44) | `pauseCauses` / `pauseSince`: `[]` unless `open` / `closed` (line 29) | Safe |
| [`src/app/app/page.tsx:319`](../src/app/app/page.tsx#L319) | Nora's test cards: the card checks `status === "stopped"` before `paused` ([`:329`](../src/app/app/page.tsx#L329), [`:338`](../src/app/app/page.tsx#L338)) | Safe |
| [`src/app/app/tests/[id]/page.tsx:691`](../src/app/app/tests/%5Bid%5D/page.tsx#L691) | Top panel's Paused badge: shown only when `status !== "stopped"` ([`TopPanel.tsx:135`](../src/app/app/tests/%5Bid%5D/TopPanel.tsx#L135)) | Safe |

### 5.4 History and moments (not "paused now")

| Line | What it decides | Verdict |
|---|---|---|
| [`src/lib/server/bankPeek.ts:219`](../src/lib/server/bankPeek.ts#L219), [`:220`](../src/lib/server/bankPeek.ts#L220) | Why a bank check was cancelled: "the team paused this test" when the pause began after the press | History (true) |
| [`src/lib/server/stopMoment.ts:57`](../src/lib/server/stopMoment.ts#L57), [`:59`](../src/lib/server/stopMoment.ts#L59) | Nora's page: a pause that began after the page loaded stops the next press once | History (a real moment) |
| [`src/lib/server/stopMoment.ts:113`](../src/lib/server/stopMoment.ts#L113), [`:115`](../src/lib/server/stopMoment.ts#L115) | Ana's page: the same | History |
| [`src/lib/server/adminLists.ts:230`](../src/lib/server/adminLists.ts#L230) | The admin's own "things I did" list: "paused by you" (also on a stopped test, as history) | History |
| [`src/lib/server/adminLists.ts:371`](../src/lib/server/adminLists.ts#L371) | "lifted by …" text, only when `adminPausedAt` is empty | History |
| [`src/lib/server/adminLists.ts:857`](../src/lib/server/adminLists.ts#L857) | The test's event history: is this "paused" event the current pause (for its reason) | History |

### 5.5 Fingerprints and types only (no decision)

| Line | What it is |
|---|---|
| [`src/lib/server/pulseV.ts:126`](../src/lib/server/pulseV.ts#L126) | Page-freshness fingerprint (a change redraws the page) |
| [`src/lib/server/pageFreshness.ts:99`](../src/lib/server/pageFreshness.ts#L99), [`:113`](../src/lib/server/pageFreshness.ts#L113) | Dashboard fingerprint |
| [`src/lib/pause.ts:11`](../src/lib/pause.ts#L11), [`src/lib/dashboardPanels.ts:22`](../src/lib/dashboardPanels.ts#L22), [`src/lib/findSearch.ts:30`](../src/lib/findSearch.ts#L30), [`src/lib/server/profileOpenTests.ts:9`](../src/lib/server/profileOpenTests.ts#L9), [`src/lib/rules.ts:998`](../src/lib/rules.ts#L998), [`src/lib/server/tests.ts:1379`](../src/lib/server/tests.ts#L1379), [`src/lib/server/calls.ts:158`](../src/lib/server/calls.ts#L158) | Parameter types (the decisions are in the functions they feed, 5.6) |
| [`src/lib/rules.ts:225`](../src/lib/rules.ts#L225) | `testerRefusal`'s parameter type; the function never reads it |
| [`src/lib/server/restrictions.ts:465`](../src/lib/server/restrictions.ts#L465), [`:512`](../src/lib/server/restrictions.ts#L512) | Writes: set by Pause, cleared by Lift |
| [`src/lib/server/holds.ts:41`](../src/lib/server/holds.ts#L41), [`:46`](../src/lib/server/holds.ts#L46), [`src/lib/server/adminLists.ts:372`](../src/lib/server/adminLists.ts#L372) | Comments |

### 5.6 Through `testPaused` / `testerPaused` (no status check)

[`src/lib/rules.ts:996`](../src/lib/rules.ts#L996), [`:1000`](../src/lib/rules.ts#L1000), [`:1001`](../src/lib/rules.ts#L1001) read `adminPausedAt` with no status check (4, table). Every caller:

| Caller | What it decides | Stopped test | Verdict |
|---|---|---|---|
| [`src/app/app/find/[id]/page.tsx:97`](../src/app/app/find/%5Bid%5D/page.tsx#L97) (used at 104, 115, 284) | The test's page in Find: someone not involved reads "This test isn't available right now."; someone involved reads "This test is paused right now." | `paused` is checked **before** `status === "stopped"` (line 284 before 286) | **LEAK**: a stopped test shows "This test is paused right now." instead of "This test was stopped." |
| [`src/app/app/page.tsx:421`](../src/app/app/page.tsx#L421) (used at 465, 486, 506, 524, 574) | Ana's dashboard: a "Paused" tag on rows in Charge or cancel (465), Waiting for review (506) and waiting calls (524) | Those rows stay after a Stop (work still reviewed and paid) | **LEAK**: a stopped test's rows carry "Paused", while Charge actually works there (`moneyFrozen` is null). Rows at 486 (applications) and 574 (invites) can't appear (a Stop closes them). |
| [`src/lib/server/calls.ts:161`](../src/lib/server/calls.ts#L161) (`callClosedKindOf`) and [`src/lib/server/blocks.ts:257`](../src/lib/server/blocks.ts#L257) (`joinCallRefusal`) | Why a call can't be joined / why it ended | `callClosedKind` and `joinCallRefusal` check `paused` before `stopped` ([`src/lib/rules.ts:2164-2165`](../src/lib/rules.ts#L2164), [`:1893-1894`](../src/lib/rules.ts#L1893)) | **LEAK** (narrow): "This test is paused." instead of "This test was stopped." Calls ahead are cancelled by the Stop, so this needs a call in progress at the Stop, or an already-cancelled call (which reads "This call was cancelled." first). |
| [`src/lib/server/payments.ts:624`](../src/lib/server/payments.ts#L624) | Ana's "Your dispute … was decided" email adds "Payment may be delayed until the test resumes." | Reached when the decided payment is delayed (bank asks to confirm, card declined, or Nora's hold) | **LEAK**: says "until the test resumes" for a stopped test that never resumes. |
| [`src/lib/server/requests.ts:536`](../src/lib/server/requests.ts#L536) (`pausedRefusal`), called by Accept at [`:966`](../src/lib/server/requests.ts#L966) | Accept on a call request refused while paused | In `answerRequest`, line 966 runs **before** `refusals()` (977), which is where the stopped check lives (541) | **LEAK**: an Accept pressed on an old page after a Stop reads "This test is paused right now, so your Accept didn't go through." (Ana) or the team-pause line (Nora) instead of the stopped line. The Stop closed the request, so this is the old-page press. Through `refusals()` (545) it is safe: 541 checks stopped first. |
| [`src/lib/server/requests.ts:1147`](../src/lib/server/requests.ts#L1147) | Repeating call sets skip a paused test | Line 1143 ends the set on a stopped test first | Safe |
| [`src/lib/server/tests.ts:1178`](../src/lib/server/tests.ts#L1178) | Developer's Accept of an application / invite: refused while paused | The Stop closed applications and invites; the application claim refuses first (1164-1167) | Safe (masked) |
| [`src/lib/server/tests.ts:1381`](../src/lib/server/tests.ts#L1381) (`softRefusals`, uses `testerPaused`) | Send / Add refused while paused | A Stop ends Ana's contract; the step before (1374) refuses a contract that isn't working | Safe (masked) |
| [`src/app/app/sessions/[id]/page.tsx:227`](../src/app/app/sessions/%5Bid%5D/page.tsx#L227), [`:231`](../src/app/app/sessions/%5Bid%5D/page.tsx#L231) | Ana's session page: paused banner, Join call, Request a time, Send | The banner needs `!refusal` (379); calls and requests need `!refusal` (248, 323); Ana's ended contract has a refusal | Safe (masked by `refusal`) |
| [`src/app/api/sessions/[id]/[action]/route.ts:84-85`](../src/app/api/sessions/%5Bid%5D/%5Baction%5D/route.ts#L84) | Draft recording upload steps refused while paused | Only runs when `PAUSE_DEFAULTS.draftsEditable` is false (it is true, line 83 returns) | Inactive |
| [`src/lib/findSearch.ts:38`](../src/lib/findSearch.ts#L38) | Admin card state | `stopped` / `closed` returned first (35-37) | Safe |
| [`src/lib/server/joining.ts:100`](../src/lib/server/joining.ts#L100) | Join page line | `stopped` returned first (94) | Safe |
| [`src/lib/server/profileOpenTests.ts:29-30`](../src/lib/server/profileOpenTests.ts#L29), [`:59`](../src/lib/server/profileOpenTests.ts#L59) | Profile lines and list | `stopped` returned first (28); the list is `open` / `closed` only | Safe |
| [`src/lib/server/testVisits.ts:55`](../src/lib/server/testVisits.ts#L55) | "Recently viewed" state | Query is `status: "open"` (41) | Safe |
| [`src/lib/server/workWindow.ts:25`](../src/lib/server/workWindow.ts#L25), [`:31`](../src/lib/server/workWindow.ts#L31), [`:55`](../src/lib/server/workWindow.ts#L55) | "The test ended" refusal; the natural close | 31 and 55 return on `stopped` first. 25 is reached only after callers' own stopped checks (e.g. `requests.ts:546`) | Safe |

These leaks also show while a stopped test's developer is still on a hold or suspension (`testPaused` reads those too). Then the money is frozen, so "paused" is closer to the truth, but the line still says "paused" rather than "stopped".

### 5.7 Admin state line

| Line | What it decides | Verdict |
|---|---|---|
| [`src/lib/server/adminLists.ts:374`](../src/lib/server/adminLists.ts#L374) | The test's state in the admin's test list: `adminStoppedAt` → "stopped by …"; `pauseClosedAt` → "closed"; else `adminPausedAt` → "paused by …" | **LEAK**: a test **Nora** stopped during the team's pause has neither `adminStoppedAt` nor `pauseClosedAt`, so it reads "paused by <admin>". (The same row's `adminPaused` flag, line 384, is correct.) |

### 5.8 Summary

- **88 lines** read or write `adminPausedAt`.
- **Leaks after a Stop: 6 places**, all wording or display, none moving money or dates:
  1. Find page "This test is paused right now." ([`src/app/app/find/[id]/page.tsx:284`](../src/app/app/find/%5Bid%5D/page.tsx#L284)).
  2. Ana's dashboard "Paused" tag ([`src/app/app/page.tsx:421`](../src/app/app/page.tsx#L421)).
  3. The call lines "This test is paused." ([`src/lib/server/calls.ts:161`](../src/lib/server/calls.ts#L161), [`src/lib/server/blocks.ts:257`](../src/lib/server/blocks.ts#L257)).
  4. The dispute-decided email "…until the test resumes." ([`src/lib/server/payments.ts:624`](../src/lib/server/payments.ts#L624)).
  5. Accept on a call request ([`src/lib/server/requests.ts:966`](../src/lib/server/requests.ts#L966)).
  6. The admin list's "paused by …" for a developer-stopped test ([`src/lib/server/adminLists.ts:374`](../src/lib/server/adminLists.ts#L374)).
  
  The first five share one cause: `testPaused` / `testerPaused` have no status check.
- **No money or date leak.** Everything that freezes money or moves a date goes through `teamPausedNow`, `moneyFrozen`, the `MONEY_*` filters, or a status-filtered query, or cuts the span at the Stop.

### 5.9 After a natural close (§386)

`teamPausedNow` is true for a **closed** test with `adminPausedAt` set (it only excludes `stopped`). So `moneyFrozen`, the `MONEY_*` filters, `pausedThrough`, the 7-day closure job, `pauseCauses` (when the pause began before the close) and `testPaused` would all treat a team pause on a test that closed on its own as still in force: money frozen, both Rate windows stretched (`moneySpans` passes no cut for a test that isn't stopped).

The code has no path that creates that state today:

- `pauseTest` refuses a closed test ([`src/lib/server/restrictions.ts:452`](../src/lib/server/restrictions.ts#L452), [`:463`](../src/lib/server/restrictions.ts#L463), "This test's work has ended, so it can't be paused.").
- A team-paused test never closes on its own: `finishWorkIfDue` and `closeWorkIfDueIn` return when `testPaused` ([`src/lib/server/workWindow.ts:31`](../src/lib/server/workWindow.ts#L31), [`:55`](../src/lib/server/workWindow.ts#L55)), and the job skips tests with `adminPausedAt` ([`:102`](../src/lib/server/workWindow.ts#L102)). It closes only through a Stop or the 7-day closure, both `stopped`.

So after a natural close, **only Nora's own hold or suspension** can freeze the money and stretch the Rate windows. That is reachable: holds and suspensions can start any time. The `closed` + team-pause branch is kept but unreachable.

---

## 6. Worked examples, one per span kind

"Harbor Run" closes on its own on **Dec 10, 11:59 PM** (Ana's deadline). Unmoved close-out: **Dec 24, 11:59 PM**. Ana sent a recording on Dec 9 at noon (`payBy` Dec 16 noon). Each example changes one thing.

### 6.1 Nora's hold after the close (`devPauseSpans`)

Nora's card is declined on Dec 12 at noon; she pays what she owes Dec 15 at noon.

- Account events: `hold` Dec 12 noon, `hold-lifted` Dec 15 noon → span **[Dec 12 noon, Dec 15 noon]**.
- While on (say Dec 13): `holdStartedAt` set → open span from Dec 12 noon. `moneyFrozen` = "hold". Pay, Charge, Confirm are refused; Ana's Charge line and Nora's Pay now line wait; every closing date reads "Waits while the test is paused".
- At the lift: `resumeTests` → `shiftAfterPause` on the closed test moves the recording's `payBy` from Dec 16 noon to **Dec 19 noon** (Dec 9 because of the Dec 9 rule). Its Charge opens Dec 19 instead of Dec 16.
- Windows from Dec 10, 11:59 PM: Ana's Rate → **Dec 27**; every piece's `testEnd` → **Dec 27**; the recording's own 14 days from Dec 19 noon → **Jan 2, noon**.
- Before tonight, Ana's Rate would have stayed at Dec 24: `testSpans` dropped a hold that began after the work ended.

### 6.2 The team's pause, then Nora's Stop (`teamPauseSpans`, the cut)

A different week: the team pauses "Harbor Run" on Dec 3 at noon while Ana is still working (deadline Dec 10). Ana's written answers were sent Dec 1 at noon (`payBy` Dec 8 noon). On Dec 5 at noon Nora presses Stop. The team never lifts its pause (it can't now: Lift is refused on a stopped test).

- After the Stop: `status: "stopped"`, `stoppedAt` Dec 5 noon, `adminPausedAt` **still Dec 3 noon**.
- `shiftAtStop` (inside the Stop): the stretch Dec 3 noon → Dec 5 noon (48 h). `payBy` Dec 8 noon → **Dec 10 noon**. Ana's contract has ended, so `shiftPieceDeadlines` stamps `stintDueAt` = her deadline Dec 10, 11:59 PM + 48 h → **Dec 12, 11:59 PM**. The piece's review date = max(Dec 10 noon, Dec 12 11:59 PM) = **Dec 12, 11:59 PM**. `pausedSince` is cleared.
- Test close: `closeOutBase` for the stopped test = max(Stop Dec 5 noon, every `dueAt`) = **Dec 10, 11:59 PM** (the contract's own `dueAt` didn't move: the stamp is on the piece).
- `teamPauseSpans(…, stoppedAt = Dec 5 noon)` = **[Dec 3 noon, Dec 5 noon], closed**. It ends before the test close, so no window from Dec 10 counts it again. Without the cut it would be an open span forever and every window would read `paused: true` and never end.
- `teamPausedNow` = false, `moneyFrozen` = null: Pay and Charge work after the Stop. But `testPaused` = true, so Ana's dashboard tags the written answers "Paused" and the Find page says "This test is paused right now." (5.6).

### 6.3 Ana's suspension (`testerPauseSpans`)

Ana's tester side is suspended Dec 18 noon → reinstated Dec 20 noon. Account events with `side: "tester"` → span **[Dec 18 noon, Dec 20 noon]**.

- `pieceCloseOut` for each of Ana's pieces: + 2 days. The written answers (review date Dec 10) close **Dec 26, 11:59 PM** instead of Dec 24. For the recording (review date Dec 16 noon, own 14 days → Dec 30 noon) the whole suspension falls after its review date: **Jan 1, noon**.
- Ana's Rate: **still Dec 24** (tonight's rule). From Dec 18 to Dec 20 her Rate box is hidden ("You can rate once your account is active again.").
- Nora's Pay and Pay more on those pieces close later with them (one date per piece).
- No stored date moves: reinstating a tester side doesn't call `resumeTests` ([`src/lib/server/restrictions.ts:256`](../src/lib/server/restrictions.ts#L256) only for the developer side).

### 6.4 Ana's dispute (`disputeSpansOf`)

Nora paid $5 of the $10 written answers. Ana disputes on Dec 21 at noon; the team decides Dec 23 at noon.

- While open: an open span from Dec 21 noon. Ana's Rate is disabled ("Rating opens once the team decides your dispute."); Nora's Rate, if open, is disabled ("Rating opens once the team decides Ana's dispute.").
- Decided: span **[Dec 21 noon, Dec 23 noon]**. Ana's Rate → **Dec 26, 11:59 PM**. Nora's window (both parts) moves by the part after its own start.
- The written answers' closing date (Pay more, Dispute) **doesn't move**: Dec 24.
- If Ana had **withdrawn** it, it would count for nothing.

### 6.5 An outage (`Outage` rows)

The site is down Dec 22 from 1:00 AM to 3:00 AM (2 hours, under 24 hours: applied at once).

- `applyOutage` moves every unreviewed `payBy` after 1:00 AM Dec 22 by 2 hours (unless the test is paused through it), `choiceBy`, working deadlines, Open until of open tests, Nora's `holdStartedAt`, and the 14-day clock of any unrevealed tester rating.
- Windows: Ana's Rate, every piece's `testEnd`, Nora's Rate: each + 2 hours, e.g. **Dec 25, 1:59 AM** instead of Dec 24, 11:59 PM.
- A 30-hour outage would wait for an admin's approval and move nothing until then. `moneySpans` and `devRateStates` ignore it until approved.

### 6.6 Nora deletes her account while suspended (the deletion cut in `moneySpans`)

Nora's developer side is suspended Dec 12 noon and never reinstated. She deletes her account Dec 16 noon.

- Before the deletion: an open span from Dec 12 noon; every window is `paused`.
- After: `moneySpans` closes it at **Dec 16 noon** ([`src/lib/server/closeOut.ts:127-128`](../src/lib/server/closeOut.ts#L127)). `moneyFrozen` returns `null` (deleted). Ana's Rate → Dec 24 + 4 days = **Dec 28, 11:59 PM**. Pieces whose Charge was already open stay open and are charged to Nora's saved card; work still under review never opens Charge (`MONEY_FREE` requires `deletedAt: null`).
- `devPauseSpans` as used directly by `devRateStates` (line 123) has no deletion cut, but a deleted developer's Rate is hidden anyway ([`src/lib/server/ratings.ts:150`](../src/lib/server/ratings.ts#L150)).

---

## Things that look off

Listed, not fixed. From reading the code only.

1. **`testPaused` and `testerPaused` have no status check, so a stopped test with its kept team pause reads as paused.** [`src/lib/rules.ts:996`](../src/lib/rules.ts#L996), [`:998-1001`](../src/lib/rules.ts#L998). A Stop by Nora or the team sets neither `workEndedAt` nor `pauseClosedAt`, so the "any cause" branch reads `adminPausedAt` (kept on purpose). This causes five display or wording leaks (5.6): the Find page, Ana's dashboard tag, the call lines, the dispute-decided email, and Accept on a call request. Money and dates are not affected.
2. **The admin test list says "paused by …" for a test Nora stopped during the team's pause.** [`src/lib/server/adminLists.ts:374`](../src/lib/server/adminLists.ts#L374) checks `adminStoppedAt` and `pauseClosedAt`, but not `status === "stopped"`, before `adminPausedAt`.
3. **`teamPauseSpans` finds past pauses by exact event wording.** [`src/lib/server/closeOut.ts:94`](../src/lib/server/closeOut.ts#L94) matches `"The team paused this test"` and `"The team lifted the pause on this test"`. If either event's text ever changes (or is translated), every past team pause silently disappears from every window. A pause still on is safe (it comes from `adminPausedAt`).
4. **The `closed` + team-pause branch (§386) is unreachable.** `teamPausedNow` and everything built on it treat a closed test's team pause as in force, but `pauseTest` refuses closed tests and a team-paused test can't close on its own (5.9). Not wrong; worth knowing when planning tests ("after the close" freezes can only be Nora's hold or suspension).
5. **`devRateStates` builds Nora's own spans without the deletion cut** ([`src/lib/server/ratings.ts:123`](../src/lib/server/ratings.ts#L123)), while `byClose` (line 144) merges the cut `money` spans with the same uncut spans. It has no visible effect today: a deleted developer's Rate is hidden (line 150). Two copies of "Nora's spans" with different rules.
6. **Outage double count after the close.** See [CLOSE-OUT-GUIDE.md "Things that look off" 1](CLOSE-OUT-GUIDE.md#things-that-look-off): `pausedThrough` ([`src/lib/server/outages.ts:310`](../src/lib/server/outages.ts#L310)) doesn't know about pauses that began after the work ended or on stopped tests, but `shiftAfterPause` now moves `payBy` for them.
7. **A failed "hold-lifted" write erases the hold from every span list.** See [CLOSE-OUT-GUIDE.md "Things that look off" 9](CLOSE-OUT-GUIDE.md#things-that-look-off).
