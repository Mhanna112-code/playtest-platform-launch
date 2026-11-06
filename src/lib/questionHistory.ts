import { additionsUntil, writtenThreads, type AddedText } from "./additions";
import { prevSetsOf, versionsOf, type SetItem } from "./answerSets";
import { qOptional, qText } from "./questions";

/**
 * (Owner, Nov 5, batch 35 §263, final; replaces §234's Past questions box and §254's earlier-set answers in it) Old questions live only in Terms history. Each
 * change of a tester's questions is one entry, "Questions changed <date/time>", Then → Now:
 * - Then: the questions as they were, each with what this tester had for it at that moment: their sent answer and its additions (the part's additions up to the
 *   change); otherwise their unsent draft ("Draft (not sent)", the tester's side only); otherwise "(no answer)".
 * - Now: the questions it changed to.
 * The entries come from the contract's earlier sets (`Contract.prevSets`, written at the change: the questions then, the draft-or-sent answers, and the "sent" and
 * "draft" versions; since §263 also `to`, the questions it changed to). An older set without `to` reads its Now from the next set (or the questions now).
 */
export type HistoryQuestion = { question: string; required: boolean; sent: { answer: string; adds: AddedText[] } | null; draft: string | null };
export type QuestionsChange = { at: string; then: HistoryQuestion[]; now: { question: string; required: boolean }[] };

export function questionChanges(prevSets: unknown, current: string[], sub: { answers: unknown; additions?: unknown } | null, opts: { drafts: boolean }): QuestionsChange[] {
  const sets = prevSetsOf(prevSets).sort((a, b) => new Date(a.until).getTime() - new Date(b.until).getTime());
  const asNow = (qs: string[]) => qs.map((q) => ({ question: qText(q), required: !qOptional(q) }));
  return sets.map((p, i) => {
    const qs = p.items.map((it) => it.question);
    const versions = versionsOf(p, !!sub);
    const sentV = versions.find((v) => v.kind === "sent")?.items ?? [];
    const draftV = versions.find((v) => v.kind === "draft")?.items ?? [];
    const byWords = (items: SetItem[], q: string) => items.find((x) => qText(x.question) === qText(q))?.answer ?? "";
    // What was sent up to the change, by the question's words (the answer and each addition to it).
    const threads = sub ? writtenThreads(sub.answers, qs, additionsUntil(sub.additions, p.until)).threads : [];
    const then = p.items.map((it): HistoryQuestion => {
      const t = threads.find((x) => qText(x.question) === qText(it.question));
      const sentText = byWords(sentV, it.question);
      // The part's thread for it (its answer and additions up to the change); a set sent before §136 (replaced later, so no thread holds it): its own sent answer.
      const fromThread = t && (t.answer.trim() || t.adds.length) && (!sentText.trim() || (t.latest ?? t.answer) === sentText);
      const sent = fromThread ? { answer: t!.answer, adds: t!.adds } : sentText.trim() ? { answer: sentText, adds: [] } : null;
      const draftText = byWords(draftV, it.question);
      return { question: qText(it.question), required: it.required, sent, draft: !sent && opts.drafts && draftText.trim() ? draftText : null };
    });
    const next = p.to ?? (sets[i + 1] ? sets[i + 1].items.map((x) => (x.required ? `[required] ${x.question}` : x.question)) : current);
    return { at: p.until, then, now: asNow(next) };
  });
}
