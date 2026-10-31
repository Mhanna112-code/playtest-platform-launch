"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { pageUser } from "@/lib/client";
import { SIGNED_IN_MARK } from "@/lib/keptText";

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
 * again): the form starts from it with the "Draft" tag (batch 35 §8; it read "Not sent yet"). Sending clears it (`clear()`, awaited before the
 * page moves on). Only for: written answers, chat messages, dispute text, rating comments, reject reasons, the Post / Edit
 * form (the server refuses any other key). `pristine`: nothing typed yet (nothing to keep); `restore` puts a kept draft back
 * (only while the form is still pristine, so what was typed meanwhile is never overwritten).
 * (Owner, Oct 30, batch 35 §8) `signedIn`: the draft came back through a sign-in (the server marked it; SIGN_IN_DRAFTS in lib/keptText.ts says what it keeps): the
 * form shows "Draft" with "Use saved" at each changed box. The mark stays on the draft (every save keeps it) until it's sent or emptied.
 */
export function useKept<T>(key: string, value: T, pristine: boolean, restore: (v: T) => void) {
  const [restored, setRestored] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const signedInRef = useRef(false);
  const ready = useRef(false); // the server's copy has been looked at
  const saved = useRef(false); // there is a copy on the server
  const pristineRef = useRef(pristine);
  pristineRef.current = pristine;
  const latest = useRef({ value, pristine });
  latest.current = { value, pristine };
  const cleared = useRef(false);
  const restoreRef = useRef(restore);
  restoreRef.current = restore;

  const mark = useCallback((data: unknown) => (data && typeof data === "object" && !Array.isArray(data) && signedInRef.current ? { ...(data as object), [SIGNED_IN_MARK]: true } : data), []);
  const forget = useCallback(() => {
    signedInRef.current = false;
    setSignedIn(false);
  }, []);
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
            const after = !!(r.data && typeof r.data === "object" && (r.data as Record<string, unknown>)[SIGNED_IN_MARK]);
            signedInRef.current = after;
            setSignedIn(after);
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
        forget();
        void send(null);
      } else {
        saved.current = true;
        void send(mark(latest.current.value));
      }
    }, 700);
    return () => clearTimeout(t);
  }, [json, pristine, send, mark, forget]);

  // Leaving the page with something unsaved: send it now.
  useEffect(() => {
    const flush = () => {
      if (!ready.current || cleared.current || (latest.current.pristine && !saved.current)) return null;
      return send(latest.current.pristine ? null : mark(latest.current.value));
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
  }, [send, mark]);

  /** The form was sent: forget the draft (wait for this before the page reloads). */
  const clear = useCallback(async () => {
    cleared.current = true;
    setRestored(false);
    forget();
    if (saved.current || !ready.current) await send(null);
    saved.current = false;
  }, [send, forget]);

  return { restored, signedIn, clear };
}

/** (Batch 35 §8) The tag on a restored draft. */
export const DRAFT_LABEL = "Draft";
/** (Batch 35 §8) Puts the box back to its saved value (a box with nothing saved yet empties). */
export const USE_SAVED_LABEL = "Use saved";
/** (Batch 35 §8) Edit / Post: every field marked Draft back to its saved value. */
export const USE_SAVED_ALL_LABEL = "Use saved for all";

/** The tag on a restored draft: "Draft" (batch 35 §8; it read "Not sent yet"). */
export function NotSentTag({ label = DRAFT_LABEL }: { /** (Batch 20 section 22) "Not saved yet" on Edit, "Not posted yet" on Post */ label?: string }) {
  return <span data-not-sent="draft" className="badge ml-2 border-amber-300/50 bg-amber-300/10 text-amber-200">{label}</span>;
}

/**
 * (Owner, Oct 30, batch 35 §8) A written box's draft that came back after signing in: the "Draft" tag, and with `onUseSaved` the "Use saved" button beside it
 * (the box goes back to its saved value; nothing saved yet: it empties). `field`: which box (Edit has one per field).
 */
export function DraftTag({ onUseSaved, field }: { onUseSaved?: () => void; field?: string }) {
  return (
    <span className="inline-flex items-center" data-draft-tag={field ?? ""}>
      <NotSentTag />
      {onUseSaved && <button type="button" className="ml-2 text-xs font-normal text-sky-300 underline" data-use-saved={field ?? ""} onClick={onUseSaved}>{USE_SAVED_LABEL}</button>}
    </span>
  );
}
