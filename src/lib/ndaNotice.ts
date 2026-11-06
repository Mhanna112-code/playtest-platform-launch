/**
 * (Owner, Nov 5, batch 35 §267) The NDA is a listing change, not a contract term: a Save that adds, removes or changes it applies to every working tester at once
 * (copied into their contract, no Switch / Keep). A tester who joins after the change accepts the NDA at join as before and is never blocked (their contract has
 * no change).
 * (Owner, Nov 6, §302; replaces §267's notice, banner and "added or removed only") EVERY NDA change (added, removed or changed) blocks the tester's presses on the
 * test (not Rate or Leave, §268) until they press the notice's Acknowledge button, the way an open contract change does: the press is refused with one line,
 * "Acknowledge the NDA change first.", and the page goes up to the notice and marks it. One notice on the session page: "<developer> changed the NDA. Click here to
 * acknowledge you've seen the change." (one wording for added, removed and changed), the line a link to the NDA in "The listing information" (`#info-nda`,
 * navigation only), with ONE button, "Acknowledge", which records `Contract.ndaNoticeSeenAt` (an added NDA: `ndaAcceptedAt` too) and lifts the block at once.
 * No imports: safe on the server and in the pages.
 */
export type NdaChangeKind = "added" | "removed" | "changed";
/** (§302) Every kind blocks (§267 had "added" and "removed" only). */
export const BLOCKING_KINDS: readonly string[] = ["added", "removed", "changed"];

/** How a Save changed the NDA (null: it didn't). */
export const ndaChangeOf = (before: string | null | undefined, after: string | null | undefined): NdaChangeKind | null => {
  const a = (before ?? "").trim(), b = (after ?? "").trim();
  if (a === b) return null;
  return !a ? "added" : !b ? "removed" : "changed";
};

type C = { ndaChangedAt: Date | null; ndaChangeKind: string; ndaNoticeSeenAt: Date | null };
/** The notice still waits to be acknowledged. */
export const ndaNoticeOpen = (c: C) => !!c.ndaChangedAt && (!c.ndaNoticeSeenAt || c.ndaNoticeSeenAt < c.ndaChangedAt);
/** The tester's presses on the test are blocked (an NDA change not yet acknowledged). */
export const ndaBlocked = (c: C) => ndaNoticeOpen(c) && BLOCKING_KINDS.includes(c.ndaChangeKind);

/** The change in words, for the bell and the top box: "fbbb changed the NDA" (§302: the owner's one wording, whether it was added, removed or changed). */
export const NDA_CHANGED = "changed the NDA";
export const ndaChangedLine = (dev: string) => `${dev} ${NDA_CHANGED}`;
/** (§302) The notice's second sentence (the whole line links to the NDA). */
export const NDA_ACK_TAIL = "Click here to acknowledge you've seen the change.";
/** (§302) The notice, the same for every kind: "fbbb changed the NDA. Click here to acknowledge you've seen the change." */
export const ndaNoticeLine = (dev: string) => `${ndaChangedLine(dev)}. ${NDA_ACK_TAIL}`;
/** (§302) The notice's one button. */
export const NDA_ACK_BUTTON = "Acknowledge";

/** (§302) The refusal while blocked: one short line under the pressed button (like "Answer the new terms first: Switch or Keep."). */
export const NDA_BLOCK_FIRST = "Acknowledge the NDA change first.";
/** The refusal's code. */
export const NDA_BLOCK_CODE = "nda_block";
/** (§302) The page event that brings the NDA notice into view, marked (the notice listens; a page without it yet loads it first). */
export const NDA_BLOCK_EVENT = "nda-block";
/** (§302) The notice's id on the session page (the bell's and the top box's link land here). */
export const NDA_NOTICE = "nda-notice";

/** (§267, §268) The session route's actions the block never applies to: Rate and Leave, the Acknowledge button, the New terms pill, and the page's own sends. */
export const NDA_FREE: readonly string[] = ["rate", "leave", "nda-seen", "terms-pill", "dismiss-removed", "recording-alive", "recording-abandon", "recording-done"];

/** (§302) Is this API path a press the block refuses (a session press other than NDA_FREE, or Join call)? `sessionId`: only that session's presses. */
export function ndaBlockedPath(path: string, sessionId?: string) {
  const p = path.split("?")[0].split("/").filter(Boolean); // api, sessions | calls, <id>, <action>
  if (p[0] !== "api" || p.length !== 4) return false;
  if (p[1] === "sessions") return (!sessionId || p[2] === sessionId) && !NDA_FREE.includes(p[3]);
  return p[1] === "calls" && p[3] === "join";
}

/** Where the bell's and the top box's links go: the notice on the session page (the NDA line in "The listing information" once acknowledged). */
export const ndaNoticeHref = (sessionId: string) => `/app/sessions/${sessionId}#${NDA_NOTICE}`;
