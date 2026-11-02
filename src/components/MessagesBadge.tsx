"use client";
import { useEffect, useState } from "react";

export const MESSAGES_EVENT = "pt-messages-count";
export const publishMessages = (n: number) => window.dispatchEvent(new CustomEvent(MESSAGES_EVENT, { detail: n }));

/** Uses SessionWatch's existing status check, with the same cadence as the bell. */
export function MessagesBadge({ unread }: { unread: number }) {
  const [count, setCount] = useState(unread);
  useEffect(() => setCount(unread), [unread]);
  useEffect(() => {
    const changed = (e: Event) => { const n = (e as CustomEvent<number>).detail; if (typeof n === "number") setCount(n); };
    window.addEventListener(MESSAGES_EVENT, changed);
    return () => window.removeEventListener(MESSAGES_EVENT, changed);
  }, []);
  return count > 0 ? <span className="absolute -right-1 -top-1 rounded-full bg-fuchsia-400 px-1.5 text-[10px] font-bold text-ink-950" data-message-unread={count}>{count > 9 ? "9+" : count}</span> : null;
}
