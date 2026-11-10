"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type SetStateAction } from "react";

/**
 * (Owner, Nov 10, §371; recordings race-369 1 and 2) A press's own state, kept by its button's part OUTSIDE the component that pressed.
 *
 * A live redraw can swap the pressing component for a new one mid-press: the written part's form is keyed "first" / "open", so another tab's Send (or a question
 * change) switched it while this tab's Send Answers was on its way; the old form unmounted and the server's stop-once box had nowhere to show. A box keyed by a
 * call's length, a list that grows into its scroll panel, the session page keyed by its status do the same. Kept here under a `scope` (the part, e.g.
 * `written-form:<session>`), the press's busy flag, its stop box and its refusal live on through the swap: the new component reads them at once, and the old
 * press's answer, when it comes, lands in them and shows under the button of the form that's shown now.
 *
 * A scope's values stay while a component with it is on the page, and a moment after the last one goes (a swap mounts the new one in the same commit); then they
 * are dropped, so a page opened again later starts clean. No scope: plain component state.
 */
type Slot = { values: Map<string, unknown>; mounted: number; subs: Set<() => void>; live: { current: unknown } | null; drop: ReturnType<typeof setTimeout> | null };
const slots = new Map<string, Slot>();
/** How long a scope's values outlive its last component (a swap needs none of it: it mounts the new one in the same commit). */
export const CARRY_GRACE_MS = 1000;

function slotOf(scope: string): Slot {
  let s = slots.get(scope);
  if (!s) {
    s = { values: new Map(), mounted: 0, subs: new Set(), live: null, drop: null };
    slots.set(scope, s);
  }
  return s;
}

function idle(scope: string, s: Slot) {
  if (s.mounted > 0 || s.drop) return;
  s.drop = setTimeout(() => {
    s.drop = null;
    if (s.mounted === 0 && slots.get(scope) === s) slots.delete(scope);
  }, CARRY_GRACE_MS);
}

function hold(scope: string) {
  const s = slotOf(scope);
  s.mounted++;
  if (s.drop) {
    clearTimeout(s.drop);
    s.drop = null;
  }
  return () => {
    const now = slots.get(scope);
    if (!now) return;
    now.mounted = Math.max(0, now.mounted - 1);
    idle(scope, now);
  };
}

/** Write a scope's value (from a press still running after its component went, too) and tell the components showing it. */
export function setCarried<T>(scope: string, name: string, v: SetStateAction<T>, initial: T) {
  const s = slotOf(scope);
  const prev = (s.values.has(name) ? s.values.get(name) : initial) as T;
  const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
  if (Object.is(prev, next)) return;
  s.values.set(name, next);
  s.subs.forEach((f) => f());
  idle(scope, s);
}

/** A scope's value now (undefined: none kept). */
export function peekCarried<T>(scope: string | undefined, name: string): T | undefined {
  return scope ? (slots.get(scope)?.values.get(name) as T | undefined) : undefined;
}

/** useState, kept under `scope` when one is given (see above). */
export function useCarried<T>(scope: string | undefined, name: string, initial: T): [T, (v: SetStateAction<T>) => void] {
  const [local, setLocal] = useState(initial);
  const first = useRef(initial);
  const subscribe = useCallback(
    (cb: () => void) => {
      if (!scope) return () => {};
      const s = slotOf(scope);
      s.subs.add(cb);
      const release = hold(scope);
      return () => {
        slots.get(scope)?.subs.delete(cb);
        release();
      };
    },
    [scope],
  );
  const read = useCallback(() => {
    const s = scope ? slots.get(scope) : undefined;
    return (s && s.values.has(name) ? s.values.get(name) : first.current) as T;
  }, [scope, name]);
  const shared = useSyncExternalStore(subscribe, read, read);
  const setShared = useCallback((v: SetStateAction<T>) => (scope ? setCarried(scope, name, v, first.current) : undefined), [scope, name]);
  return scope ? [shared, setShared] : [local, setLocal];
}

/**
 * The component of `scope` on the page now. A press that outlived its component calls the shown one's handles (its "Sent" line and redraw, its draft) instead
 * of its own, which are gone. With no scope, or none on the page, its own.
 */
export function useCarriedLive<H>(scope: string | undefined, own: H): () => H {
  const ref = useRef(own);
  useEffect(() => {
    ref.current = own;
  });
  useEffect(() => {
    if (!scope) return;
    const release = hold(scope);
    const s = slotOf(scope);
    s.live = ref;
    return () => {
      const now = slots.get(scope);
      if (now?.live === ref) now.live = null;
      release();
    };
  }, [scope]);
  return useCallback(() => ((scope ? (slots.get(scope)?.live?.current as H | undefined) : undefined) ?? ref.current), [scope]);
}

/** (For tests) start over. */
export function resetCarried() {
  for (const s of slots.values()) if (s.drop) clearTimeout(s.drop);
  slots.clear();
}
