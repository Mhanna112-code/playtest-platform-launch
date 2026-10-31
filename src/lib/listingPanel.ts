import { money } from "@/lib/format";
import { NOT_LISTED, testerShare, type Listing } from "@/lib/rules";
import { qRequired, qText } from "@/lib/questions";

/**
 * (Owner, Oct 30, batch 34 §14) The developer's test page "Listing" panel (right below the top overview panel; it replaces the old "Contract changes" fold): every
 * field of the CURRENT listing, the way testers see it. Only the fields changed in the MOST RECENT save carry "Updated <time>", opening Before / Now.
 */

/**
 * The TestEvent kind that keeps one listing Save's changed fields, before and after (JSON in its text), every field (spots, Open until and who can join too); a
 * Save that changed only the access keys keeps one with no fields. Read only by the developer's Listing panel: never a line anywhere (no live box, bell or timeline).
 */
export const LISTING_SAVED = "listing_saved";
export type SavedValues = { fields: string[]; before: Record<string, unknown>; after: Record<string, unknown> };
export const savedText = (v: SavedValues) => JSON.stringify(v);
export function parseSaved(text: string): SavedValues | null {
  try {
    const v = JSON.parse(text) as Partial<SavedValues>;
    if (!v || !Array.isArray(v.fields) || !v.before || typeof v.before !== "object" || !v.after || typeof v.after !== "object") return null;
    return { fields: v.fields.filter((f): f is string => typeof f === "string"), before: v.before, after: v.after };
  } catch {
    return null;
  }
}

/** The panel's lines, in order, each with the listing fields it shows. */
export const PANEL_ROWS = [
  { key: "productName", label: "Product", fields: ["productName"] },
  { key: "title", label: "Name", fields: ["title"] },
  { key: "description", label: "What to do", fields: ["description"] },
  { key: "questions", label: "Questions", fields: ["questions"] },
  { key: "buildUrl", label: "Build link", fields: ["buildUrl"] },
  { key: "ndaText", label: "NDA", fields: ["ndaText"] },
  { key: "devices", label: "Devices", fields: ["devices"] },
  { key: "languages", label: "Languages", fields: ["languages"] },
  { key: "categories", label: "Categories", fields: ["categories"] },
  { key: "mature", label: "Mature (18+)", fields: ["mature", "matureWhy"] },
  { key: "parts", label: "Parts and prices", fields: ["writtenCents", "writtenRequired", "recordingCents", "recordingRequired"] },
  { key: "call", label: "Call rate", fields: ["liveRateCents", "liveMinutes", "liveRequired"] },
  { key: "deadlineDays", label: "Tester deadline", fields: ["deadlineDays"] },
  { key: "openUntil", label: "Open until", fields: ["openUntil"] },
  { key: "joinMode", label: "Who can join", fields: ["joinMode"] },
  { key: "spots", label: "Spots", fields: ["spots"] },
] as const satisfies readonly { key: string; label: string; fields: readonly (keyof Listing)[] }[];
export type PanelKey = (typeof PANEL_ROWS)[number]["key"];

const JOIN_MODES: Record<string, string> = { anyone: "Anyone who matches (they press Join)", apply: "Approved only (you accept or decline)", invite: "Invite only" };
/** (Batch 35 §14) The same choices in the tester's words (the developer's "you" is the developer). */
const TESTER_JOIN_MODES: Record<string, string> = { anyone: "Anyone who matches (press Join)", apply: "Approved only (the developer accepts or declines)", invite: "Invite only" };
const need = (r: boolean | undefined) => (r ? "Required" : "Not required");
const list = (v: string[] | undefined, none: string) => (v?.length ? v.join(", ") : none);

/**
 * (Batch 35 §14) Whose panel: the developer's test page, or the tester's join page. The tester's reads their own share of each price ("$8.00 for you", as in their
 * "Your agreed scope"), their deadline from joining, "Who can join" in their words, and never the build link itself (they get it when they join, after any NDA).
 */
export type PanelSide = "developer" | "tester";
/** The build link's line on the tester's panel: the link itself comes with joining. */
export const BUILD_LINK_LATER = "You get it when you join";
/** The tester's labels where they differ from the developer's. */
const TESTER_LABELS: Partial<Record<PanelKey, string>> = { deadlineDays: "Your deadline" };
export const rowLabel = (key: PanelKey, side: PanelSide = "developer") => (side === "tester" ? TESTER_LABELS[key] : undefined) ?? PANEL_ROWS.find((r) => r.key === key)!.label;

/** How a line reads, now and in its Before (the same words for both). */
export function rowText(key: PanelKey, l: Listing, side: PanelSide = "developer"): string {
  const t = side === "tester";
  const price = (c: number) => (c === 0 ? "Free" : t ? `${money(testerShare(c))} for you` : money(c));
  switch (key) {
    case "productName": return l.productName || "(none)";
    case "title": return l.title || "(none)";
    case "description": return l.description || "(none)";
    case "questions": return l.questions?.length ? l.questions.map((q, i) => `${i + 1}. ${qText(q)}${qRequired(q) ? " (required)" : ""}`).join("\n") : "(none)";
    case "buildUrl": return l.buildUrl ? (t ? BUILD_LINK_LATER : l.buildUrl) : "(none)";
    case "ndaText": return l.ndaText || "None";
    case "devices": return list(l.devices, "Any device");
    case "languages": return list(l.languages, "Any language");
    case "categories": return list(l.categories, "(none)");
    case "mature": return l.mature ? `Yes${l.matureWhy ? `: ${l.matureWhy}` : ""}` : "No";
    case "parts": return [
      `Written answers: ${l.writtenCents == null ? NOT_LISTED : `${price(l.writtenCents)} · ${need(l.writtenRequired)}`}`,
      `Screen recording: ${l.recordingCents == null ? NOT_LISTED : `${price(l.recordingCents)} · ${need(l.recordingRequired)}`}`,
    ].join("\n");
    case "call": return l.liveRateCents == null ? NOT_LISTED : `${l.liveRateCents === 0 ? "Free" : `${money(t ? testerShare(l.liveRateCents) : l.liveRateCents)}/h${t ? " for you" : ""}`}${l.liveMinutes ? ` · ${l.liveMinutes}-minute calls` : ""} · ${need(l.liveRequired)}`;
    case "deadlineDays": return `${l.deadlineDays} day${l.deadlineDays === 1 ? "" : "s"}${t ? " from joining" : ""}`;
    case "openUntil": return l.openUntil ? new Date(l.openUntil).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "No end date";
    case "joinMode": return (t ? TESTER_JOIN_MODES : JOIN_MODES)[l.joinMode] ?? l.joinMode;
    case "spots": return String(l.spots);
  }
}

export type PanelRow = { key: PanelKey; label: string; now: string; before: string | null; updatedAt: Date | null };

/**
 * Each line of the panel: its current words and, ONLY when the most recent save changed it, what it read before that save and when (a line that save didn't
 * change, or changed and that reads the same, has no tag).
 */
export function panelRows(now: Listing, last: (SavedValues & { at: Date }) | null, side: PanelSide = "developer"): PanelRow[] {
  const before = last ? ({ ...now, ...last.before } as Listing) : null;
  return PANEL_ROWS.map((r) => {
    const label = rowLabel(r.key, side);
    const n = rowText(r.key, now, side);
    if (!last || !before || !r.fields.some((f) => last.fields.includes(f))) return { key: r.key, label, now: n, before: null, updatedAt: null };
    // (Batch 35 §14) The tester's build link changed from one link to another: said without either link.
    if (side === "tester" && r.key === "buildUrl" && before.buildUrl && now.buildUrl && before.buildUrl !== now.buildUrl) return { key: r.key, label, now: n, before: "An earlier link", updatedAt: last.at };
    const b = rowText(r.key, before, side);
    return b === n ? { key: r.key, label, now: n, before: null, updatedAt: null } : { key: r.key, label, now: n, before: b, updatedAt: last.at };
  });
}
