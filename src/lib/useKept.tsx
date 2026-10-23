"use client";
import { useCallback, useEffect, useRef, useState } from "react";

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

  const send = useCallback((data: unknown) => fetch("/api/kept", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key, data }), keepalive: true }).catch(() => null), [key]);

  useEffect(() => {
    let alive = true;
    fetch(`/api/kept?key=${encodeURIComponent(key)}`, { cache: "no-store" })
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
      if (!ready.current || cleared.current || (latest.current.pristine && !saved.current)) return;
      void send(latest.current.pristine ? null : latest.current.value);
    };
    const onHide = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
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
export function NotSentTag() {
  return <span data-not-sent="draft" className="badge ml-2 border-amber-300/50 bg-amber-300/10 text-amber-200">Not sent yet</span>;
}
