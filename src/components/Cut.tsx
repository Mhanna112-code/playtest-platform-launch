"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { NAME_CUT, cutEmail, cutTo } from "@/lib/rules";

/** What a listed name is: a person, a test, a product, or an email. A linked one's pop-up offers "Open profile →" or "Open test →". */
export type CutKind = "person" | "test" | "product" | "email";

/** (Owner, Nov 3) How a listed name is drawn: cut at NAME_CUT (12) characters with "…" (cutTo); an email in the middle (cutEmail). */
export const cutText = (text: string, kind: CutKind = "person", n = NAME_CUT) => (kind === "email" ? cutEmail(text) : cutTo(text, n));

/** A screen with no hover (a phone or a tablet): there a cut name opens a small pop-up instead of a tooltip. */
export const touchOnly = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(hover: none)").matches;

/** Whether a tap on a name opens the pop-up: only a cut name, and only on a touch screen. Anywhere else a click does what it always did. */
export const opensPopup = (cut: boolean, touch: boolean) => cut && touch;

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
export function Cut({ text, kind = "person", n = NAME_CUT, className = "" }: { text: string; kind?: CutKind; n?: number; className?: string }) {
  const full = text ?? "";
  const shown = cutText(full, kind, n);
  const cut = shown !== full;
  const [at, setAt] = useState<At | null>(null);
  const onClick = useCallback((e: ReactMouseEvent<HTMLSpanElement>) => {
    if (!opensPopup(cut, touchOnly())) return;
    // The tap opens the pop-up instead of following the link the name sits in (the pop-up offers that link).
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const link = e.currentTarget.closest("a[href]") as HTMLAnchorElement | null;
    link?.blur(); // a hover card shown on focus (PersonHover) gives way to the pop-up
    const below = r.bottom + 180 < window.innerHeight;
    setAt({ x: r.left, y: below ? r.bottom + 6 : r.top - 6, below, href: link?.getAttribute("href") ?? null });
  }, [cut]);
  const close = useCallback(() => setAt(null), []);
  // Not cut: exactly the text, as before (no wrapper, no underline, no title).
  if (!cut) return className ? <span className={className}>{full}</span> : <>{full}</>;
  return (
    <span className={className || undefined} title={full} aria-label={full} onClick={onClick} data-cut={kind}>
      <span aria-hidden="true" className="select-none underline decoration-dotted decoration-1 underline-offset-2" data-cut-shown="">{shown}</span>
      <span className="sr-only" data-cut-full="">{full}</span>
      {at && <CutPopup full={full} kind={kind} at={at} onClose={close} />}
    </span>
  );
}

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
      <div className="max-h-36 overflow-y-auto whitespace-pre-wrap pr-1 leading-6 [overflow-wrap:anywhere]" tabIndex={0} data-cut-popup-text="">{full}</div>
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
 */
export function NameLink({ text, href, kind = "person", className = "" }: { text: string; href?: string | null; kind?: CutKind; className?: string }) {
  if (!href) return <Cut text={text} kind={kind} className={className} />;
  return <a href={href} className={`relative z-10 ${className}`} data-name-link={kind}><Cut text={text} kind={kind} /></a>;
}
