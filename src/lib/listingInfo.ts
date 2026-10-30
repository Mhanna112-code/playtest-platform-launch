/**
 * (Batch 30 §15) The listing information on a tester's session page: always the CURRENT values (title, product name, what to do, build link, devices,
 * languages, categories, Mature), each line changed since the tester joined carrying "Updated <time>" with before (as when they joined) → now.
 * Not part of the contract (which stays fixed until Switch).
 */

/** The fields that make up the listing information (each Save that changed them records a "listing_values" TestEvent). */
export const LISTING_INFO_FIELDS = ["title", "productName", "description", "buildUrl", "devices", "languages", "categories", "mature", "matureWhy"] as const;
export type InfoField = (typeof LISTING_INFO_FIELDS)[number];

export type InfoValues = { title: string; productName: string; description: string; buildUrl: string; devices: string[]; languages: string[]; categories: string[]; mature: boolean; matureWhy: string };
export type InfoChange = { fields: string[]; before: unknown; after: unknown; createdAt: Date };

/**
 * (Batch 30 §15) The TestEvent kind that keeps one Save's listing information before and after (JSON in its text): read only by the testers' session pages,
 * never shown as a line anywhere (no live box, bell or timeline lists this kind).
 */
export const LISTING_VALUES = "listing_values";
export const valuesText = (v: { fields: string[]; before: Record<string, unknown>; after: Record<string, unknown> }) => JSON.stringify(v);
/** A "listing_values" event as a change (null when its text isn't one). */
export function parseValues(e: { text: string; createdAt: Date }): InfoChange | null {
  try {
    const v = JSON.parse(e.text) as { fields?: unknown; before?: unknown; after?: unknown };
    if (!v || !Array.isArray(v.fields) || typeof v.before !== "object" || typeof v.after !== "object") return null;
    return { fields: v.fields.filter((f): f is string => typeof f === "string"), before: v.before, after: v.after, createdAt: e.createdAt };
  } catch {
    return null;
  }
}

/** The lines of the contract box's listing part, in order (categories show only in the header's badges). "mature" covers the box and its note. */
export const INFO_LINES = [
  { key: "title", label: "Title", fields: ["title"] },
  { key: "productName", label: "Product", fields: ["productName"] },
  { key: "description", label: "What to do", fields: ["description"] },
  { key: "buildUrl", label: "Build link", fields: ["buildUrl"] },
  { key: "devices", label: "Devices", fields: ["devices"] },
  { key: "languages", label: "Languages", fields: ["languages"] },
  { key: "mature", label: "Mature (18+)", fields: ["mature", "matureWhy"] },
] as const;
export type InfoLineKey = (typeof INFO_LINES)[number]["key"];

/** How a line reads (the same words for now and before). */
export function infoText(key: InfoLineKey | "categories", v: InfoValues): string {
  switch (key) {
    case "title": return v.title;
    case "productName": return v.productName || "(none)";
    case "description": return v.description || "(none)";
    case "buildUrl": return v.buildUrl || "(none)";
    case "devices": return v.devices.length ? v.devices.join(", ") : "Any device";
    case "languages": return v.languages.length ? v.languages.join(", ") : "Any language";
    case "categories": return v.categories.length ? v.categories.join(", ") : "(none)";
    case "mature": return v.mature ? `Yes${v.matureWhy ? `: ${v.matureWhy}` : ""}` : "No";
  }
}

const field = (o: unknown, f: string) => (o && typeof o === "object" && f in (o as Record<string, unknown>) ? (o as Record<string, unknown>)[f] : undefined);

/** The listing information as it was when the tester joined: the "before" of the first change of each field after joining (the contract's own copies of the
 * title, description and build link for changes older than these records). */
export function infoAtJoin(now: InfoValues, changes: InfoChange[], joined: { title: string; description: string; buildUrl: string } | null): InfoValues {
  const at: Record<string, unknown> = { ...now };
  const done = new Set<string>();
  for (const c of [...changes].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    const kept = c.before && typeof c.before === "object" ? Object.keys(c.before as Record<string, unknown>) : [];
    for (const f of new Set([...c.fields, ...kept])) {
      if (done.has(f)) continue;
      const b = field(c.before, f);
      if (b !== undefined) at[f] = b ?? (f === "mature" ? false : Array.isArray(at[f]) ? [] : "");
      done.add(f);
    }
  }
  if (joined) for (const f of ["title", "description", "buildUrl"] as const) if (!done.has(f)) at[f] = joined[f];
  return at as InfoValues;
}

export type InfoLine = { key: InfoLineKey; label: string; now: string; before: string | null; updatedAt: Date | null };

/**
 * Each line of the listing part: its current words, and (changed since joining) what it read then and when it last changed. A field changed and changed back
 * reads as not changed. `fallbackAt`: the time to show for a change older than the records (the newest listing-information event since joining), if any.
 */
export function infoLines(now: InfoValues, changes: InfoChange[], joined: { title: string; description: string; buildUrl: string } | null, fallbackAt: Date | null = null): InfoLine[] {
  const then = infoAtJoin(now, changes, joined);
  return INFO_LINES.map((l) => {
    const n = infoText(l.key, now), b = infoText(l.key, then);
    if (n === b) return { key: l.key, label: l.label, now: n, before: null, updatedAt: null };
    const last = changes.filter((c) => c.fields.some((f) => (l.fields as readonly string[]).includes(f))).reduce<Date | null>((a, c) => (!a || c.createdAt > a ? c.createdAt : a), null);
    return { key: l.key, label: l.label, now: n, before: b, updatedAt: last ?? fallbackAt };
  });
}

const NAMES: Record<string, string> = { title: "title", productName: "product name", description: "description", buildUrl: "build link", devices: "devices", languages: "languages", categories: "categories", mature: "Mature (18+)", matureWhy: "Mature (18+)" };

/** One Terms history entry's fields (renames have their own "Renamed" line there): before → after per field, or null when only the names changed. */
export function historyRows(c: InfoChange): { name: string; before: string; after: string }[] | null {
  const fs = c.fields.filter((f) => f !== "title" && f !== "productName");
  if (!fs.length) return null;
  const val = (o: unknown) => ({ title: "", productName: "", description: "", buildUrl: "", devices: [], languages: [], categories: [], mature: false, matureWhy: "", ...(o && typeof o === "object" ? Object.fromEntries(Object.entries(o as Record<string, unknown>).filter(([, x]) => x != null)) : {}) }) as InfoValues;
  const b = val(c.before), a = val(c.after);
  const keys = [...new Set(fs.map((f) => (f === "matureWhy" ? "mature" : f)))] as (InfoLineKey | "categories")[];
  return keys.map((k) => ({ name: NAMES[k], before: infoText(k, b), after: infoText(k, a) }));
}
