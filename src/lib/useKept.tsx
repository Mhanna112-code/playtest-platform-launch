"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { pageUser } from "@/lib/client";
import { SIGNED_IN_MARK } from "@/lib/keptText";
import { unitIsDraft, unitPatch, unitWrites, unitsOf, type Units } from "@/lib/draftUnits";

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

/**
 * (Owner's repro, Oct 31, batch 35 §65) A form writes (or forgets) the shared draft only because of THIS tab's own edits: a value change within a moment of a
 * real keystroke, click, paste or drop in this tab (typing, a tick, a chip, the Use saved / Discard buttons). A change that came from a redraw (the tab became
 * visible, the live poll), from the server or from another tab's save never writes: an old tab that's only looked at, a restored-but-untouched form, never
 * deletes or overwrites a newer draft another tab typed. Typing still waiting to be saved (`unsent`) is saved even if a redraw lands meanwhile.
 */
export const OWN_EDIT_MS = 800;
let lastGesture = 0;
let watching = false;
function watchGestures() {
  if (watching || typeof document === "undefined") return;
  watching = true;
  const on = (e: Event) => {
    if (e.isTrusted) lastGesture = Date.now();
  };
  for (const g of ["input", "change", "click", "keydown", "paste", "drop", "cut"]) document.addEventListener(g, on, true);
}
/** A value change counts as this tab's own edit: a real gesture in this tab a moment before it. */
export const ownEdit = (gestureAt: number, now = Date.now()) => gestureAt > 0 && now - gestureAt >= 0 && now - gestureAt <= OWN_EDIT_MS;
/** (Batch 35 §65) Whether a value change schedules a write of the shared draft. */
export function draftWrite(s: { ready: boolean; cleared: boolean; pristine: boolean; saved: boolean; unsent: boolean; own: boolean }): boolean {
  if (!s.ready || s.cleared) return false;
  if (!s.own && !s.unsent) return false; // a redraw, the server or another tab: never written (and never forgotten)
  return !(s.pristine && !s.saved);
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
  useEffect(() => watchGestures(), []);
  useEffect(() => {
    const own = ownEdit(lastGesture);
    if (!pristine && own) cleared.current = false; // typing again after a send
    // (Batch 35 §65) Only this tab's own edits write (or forget) the draft.
    if (!draftWrite({ ready: ready.current, cleared: cleared.current, pristine, saved: saved.current, unsent: unsent.current, own })) return;
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

/**
 * (Owner, Nov 2, batch 35 §120) Per-field drafts (Post / Edit, written answers): like useKept, but the form is a set of units (lib/draftUnits.ts) and this tab
 * writes only the units IT changed (since that unit's draft or saved value), each unit on its own; the server keeps every unit's latest value. A unit this tab
 * never touched never writes, so it never overwrites (or forgets) another tab's draft of it. Everything else is useKept's: writes only for this tab's own edits
 * (§65), a moment after typing stops; a flush sends only what is still unsent (§16); the draft comes back on a reload, a new tab or after a sign-in.
 * - `units`: each unit's value now; `saved`: each unit's saved value (Edit: the listing; written answers: what was sent; a new Post: the empty start).
 * - `restore(units)`: puts the kept units back (only units this tab hasn't changed itself).
 * - `drafted`: the units holding a draft (kept on the server, or typed here); `isDraft(u)`: it holds one AND differs from the saved value (the Draft tag shows
 *   only there: a unit with no draft never shows Draft, whatever else was typed).
 * - `clear(units?)`: sent: forget those units' drafts (none given: the whole draft); `write(units)`: send these units now (and wait).
 * - `questions`: written answers' questions (an older draft with no questions list pairs its answers by place).
 */
export function useKeptUnits(key: string, units: Units, saved: Units, restore: (u: Units) => void, opts: { off?: boolean; questions?: string[] } = {}) {
  const off = !!opts.off;
  const [restored, setRestored] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [restoredAt, setRestoredAt] = useState("");
  const [drafted, setDrafted] = useState<ReadonlySet<string>>(new Set());
  const draftedRef = useRef<Set<string>>(new Set());
  const signedInRef = useRef(false);
  const ready = useRef(false);
  const cleared = useRef(false);
  const pending = useRef<Set<string>>(new Set()); // (§16) units this tab changed and hasn't sent yet
  const edited = useRef<Set<string>>(new Set()); // units this tab changed itself (a kept copy never replaces them)
  const restoring = useRef<Map<string, string>>(new Map()); // units being put back from the server, with their value (that change is never this tab's edit)
  const latest = useRef({ units, saved });
  latest.current = { units, saved };
  const prev = useRef({ units, saved });
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  const questionsRef = useRef(opts.questions);
  questionsRef.current = opts.questions;

  const setDraftedUnits = useCallback((next: Set<string>) => {
    draftedRef.current = next;
    setDrafted(new Set(next));
    if (!next.size) {
      setRestored(false);
      signedInRef.current = false;
      setSignedIn(false);
    }
  }, []);
  const post = useCallback(
    (patch: Record<string, unknown>) =>
      fetch("/api/kept", {
        method: "POST",
        headers: { "content-type": "application/json", ...uidHeader() },
        body: JSON.stringify({ key, units: patch, ...(signedInRef.current ? { mark: true } : {}), ...(questionsRef.current ? { questions: questionsRef.current } : {}) }),
        keepalive: true,
      }).catch(() => null),
    [key],
  );
  /** Send these units now: their value, or null where back to the saved value (that unit's draft goes). */
  const sendUnits = useCallback(
    (us: Iterable<string>) => {
      const list = [...us];
      if (!list.length) return null;
      const patch = unitPatch(list, latest.current.units, latest.current.saved);
      const next = new Set(draftedRef.current);
      for (const [u, v] of Object.entries(patch)) {
        if (v === null) next.delete(u);
        else next.add(u);
      }
      setDraftedUnits(next);
      return post(patch);
    },
    [post, setDraftedUnits],
  );
  const sendPending = useCallback(() => {
    const us = [...pending.current];
    pending.current.clear();
    return sendUnits(us);
  }, [sendUnits]);

  useEffect(() => {
    if (off) return;
    let alive = true;
    fetch(`/api/kept?key=${encodeURIComponent(key)}`, { cache: "no-store", headers: uidHeader() })
      .then((r) => (r.ok ? r.json() : null))
      .then((r: { data: unknown; at?: string } | null) => {
        if (!alive) return;
        ready.current = true;
        const kept = unitsOf(key, r?.data ?? null, questionsRef.current ?? []);
        const names = Object.keys(kept);
        if (names.length && !cleared.current) {
          const after = !!(r?.data && typeof r.data === "object" && (r.data as Record<string, unknown>)[SIGNED_IN_MARK]);
          signedInRef.current = after;
          setSignedIn(after);
          setDraftedUnits(new Set([...draftedRef.current, ...names]));
          const back = Object.fromEntries(Object.entries(kept).filter(([u]) => !edited.current.has(u)));
          if (Object.keys(back).length) {
            restoring.current = new Map(Object.entries(back).map(([u, v]) => [u, JSON.stringify(v)]));
            restoreRef.current(back);
            setRestored(true);
            setRestoredAt(r?.at ?? "");
          }
        }
        if (pending.current.size) void sendPending(); // typed before the server's copy was looked at
      })
      .catch(() => {
        ready.current = true;
      });
    return () => {
      alive = false;
    };
  }, [key, off, sendPending, setDraftedUnits]);

  // Save a moment after typing stops: only the units this tab changed by its own edits (§65).
  const json = JSON.stringify(units) + "|" + JSON.stringify(saved);
  useEffect(() => watchGestures(), []);
  useEffect(() => {
    const was = prev.current;
    prev.current = latest.current;
    if (off) return;
    const back = restoring.current;
    restoring.current = new Map();
    const now = latest.current.units;
    const changed = unitWrites({ prev: was.units, next: now, prevSaved: was.saved, nextSaved: latest.current.saved, own: ownEdit(lastGesture) }).filter((u) => back.get(u) !== JSON.stringify(now[u]));
    if (!changed.length) return;
    cleared.current = false; // typing again after a send
    for (const u of changed) {
      pending.current.add(u);
      edited.current.add(u);
    }
    if (!ready.current) return; // sent once the server's copy has been looked at
    const t = setTimeout(() => {
      if (cleared.current) return; // (batch 34 §9) sent meanwhile: never written back
      void sendPending();
    }, 700);
    return () => clearTimeout(t);
  }, [json, off, sendPending]);

  // Leaving the page with something unsent: send it now (only what this tab changed and hasn't sent: §16).
  useEffect(() => {
    const flush = () => {
      if (off || !ready.current || cleared.current || !pending.current.size) return null;
      return sendPending();
    };
    const onHide = () => document.visibilityState === "hidden" && void flush();
    const onLeave = () => void flush();
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
  }, [off, sendPending]);

  /** Sent: forget the draft (wait for this before the page moves on). `only`: just these units (Edit's Save: the units it saved; other tabs' drafts of other fields stay). */
  const clear = useCallback(
    async (only?: Iterable<string>) => {
      cleared.current = true;
      pending.current.clear();
      if (off) return;
      if (only) {
        const list = [...only];
        const next = new Set(draftedRef.current);
        for (const u of list) next.delete(u);
        setDraftedUnits(next);
        if (list.length) await post(Object.fromEntries(list.map((u) => [u, null])));
        return;
      }
      setDraftedUnits(new Set());
      await fetch("/api/kept", { method: "POST", headers: { "content-type": "application/json", ...uidHeader() }, body: JSON.stringify({ key, data: null }), keepalive: true }).catch(() => null);
    },
    [key, off, post, setDraftedUnits],
  );
  /** Send these units now and wait (a file's marker removed from the answers before the file goes). */
  const write = useCallback(
    async (us: Iterable<string>) => {
      if (off) return;
      const list = [...us];
      for (const u of list) pending.current.delete(u);
      await sendUnits(list);
    },
    [off, sendUnits],
  );
  const isDraft = (u: string) => unitIsDraft(drafted, u, units, saved);

  return { restored, signedIn, restoredAt, drafted, isDraft, clear, write };
}

/** (Batch 35 §8) The tag on a restored draft. */
export const DRAFT_LABEL = "Draft";
/** (Batch 35 §8) Puts the box back to its saved value. */
export const USE_SAVED_LABEL = "Use saved";
/** (Batch 35 §10) The same button on a box with no saved version (its text only exists once its button is pressed): it empties the box and the draft goes. */
export const DISCARD_LABEL = "Discard";
/**
 * (Owner, Oct 30, batch 35 §10; Oct 31, §39) Which button a DraftTag shows: "saved" ("Use saved") ONLY where a saved version of that box exists (Edit's fields, a
 * saved draft opened from the drafts list, profile edits, written answers already sent: back to the sent answers); "discard" ("Discard") everywhere else (Pay and
 * Pay more: the amount back to its start, the note emptied, the ticks off; the admin's Decide total and note together; written answers never sent; End early /
 * Stop reasons, admin reasons, dispute reason and side, rating comments, chat, Contact us, call requests, the Apply note, a new Post).
 */
export type DraftKind = "saved" | "discard";
export const draftButtonLabel = (kind: DraftKind) => (kind === "discard" ? DISCARD_LABEL : USE_SAVED_LABEL);
/** (Batch 35 §8) Edit / Post: every field marked Draft back to its saved value. */
export const USE_SAVED_ALL_LABEL = "Use saved for all";
/** (Owner, Oct 31, batch 35 §39) The same for boxes with nothing saved (written answers never sent): every box emptied, the draft goes. */
export const DISCARD_ALL_LABEL = "Discard all";

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
export function DraftTag({ onUseSaved, field, kind, disabled = false }: { onUseSaved?: () => void; field?: string; kind: DraftKind; /** (batch 35 §58) the form's main press is going or finished */ disabled?: boolean }) {
  return (
    <span className="inline-flex items-center" data-draft-tag={field ?? ""} data-draft-kind={kind}>
      <NotSentTag />
      {onUseSaved && <DraftButton className="ml-2 text-xs font-normal text-sky-300 underline" data-use-saved={field ?? ""} onPress={onUseSaved} disabled={disabled}>{draftButtonLabel(kind)}</DraftButton>}
    </span>
  );
}

/**
 * (Owner, Oct 31, batch 35 §58) Every draft button ("Start empty", "Use saved", "Use saved for all", "Discard", "Discard all"): disabled while the form's main press
 * is going or has finished (until the redraw lands: `disabled`), and, once pressed, until what it does has applied (no double press).
 */
export function DraftButton({ onPress, disabled = false, className, children, ...data }: { onPress: () => unknown; disabled?: boolean; className?: string; children: ReactNode } & Record<`data-${string}`, string>) {
  const [applying, setApplying] = useState(false);
  const busy = useRef(false);
  const click = async () => {
    if (busy.current || disabled) return;
    busy.current = true;
    setApplying(true);
    try {
      await onPress();
      await new Promise((r) => requestAnimationFrame(() => r(null))); // applied: the boxes have redrawn
    } finally {
      busy.current = false;
      setApplying(false);
    }
  };
  return <button type="button" className={`${className ?? ""} disabled:cursor-not-allowed disabled:opacity-50`} disabled={disabled || applying} onClick={() => void click()} {...data}>{children}</button>;
}
