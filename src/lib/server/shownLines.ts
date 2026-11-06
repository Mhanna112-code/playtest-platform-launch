import type { TestEventLike } from "@/lib/rules";

/**
 * (Owner, Nov 5, §250) An update listed in ANY stop box on a page counts as seen for EVERY button on that page: no other press there stops again for it.
 *
 * Per update, not by time: each stop line carries a stable identity (`sid`) and the page sends back the identities its stop boxes ACTUALLY LISTED (`shownIds`, every
 * press, lib/live.ts `shownIdsNow`). Both gates (the developer's devGate, the tester's testerGate, and the stop / pause moments with them) drop a line whose identity
 * is among them before deciding to stop. An update that arrived before a box but wasn't listed in it (left out by that press's Alerts, or not about that press) still
 * stops the presses it applies to, by their usual rules; a newer update has a new identity and stops as usual.
 *
 * Identity: the test event's row id when the line is one (`eventId`), otherwise its kind, time (ms) and raw text (before the reader's zone is applied), hashed short.
 *
 * (Owner, Nov 5, §268) No exceptions any more: §232's Rate / Leave open-terms line (`everyPress`) is gone.
 * Lines with no identity (`sid`) never count: Pay what you owe's stop (holds.ts keeps its own seenIds / seenAmounts) and other boxes outside the two gates.
 */
export const SHOWN_IDS_MAX = 300;

/** cyrb53: a short stable hash (no crypto needed; collisions are vanishingly rare at a page's few hundred lines). */
function hash(str: string) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** The line's identity: `ev:<event id>` hashed, else kind + time + raw text hashed. */
export function lineId(e: { kind?: string; text: string; createdAt: Date; eventId?: string }) {
  return hash(e.eventId ? `ev|${e.eventId}` : `${e.kind ?? ""}|${e.createdAt.getTime()}|${e.text}`);
}
/** The `sid` a stop line carries. */
export const sidOf = (e: TestEventLike) => ({ sid: lineId(e) });

/** The identities the page's stop boxes listed (`shownIds`), capped. */
export function shownIdsOf(body: Record<string, unknown>): Set<string> {
  const v = body.shownIds;
  if (!Array.isArray(v)) return new Set();
  return new Set(v.slice(-SHOWN_IDS_MAX).filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 32));
}
/** Was this line listed in a stop box on the page already? */
export const wasListed = (e: TestEventLike, shown: ReadonlySet<string>) => shown.size > 0 && shown.has(lineId(e));
/** The lines no stop box on the page listed yet. */
export const notListed = <T extends TestEventLike>(lines: T[], body: Record<string, unknown>): T[] => {
  const shown = shownIdsOf(body);
  return shown.size ? lines.filter((e) => !wasListed(e, shown)) : lines;
};
