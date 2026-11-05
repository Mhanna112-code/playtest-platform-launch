import type { ReactNode } from "react";
import { OwnPanel, ResizeBox } from "@/components/Panel";

/**
 * (Owner, Nov 5, batch 35 §223) ONE look for a question and an answer wherever they are shown: the tester's "Your written answers" and previous sets, the
 * developer's tester rows, Needs you and By question, the team's "See the work", and the new terms' "The questions changed" blocks.
 * - A question: a small label ("Question 1", with a small "Required" tag), its text in a quieter tone (slate, italic, medium weight) on a faint background.
 * - An answer: a label ("Answer", or "Added · <date>" for an addition), its text in the normal bright tone, with a volt left accent border.
 * Each text is in its own box that scrolls and drags taller (ResizeBox: 6rem at first, the grip drags it to 60% of the screen). These boxes always sit inside
 * another panel (the answers panel, Needs you's part, a person's drop-down), so each is in OwnPanel: a nested ResizeBox is flat otherwise (§187). One scroll per
 * text: no Show more inside a box. Long words wrap anywhere, so a 375 px phone never scrolls sideways.
 */
export const QA_BOX_MAX = "6rem";
export const QA_BOX_TALLEST = 0.6;
const LABEL = "flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-semibold text-slate-400";

/** The small "Required" tag on a question. */
export function RequiredTag() {
  return <span className="rounded border border-white/20 px-1 text-[10px] font-normal normal-case text-slate-400" data-required-tag="">Required</span>;
}

/** A question's text in its box, under its label ("Question 1"). `id`: unique on the page (the box keeps its dragged height by it). */
export function QuestionText({ id, label, required = false, children }: { id: string; label: string; required?: boolean; children?: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1" data-qa="question">
      <p className={LABEL} data-qa-label="">{label}{required && <RequiredTag />}</p>
      <OwnPanel>
        <ResizeBox id={id} label={label} defaultMax={QA_BOX_MAX} tallest={QA_BOX_TALLEST} className="!bg-white/[0.05]">
          <div className="whitespace-pre-wrap break-words text-sm font-medium italic text-slate-300 [overflow-wrap:anywhere]" data-qa-text="question">{children}</div>
        </ResizeBox>
      </OwnPanel>
    </div>
  );
}

/**
 * An answer (or an addition) in its box, under its label: "Answer" by default, or a node of its own (AddedLabel's "Added · <date>"). `name`: what the box is,
 * for screen readers. `empty`: nothing to show: the label and "(no answer)" in grey, no box.
 */
export function AnswerText({ id, label = "Answer", name, empty = false, emptyText = "(no answer)", children }: {
  id: string; label?: ReactNode; name?: string; empty?: boolean; emptyText?: string; children?: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1" data-qa="answer">
      {typeof label === "string" ? <p className={LABEL} data-qa-label="">{label}</p> : label}
      {empty ? <p className="text-sm text-slate-500" data-no-answer="">{emptyText}</p> : (
        <OwnPanel>
          <ResizeBox id={id} label={name ?? (typeof label === "string" ? label : "Answer")} defaultMax={QA_BOX_MAX} tallest={QA_BOX_TALLEST} className="!border-l-2 !border-l-volt-300/60">
            <div className="break-words text-sm text-slate-100 [overflow-wrap:anywhere]" data-qa-text="answer">{children}</div>
          </ResizeBox>
        </OwnPanel>
      )}
    </div>
  );
}

/**
 * (Owner, Nov 5, batch 35 §231) The same box for every long text from the contract or the listing: the test's title and product name, what testers should do, the
 * build link (still a link, clickable), the Mature reason, the NDA, and each "Updated" Before / Now. Its label is shown above it by the caller (FieldLabel); the
 * text bright on a faint background, scrolling and dragging taller like the question and answer boxes (ResizeBox in OwnPanel). `defaultMax`: the NDA starts taller.
 * Short values (a price, Required, the days) stay plain lines.
 */
export function ValueText({ id, label, defaultMax = QA_BOX_MAX, children }: { id: string; label: string; defaultMax?: string; children?: ReactNode }) {
  return (
    <OwnPanel>
      <ResizeBox id={id} label={label} defaultMax={defaultMax} tallest={QA_BOX_TALLEST} className="!bg-white/[0.03]">
        <div className="whitespace-pre-wrap break-words text-sm text-slate-100 [overflow-wrap:anywhere]" data-qa-text="value">{children}</div>
      </ResizeBox>
    </OwnPanel>
  );
}

/** (§231) A contract's or a listing's questions: each its own question box ("Question N", "Required" a tag), in order. `id`: unique on the page. */
export function QuestionTexts({ id, items, empty = "none" }: { id: string; items: { text: string; required?: boolean }[]; empty?: string }) {
  if (!items.length) return <span>{empty}</span>;
  return (
    <ol className="space-y-2" data-question-texts="">
      {items.map((q, i) => <li key={i} data-question=""><QuestionText id={`${id}-${i}`} label={`Question ${i + 1}`} required={q.required}>{q.text}</QuestionText></li>)}
    </ol>
  );
}

/** (§231) The NDA box's first height (it is read before agreeing, so it starts taller than the other boxes). */
export const NDA_BOX_MAX = "12rem";
