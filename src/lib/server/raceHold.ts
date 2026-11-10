// (Owner, Nov 10, §369) TEST-ONLY pause point between a press's checks and its lock (Send Answers, Add to this answer), for recordings and tests that must force
// one exact order of two presses. Active ONLY with RACE_HOLDS=1 (never in production; not in .env.example). A request whose body has `raceHold: "<name>"` waits
// here, holding no lock and no transaction, until POST /api/test/race-release { name } releases it (or 60 s pass). Unset, `raceHold` is ignored completely.

type Holds = { waiting: Map<string, () => void>; released: Set<string> };
const holds = (): Holds => ((globalThis as { __raceHolds?: Holds }).__raceHolds ??= { waiting: new Map(), released: new Set() });

/** Is the test-only pause point on? */
export const raceHoldsOn = () => process.env.RACE_HOLDS === "1" && process.env.NODE_ENV !== "production";

/** Waits here when the pause point is on and the body names a hold; returns at once otherwise. */
export async function raceHold(body: Record<string, unknown>) {
  if (!raceHoldsOn()) return;
  const name = typeof body.raceHold === "string" ? body.raceHold.slice(0, 64) : "";
  if (!name) return;
  const h = holds();
  if (h.released.delete(name)) return; // released before it got here
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => { h.waiting.delete(name); resolve(); }, 60_000);
    h.waiting.set(name, () => { clearTimeout(timer); h.waiting.delete(name); resolve(); });
  });
}

/** Is a request waiting at this hold right now? */
export const raceWaiting = (name: string) => holds().waiting.has(name);

/** Lets the request waiting at this hold go on (or the next one to arrive, once). */
export function raceRelease(name: string) {
  const h = holds();
  const go = h.waiting.get(name);
  if (go) go();
  else h.released.add(name);
  return { released: !!go };
}
