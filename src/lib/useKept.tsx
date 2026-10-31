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
 * (Batch 35 §16, found on video Oct 31) What a form sends when the page asks it to send now (leaving, hiding, the side-switch reload, Log out): only what THIS tab
 * typed since its last save ("one draft per form, last typed wins"). A tab with nothing unsent (idle, or its last typing already saved) sends nothing, so it
 * never puts its older text over a newer draft another tab saved meanwhile. "draft": send the text; "empty": the box was emptied, forget the draft.
 */
export function flushDraft(s: { ready: boolean; cleared: boolean; pristine: boolean; saved: boolean; unsent: boolean }): "skip" | "draft" | "empty" {
  if (!s.ready || s.cleared || !s.unsent) return "skip";
  if (s.pristine) return s.saved ? "empty" : "skip";
  return "draft";
}

/** (Batch 35 §11) Forget a form's draft that no longer applies (an admin box swapped out because another admin changed its state meanwhile). */
export const dropKept = (key: string) =>
  fetch("/api/kept", { method: "POST", headers: { "content-type": "application/json", ...uidHeader() }, body: JSON.stringify({ key, data: null }), keepalive: true }).catch(() => null);

/**
 * (NEXT-UI 10) A form's typed-but-unsent text, kept on the server per person and form (any device, and after signing in
 * again): the form starts from it with the "Draft" tag (batch 35 §8; it read "Not sent yet"). Sending clears it (`clear()`, awaited before the
 * page moves on). Only for: written answers, chat messages, dispute text, rating comments, reject reasons, the Post / Edit
 * form, (batch 35 §10) the tester's Apply / Ask to rejoin note and the profile edits, and (batch 35 §11) the admin console's boxes, admins only (the server refuses any other key). `pristine`: nothing typed yet (nothing to keep); `restore` puts a kept draft back
 * (only while the form is still pristine, so what was typed meanwhile is never overwritten).
 * (Owner, Oct 30, batch 35 §8) `signedIn`: the draft came back through a sign-in (the server marked it; SIGN_IN_DRAFTS in lib/keptText.ts says what it keeps): the
 * form shows "Draft" with "Use saved" at each changed box. The mark stays on the draft (every save keeps it) until it's sent or emptied.
 * (Batch 35 §10) `off`: this form keeps nothing (the profile's first setup): nothing is read, saved or cleared.
 * (Owner, Oct 31, batch 35 §18) A restored draft can always be discarded, not only after a sign-in: every form's DraftTag shows its button ("Use saved" /
 * "Discard") whenever it came back (a reload, a new tab, a sign-in); `restoredAt` says when it was last kept (Post / Edit's line at the top).
 */
export function useKept<T>(key: string, value: T, pristine: boolean, restore: (v: T) => void, off = false) {
  const [restored, setRestored] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [restoredAt, setRestoredAt] = useState(""); // (batch 35 §18) when the restored draft was last kept
  const signedInRef = useRef(false);
  const ready = useRef(false); // the server's copy has been looked at
  const saved = useRef(false); // there is a copy on the server
  const pristineRef = useRef(pristine);
  pristineRef.current = pristine;
  const latest = useRef({ value, pristine });
  latest.current = { value, pristine };
  const cleared = useRef(false);
  const unsent = useRef(false); // (batch 35 §16) typed since this tab's last save (a save is waiting for typing to stop)
  const restoreRef = useRef(restore);
  restoreRef.current = restore;

  const mark = useCallback((data: unknown) => (data && typeof data === "object" && !Array.isArray(data) && signedInRef.current ? { ...(data as object), [SIGNED_IN_MARK]: true } : data), []);
  const forget = useCallback(() => {
    signedInRef.current = false;
    setSignedIn(false);
  }, []);
  const send = useCallback((data: unknown) => fetch("/api/kept", { method: "POST", headers: { "content-type": "application/json", ...uidHeader() }, body: JSON.stringify({ key, data }), keepalive: true }).catch(() => null), [key]);

  useEffect(() => {
    if (off) return;
    let alive = true;
    fetch(`/api/kept?key=${encodeURIComponent(key)}`, { cache: "no-store", headers: uidHeader() })
      .then((r) => (r.ok ? r.json() : null))
      .then((r: { data: T | null; at?: string } | null) => {
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
            setRestoredAt(r.at ?? "");
          }
        }
      })
      .catch(() => {
        ready.current = true;
      });
    return () => {
      alive = false;
    };
  }, [key, off]);

  // Save a moment after typing stops; forget it when the form is empty again.
  const json = JSON.stringify(value);
  useEffect(() => {
    if (!pristine) cleared.current = false; // typing again after a send
    if (!ready.current || cleared.current) return;
    if (pristine && !saved.current) return;
    unsent.current = true;
    const t = setTimeout(() => {
      // (Batch 34 §9) Sent meanwhile (a Save went through within the moment): the cleared draft is never written back.
      if (cleared.current) return;
      unsent.current = false;
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
    // (Batch 35 §16) Only what this tab typed since its last save: an idle tab sends nothing (another tab's newer draft stays).
    const flush = () => {
      const what = flushDraft({ ready: ready.current, cleared: cleared.current, pristine: latest.current.pristine, saved: saved.current, unsent: unsent.current });
      if (what === "skip") return null;
      unsent.current = false;
      if (what === "empty") saved.current = false;
      else saved.current = true;
      return send(what === "empty" ? null : mark(latest.current.value));
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
    unsent.current = false;
    setRestored(false);
    forget();
    if (!off && (saved.current || !ready.current)) await send(null);
    saved.current = false;
  }, [send, forget, off]);

  return { restored, signedIn, restoredAt, clear };
}

/** (Batch 35 §8) The tag on a restored draft. */
export const DRAFT_LABEL = "Draft";
/** (Batch 35 §8) Puts the box back to its saved value. */
export const USE_SAVED_LABEL = "Use saved";
/** (Batch 35 §10) The same button on a box with no saved version (its text only exists once its button is pressed): it empties the box and the draft goes. */
export const DISCARD_LABEL = "Discard";
/**
 * (Owner, Oct 30, batch 35 §10) Which button a DraftTag shows: "saved" ("Use saved") where a saved version exists (Edit, Post, Pay / Pay more, written answers,
 * the profile); "discard" ("Discard") where nothing is saved (End early / Stop reasons, dispute reason and side, rating comments, chat, Contact us, call requests,
 * the Apply note). Same behaviour either way.
 */
export type DraftKind = "saved" | "discard";
export const draftButtonLabel = (kind: DraftKind) => (kind === "discard" ? DISCARD_LABEL : USE_SAVED_LABEL);
/** (Batch 35 §8) Edit / Post: every field marked Draft back to its saved value. */
export const USE_SAVED_ALL_LABEL = "Use saved for all";

/** (Owner, Oct 31, batch 35 §18) The line at the top of Post / Edit when the form opened with a restored draft. */
export const DRAFT_START_LINE = (when: string) => `Started from your unsent draft${when ? ` (${when})` : ""}`;
/** (Batch 35 §18) Post a test: every field back to the empty start, and the draft goes (a brand-new test). */
export const START_EMPTY_LABEL = "Start empty";

/** The tag on a restored draft: "Draft" (batch 35 §8; it read "Not sent yet"). */
export function NotSentTag({ label = DRAFT_LABEL }: { /** (Batch 20 section 22) "Not saved yet" on Edit, "Not posted yet" on Post */ label?: string }) {
  return <span data-not-sent="draft" className="badge ml-2 border-amber-300/50 bg-amber-300/10 text-amber-200">{label}</span>;
}

/**
 * (Owner, Oct 30, batch 35 §8) A written box's draft that came back after signing in: the "Draft" tag, and with `onUseSaved` the button beside it
 * (the box goes back to its saved value; nothing saved yet: it empties). `field`: which box (Edit has one per field).
 * (Batch 35 §10) `kind`: "saved" reads "Use saved" (a saved version exists), "discard" reads "Discard" (nothing is saved; the box empties).
 * (Batch 35 §18) Every restored draft, not only one back through a sign-in: the forms pass `onUseSaved` whenever their draft came back.
 */
export function DraftTag({ onUseSaved, field, kind }: { onUseSaved?: () => void; field?: string; kind: DraftKind }) {
  return (
    <span className="inline-flex items-center" data-draft-tag={field ?? ""} data-draft-kind={kind}>
      <NotSentTag />
      {onUseSaved && <button type="button" className="ml-2 text-xs font-normal text-sky-300 underline" data-use-saved={field ?? ""} onClick={onUseSaved}>{draftButtonLabel(kind)}</button>}
    </span>
  );
}
