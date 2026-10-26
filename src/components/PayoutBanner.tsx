import { Banknote } from "lucide-react";
import { PAYOUT_LINE } from "@/lib/payout";

/** (Design doc 9) The tester's payout-failure banner: a button to Stripe; the money stays in their Stripe balance. */
export function PayoutBanner() {
  return (
    <section role="alert" data-payout-banner="" className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-400/40 bg-amber-500/10 p-4 text-sm text-amber-100">
      <Banknote className="h-5 w-5 shrink-0" />
      <p className="min-w-0 flex-1"><b>{PAYOUT_LINE}</b> <span className="text-amber-100/80">The money stays in your Stripe balance until it works.</span></p>
      <a className="btn no-underline hover:no-underline" href="/api/payments/payout">Update payout details</a>
    </section>
  );
}
