# Codex tasks (paste one prompt per Codex task)

Each prompt assumes Codex has read `AGENTS.md` (it does so automatically). Give each task its own number N (codex1, codex2, …):
it names the worktree's test schema and build folder so tasks never collide.

## Task 1: the stale "Not sent yet" chip after Keep

```
Read AGENTS.md first and follow it. Task number: 1 (schema codex1, build folder .next-codex1, branch codex/not-sent-chip,
worktree C:/Users/march/Projects/pl-codex-1).

Bug (owner, Oct 29): after a developer changes a test's terms and the tester presses Keep (keeping their current deal), a
"Not sent yet" chip/badge for a part can stay on screen although nothing about that part changed, until the page is reloaded.
Search src/ for "Not sent yet" and the new-terms Switch / Keep flow (the tester's session page, and the developer's Edit and test
pages) to find where the chip is drawn and what state it reads after Keep.

1. Reproduce it in a test first (vitest, tests/codex1-not-sent-chip.test.ts). If you can't reproduce it, stop and report what you
   checked; don't change code on a guess.
2. Fix it so the chip always matches the tester's current deal right after Keep (and after Switch), with no reload.
3. npm run check green with the schema and build folder above. Commit on the branch; don't push or merge.
```

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
