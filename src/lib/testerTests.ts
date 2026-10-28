// (Owner, Oct 28, batch 16 section 15, clarified) A tester's profile, seen by a developer: "Your tests with <name>", every one of THIS developer's tests the
// tester joined, most recent first. Other developers' tests never show. Pure, so the page's filter box and the tests share it.

/** One row: the test (it opens the developer's test page), when the tester joined, their state there, and whether the test is still running. */
export type TesterTestRow = { id: string; title: string; joinedAt: string; state: "Working" | "Finished" | "Left" | "Ended"; open: boolean; href: string };

/** The tester's state on that test (never why it ended: a block, a suspension or an early end all read "Ended"). */
export function testerStateWord(c: { status: string; endKind: string }): TesterTestRow["state"] {
  if (c.status === "working") return "Working";
  if (c.endKind === "rated") return "Finished";
  if (c.status === "left") return "Left";
  return "Ended";
}

/** Open = the test is still running (taking testers, or joining closed with testers still working); Closed = stopped, ended or closed. */
export function testIsRunning(t: { status: string; openUntil: Date | null; contracts: { status: string; dueAt: Date }[] }, now = new Date()) {
  if (t.status !== "open") return false;
  if (!t.openUntil || t.openUntil.getTime() > now.getTime()) return true;
  return t.contracts.some((c) => c.status === "working" && c.dueAt.getTime() > now.getTime());
}

/** The Open / Closed ticks: both ticked (or both unticked) = all. */
export function filterTesterTests(rows: TesterTestRow[], open: boolean, closed: boolean) {
  if (open === closed) return rows;
  return rows.filter((r) => (open ? r.open : !r.open));
}

/** None yet: "Ana Silva hasn't been in any of your tests yet." */
export const noTestsWithLine = (name: string) => `${name} hasn't been in any of your tests yet.`;
