import { OwnPanel, ResizeBox } from "@/components/Panel";
import { QA_BOX_MAX, QA_BOX_TALLEST, textId } from "@/components/QA";

/**
 * (Owner, Oct 30, batch 15 sections 3, 17 and 20) A reason or a note, italic and quoted.
 * (Owner, Nov 5, §237) It is the shared draggable box (ResizeBox in OwnPanel, as QA.tsx's boxes): about 4 lines (6rem) at first, the grip drags it to 60% of
 * the screen, its own scroll at any height, even inside another panel. The quote look stays: italic, in “…”, with a left rule. Used for every reason and note:
 * dispute reasons, the developer's side, the team's decision and pause notes, stop and end-early reasons, call cancel / no-show / length notes, the admin's
 * suspend, delete, report and q-reason notes, an application's note, rating comments. One scroll per text: no Show more. Long words wrap anywhere (375px phones
 * never scroll sideways). `id`: unique on the page (the box keeps its dragged height by it); by default one made from the text. Usable from server components.
 * (§237) The old fixed `ScrollText` box is gone: its last uses (the join page's questions, the admin's Contact us messages) are boxes now.
 */
export const REASON_BOX_MAX = QA_BOX_MAX;
/** A colour class the caller passes (text-rose-50, text-slate-300…) replaces the default slate-200; a size (text-sm) doesn't. */
const COLOR = /(^|\s)text-[a-z]+-\d/;

export function ReasonQuote({ text, className = "", id, label = "Reason" }: { text: string; className?: string; id?: string; /** what the box holds, for screen readers */ label?: string }) {
  const t = text.trim();
  if (!t) return null;
  return (
    <div className={`min-w-0 max-w-full ${COLOR.test(className) ? "" : "text-slate-200"} ${className}`} data-reason="">
      <OwnPanel>
        <ResizeBox id={id ?? textId("reason", t)} label={label} defaultMax={REASON_BOX_MAX} tallest={QA_BOX_TALLEST} className="!border-l-2 !border-l-white/20">
          <blockquote className="whitespace-pre-wrap break-words italic [overflow-wrap:anywhere]" data-reason-text="">“{t}”</blockquote>
        </ResizeBox>
      </OwnPanel>
    </div>
  );
}
