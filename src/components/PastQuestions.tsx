import type { ReactNode } from "react";
import { ResizeBox } from "@/components/Panel";

/** (§234) The box's heading: "Past questions (2)". */
export const pastQuestionsTitle = (n: number) => `Past questions (${n})`;

/**
 * (Owner, Nov 5, batch 35 §234) Everything past of a written part in one place: each question no longer in the tester's contract, read-only, with its sent answer
 * and its additions (SentWork part="past", the QA boxes), then the earlier "Previous questions and answers (until <date>)" folds (PrevSetFolds, as they were). A
 * draggable panel (ResizeBox; the boxes inside keep their own scroll, OwnPanel), headed "Past questions (N)", drawn only when N > 0. No Add / Answer row: a past
 * question is never added to (the server refuses it too). The tester's session page draws it under "Your written answers"; the developer's Testers list at the
 * bottom of the part's written answers.
 */
export function PastQuestions({ id, count, children }: { id: string; count: number; children?: ReactNode }) {
  if (count <= 0) return null;
  return (
    <section className="space-y-1" data-past-questions={count}>
      <p className="text-sm font-medium text-white" data-past-questions-title="">{pastQuestionsTitle(count)}</p>
      <ResizeBox id={id} label="Past questions">{children}</ResizeBox>
    </section>
  );
}

/** (§234) How many past questions: the part's (their threads) and those of the earlier sets shown with them, each counted once by its words. */
export function pastCount(threadQuestions: string[], prevSetQuestions: string[], isPast: (q: string) => boolean, norm: (q: string) => string) {
  return new Set([...threadQuestions, ...prevSetQuestions.filter(isPast)].map(norm)).size;
}
