import type { ReactNode } from "react";
import { OwnPanel, ResizeBox } from "@/components/Panel";

/**
 * (Owner, Nov 5, batch 35 §223) ONE look for a question and an answer wherever they are shown: the tester's "Your written answers" and previous sets, the
 * developer's tester rows, Needs you and By question, the team's "See the work", and the new terms' "The questions changed" blocks.
 * - A question: a small label ("Question 1", with a small "Required" tag), its text in a quieter tone (slate, italic, medium weight) on a faint background.
 * - An answer: a label ("Answer", or "Added · <date>" for an addition), its text in the normal bright tone, with a volt left accent border.
 * (Owner, Nov 5, §256; replaces §223's faint question box, which was hard to tell from an answer) Told apart at a glance: a question is a SKY-tinted box (tint,
 * border and a sky left accent; its text sky-pale, italic) under a sky label; an answer keeps the normal dark box with the volt left accent, under a volt label
 * ("Answer", "Notes"). "Added · <date>" keeps its own green label (AddedLabel). Sky, not indigo: this app's indigo is remapped to volt (tailwind.config.ts).
 * Each text is in its own box that scrolls and drags taller (ResizeBox: 6rem at first, the grip drags it to 60% of the screen). These boxes always sit inside
 * another panel (the answers panel, Needs you's part, a person's drop-down), so each is in OwnPanel: a nested ResizeBox is flat otherwise (§187). One scroll per
 * text: no Show more inside a box. Long words wrap anywhere, so a 375 px phone never scrolls sideways.
 */
export const QA_BOX_MAX = "6rem";
export const QA_BOX_TALLEST = 0.6;
const LABEL = "flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-semibold";
/** (Owner, Nov 5, §256) The question's label in the box's tint; the answer's in volt. */
export const QUESTION_LABEL = `${LABEL} text-sky-300`;
export const ANSWER_LABEL = `${LABEL} text-volt-300`;
/** (§256) The question box: a sky tint, a matching border and a matching left accent. */
export const QUESTION_BOX = "!border-sky-300/30 !border-l-2 !border-l-sky-300/70 !bg-sky-400/[0.08]";
/** (§256; as §223) The answer box: the normal dark box with the volt left accent. */
export const ANSWER_BOX = "!border-l-2 !border-l-volt-300/60";

/** The small "Required" tag on a question. */
export function RequiredTag() {
  return <span className="rounded border border-white/20 px-1 text-[10px] font-normal normal-case text-slate-400" data-required-tag="">Required</span>;
}

/** A question's text in its box, under its label ("Question 1"). `id`: unique on the page (the box keeps its dragged height by it). */
export function QuestionText({ id, label, required = false, showLabel = false, children }: { id: string; label: string; required?: boolean;
  /** (§259) shown above the box: only where the label says which version it is (the questions changed' "Before" / "After") */ showLabel?: boolean; children?: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1" data-qa="question">
      {/* (Owner, Nov 5, §256) The sky-tinted box: never mistaken for an answer. (Owner, Nov 5, §259) No label over a question ("Question 1"): the box says it is
          one; the label is kept for screen readers, a Required question keeps its tag, and "Before" / "After" still show. */}
      {showLabel ? <p className={QUESTION_LABEL} data-qa-label="">{label}{required && <RequiredTag />}</p> : <>
        <span className="sr-only">{label}</span>
        {required && <p className={QUESTION_LABEL} data-qa-required="">{<RequiredTag />}</p>}
      </>}
      <OwnPanel>
        <ResizeBox id={id} label={label} defaultMax={QA_BOX_MAX} tallest={QA_BOX_TALLEST} className={QUESTION_BOX}>
          <div className="whitespace-pre-wrap break-words text-sm font-medium italic text-sky-100 [overflow-wrap:anywhere]" data-qa-text="question">{children}</div>
        </ResizeBox>
      </OwnPanel>
    </div>
  );
}

/**
 * An answer (or an addition) in its box, under its label: "Answer" by default, or a node of its own (AddedLabel's "Added · <date>"). `name`: what the box is,
 * for screen readers. `empty`: nothing to show: the label and "(no answer)" in grey, no box.
 */
export function AnswerText({ id, label = "Answer", name, empty = false, emptyText = "(no answer)", defaultMax = QA_BOX_MAX, textClassName = "", children }: {
  id: string; label?: ReactNode; name?: string; empty?: boolean; emptyText?: string; /** (§256) the box's first height (the excerpt picker's is taller) */ defaultMax?: string;
  /** (§256) more classes on the text (the excerpt picker keeps its line breaks) */ textClassName?: string; children?: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1" data-qa="answer">
      {/* (Owner, Nov 5, §256) A string label in volt (an "Added · <date>" node keeps its own green); the normal box with the volt accent. */}
      {typeof label === "string" ? <p className={ANSWER_LABEL} data-qa-label="">{label}</p> : label}
      {empty ? <p className="text-sm text-slate-500" data-no-answer="">{emptyText}</p> : (
        <OwnPanel>
          <ResizeBox id={id} label={name ?? (typeof label === "string" ? label : "Answer")} defaultMax={defaultMax} tallest={QA_BOX_TALLEST} className={ANSWER_BOX}>
            <div className={`break-words text-sm text-slate-100 [overflow-wrap:anywhere]${textClassName ? ` ${textClassName}` : ""}`} data-qa-text="answer">{children}</div>
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
/**
 * (Owner, Nov 5, §249; as the new-terms "questions changed", §233/§242) Every list of questions (the contract's terms, the listing information on both sides, the join
 * page, Terms history, Edit's notes): one drop-down "Questions (N)", its list in the draggable scroll panel, and each question its own drop-down ("Question 3 ·
 * Required · <its first words>", closed), its words in the question box when opened.
 */
export function QuestionTexts({ id, items, empty = "none", open = false, label = "Questions" }: { id: string; items: { text: string; required?: boolean }[]; empty?: string; /** the outer drop-down starts open */ open?: boolean; label?: string }) {
  if (!items.length) return <span>{empty}</span>;
  return (
    <details className="group/qs" open={open} data-question-texts="">
      <summary className="cursor-pointer font-medium text-slate-200" data-questions-toggle="">{label} ({items.length})</summary>
      <div className="mt-1.5">
        <OwnPanel><ResizeBox id={`${id}-list`} label={label} defaultMax="min(24rem, 55vh)" tallest={0.8}>
          <ol className="space-y-1.5">
            {items.map((q, i) => (
              <li key={i} data-question="">
                <details className="rounded-lg border border-white/10 px-2 py-1.5">
                  <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-2 text-sm" data-question-summary="">
                    <span className="font-medium">Question {i + 1}</span>
                    {q.required && <span className="badge text-xs">Required</span>}
                    <span className="min-w-0 flex-1 truncate font-normal text-slate-400">{q.text}</span>
                  </summary>
                  <div className="mt-1.5"><QuestionText id={`${id}-${i}`} label={`Question ${i + 1}`} required={q.required}>{q.text}</QuestionText></div>
                </details>
              </li>
            ))}
          </ol>
        </ResizeBox></OwnPanel>
      </div>
    </details>
  );
}

/**
 * (Owner, Nov 5, §237) A box's id made from its text, for a box with no record id of its own (a reason, a note's before / after): `<prefix>-<hash>`. The same
 * text gets the same id (its dragged height is kept by it); a plain string hash, the same on the server and in the browser.
 */
export function textId(prefix: string, text: string) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `${prefix}-${(h >>> 0).toString(36)}`;
}

/** (§237) A bio's first height (about 6 lines: it is the About section's whole content). */
export const BIO_BOX_MAX = "9rem";

/** (§231) The NDA box's first height (it is read before agreeing, so it starts taller than the other boxes). */
export const NDA_BOX_MAX = "12rem";
