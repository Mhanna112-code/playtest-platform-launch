"use client";
import { useState } from "react";
import { confirmWaiting } from "@/lib/bankConfirm";

/**
 * (Owner, Oct 29, batch 11) Payments your bank wants you to confirm (made while you weren't here: a tester's Charge, a dispute decision, a retry during a hold, a renewal).
 * Confirm opens the bank's pop-up; not confirmed by the date, a charge counts as declined (a payment hold) and a renewal lapses.
 */
export function ConfirmList({ items }: { items: { id: string; text: string }[] }) {
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState<Record<string, string>>({});
  if (!items.length) return null;
  return (
    <section id="confirm" className="card scroll-mt-24 space-y-3 border-sky-300/30" data-confirm-list="">
      <h2 className="font-semibold text-white">Your bank wants you to confirm</h2>
      <ul className="space-y-2 text-sm">
        {items.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-2">
            <span className="mr-auto text-slate-200">{i.text}</span>
            <button className="btn px-3 py-1.5 text-sm" disabled={!!busy} onClick={async () => {
              setBusy(i.id);
              try {
                await confirmWaiting(i.id);
                window.location.reload();
              } catch (e) {
                setNote((n) => ({ ...n, [i.id]: (e as Error).message }));
                setBusy("");
              }
            }}>Confirm</button>
            {note[i.id] && <p className="info basis-full">{note[i.id]}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
