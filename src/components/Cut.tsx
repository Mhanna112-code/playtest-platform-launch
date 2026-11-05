"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { OwnPanel, ResizeBox } from "@/components/Panel";
import { NAME_CUT, cutEmail, cutTo } from "@/lib/rules";

/** What a listed name is: a person, a test, a product, or an email. A linked one's pop-up offers "Open profile →" or "Open test →". */
export type CutKind = "person" | "test" | "product" | "email";

/** (Owner, Nov 3) How a listed name is drawn: cut at NAME_CUT (20; owner, Nov 5, §203: was 12) characters with "…" (cutTo); an email in the middle (cutEmail). */
export const cutText = (text: string, kind: CutKind = "person", n = NAME_CUT) => (kind === "email" ? cutEmail(text) : cutTo(text, n));

/** A screen with no hover (a phone or a tablet): there a cut name opens a small pop-up instead of a tooltip. */
export const touchOnly = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(hover: none)").matches;

/**
 * Whether a tap on a name opens the pop-up: a cut name. (Owner, Nov 5, §244; was touch screens only, with a mouse hover elsewhere) On every device, so the whole
 * name or email is always one press away (no hover); the pop-up holds it in the draggable box, with the name's link and Copy.
 */
export const opensPopup = (cut: boolean, _touch?: boolean) => cut;

/** The pop-up's link, when the name is a link: a person's profile, or a test. */
export const openLabel = (kind: CutKind) => (kind === "test" || kind === "product" ? "Open test →" : "Open profile →");

/** Copies the full text: the Clipboard API, else the older way through a hidden text box. Says whether it worked. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // the older way below
  }
  try {
    const box = document.createElement("textarea");
    box.value = text;
    box.setAttribute("readonly", "");
    box.style.position = "fixed";
    box.style.opacity = "0";
    document.body.appendChild(box);
    box.select();
    const ok = document.execCommand("copy");
    box.remove();
    return ok;
  } catch {
    return false;
  }
}

type At = { x: number; y: number; below: boolean; href: string | null };

/**
 * (Owner, Nov 3) A name (a person, a test, a product) or an email LISTED on a page. A long one is drawn cut ("Alexandria…", "maximi…@playtest.test") with a
 * dotted underline, while the full text stays in the page: a visually hidden copy right after it (so selecting and copying the row gives the full name, never the
 * cut one), and `title` and `aria-label`. Ten characters or fewer (an email that needs no cut): drawn as it is, with no underline and no title.
 * - With a mouse: the browser's tooltip shows the full text; a click does what it did before (a name that is a link opens the profile or the test).
 * - On a touch screen (no hover): tapping a CUT name opens a small pop-up instead: the full text in a scroll box about 6 lines tall, "Open profile →" / "Open test
 *   →" when the name is a link, and Copy ("Copied"). It closes on a tap outside it, on Escape or when the page scrolls, and it stays on the screen (at most 78% of
 *   its width). Tapping a name that isn't cut works as before.
 */
export function Cut({ text, kind = "person", n = NAME_CUT, className = "", fit = false }: { text: string; kind?: CutKind; n?: number; className?: string;
  /** (Owner, Nov 4, §187) cut only when the row is actually full: the whole name, cut with "…" by the width it has (CSS), never at a fixed number of characters */ fit?: boolean }) {
  const full = text ?? "";
  const shown = cutText(full, kind, n);
  const cut = shown !== full;
  const [at, setAt] = useState<At | null>(null);
  const onClick = useCallback((e: ReactMouseEvent<HTMLSpanElement>) => {
    // (Owner, Nov 5, §244) A name of 20 characters or fewer never opens it (nothing to expand), even when a tight row cuts it by width.
    if (!opensPopup(fit ? overflows(e.currentTarget) && Array.from(full).length > n : cut, touchOnly())) return;
    // The tap opens the pop-up instead of following the link the name sits in (the pop-up offers that link).
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const link = e.currentTarget.closest("a[href]") as HTMLAnchorElement | null;
    link?.blur(); // a hover card shown on focus (PersonHover) gives way to the pop-up
    const below = r.bottom + 180 < window.innerHeight;
    setAt({ x: r.left, y: below ? r.bottom + 6 : r.top - 6, below, href: link?.getAttribute("href") ?? null });
  }, [cut, fit]);
  const close = useCallback(() => setAt(null), []);
  // (Owner, Nov 4, §187) Fitted: the whole name, cut by the width it has; the tooltip (with a mouse) and the tap pop-up only when it is cut now.
  if (fit) {
    return (
      <span className={`inline-block min-w-0 max-w-full truncate align-bottom ${className}`} data-cut-fit={kind} onClick={onClick}
        onMouseEnter={(e) => { e.currentTarget.title = overflows(e.currentTarget) ? full : ""; }}>
        {full}
        {at && <CutPopup full={full} kind={kind} at={at} onClose={close} />}
      </span>
    );
  }
  // Not cut: exactly the text, as before (no wrapper, no underline, no title).
  if (!cut) return className ? <span className={className}>{full}</span> : <>{full}</>;
  return (
    <span className={`cursor-pointer ${className}`.trim()} title={full} aria-label={full} onClick={onClick} data-cut={kind}>
      <span aria-hidden="true" className="select-none underline decoration-dotted decoration-1 underline-offset-2" data-cut-shown="">{shown}</span>
      <span className="sr-only" data-cut-full="">{full}</span>
      {at && <CutPopup full={full} kind={kind} at={at} onClose={close} />}
    </span>
  );
}

/** (§187) Whether a fitted name is cut right now (its text is wider than the room it has). */
const overflows = (el: HTMLElement) => el.scrollWidth > el.clientWidth + 1;

/** The touch pop-up: the full text in a scroll box, the name's link when it has one, and Copy. Drawn on the page's top layer, kept on the screen. */
function CutPopup({ full, kind, at, onClose }: { full: string; kind: CutKind; at: At; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(at.x);
  const [copied, setCopied] = useState<"" | "yes" | "no">("");
  // Moved left when it would run past the right edge of the screen (8 px from each edge).
  useLayoutEffect(() => {
    const w = box.current?.getBoundingClientRect().width ?? 0;
    setLeft(Math.max(8, Math.min(at.x, window.innerWidth - w - 8)));
  }, [at.x]);
  useEffect(() => {
    const outside = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    // Listening starts after the tap that opened it.
    const t = setTimeout(() => document.addEventListener("pointerdown", outside), 0);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", onClose, { passive: true });
    return () => {
      clearTimeout(t);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", onClose);
    };
  }, [onClose]);
  return createPortal(
    <div ref={box} role="dialog" aria-label={full} data-cut-popup=""
      className="fixed z-[60] w-max max-w-[78vw] space-y-2 rounded-xl border border-white/15 bg-slate-900 p-3 text-sm text-slate-100 shadow-2xl"
      style={{ left, ...(at.below ? { top: at.y } : { bottom: window.innerHeight - at.y }) }}
      // A press inside the pop-up stays in it (it doesn't reach the row's own link behind the name).
      onClick={(e) => e.stopPropagation()}>
      {/* (Owner, Nov 5, §244) The whole name or email in the draggable box (it scrolls, the grip drags it taller). */}
      <OwnPanel><ResizeBox id={`cut-${kind}-${full.slice(0, 40)}`} label={full} defaultMax="9rem" tallest={0.5}>
        <div className="whitespace-pre-wrap pr-1 leading-6 [overflow-wrap:anywhere]" data-cut-popup-text="">{full}</div>
      </ResizeBox></OwnPanel>
      <div className="flex flex-wrap items-center gap-2">
        {at.href && <a href={at.href} className="btn-secondary px-3 py-1 text-xs no-underline hover:no-underline" data-cut-open="">{openLabel(kind)}</a>}
        <button type="button" className="btn-secondary px-3 py-1 text-xs" data-cut-copy="" onClick={async () => setCopied((await copyText(full)) ? "yes" : "no")}>Copy</button>
        {copied === "yes" && <span className="ok text-xs" role="status" data-cut-copied="">Copied</span>}
        {copied === "no" && <span className="text-xs text-slate-400" role="status">Couldn&apos;t copy: select the text above.</span>}
      </div>
    </div>,
    document.body,
  );
}

/**
 * (Owner, Nov 3, batch 35 §137) A person's or a test's name inside a SENTENCE: cut like a listed name (hover / title, the tap pop-up with "Open profile →" /
 * "Open test →" and Copy) and a link to their profile or to the test. No `href` (a deleted account, someone whose profile isn't open to you): the cut name only.
 * (Owner, Nov 3, §166) "The name itself should be green everywhere": also a person's name in a heading, a row or a hover card, never a separate "See her
 * profile" link next to it.
 */
export function NameLink({ text, href, kind = "person", className = "", whole = false, newTab = false, fit = false }: { text: string; href?: string | null; kind?: CutKind; className?: string;
  /** (Owner, Nov 3, §166) The name drawn whole (a hover card's own heading, which is there to show the full name), wrapping anywhere instead of cut. */
  whole?: boolean;
  /** (Owner, Nov 3, §166) Opens in a new tab (the Invite box's rows, so the ticks stay). */
  newTab?: boolean;
  /** (Owner, Nov 4, §187) In a row (Needs you's people, the call request boxes, the testers' calls cards): the whole name, cut only when the row is full (Cut's `fit`) */
  fit?: boolean }) {
  const words = whole ? <span className="[overflow-wrap:anywhere]">{text}</span> : <Cut text={text} kind={kind} fit={fit} />;
  if (!href) return whole ? <span className={className || undefined}>{words}</span> : <Cut text={text} kind={kind} className={className} fit={fit} />;
  return <a href={href} className={`relative z-10 ${fit ? "inline-block min-w-0 max-w-full align-bottom " : ""}${className}`} data-name-link={kind} {...(newTab ? { target: "_blank", rel: "noopener" } : {})}>{words}</a>;
}
