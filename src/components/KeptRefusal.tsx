"use client";
import { useEffect, useRef, useState } from "react";
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

/** (Batch 32 §10) The ids of the sections around the pressed button, nearest first: the notice goes into the nearest one still on the page after the redraw. */
function anchorsOf(el: Element | null): string[] {
  const out: string[] = [];
  for (let n = el?.parentElement ?? null; n && n !== document.body && out.length < 8; n = n.parentElement) {
    if (n.id && !["INPUT", "TEXTAREA", "SELECT", "MAIN"].includes(n.tagName)) out.push(n.id);
  }
  return out;
}

const flat = (t: string | null | undefined) => (t ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Is the press's own line on the page already? Its button still there, or (batch 32 §10, never twice) any other line on the page saying the same thing,
 * whatever its style (a red line, a blue notice, a stop box). Then this one stays hidden.
 */
function shownElsewhere(k: Kept) {
  const el = k.el as HTMLElement | null;
  if (el?.isConnected && el.getClientRects().length > 0) return true;
  const msg = flat(k.message);
  if (!msg) return false;
  return [...document.querySelectorAll("p, li, [role='status'], [data-refusal], .err")].some(
    (p) => !p.closest("[data-kept-refusal], [data-kept-host]") && (p as HTMLElement).getClientRects().length > 0 && flat(p.textContent).includes(msg),
  );
}

/**
 * (Owner, Oct 29, batch 29 §36) In the root layout, outside every page, so it survives the redraw a refused press makes (batch 28 §9): when the redraw took the
 * pressed button away, its refusal line stays ("Your Join call didn't go through: this call isn't available.") until the next press anywhere on the page.
 * (Owner, Oct 29, batch 32 §10) A blue notice IN the page, inside the part or row the button was in (it pushes the text below it down, never covers it); with
 * none of those left, at the top of the page.
 */
export function KeptRefusal() {
  const [kept, setKept] = useState<Kept | null>(null);
  const [show, setShow] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const hostRef = useRef<HTMLElement | null>(null);
  const dropHost = () => {
    hostRef.current?.remove();
    hostRef.current = null;
    setHost(null);
  };
  useEffect(() => {
    const onPress = (e: Event) => {
      const t = e.type === "submit" ? ((e as SubmitEvent).submitter ?? (e.target as Element | null)) : (e.target as Element | null)?.closest?.(PRESSABLE) ?? null;
      if (!t || t.closest("[data-kept-refusal]")) return;
      notePress(t, spotOf(t), Date.now(), anchorsOf(t));
    };
    document.addEventListener("click", onPress, true);
    document.addEventListener("submit", onPress, true);
    setKept(currentKept());
    const off = onKept(setKept);
    return () => {
      off();
      document.removeEventListener("click", onPress, true);
      document.removeEventListener("submit", onPress, true);
      hostRef.current?.remove();
    };
  }, []);
  useEffect(() => {
    if (!kept) {
      setShow(false);
      dropHost();
      return;
    }
    // Checked a few times a second: hidden while the button (or a line saying the same) is on the page; once the redraw took it away, placed in the nearest
    // section still there, and placed again if a later redraw (a live update) replaced that section.
    const check = () => {
      if (Date.now() - kept.at >= KEEP_MS) {
        setShow(false);
        dropHost();
        dropKept(kept.id);
        return;
      }
      if (!keptShows(kept, Date.now(), shownElsewhere(kept))) {
        setShow(false);
        dropHost();
        return;
      }
      const anchor = kept.anchors.map((id) => document.getElementById(id)).find((a): a is HTMLElement => !!a && a.getClientRects().length > 0) ?? null;
      if (!anchor) dropHost();
      else if (!hostRef.current || hostRef.current.parentElement !== anchor) {
        hostRef.current?.remove();
        const h = document.createElement(anchor.tagName === "UL" || anchor.tagName === "OL" ? "li" : "div");
        h.setAttribute("data-kept-host", "");
        h.style.listStyle = "none";
        anchor.appendChild(h);
        hostRef.current = h;
        setHost(h);
      }
      setShow(true);
    };
    check();
    const t = setInterval(check, 200);
    return () => clearInterval(t);
  }, [kept]);
  if (!kept || !show || typeof document === "undefined") return null;
  if (host) {
    return createPortal(
      <p className="info mt-2" role="status" data-kept-refusal="">
        {kept.text}
      </p>,
      host,
    );
  }
  // No section of the button's left on the page: a notice at the top of the screen.
  return createPortal(
    <p className="info shadow-lg" style={{ position: "fixed", top: 72, left: "50%", transform: "translateX(-50%)", width: "min(32rem, calc(100vw - 32px))", zIndex: 60 }} role="status" data-kept-refusal="">
      {kept.text}
    </p>,
    document.body,
  );
}
