"use client";
import { useEffect, useState, type ReactNode } from "react";

/**
 * (Owner bug fix) A Save result that arrives in the address (?saved=1&...) is shown ONCE and then taken out of the address,
 * so a later reload or refresh (after a call request, Pay, Invite, End early ...) never replays it. It stays on screen
 * until the page is left or reloaded.
 */
export function SavedNote({ children }: { children: ReactNode }) {
  const [kept] = useState(children);
  useEffect(() => {
    const url = new URL(window.location.href);
    for (const k of ["saved", "offered", "skipped", "closed", "resent", "spotclosed", "spots"]) url.searchParams.delete(k);
    window.history.replaceState(window.history.state, "", url.pathname + (url.search || "") + url.hash);
  }, []);
  return <>{kept}</>;
}
