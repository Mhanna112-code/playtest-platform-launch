import { db } from "@/lib/db";
import { LISTING_SAVED, parseSaved, type SavedValues } from "@/lib/listingPanel";
import { LISTING_VALUES, parseValues } from "@/lib/listingInfo";

/** How far apart the records one Save makes can be. */
const NEAR_MS = 5_000;

/**
 * (Batch 34 §14) The test's most recent listing Save: the fields it changed, before and after, and when. A Save made before the panel existed (no "listing_saved"
 * record) is pieced together from what it did keep: its Contract-changes entry (the terms and the names) and its listing-information record.
 */
export async function lastListingSave(testId: string): Promise<(SavedValues & { at: Date }) | null> {
  const [saved, edited] = await Promise.all([
    db.testEvent.findFirst({ where: { testId, kind: LISTING_SAVED }, orderBy: { createdAt: "desc" } }),
    db.testEvent.findFirst({ where: { testId, kind: { in: ["edited", "edited_spots"] } }, orderBy: { createdAt: "desc" } }),
  ]);
  if (saved && (!edited || saved.createdAt.getTime() >= edited.createdAt.getTime() - NEAR_MS)) {
    const v = parseSaved(saved.text);
    return v ? { ...v, at: saved.createdAt } : null;
  }
  if (!edited) return null;
  const near = { gte: new Date(edited.createdAt.getTime() - NEAR_MS), lte: new Date(edited.createdAt.getTime() + NEAR_MS) };
  const [deal, info] = await Promise.all([
    db.testChange.findFirst({ where: { testId, createdAt: near }, orderBy: { createdAt: "desc" } }),
    db.testEvent.findFirst({ where: { testId, kind: LISTING_VALUES, createdAt: near }, orderBy: { createdAt: "desc" } }),
  ]);
  const i = info ? parseValues(info) : null;
  const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
  const fields = [...new Set([...(deal?.fields ?? []), ...(i?.fields ?? [])])];
  if (!fields.length) return { fields: [], before: {}, after: {}, at: edited.createdAt };
  return { fields, before: { ...obj(i?.before), ...obj(deal?.before) }, after: { ...obj(i?.after), ...obj(deal?.after) }, at: edited.createdAt };
}
