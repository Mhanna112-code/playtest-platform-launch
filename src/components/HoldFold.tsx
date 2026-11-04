"use client";
import { createContext, useCallback, useContext, useEffect, useId, useRef, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";

/**
 * (Owner, Nov 4, §180; generalised by §181) Something inside a fold tells it while its bank box, a press in flight, a stop box or a refusal is showing: the fold (and
 * every fold around it) opens and stays open over it.
 */
const Hold = createContext<((key: string, on: boolean) => void) | null>(null);

/** (§180) `on` while the thing under `key` shows a bank box, a press in flight, a stop box or a refusal. Outside a fold it does nothing. */
export function useFoldHold(key: string, on: boolean) {
  const hold = useContext(Hold);
  useEffect(() => {
    if (!hold) return;
    hold(key, on);
    return () => hold(key, false);
  }, [hold, key, on]);
}

/** (§180) BankWaiting's name for it. */
export const useBankGroupHold = useFoldHold;

/** (Owner, Nov 4, §181) The same with a key of its own: every press (usePress) and a Pay box's own bank check hold the folds they sit in. */
export function useHoldOpen(on: boolean) {
  useFoldHold(useId(), on);
}

/**
 * (Owner, Nov 4, §180 / §181) A drop-down on the test page's Needs you: one per person (their name as the green profile link: clicking it opens the profile, clicking
 * elsewhere on the row, Enter or Space opens or closes it), one per part, one per Pay / Pay more box. Closed at first and not remembered (owner: no extras). It opens
 * by itself when a link jumps to something inside it (`#bank-<id>`, `#piece-<id>`, `#call-<id>`, `#update-<id>`, `#item-dispute-<id>`, `#req-<id>`, `#call-requests-person-<id>`,
 * `#item-app-<id>`, `#excerpt-<id>`): on load, on a hash change, and on a click on an in-page link before the browser scrolls (markJump's `jumpTo` also opens every
 * fold above its target). `openOn`: the ids whose link opens it too though it isn't inside them (a part's own anchor opens the part and its Pay box, as §139's
 * folds under a part; a link to the whole of Needs you opens none of them). It never closes while anything inside has a bank box, a press under way, a stop box or
 * a refusal showing (useFoldHold): those open it, and every fold around it.
 */
export function HoldFold({ summary, children, className = "min-w-0 rounded-xl border border-white/10 p-2", summaryClassName = "flex items-center gap-2 text-sm font-medium text-white", bodyClassName = "mt-2 min-w-0 space-y-2", openOn, data, toggleData, defaultOpen = false }: {
  summary: ReactNode; children?: ReactNode; className?: string; summaryClassName?: string; bodyClassName?: string;
  /** ids (no "#") whose link opens it although it isn't inside them: its part's anchor */
  openOn?: string[];
  /** data-* hooks on the `<details>` and on its summary */
  data?: Record<string, string>; toggleData?: Record<string, string>;
  /** (§181) open at first (the Call requests box itself; every drop-down in it is closed) */
  defaultOpen?: boolean;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const parent = useContext(Hold);
  const held = useRef(new Set<string>());
  const hold = useCallback((key: string, on: boolean) => {
    if (on) {
      held.current.add(key);
      if (ref.current && !ref.current.open) ref.current.open = true;
    } else held.current.delete(key);
    parent?.(key, on);
  }, [parent]);
  const also = (openOn ?? []).join(" ");
  useEffect(() => {
    const ids = also ? also.split(" ") : [];
    const openFor = (href: string | null) => {
      const target = href?.startsWith("#") ? decodeURIComponent(href.slice(1)) : "";
      const el = target ? document.getElementById(target) : null;
      const me = ref.current;
      if (!el || !me || el === me) return;
      if (me.contains(el) || ids.includes(target)) me.open = true;
    };
    openFor(window.location.hash);
    // Before the browser scrolls to it: a link on this page to something inside opens the drop-down first.
    const click = (e: MouseEvent) => openFor((e.target as Element | null)?.closest?.("a[href^='#']")?.getAttribute("href") ?? null);
    const hash = () => openFor(window.location.hash);
    document.addEventListener("click", click, true);
    window.addEventListener("hashchange", hash);
    return () => {
      document.removeEventListener("click", click, true);
      window.removeEventListener("hashchange", hash);
    };
  }, [also]);
  // Never closed over an open bank check, a press, a stop box or a refusal; the name link still opens the profile.
  const toggle = (e: ReactMouseEvent<HTMLElement>) => {
    if (ref.current?.open && held.current.size > 0 && !(e.target as Element).closest("a")) e.preventDefault();
  };
  return (
    <Hold.Provider value={hold}>
      <details ref={ref} open={defaultOpen || undefined} className={`group/fold ${className}`} data-hold-fold="" {...data}>
        <summary className={`fold-chevron cursor-pointer ${summaryClassName}`} onClick={toggle} {...toggleData}>{summary}</summary>
        <div className={bodyClassName}>{children}</div>
      </details>
    </Hold.Provider>
  );
}
