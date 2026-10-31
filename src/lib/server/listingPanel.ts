import { db } from "@/lib/db";
import { LISTING_SAVED, panelRows, parseSaved, type PanelRow, type SavedValues } from "@/lib/listingPanel";
import { LISTING_VALUES, parseValues } from "@/lib/listingInfo";
import type { Listing } from "@/lib/rules";

/** How far apart the records one Save makes can be. */
const NEAR_MS = 5_000;

/**
 * (Batch 34 §14) The test's most recent listing Save: the fields it changed, before and after, and when. A Save made before the panel existed (no "listing_saved"
 * record) is pieced together from what it did keep: its Contract-changes entry (the terms and the names) and its listing-information record.
 */
export async function lastListingSave(testId: string, opts: { /** (Batch 35 §14) the tester's panel: a Save of only the access keys isn't a listing Save */ skipEmpty?: boolean } = {}): Promise<(SavedValues & { at: Date }) | null> {
  const [saved, edited] = await Promise.all([
    db.testEvent.findFirst({ where: { testId, kind: LISTING_SAVED }, orderBy: { createdAt: "desc" } }),
    db.testEvent.findFirst({ where: { testId, kind: { in: ["edited", "edited_spots"] } }, orderBy: { createdAt: "desc" } }),
  ]);
  if (saved && (!edited || saved.createdAt.getTime() >= edited.createdAt.getTime() - NEAR_MS)) {
    const v = parseSaved(saved.text);
    if (opts.skipEmpty && v && !v.fields.length) {
      // The keys are never on the tester's side: their panel shows the most recent Save that changed the listing.
      const older = await db.testEvent.findMany({ where: { testId, kind: LISTING_SAVED, createdAt: { lt: saved.createdAt } }, orderBy: { createdAt: "desc" }, take: 50 });
      for (const o of older) {
        const w = parseSaved(o.text);
        if (w?.fields.length) return { ...w, at: o.createdAt };
      }
      return null;
    }
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

/**
 * (Owner, Oct 30, batch 34 §14 "The join page too"; batch 35 §14) The tester's join page Listing panel: the current listing in the tester's words (their share of
 * each price, their deadline from joining, no build link before joining), the fields of the most recent listing Save tagged "Updated <time>" (Before / Now), and
 * that Save's time (`savedAt`, the panel's data-saved-at: See it marks a line's fields only when the panel shows that line's Save).
 */
export async function testerListingPanel(testId: string, now: Listing): Promise<{ rows: PanelRow[]; savedAt: string }> {
  const last = await lastListingSave(testId, { skipEmpty: true });
  return { rows: panelRows(now, last, "tester"), savedAt: last?.at.toISOString() ?? "" };
}

/**
 * (Batch 35 §14) The "What this test needs" pop-up's own lines ("Nora Lane added Spanish to the languages this test needs"): the most recent listing Save that changed
 * the devices or the languages, so their See it marks that Save's fields only.
 */
export async function needsSaveAt(testId: string): Promise<string | undefined> {
  const s = await db.testEvent.findFirst({ where: { testId, kind: LISTING_SAVED, OR: [{ text: { contains: '"devices"' } }, { text: { contains: '"languages"' } }] }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  return s?.createdAt.toISOString();
}
