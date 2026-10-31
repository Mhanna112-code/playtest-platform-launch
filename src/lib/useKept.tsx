"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { pageUser } from "@/lib/client";

/** (Batch 35 §6) Sent before the tab reloads to the other side: every mounted form sends its draft at once (each adds its request to `waits`). */
export const KEPT_FLUSH_EVENT = "kept-flush";
/** (Batch 35 §6) The page user's id on every kept request: a draft is read and written only as the account the page belongs to (the server refuses another). */
const uidHeader = (): Record<string, string> => (pageUser() ? { "x-uid": pageUser() } : {});

/** (Batch 35 §6) Send every form's unsaved draft now (keepalive) and wait for them, at most `timeoutMs`. */
export async function flushKept(timeoutMs = 1500) {
  const waits: Promise<unknown>[] = [];
  window.dispatchEvent(new CustomEvent(KEPT_FLUSH_EVENT, { detail: { waits } }));
  await Promise.race([Promise.all(waits), new Promise((r) => setTimeout(r, timeoutMs))]);
}

/**
 * (NEXT-UI 10) A form's typed-but-unsent text, kept on the server per person and form (any device, and after signing in
 * again): the form starts from it with the full app's "Not sent yet" tag. Sending clears it (`clear()`, awaited before the
 * page moves on). Only for: written answers, chat messages, dispute text, rating comments, reject reasons, the Post / Edit
 * form (the server refuses any other key). `pristine`: nothing typed yet (nothing to keep); `restore` puts a kept draft back
 * (only while the form is still pristine, so what was typed meanwhile is never overwritten).
 */
export function useKept<T>(key: string, value: T, pristine: boolean, restore: (v: T) => void) {
  const [restored, setRestored] = useState(false);
  const ready = useRef(false); // the server's copy has been looked at
  const saved = useRef(false); // there is a copy on the server
  const pristineRef = useRef(pristine);
  pristineRef.current = pristine;
  const latest = useRef({ value, pristine });
  latest.current = { value, pristine };
  const cleared = useRef(false);
  const restoreRef = useRef(restore);
  restoreRef.current = restore;

  const send = useCallback((data: unknown) => fetch("/api/kept", { method: "POST", headers: { "content-type": "application/json", ...uidHeader() }, body: JSON.stringify({ key, data }), keepalive: true }).catch(() => null), [key]);

  useEffect(() => {
    let alive = true;
    fetch(`/api/kept?key=${encodeURIComponent(key)}`, { cache: "no-store", headers: uidHeader() })
      .then((r) => (r.ok ? r.json() : null))
      .then((r: { data: T | null } | null) => {
        if (!alive) return;
        ready.current = true;
        if (r?.data != null) {
          saved.current = true;
          if (pristineRef.current && !cleared.current) {
            restoreRef.current(r.data);
            setRestored(true);
          }
        }
      })
      .catch(() => {
        ready.current = true;
      });
    return () => {
      alive = false;
    };
  }, [key]);

  // Save a moment after typing stops; forget it when the form is empty again.
  const json = JSON.stringify(value);
  useEffect(() => {
    if (!pristine) cleared.current = false; // typing again after a send
    if (!ready.current || cleared.current) return;
    if (pristine && !saved.current) return;
    const t = setTimeout(() => {
      // (Batch 34 §9) Sent meanwhile (a Save went through within the moment): the cleared draft is never written back.
      if (cleared.current) return;
      if (latest.current.pristine) {
        saved.current = false;
        setRestored(false);
        void send(null);
      } else {
        saved.current = true;
        void send(latest.current.value);
      }
    }, 700);
    return () => clearTimeout(t);
  }, [json, pristine, send]);

  // Leaving the page with something unsaved: send it now.
  useEffect(() => {
    const flush = () => {
      if (!ready.current || cleared.current || (latest.current.pristine && !saved.current)) return null;
      return send(latest.current.pristine ? null : latest.current.value);
    };
    const onHide = () => document.visibilityState === "hidden" && void flush();
    const onLeave = () => void flush();
    // (Batch 35 §6) The tab is about to reload to the other side: send it now and let the reload wait for it.
    const onFlush = (e: Event) => {
      const p = flush();
      if (p) (e as CustomEvent<{ waits: Promise<unknown>[] }>).detail?.waits.push(p);
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onLeave);
    window.addEventListener(KEPT_FLUSH_EVENT, onFlush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onLeave);
      window.removeEventListener(KEPT_FLUSH_EVENT, onFlush);
    };
  }, [send]);

  /** The form was sent: forget the draft (wait for this before the page reloads). */
  const clear = useCallback(async () => {
    cleared.current = true;
    setRestored(false);
    if (saved.current || !ready.current) await send(null);
    saved.current = false;
  }, [send]);

  return { restored, clear };
}

/** The full app's "Not sent yet" tag. */
export function NotSentTag({ label = "Not sent yet" }: { /** (Batch 20 section 22) "Not saved yet" on Edit, "Not posted yet" on Post */ label?: string }) {
  return <span data-not-sent="draft" className="badge ml-2 border-amber-300/50 bg-amber-300/10 text-amber-200">{label}</span>;
}
