import { ClipboardList } from "lucide-react";
import { UpdatedTag } from "@/components/ListingInfo";
import { ScrollText } from "@/components/ScrollText";
import { QuestionList } from "@/components/QuestionList";
import { qRequired, qText } from "@/lib/questions";
import type { PanelKey, PanelRow, PanelSide } from "@/lib/listingPanel";
import type { Listing } from "@/lib/rules";

/**
 * (Owner, Oct 30, batch 34 §14) The developer's "Listing" panel, right below the top overview panel (it replaces the "Contract changes" fold): every field of the
 * current listing, the way testers see it (the tester's "Your agreed scope" lines). A field changed in the most recent save carries "Updated <time>", opening
 * Before / Now (each a scroll box about 8 lines tall). Every listing line in the page's blue boxes has a "See it" that jumps here (and marks those lines).
 * (Owner, Oct 30, batch 34 §14 "The join page too"; batch 35 §14) The tester's join page shows the same panel (`side="tester"`, rows from testerListingPanel): its
 * header card (`head`: the tile, title, price and badges) and "What testers said" (`foot`) sit inside it, and `after` adds to a line ("Spots: 5 · 3 left").
 * (Owner, Oct 31, batch 35 §15) Each line is its label (small, muted, uppercase, with its "Updated" tag) over its value (bright); the questions a numbered list
 * with "Required" as a small tag.
 */
/** (Owner, Oct 31, batch 35 §15) Labels apart from values: a small muted uppercase label on its own line, the value below it in bright text. */
const LABEL = "text-[11px] font-medium uppercase tracking-wide text-slate-400";
/** The long values (What to do, NDA) keep their scroll boxes, on a faint ground. */
const BOX = "rounded-md bg-white/[0.03] px-2 py-1 text-slate-100";

export function ListingPanel({ rows, listing, when, savedAt, side = "developer", intro, head, foot, after }: { rows: PanelRow[]; listing: Listing; when: (d: Date) => string; /** (Batch 35 §3) the Save this panel shows (its record's time; "" for none): See it waits for the line's Save */ savedAt?: string; side?: PanelSide; intro?: string; head?: React.ReactNode; foot?: React.ReactNode; after?: Partial<Record<PanelKey, React.ReactNode>> }) {
  const tag = (l: PanelRow) => (l.before != null ? <UpdatedTag when={l.updatedAt ? when(l.updatedAt) : ""} before={l.before} now={l.now} /> : null);
  const link = side === "developer" && listing.buildUrl; // (batch 35 §14) a tester gets the build link when they join
  return (
    <section className={`card scroll-mt-24${head ? " space-y-4" : ""}`} id="listing" data-listing-panel={side === "tester" ? "tester" : ""} data-saved-at={savedAt}>
      {head}
      <div>
        <h2 className="flex items-center gap-2 font-semibold text-white"><ClipboardList className="h-5 w-5 text-indigo-300" /> Listing</h2>
        <p className="text-xs text-slate-400">{intro ?? "What testers see now. A field your last save changed shows when: tap it for before and now."}</p>
        <ul className="mt-3 space-y-2.5 text-sm" data-listing-fields="">
          {rows.map((l) => (
            <li key={l.key} className="scroll-mt-24 rounded-lg px-1 transition-shadow data-[marked]:ring-2 data-[marked]:ring-sky-300" data-info-line={l.key} {...(l.before != null ? { "data-updated-at": l.updatedAt?.toISOString() ?? "" } : {})}>
              {/* (Batch 35 §15) The label: small, muted, uppercase, on its own line with its "Updated <time>" (Before / Now opens below it). */}
              <div className="leading-5"><span className={LABEL} data-panel-label="">{l.label}</span>{tag(l)}</div>
              <div className="mt-0.5 text-slate-100" data-panel-value="">
                {l.key === "description" && listing.description ? (
                  <ScrollText text={listing.description} className={BOX} label="What to do" />
                ) : l.key === "buildUrl" && link ? (
                  <a href={listing.buildUrl} target="_blank" rel="noreferrer" className="break-all">{listing.buildUrl}</a>
                ) : l.key === "questions" && listing.questions.length ? (
                  <QuestionList numbered items={listing.questions.map((q) => ({ text: qText(q), required: qRequired(q) }))} />
                ) : l.key === "ndaText" && listing.ndaText ? (
                  <ScrollText text={listing.ndaText} lines={4} className={BOX} label="NDA" />
                ) : (
                  <><span className="whitespace-pre-wrap break-words">{l.now}</span>{after?.[l.key]}</>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
      {foot}
    </section>
  );
}
