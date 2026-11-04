"use client";
import { createContext, useCallback, useContext, useEffect, useRef, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";

/** (Owner, Nov 4, §180) A charge in a group tells it while its bank box, stop box or refusal is showing: the group stays open over it. */
const Hold = createContext<((paymentId: string, on: boolean) => void) | null>(null);

/** (§180) Used by BankWaiting: `on` while its check is open or a stop box / refusal shows under its button. Outside a group it does nothing. */
export function useBankGroupHold(paymentId: string, on: boolean) {
  const hold = useContext(Hold);
  useEffect(() => {
    if (!hold) return;
    hold(paymentId, on);
    return () => hold(paymentId, false);
  }, [hold, paymentId, on]);
}

/**
 * (Owner, Nov 4, §180, refining §175) The test page's charges waiting for the bank, one drop-down per tester: the summary row is the tester's name (the green
 * profile link: clicking it opens the profile, clicking elsewhere on the row opens or closes the drop-down), then "· 2 charges waiting · $13.00"; inside, each
 * charge's Confirm with your bank as before. Closed at first; it opens by itself when a link jumps to one of its charges (`#bank-<id>`: the tester row's "Confirm
 * with your bank in Needs you ↑", the bell, the dashboard and Payments), and while one of its charges has its bank box, a stop box or a refusal showing (it can't
 * be closed over an open bank check).
 */
export function BankGroup({ id, name, count, total, children }: { /** the tester's contract */ id: string; name: ReactNode; count: number; total: string; children?: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const held = useRef(new Set<string>());
  const hold = useCallback((paymentId: string, on: boolean) => {
    if (on) {
      held.current.add(paymentId);
      if (ref.current && !ref.current.open) ref.current.open = true;
    } else held.current.delete(paymentId);
  }, []);
  useEffect(() => {
    const openFor = (href: string | null) => {
      const target = href?.startsWith("#") ? decodeURIComponent(href.slice(1)) : "";
      const el = target ? document.getElementById(target) : null;
      if (el && ref.current && el !== ref.current && ref.current.contains(el)) ref.current.open = true;
    };
    openFor(window.location.hash);
    // Before the browser scrolls to the charge: a link on this page to one of its charges opens the drop-down first.
    const click = (e: MouseEvent) => openFor((e.target as Element | null)?.closest?.("a[href^='#']")?.getAttribute("href") ?? null);
    const hash = () => openFor(window.location.hash);
    document.addEventListener("click", click, true);
    window.addEventListener("hashchange", hash);
    return () => {
      document.removeEventListener("click", click, true);
      window.removeEventListener("hashchange", hash);
    };
  }, []);
  // Never closed over an open bank check (or a stop box / refusal); the name link still opens the profile.
  const toggle = (e: ReactMouseEvent<HTMLElement>) => {
    if (ref.current?.open && held.current.size > 0 && !(e.target as Element).closest("a")) e.preventDefault();
  };
  return (
    <Hold.Provider value={hold}>
      <details ref={ref} className="group/fold min-w-0 rounded-xl border border-white/10 p-2" data-bank-group={id}>
        <summary className="fold-chevron flex cursor-pointer items-center gap-2 text-sm font-medium text-white" data-bank-group-toggle="" onClick={toggle}>
          <span className="min-w-0 [overflow-wrap:anywhere]">
            <span data-bank-group-name="">{name}</span>{" "}
            <span className="font-normal text-slate-400" data-bank-group-count="">· {count} charge{count === 1 ? "" : "s"} waiting · {total}</span>
          </span>
        </summary>
        <div className="mt-2 min-w-0 space-y-2">{children}</div>
      </details>
    </Hold.Provider>
  );
}
