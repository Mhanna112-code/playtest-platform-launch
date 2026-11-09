import { noKeyWaitingLine } from "./keys";

/**
 * (Owner, Nov 5, §275 revised) The Edit Save's note, shown on Edit (the developer stays there): "Saved.", followed only by what else the Save did (new terms offered to
 * N working testers, applications closed, invites re-sent, not re-invited). `extras`: it lists any of those (it then stays until ×; otherwise it fades).
 */
export const SAVED_PARAMS = ["saved", "offered", "closed", "resent", "skipped", "nokey"] as const;
export type SavedParams = Partial<Record<(typeof SAVED_PARAMS)[number], string>>;

/** The Edit page's address after a Save that went through: the same page, with what the Save did. */
export function savedHref(testId: string, r: { offered?: number; closedApps?: string[]; resent?: string[]; notReinvited?: string[]; /** (§338) */ noKeyApps?: string[] }) {
  const q = (k: string, v?: string[]) => (v?.length ? `&${k}=${encodeURIComponent(v.join(", "))}` : "");
  return `/app/tests/${testId}/edit?saved=1&offered=${r.offered ?? 0}${q("closed", r.closedApps)}${q("resent", r.resent)}${q("skipped", r.notReinvited)}${q("nokey", r.noKeyApps)}`;
}

/** The note's text, or null when the address carries no Save. */
export function savedNoteText(p: SavedParams): { text: string; extras: boolean } | null {
  if (p.saved !== "1") return null;
  const n = Number(p.offered) || 0;
  const count = (s: string) => s.split(", ").length;
  const extra = [
    n > 0 ? `Offered the new terms to ${n} working tester${n === 1 ? "" : "s"}.` : "",
    p.closed ? `Closed ${count(p.closed)} application${count(p.closed) === 1 ? "" : "s"}: ${p.closed.slice(0, 500)}.` : "",
    p.resent ? `Invites re-sent on the new listing: ${p.resent.slice(0, 500)}.` : "",
    p.skipped ? `Not re-invited: ${p.skipped.slice(0, 500)}.` : "",
    p.nokey ? noKeyWaitingLine(p.nokey.slice(0, 500).split(", ")) : "", // (§338)
  ].filter(Boolean);
  return { text: ["Saved.", ...extra].join(" "), extras: extra.length > 0 };
}
