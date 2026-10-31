/**
 * (Owner, Oct 31, batch 35 §15; §29 everywhere) Listing and contract fields read apart from their values: each field is its LABEL (small, muted, uppercase, on
 * its own line, with its "Updated <time>" tag right after it) over its VALUE (bright). The developer's Listing panel and the tester's join page (ListingPanel),
 * the tester's "Your agreed scope" fold (its contract and the listing information), the new-terms offer (Switch / Keep) and the terms history's "then and now"
 * lists all draw their fields with these. Questions in such a value: `QuestionList numbered` (Required as a small tag); long texts in their scroll boxes on
 * FIELD_BOX.
 */
export const FIELD_LABEL = "text-[11px] font-medium uppercase tracking-wide text-slate-400";
/** The long values (What to do, the NDA) keep their scroll boxes, on a faint ground. */
export const FIELD_BOX = "rounded-md bg-white/[0.03] px-2 py-1 text-slate-100";

/** A field's label on its own line, with its tag ("Updated <time>") after it. */
export function FieldLabel({ children, tag }: { children?: React.ReactNode; tag?: React.ReactNode }) {
  return <div className="leading-5"><span className={FIELD_LABEL} data-panel-label="">{children}</span>{tag}</div>;
}

/** A field's value under its label, in bright text. */
export function FieldValue({ children }: { children?: React.ReactNode }) {
  return <div className="mt-0.5 text-slate-100" data-panel-value="">{children}</div>;
}
