"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { ResizeBox } from "@/components/Panel";
import { OPEN_FOLD_TEXT } from "@/lib/markJump";

/**
 * (Owner, Nov 4, §182; generalises FieldNote's FoldText, Oct 28 batch 16 section 19) ONE fold for long text, used wherever a tester's question, answer or addition is
 * shown (the tester's own session page, the developer's tester rows, Needs you's parts, By question, the previous sets, the team's "See the work") and for the blue
 * notes' long values: folded, a question shows its first 2 lines and an answer or addition its first 3; text that fits shows whole, with no button; longer text
 * ends with "Show more", which opens the whole text in a scroll box about 8 lines tall (the draggable panel, ResizeBox §139, kept per panel id), and "Show less"
 * folds it back. The content can be any rendering (attachment markers, images, formatted runs): whether it is long is measured on the page; `text`, when given,
 * lets the first draw (the server's) already know a clearly short or clearly long text. The text stays selectable: only the button toggles.
 * A jump to something inside a folded one opens it (markJump's jumpTo sends OPEN_FOLD_TEXT).
 * `bare`: the first lines already show just above (a question fold's title, cut at 2 lines): folded, only Show more (when there's more), so they aren't shown twice.
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

export function LongText({ text, children, lines = ANSWER_LINES, id, label = "Text", className = "", bare = false }: {
  /** the plain text (shown when there are no children; also lets the first draw guess) */ text?: string; children?: ReactNode;
  /** folded: 2 for a question, 3 for an answer or an addition */ lines?: number;
  /** the open box's panel id (its dragged height is kept by it) */ id?: string; /** what's inside, for screen readers */ label?: string; className?: string;
  /** folded, the text itself isn't drawn (it shows just above): only measured, and Show more */ bare?: boolean;
}) {
  const auto = useId();
  const panelId = id ?? `fold-text-${auto}`;
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState<boolean | null>(() => foldGuess(text, lines));
  const root = useRef<HTMLDivElement>(null);
  const cut = useRef<HTMLDivElement>(null);
  // Folded: is anything past the lines? Measured again when the width changes or an image in it loads; not while it isn't drawn (inside a closed fold).
  // `bare`: the title above is what's cut (its own 2-line cut, its own width), so it is the one measured when there is one.
  useLayoutEffect(() => {
    const clone = cut.current;
    if (open || !clone) return;
    const title = bare ? root.current?.closest("details")?.querySelector<HTMLElement>(":scope > summary [data-question-title]") : null;
    const el = title ?? clone;
    const check = () => { if (el.getClientRects().length) setLong(el.scrollHeight > el.clientHeight + 1); };
    check();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    clone.addEventListener("load", check, true);
    return () => { ro.disconnect(); clone.removeEventListener("load", check, true); };
  }, [open, text, lines, bare]);
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
  return (
    <div ref={root} className={["min-w-0", bare && "relative", className].filter(Boolean).join(" ")} data-fold-text={state} data-fold-lines={lines}>
      {open ? (
        <ResizeBox id={panelId} label={label} defaultMax={FOLD_TEXT_OPEN}>{body}</ResizeBox>
      ) : (
        <div ref={cut} className={`${CLAMP[lines] ?? "line-clamp-3"} break-words [overflow-wrap:anywhere] ${bare ? "pointer-events-none invisible absolute inset-x-0 top-0" : ""}`} aria-hidden={bare || undefined} data-fold-cut={bare ? "bare" : ""}>{body}</div>
      )}
      {(open || long) && (
        <button type="button" className="btn-ghost mt-0.5 !px-2 !py-0.5 text-xs" aria-expanded={open} aria-label={bare ? `${open ? "Show less" : "Show more"} of the ${label.toLowerCase()}` : undefined} data-fold-toggle="" onClick={toggle}>
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
