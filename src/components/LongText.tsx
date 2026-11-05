"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { ResizeBox, useInPanel } from "@/components/Panel";
import { OPEN_FOLD_TEXT } from "@/lib/markJump";

/**
 * (Owner, Nov 4, §182; generalises FieldNote's FoldText, Oct 28 batch 16 section 19) ONE fold for long text, used wherever a tester's question, answer or addition is
 * shown (the tester's own session page, the developer's tester rows, Needs you's parts, By question, the previous sets, the team's "See the work") and for the blue
 * notes' long values: folded, a question shows its first 2 lines and an answer or addition its first 3; text that fits shows whole, with no button; longer text
 * ends with "Show more", which opens the whole text in a scroll box about 8 lines tall (the draggable panel, ResizeBox §139, kept per panel id), and "Show less"
 * folds it back. The content can be any rendering (attachment markers, images, formatted runs): whether it is long is measured on the page; `text`, when given,
 * lets the first draw (the server's) already know a clearly short or clearly long text. The text stays selectable: only the button toggles.
 * A jump to something inside a folded one opens it (markJump's jumpTo sends OPEN_FOLD_TEXT).
 * (A question fold's own title is QuestionTitle, below: §187 replaced §182's `bare` fold under the title.)
 * (Owner, Nov 4, §187) Already inside a scroll panel (the answers panel in a part, in a person, in Needs you; the tester's "Your written answers"): Show more opens
 * the whole text inline, with no box of its own, and the outer panel scrolls it (the 8-line box inside it showed about 4 lines on a desktop, 2.5 on a phone).
 * Outside any panel it keeps the 8-line box.
 */
export const QUESTION_LINES = 2;
export const ANSWER_LINES = 3;
/** (§182) The open box: about 8 lines (plus the panel's padding) at first; the grip drags it like the other panels. */
export const FOLD_TEXT_OPEN = "calc(8lh + 1.5rem)";
/** The classes that cut the folded text at its lines (whole class names, so Tailwind keeps them). */
const CLAMP: Record<number, string> = { 1: "line-clamp-1", 2: "line-clamp-2", 3: "line-clamp-3", 4: "line-clamp-4" };

/** An attachment marker ("[📎 map.png #k3f9]", "[[attachment:…]]"): its file can be tall, so such text is always measured. */
const MARKER = /\[📎|\[\[attachment:/;

/** (§182) From the text alone: clearly long (more lines than shown, or very long), clearly short (one short line), or unknown (measured on the page). */
export function foldGuess(text: string | undefined, lines: number): boolean | null {
  if (text == null) return null;
  if (MARKER.test(text)) return null;
  const rows = text.split("\n").length;
  if (rows > lines || text.length > lines * 200) return true;
  if (rows === 1 && text.length <= 40) return false;
  return null;
}

export function LongText({ text, children, lines = ANSWER_LINES, id, label = "Text", className = "", inline = false }: {
  /** the plain text (shown when there are no children; also lets the first draw guess) */ text?: string; children?: ReactNode;
  /** folded: 2 for a question, 3 for an answer or an addition */ lines?: number;
  /** the open box's panel id (its dragged height is kept by it) */ id?: string; /** what's inside, for screen readers */ label?: string; className?: string;
  /** (Owner, Nov 4, §187) a question above its answer: Show more right after the cut text (beside its last line), and opened, the whole text with no box and
   * Show less right after its last word (never a button alone on a line between the question and the answer) */ inline?: boolean;
}) {
  const auto = useId();
  const inPanel = useInPanel();
  const panelId = id ?? `fold-text-${auto}`;
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState<boolean | null>(() => foldGuess(text, lines));
  const root = useRef<HTMLDivElement>(null);
  const cut = useRef<HTMLDivElement>(null);
  // Folded: is anything past the lines? Measured again when the width changes or an image in it loads; not while it isn't drawn (inside a closed fold).
  useLayoutEffect(() => {
    const el = cut.current;
    if (open || !el) return;
    const check = () => { if (el.getClientRects().length) setLong(el.scrollHeight > el.clientHeight + 1); };
    check();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    el.addEventListener("load", check, true);
    return () => { ro.disconnect(); el.removeEventListener("load", check, true); };
  }, [open, text, lines]);
  // (§182) A jump to something inside opens it at once, so the jump lands on the open text.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const openNow = () => flushSync(() => setOpen(true));
    el.addEventListener(OPEN_FOLD_TEXT, openNow);
    return () => el.removeEventListener(OPEN_FOLD_TEXT, openNow);
  }, []);
  // The button never toggles a fold it sits in (a <summary>).
  const toggle = (e: MouseEvent<HTMLButtonElement>) => { e.preventDefault(); e.stopPropagation(); setOpen(!open); };
  const body = children ?? <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{text}</div>;
  const state = open ? "open" : long === false ? "short" : "closed";
  const button = (
    <button type="button" className={`btn-ghost !px-2 !py-0.5 text-xs ${inline ? "ml-1 align-baseline" : "mt-0.5"}`} aria-expanded={open} data-fold-toggle="" onClick={toggle}>
      {open ? "Show less" : "Show more"}
    </button>
  );
  if (inline) {
    return (
      <div ref={root} className={["min-w-0", className].filter(Boolean).join(" ")} data-fold-text={state} data-fold-lines={lines} data-fold-inline="">
        {open ? (
          <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]" data-fold-open="inline">{children ?? text}{button}</div>
        ) : (
          <div className="flex items-end gap-1">
            <div ref={cut} className={`${CLAMP[lines] ?? "line-clamp-3"} min-w-0 flex-1 break-words [overflow-wrap:anywhere]`} data-fold-cut="">{body}</div>
            {long && <span className="shrink-0">{button}</span>}
          </div>
        )}
      </div>
    );
  }
  return (
    <div ref={root} className={["min-w-0", className].filter(Boolean).join(" ")} data-fold-text={state} data-fold-lines={lines}>
      {open ? (
        inPanel ? <div className="break-words [overflow-wrap:anywhere]" data-fold-open="inline">{body}</div> : <ResizeBox id={panelId} label={label} defaultMax={FOLD_TEXT_OPEN}>{body}</ResizeBox>
      ) : (
        <div ref={cut} className={`${CLAMP[lines] ?? "line-clamp-3"} break-words [overflow-wrap:anywhere]`} data-fold-cut="">{body}</div>
      )}
      {(open || long) && button}
    </div>
  );
}

/**
 * (Owner, Nov 4, §187) A question fold's title (in its <summary>): the question cut at 2 lines; when there's more, "Show more" sits right after it in the title
 * (it sat alone on a line of its own between the title and the answer, §182's `bare` fold). Show more opens the whole question in the title itself, with "Show
 * less" right after its last word. The buttons show only while the question's fold is open (globals.css), and the title goes back to 2 lines when it closes.
 * Never toggles the fold it sits in. `children`: what follows the text inside the title (the required mark).
 */
export function QuestionTitle({ text, children, className = "", label = "Question" }: { text: string; children?: ReactNode; className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState<boolean | null>(() => foldGuess(text, QUESTION_LINES));
  const root = useRef<HTMLSpanElement>(null);
  const title = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = title.current;
    if (open || !el) return;
    const check = () => { if (el.getClientRects().length) setLong(el.scrollHeight > el.clientHeight + 1); };
    check();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, text]);
  useEffect(() => {
    const el = root.current;
    const fold = el?.closest("details");
    if (!el) return;
    const openNow = () => flushSync(() => setOpen(true));
    const closed = () => { if (fold && !fold.open) setOpen(false); };
    el.addEventListener(OPEN_FOLD_TEXT, openNow);
    fold?.addEventListener("toggle", closed);
    return () => { el.removeEventListener(OPEN_FOLD_TEXT, openNow); fold?.removeEventListener("toggle", closed); };
  }, []);
  const toggle = (e: MouseEvent<HTMLButtonElement>) => { e.preventDefault(); e.stopPropagation(); setOpen(!open); };
  const button = (
    <button type="button" className="btn-ghost ml-1 !px-2 !py-0 align-baseline text-xs font-normal leading-4" aria-expanded={open} aria-label={`${open ? "Show less" : "Show more"} of the ${label.toLowerCase()}`}
      data-fold-toggle="" data-question-more="" onClick={toggle}>
      {open ? "Show less" : "Show more"}
    </button>
  );
  // Cut: the button floats at the right end of the 2nd line, the text running up to it (globals.css, data-question-clamp); the title keeps the whole width.
  return (
    <span ref={root} className={`flex min-w-0 flex-1 ${className}`} data-fold-text={open ? "open" : long === false ? "short" : "closed"} data-fold-lines={QUESTION_LINES}>
      <span ref={title} className="min-w-0 flex-1 [overflow-wrap:anywhere]" data-question-title="" data-question-clamp={open ? undefined : ""}>
        {!open && long && <span className="float-right clear-right" data-question-more-slot="">{button}</span>}
        {text}{children}{open && button}
      </span>
    </span>
  );
}
