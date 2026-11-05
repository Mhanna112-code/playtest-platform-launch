import type { ReactNode } from "react";
import { ResizeBox } from "@/components/Panel";

/** (§237) The answers box's first height (it was a fixed 20rem). */
export const ANSWERS_BOX_MAX = "20rem";

/**
 * (Owner, Oct 29, batch 10) One piece's written answers, as the team reads them in "See the work" (DisputeWork): the question labels inside it, scrolling as one.
 * (Owner, Nov 5, §237) It is the draggable panel (ResizeBox): 20rem at first (a short piece only as tall as it is), the grip drags it to 60% of the screen, the
 * height kept by `id`. The panels inside it are plain (§187); the question and answer boxes keep their own (QA).
 */
export function AnswersBox({ id, children }: { /** unique on the page, e.g. "answers-<piece>" */ id: string; children: ReactNode }) {
  return (
    <ResizeBox id={id} label="Written answers" defaultMax={ANSWERS_BOX_MAX}>
      <div className="space-y-2" data-answers-box="panel">{children}</div>
    </ResizeBox>
  );
}
