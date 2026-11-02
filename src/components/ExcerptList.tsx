import { ClampText } from "@/components/ClampText";
import { ExcerptRemove } from "@/components/Excerpts";
import { qText } from "@/lib/questions";

type Mine = { id: string; text: string; source: string; testTitle: string; state: string; question?: string };

/** (Owner, Oct 28, batch 16 section 37) The written part's "Anything else" box, as an excerpt's question reads it. */
export const ANYTHING_ELSE = "Anything else (bugs, ideas)";
/** The question an excerpt answers, as shown above it ("[not required]" left out; the "Anything else" box by its label). */
export const excerptQuestion = (q: string | null | undefined) => qText(q ?? "").trim() || ANYTHING_ELSE;
/** The question above the quote: small grey text, 2 lines, then "Show more". */
export function ExcerptQuestion({ question }: { question: string | null | undefined }) {
  return (
    <span className="block" data-excerpt-question="">
      <ClampText text={excerptQuestion(question)} lines={2} className="text-xs text-slate-400" />
    </span>
  );
}

/** (Batch 35 §126) The developer's request row when Allow would replace the excerpt shown now for that question. */
export const REPLACES_LINE = "Replaces the excerpt shown now";
/** (Batch 35 §126) On the developer's request row: the excerpt(s) shown now for that question, which Allow replaces (Deny keeps them). */
export function ExcerptReplaces({ texts }: { texts: string[] }) {
  if (!texts.length) return null;
  return (
    <div className="space-y-1 rounded-md border border-amber-300/20 bg-amber-300/[0.04] p-2" data-excerpt-replaces="">
      <p className="text-xs font-medium text-amber-200">{REPLACES_LINE}:</p>
      {texts.map((t, i) => <ClampText key={i} text={`“${t}”`} className="text-xs text-slate-400" />)}
    </div>
  );
}

/** (Owner, Nov 1) Accepted excerpts with Remove, only on the tester's own profile. */
export function MyExcerpts({ items, canRemove = true }: { items: Mine[]; canRemove?: boolean }) {
  if (!items.length) return null;
  return (
    <section className="card space-y-3 scroll-mt-24" id="excerpts" aria-label="Your excerpts">
      <h2 className="font-semibold text-white">Your excerpts</h2>
      <p className="text-sm text-slate-400">Excerpts of your paid written answers accepted by the developer.</p>
      <ul className="space-y-2">
          {items.map((x) => (
            <li key={x.id} className="flex flex-wrap items-start gap-2 rounded-lg border border-white/[0.08] p-2 text-sm" data-my-excerpt={x.state}>
              <span className="min-w-0 flex-1 space-y-0.5">
                <ExcerptQuestion question={x.question} />
                <ClampText text={`“${x.text}”`} className="text-slate-200" />
                <span className="block text-xs text-slate-400">From {x.testTitle} (shown as {x.source}) · {x.state}</span>
              </span>
              {canRemove && <ExcerptRemove excerptId={x.id} />}
            </li>
          ))}
      </ul>
    </section>
  );
}

/** Shown excerpts as others see them (the profile): plain quotes, up to 3. */
export function ShownExcerpts({ items }: { items: { id: string; text: string; source: string; question?: string }[] }) {
  if (!items.length) return null;
  return (
    <section className="card space-y-2" aria-label="Excerpts" data-shown-excerpts="">
      <h2 className="font-semibold text-white">Excerpts of their work</h2>
      <ul className="space-y-2">
        {items.map((x) => (
          <li key={x.id} className="text-sm">
            <ExcerptQuestion question={x.question} />
            <ClampText text={`“${x.text}”`} className="text-slate-200" />
            <span className="text-xs text-slate-400">From {x.source}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
