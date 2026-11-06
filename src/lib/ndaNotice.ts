/**
 * (Owner, Nov 5, batch 35 §267) The NDA is a listing change, not a contract term: a Save that adds, removes or changes it applies to every working tester at once
 * (copied into their contract, no Switch / Keep). Each gets its own notice, "<developer> changed the NDA" (the bell, the session page's top, the email with the
 * bell), whose "changed the NDA" is a link to the NDA line in "The listing information" (`#info-nda`, `data-info-line="nda"`). Opening it records
 * `Contract.ndaNoticeSeenAt`.
 * An ADDED or REMOVED NDA also blocks every press of the tester's on that test (not Rate or Leave, §268) until they open the notice; a changed text only notifies.
 * (Easy to extend: `BLOCKING_KINDS`.) A tester who joins after the change accepts the NDA at join as before and is never blocked (their contract has no change).
 */
export type NdaChangeKind = "added" | "removed" | "changed";
export const BLOCKING_KINDS: readonly string[] = ["added", "removed"];

/** How a Save changed the NDA (null: it didn't). */
export const ndaChangeOf = (before: string | null | undefined, after: string | null | undefined): NdaChangeKind | null => {
  const a = (before ?? "").trim(), b = (after ?? "").trim();
  if (a === b) return null;
  return !a ? "added" : !b ? "removed" : "changed";
};

type C = { ndaChangedAt: Date | null; ndaChangeKind: string; ndaNoticeSeenAt: Date | null };
/** The notice still waits to be opened. */
export const ndaNoticeOpen = (c: C) => !!c.ndaChangedAt && (!c.ndaNoticeSeenAt || c.ndaNoticeSeenAt < c.ndaChangedAt);
/** The tester's presses on the test are blocked (an added or removed NDA whose notice wasn't opened). */
export const ndaBlocked = (c: C) => ndaNoticeOpen(c) && BLOCKING_KINDS.includes(c.ndaChangeKind);

/** The notice's words: "<developer> changed the NDA" (its "changed the NDA" is the link). */
export const NDA_CHANGED = "changed the NDA";
export const ndaChangedLine = (dev: string) => `${dev} ${NDA_CHANGED}`;
/** The block's line (the refusal and the banner); `link` is the part drawn as the link. */
export const ndaBlockParts = (dev: string, kind: string) =>
  kind === "removed" ? { before: `${dev} removed the NDA from this test: `, link: "see the change", after: " before you go on" } : { before: `${dev} added an NDA to this test: `, link: "read it", after: " before you go on" };
export const ndaBlockLine = (dev: string, kind: string) => { const p = ndaBlockParts(dev, kind); return `${p.before}${p.link}${p.after}`; };
/** Is this refusal text the block's line (the refusal box draws its link)? */
export const isNdaBlockLine = (text: string) => / (added an NDA to|removed the NDA from) this test: (read it|see the change) before you go on$/.test(text);
/** Where the notice's link goes: the session page, which records it as opened and brings the NDA line into view. */
export const ndaNoticeHref = (sessionId: string) => `/app/sessions/${sessionId}?nda=open#info-nda`;
