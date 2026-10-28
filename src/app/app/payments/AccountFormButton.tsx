"use client";
import { useEffect, useState } from "react";
import { ChangesBox, type Change } from "@/components/ChangesBox";
import { TAB } from "@/lib/client";

/**
 * (Owner, Oct 28, batch 16 section 27) Payments' Change card / payout setup: a plain form that goes on to Stripe. It carries the page's load time and tab, so
 * the first press after a change in another tab or device comes back here with the blue box under the button ("Changed in another tab or device since
 * you opened this page:"); the next press goes ahead.
 */
export function AccountFormButton({ action, seenAt, press, stop, className = "btn", children }: { action: string; seenAt: string; press: string; stop: { changes: Change[]; at: string } | null; className?: string; children: React.ReactNode }) {
  const [seen] = useState(seenAt);
  const [tab, setTab] = useState("");
  useEffect(() => setTab(TAB), []);
  return (
    <form method="post" action={action} className="space-y-2">
      <input type="hidden" name="seenAt" value={seen} />
      <input type="hidden" name="tab" value={tab} />
      {stop && <input type="hidden" name="confirmed" value="1" />}
      {stop && <input type="hidden" name="boxAt" value={stop.at} />}
      <button className={className}>{children}</button>
      {stop && <ChangesBox changes={stop.changes} press={press} />}
    </form>
  );
}
