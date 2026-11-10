/**
 * (Owner, Nov 10, §369, as reviewed) "The result must never depend on timing." A tester's press that checks before the test's lock and writes under it notes
 * what it saw at its first look (the questions by their words, the saved part's time, what was paid on it). Under the lock, if that moved (questions first),
 * nothing is written: the transaction throws Moved and rolls back, and after it (the lock released) the press gives the normal stop-once box for what moved, as
 * a press made a moment later would, never a "meanwhile" refusal. The refusals that are final whatever the timing (paid / locked, a window closed, a cap) stay.
 */

/** What the press saw before the lock moved by the time it held it. */
export class Moved extends Error {
  constructor(readonly what: "questions" | "answers" | "paid") {
    super(`moved: ${what}`);
  }
}

/** (§369) Test hook: a pause between a press's checks and its lock (the window a race needs). A no-op unless a test sets it. */
export async function beforeLock(name: string) {
  const hook = (globalThis as { __pressHooks?: Record<string, () => Promise<void>> }).__pressHooks?.[name];
  if (hook) await hook();
}
