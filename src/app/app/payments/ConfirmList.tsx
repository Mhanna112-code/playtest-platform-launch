"use client";
import { BankWaiting } from "@/components/BankWaiting";
import { CONFIRM_WITH_BANK } from "@/lib/rules";

/**
 * (Owner, Oct 29, batch 11) Payments your bank wants you to confirm (made while you weren't here: a tester's Charge, a dispute decision, a retry during a hold, a renewal).
 * Not confirmed by the date, a charge counts as declined (a payment hold) and a renewal lapses.
 * (Batch 17 §11) A charge on a test is confirmed on that test page, under the piece: the row links straight to its "Confirm with your bank" (the piece marked). Only a
 * charge that belongs to no test (a renewal) is confirmed here, with the same inline check.
 */
export function ConfirmList({ items }: { items: { id: string; text: string; href: string | null }[] }) {
  if (!items.length) return null;
  return (
    <section id="confirm" className="card scroll-mt-24 space-y-3 border-sky-300/30" data-confirm-list="">
      <h2 className="font-semibold text-white">Your bank wants you to confirm</h2>
      <ul className="space-y-2 text-sm">
        {items.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-2" data-confirm-item={i.id}>
            {i.href ? (
              <>
                <span className="mr-auto text-slate-200">{i.text}</span>
                <a href={i.href} className="btn-secondary px-3 py-1.5 text-sm no-underline hover:no-underline" data-bank-link="">{CONFIRM_WITH_BANK} →</a>
              </>
            ) : (
              <BankWaiting paymentId={i.id} line={i.text} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
