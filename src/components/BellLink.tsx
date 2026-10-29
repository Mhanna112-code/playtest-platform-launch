"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Bell } from "lucide-react";

/** (Batch 29 §28) The bell's number changed (SessionWatch's ~20-second check, the tab coming back into focus, or a line opened on the Notifications page). */
export const BELL_EVENT = "pt-bell";
/** Ask SessionWatch to check again now (after a line or a stack was opened). */
export const BELL_REFRESH = "pt-bell-refresh";
export const publishBell = (n: number) => window.dispatchEvent(new CustomEvent(BELL_EVENT, { detail: n }));
export const refreshBell = () => window.dispatchEvent(new Event(BELL_REFRESH));

/**
 * (Owner, Oct 29, batch 29 §28) The header's bell: the red number is how many entries of the bell list have anything unread ("9+" above 9; the aria-label says
 * the same number). It follows the same ~20-second check as the page and the tab coming back into focus, on every page.
 */
export function BellLink({ unread: start }: { unread: number }) {
  const [unread, setUnread] = useState(start);
  useEffect(() => setUnread(start), [start]);
  useEffect(() => {
    const on = (e: Event) => {
      const n = (e as CustomEvent<number>).detail;
      if (typeof n === "number") setUnread(n);
    };
    window.addEventListener(BELL_EVENT, on);
    return () => window.removeEventListener(BELL_EVENT, on);
  }, []);
  const shown = unread > 9 ? "9+" : String(unread);
  return (
    <Link className="nav-link relative" href="/app/notifications" aria-label={`Notifications, ${shown} unread`} data-bell-count={unread}>
      <Bell className="h-4 w-4" />
      {unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-punch-500 px-1.5 text-[10px] font-bold text-white">{shown}</span>}
    </Link>
  );
}
