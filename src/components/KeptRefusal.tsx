"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { KEEP_MS, currentKept, dropKept, keptShows, notePress, onKept, type Kept, type Spot } from "@/lib/keptRefusal";

/** The things a person presses: a press on any of them clears a kept line (and is remembered, in case it's refused). */
const PRESSABLE = "button, [role='button'], input[type='submit'], input[type='button']";

function spotOf(el: Element | null): Spot | null {
  if (!el || typeof window === "undefined") return null;
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  const width = Math.min(Math.max(r.width, 260), Math.max(document.documentElement.clientWidth - 32, 200));
  const left = Math.max(16, Math.min(r.left, document.documentElement.clientWidth - width - 16));
  return { top: r.bottom + window.scrollY + 4, left: left + window.scrollX, width };
}

/** Is the press's own line on the page (its button still there, or a refusal line under where it was that says the same)? Then this one stays hidden. */
function shownElsewhere(k: Kept) {
  const el = k.el as HTMLElement | null;
  if (el?.isConnected && el.getClientRects().length > 0) return true;
  const msg = k.message.replace(/\s+/g, " ").trim();
  return [...document.querySelectorAll(".err, [data-refusal]")].some((p) => !p.closest("[data-kept-refusal]") && (p as HTMLElement).getClientRects().length > 0 && (p.textContent ?? "").replace(/\s+/g, " ").includes(msg));
}

/**
 * (Owner, Oct 29, batch 29 §36) In the root layout, outside every page, so it survives the redraw a refused press makes (batch 28 §9): when the redraw took the
 * pressed button away, its refusal line stays where the button was, a small blue line ("Your Join call didn't go through: this call isn't available."), until
 * the next press anywhere on the page or about 10 seconds.
 */
export function KeptRefusal() {
  const [kept, setKept] = useState<Kept | null>(null);
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onPress = (e: Event) => {
      const t = e.type === "submit" ? ((e as SubmitEvent).submitter ?? (e.target as Element | null)) : (e.target as Element | null)?.closest?.(PRESSABLE) ?? null;
      if (!t || t.closest("[data-kept-refusal]")) return;
      notePress(t, spotOf(t));
    };
    document.addEventListener("click", onPress, true);
    document.addEventListener("submit", onPress, true);
    setKept(currentKept());
    const off = onKept(setKept);
    return () => {
      off();
      document.removeEventListener("click", onPress, true);
      document.removeEventListener("submit", onPress, true);
    };
  }, []);
  useEffect(() => {
    if (!kept) {
      setShow(false);
      return;
    }
    // Checked a few times a second: hidden while the button (or its own line) is still on the page, shown once the redraw took it away, gone after 10 s.
    const check = () => {
      if (Date.now() - kept.at >= KEEP_MS) {
        setShow(false);
        dropKept(kept.id);
        return;
      }
      setShow(keptShows(kept, Date.now(), shownElsewhere(kept)));
    };
    check();
    const t = setInterval(check, 200);
    return () => clearInterval(t);
  }, [kept]);
  if (!kept || !show || typeof document === "undefined") return null;
  const spot = kept.spot;
  const style: React.CSSProperties = spot
    ? { position: "absolute", top: spot.top, left: spot.left, width: spot.width, zIndex: 60, pointerEvents: "none" }
    : { position: "fixed", top: 72, left: "50%", transform: "translateX(-50%)", width: "min(32rem, calc(100vw - 32px))", zIndex: 60, pointerEvents: "none" };
  return createPortal(
    <p className="err bg-ink-950/95 shadow-lg" style={style} role="status" data-kept-refusal="">
      {kept.text}
    </p>,
    document.body,
  );
}
