"use client";
import { withLineLinks } from "@/components/LineLinks";
import { knownLinks } from "@/lib/lineLinkRegistry";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { KEEP_MS, KEPT_STORE, OWN_LINE_GRACE_MS, currentKept, dropKept, keptButton, keptPlacement, keptShows, keptOnPage, refusalTextOutsideKept, notePress, onKept, restoreKept, type Kept, type Spot } from "@/lib/keptRefusal";
import { watchNewPageVersion } from "@/lib/pageVersion";

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

/** (§380 KR) The pressed button on the page now (the same element, or the same words in its section after a redraw replaced it), visible. */
function buttonNow(k: Kept): HTMLElement | null {
  const el = k.el as HTMLElement | null;
  const visible = (b: HTMLElement | null) => (b && b.isConnected && b.getClientRects().length > 0 ? b : null);
  return keptButton(k, visible(el), (id) => {
    const section = document.getElementById(id);
    if (!section || !section.getClientRects().length) return null;
    return [...section.querySelectorAll<HTMLElement>(PRESSABLE)].filter((b) => !b.closest("[data-kept-refusal]") && b.getClientRects().length > 0);
  });
}

/**
 * Is the press's own line on the page already? (Batch 32 §10, never twice) any other line on the page saying the same thing, whatever its style (a red line, a
 * blue notice, a stop box): then this one stays hidden. (Owner, Nov 11, §380 KR; replaces "its button still there") A button still there that no longer shows its
 * line (the redraw reset it) gets the kept line right under it, on EVERY button; it gets a moment first to show its own. The top banner of a part that's over
 * never counts: the short line shows under the button too.
 */
function shownElsewhere(k: Kept) {
  if (buttonNow(k) && Date.now() - k.at < OWN_LINE_GRACE_MS) return true;
  const msg = flat(k.message);
  if (!msg) return false;
  return [...document.querySelectorAll("p, li, [role='status'], [data-refusal], .err")].some(
    (p) => !p.closest("[data-kept-refusal], [data-kept-host], [data-stopped-line], [data-failed-line]") && (p as HTMLElement).getClientRects().length > 0 && flat(refusalTextOutsideKept(p)).includes(msg),
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
      notePress(t, spotOf(t), Date.now(), anchorsOf(t), (t.textContent ?? "").replace(/\s+/g, " ").trim());
    };
    document.addEventListener("click", onPress, true);
    document.addEventListener("submit", onPress, true);
    // (§380 KR) A line kept across the reload a refused press made (a part that's over): back under the same button.
    try {
      restoreKept(sessionStorage.getItem(KEPT_STORE), location.pathname);
    } catch {
      // no storage
    }
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
    const stopWatching = watchNewPageVersion(() => dropKept(kept.id));
    // Checked a few times a second: hidden while the button (or a line saying the same) is on the page; once the redraw took it away, placed in the nearest
    // section still there. (Batch 32 §12) ONE notice element per kept line: when a live redraw throws its section away, the same element goes back in at once
    // (a MutationObserver runs before the screen repaints), so it never blinks.
    const place = () => {
      // (§380 KR) The pressed button still on the page: right under it.
      const button = buttonNow(kept);
      if (button) {
        if (!hostRef.current) {
          const h = document.createElement("div");
          h.setAttribute("data-kept-host", "");
          h.className = "empty:hidden basis-full w-full";
          hostRef.current = h;
          setHost(h);
        }
        if (button.nextElementSibling !== hostRef.current) button.insertAdjacentElement("afterend", hostRef.current);
        return;
      }
      const { target: anchor, first } = keptPlacement(kept.anchors, (id) => { const a = document.getElementById(id); return a && a.getClientRects().length > 0 ? a : null; }, document.querySelector<HTMLElement>("main"));
      if (!anchor) {
        if (hostRef.current) dropHost();
        return;
      }
      if (!hostRef.current) {
        const h = document.createElement(anchor.tagName === "UL" || anchor.tagName === "OL" ? "li" : "div");
        h.setAttribute("data-kept-host", "");
        h.className = "empty:hidden"; // no empty list item while the portal mounts its line
        h.style.listStyle = "none";
        hostRef.current = h;
        setHost(h);
      }
      if (first) {
        if (anchor.firstChild !== hostRef.current) anchor.prepend(hostRef.current);
      } else if (hostRef.current.parentElement !== anchor) anchor.appendChild(hostRef.current);
    };
    const check = () => {
      // (Owner, Oct 31, batch 35 §85) It belongs to the page it was pressed on: going to another page drops it (it never follows you there).
      if (Date.now() - kept.at >= KEEP_MS || !keptOnPage(kept, location.pathname)) {
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
      place();
      setShow(true);
    };
    check();
    const t = setInterval(check, 200);
    const mo = new MutationObserver(() => {
      if (hostRef.current && !hostRef.current.isConnected) place();
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      stopWatching();
      clearInterval(t);
      mo.disconnect();
    };
  }, [kept]);
  if (!kept || !show || typeof document === "undefined") return null;
  if (host) {
    return createPortal(
      <p className="info mt-2" role="status" data-kept-refusal="">
        {withLineLinks(kept.text, knownLinks(), { draw: (t) => t }) /* (Owner, Nov 5, §270) its names and tests, green links */}
      </p>,
      host,
    );
  }
  return null; // Wait for a content host if the page's main has not mounted yet.
}
