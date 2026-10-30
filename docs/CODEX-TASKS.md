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
