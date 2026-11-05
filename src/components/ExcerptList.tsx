import { Cut, TestName } from "@/components/Cut";
import { QuestionText, ValueText } from "@/components/QA";
import { ExcerptRemove } from "@/components/Excerpts";
import { qText } from "@/lib/questions";

type Mine = { id: string; text: string; source: string; testTitle: string; state: string; question?: string };

/** (Owner, Oct 28, batch 16 section 37) The written part's "Anything else" box, as an excerpt's question reads it. */
export const ANYTHING_ELSE = "Anything else (bugs, ideas)";
/** The question an excerpt answers, as shown above it ("[not required]" left out; the "Anything else" box by its label). */
export const excerptQuestion = (q: string | null | undefined) => qText(q ?? "").trim() || ANYTHING_ELSE;
/**
 * The question above the quote. (Owner, Nov 5, §237) In its question box ("Question", QA's QuestionText: drags taller, its own scroll), no Show more.
 * `id`: the excerpt's (or the request's) id; the box is `excerpt-q-<id>`.
 */
export function ExcerptQuestion({ id, question }: { id: string; question: string | null | undefined }) {
  return (
    <div className="block" data-excerpt-question="">
      <QuestionText id={`excerpt-q-${id}`} label="Question">{excerptQuestion(question)}</QuestionText>
    </div>
  );
}

/** (Owner, Nov 5, §237) An excerpt's quote in the shared box for long text (QA's ValueText), in “…”. `id`: unique on the page. */
export function ExcerptQuote({ id, text, label = "Excerpt" }: { id: string; text: string; label?: string }) {
  return <div className="min-w-0" data-excerpt-quote=""><ValueText id={id} label={label}>{`“${text}”`}</ValueText></div>;
}

/** (Batch 35 §126) The developer's request row when Allow would replace the excerpt shown now for that question. */
export const REPLACES_LINE = "Replaces the excerpt shown now";
/** (Batch 35 §126) On the developer's request row: the excerpt(s) shown now for that question, which Allow replaces (Deny keeps them). */
export function ExcerptReplaces({ id, texts }: { /** the request's id */ id: string; texts: string[] }) {
  if (!texts.length) return null;
  return (
    <div className="space-y-1 rounded-md border border-amber-300/20 bg-amber-300/[0.04] p-2" data-excerpt-replaces="">
      <p className="text-xs font-medium text-amber-200">{REPLACES_LINE}:</p>
      {texts.map((t, i) => <ExcerptQuote key={i} id={`excerpt-replaces-${id}-${i}`} label="The excerpt shown now" text={t} />)}
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
              <div className="min-w-0 flex-1 space-y-1">
                <ExcerptQuestion id={x.id} question={x.question} />
                <ExcerptQuote id={`excerpt-text-${x.id}`} text={x.text} />
                <span className="block text-xs text-slate-400">From <TestName text={x.testTitle} /> (shown as <Cut text={x.source} kind="product" />) · {x.state}</span>
              </div>
              {canRemove && <ExcerptRemove excerptId={x.id} />}
            </li>
          ))}
      </ul>
    </section>
  );
}

/** Shown excerpts as others see them (the profile): plain quotes, up to 3. (Batch 35 §162) The heading in the tester's own pronoun ("Excerpts of her work"). */
export function ShownExcerpts({ items, poss = "their" }: { items: { id: string; text: string; source: string; question?: string }[]; poss?: string }) {
  if (!items.length) return null;
  return (
    <section className="card space-y-2" aria-label="Excerpts" data-shown-excerpts="">
      <h2 className="font-semibold text-white">Excerpts of {poss} work</h2>
      <ul className="space-y-2">
        {items.map((x) => (
          <li key={x.id} className="space-y-1 text-sm">
            <ExcerptQuestion id={x.id} question={x.question} />
            <ExcerptQuote id={`excerpt-text-${x.id}`} text={x.text} />
            <span className="block text-xs text-slate-400">From {x.source}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
