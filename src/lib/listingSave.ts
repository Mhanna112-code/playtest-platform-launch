import { fmtTimeIn } from "@/lib/format";
import type { Listing } from "@/lib/rules";

/**
 * (Batch 30 §10) ONE line per listing save for testers, everywhere they see listing changes (join page, session page, their stop boxes and top boxes):
 * "Marc Hanna edited the listing at 6:55 PM: product name, title (now “lllllq”), description, build link, recording price, live call rate". Each Save that
 * changed anything testers see (every field but spots and Open until) records one "listing_save" event holding what it changed (JSON); each page writes the line
 * for its reader. The developer's own pages keep their lines ("edited", "info", "renamed").
 */
export const LISTING_SAVE = "listing_save";

/** The words for each listing field, as every line names it. */
export const FIELD_NAMES: Record<keyof Listing, string> = {
  productName: "product name", mature: "Mature (18+) box", matureWhy: "Mature (18+) note", ndaText: "NDA",
  title: "title", description: "description", buildUrl: "build link", categories: "categories", devices: "devices", languages: "languages",
  openUntil: "Open until", joinMode: "who can join", spots: "spots", writtenCents: "written answers price", writtenRequired: "written answers required", recordingRequired: "recording required", liveRequired: "live call required", recordingCents: "recording price", liveRateCents: "live call rate",
  liveMinutes: "call length", deadlineDays: "deadline", questions: "questions",
};

/** (F) The listing info a working tester sees change live (the title too, as a rename): never their contract's terms, which come as Switch / Keep. */
export const INFO_FIELDS: (keyof Listing)[] = ["description", "devices", "languages", "buildUrl", "categories", "joinMode", "productName", "mature", "matureWhy"];

export type ListingSave = { by: string; fields: string[]; title: string; nda: boolean };

/** What one Save stores. */
export const saveText = (s: ListingSave) => JSON.stringify(s);

export function parseSave(text: string): ListingSave | null {
  try {
    const v = JSON.parse(text) as Partial<ListingSave>;
    if (!v || typeof v.by !== "string" || !Array.isArray(v.fields)) return null;
    return { by: v.by, fields: v.fields.filter((f): f is string => typeof f === "string"), title: typeof v.title === "string" ? v.title : "", nda: v.nda === true };
  } catch {
    return null;
  }
}

/** The NDA's words on the join page, where the tester accepts it before joining. */
export const NDA_AGAIN = "read and accept it again below";

/** (Owner, Oct 31, batch 35 §34) The tester's ONE line for all the developer's listing edits since the page's seen time: "Nora Lane edited the listing". */
export const editedLine = (by: string) => `${by} edited the listing`;
/** (Batch 35 §34) The join page's own line when an edit changed the NDA: the tester accepts it again before joining. */
export const ndaAgainLine = (by: string) => `${by} changed the NDA: ${NDA_AGAIN}`;
/** (Batch 35 §34) The developer's ONE line for their own listing Saves (and renames) in other tabs since the page's seen time. */
export const SAVED_ELSEWHERE_LINE = "You saved the listing in another tab";

/**
 * The tester's line for one save, at `at` in the reader's zone; null when nothing on that page is about it. `join`: the join page (every field; an NDA change asks
 * to accept it again); `session`: a working tester's session page (the listing information only: their contract's terms come as an offer). `titleOnly`: a rename alone
 * is info only (it never stops a press by itself).
 */
export function saveLine(s: ListingSave, at: Date, tz: string | null | undefined, side: "join" | "session"): { text: string; titleOnly: boolean; nda: boolean } | null {
  const fields = side === "join" ? s.fields : s.fields.filter((f) => f === "title" || (INFO_FIELDS as string[]).includes(f));
  if (!fields.length) return null;
  const time = fmtTimeIn(at, tz);
  const nda = side === "join" && fields.includes("ndaText");
  if (nda && fields.length === 1) return { text: s.nda ? `${s.by} changed the NDA at ${time}: ${NDA_AGAIN}` : `${s.by} removed the NDA at ${time}`, titleOnly: false, nda: s.nda };
  const names = fields.map((f) => (f === "title" && s.title ? `title (now “${s.title}”)` : f === "ndaText" ? `NDA (${s.nda ? NDA_AGAIN : "removed"})` : FIELD_NAMES[f as keyof Listing] ?? f));
  return { text: `${s.by} edited the listing at ${time}: ${names.join(", ")}`, titleOnly: fields.every((f) => f === "title"), nda: nda && s.nda };
}
