import { money } from "@/lib/format";
import { NOT_LISTED, type Listing } from "@/lib/rules";
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
const price = (c: number) => (c === 0 ? "Free" : money(c));
const need = (r: boolean | undefined) => (r ? "Required" : "Not required");
const list = (v: string[] | undefined, none: string) => (v?.length ? v.join(", ") : none);

/** How a line reads, now and in its Before (the same words for both). */
export function rowText(key: PanelKey, l: Listing): string {
  switch (key) {
    case "productName": return l.productName || "(none)";
    case "title": return l.title || "(none)";
    case "description": return l.description || "(none)";
    case "questions": return l.questions?.length ? l.questions.map((q, i) => `${i + 1}. ${qText(q)}${qRequired(q) ? " (required)" : ""}`).join("\n") : "(none)";
    case "buildUrl": return l.buildUrl || "(none)";
    case "ndaText": return l.ndaText || "None";
    case "devices": return list(l.devices, "Any device");
    case "languages": return list(l.languages, "Any language");
    case "categories": return list(l.categories, "(none)");
    case "mature": return l.mature ? `Yes${l.matureWhy ? `: ${l.matureWhy}` : ""}` : "No";
    case "parts": return [
      `Written answers: ${l.writtenCents == null ? NOT_LISTED : `${price(l.writtenCents)} · ${need(l.writtenRequired)}`}`,
      `Screen recording: ${l.recordingCents == null ? NOT_LISTED : `${price(l.recordingCents)} · ${need(l.recordingRequired)}`}`,
    ].join("\n");
    case "call": return l.liveRateCents == null ? NOT_LISTED : `${l.liveRateCents === 0 ? "Free" : `${money(l.liveRateCents)}/h`}${l.liveMinutes ? ` · ${l.liveMinutes}-minute calls` : ""} · ${need(l.liveRequired)}`;
    case "deadlineDays": return `${l.deadlineDays} day${l.deadlineDays === 1 ? "" : "s"}`;
    case "openUntil": return l.openUntil ? new Date(l.openUntil).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "No end date";
    case "joinMode": return JOIN_MODES[l.joinMode] ?? l.joinMode;
    case "spots": return String(l.spots);
  }
}

export type PanelRow = { key: PanelKey; label: string; now: string; before: string | null; updatedAt: Date | null };

/**
 * Each line of the panel: its current words and, ONLY when the most recent save changed it, what it read before that save and when (a line that save didn't
 * change, or changed and that reads the same, has no tag).
 */
export function panelRows(now: Listing, last: (SavedValues & { at: Date }) | null): PanelRow[] {
  const before = last ? ({ ...now, ...last.before } as Listing) : null;
  return PANEL_ROWS.map((r) => {
    const n = rowText(r.key, now);
    if (!last || !before || !r.fields.some((f) => last.fields.includes(f))) return { key: r.key, label: r.label, now: n, before: null, updatedAt: null };
    const b = rowText(r.key, before);
    return b === n ? { key: r.key, label: r.label, now: n, before: null, updatedAt: null } : { key: r.key, label: r.label, now: n, before: b, updatedAt: last.at };
  });
}
