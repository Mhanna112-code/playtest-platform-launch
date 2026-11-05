import { Banknote } from "lucide-react";
import { PAYOUT_LINE } from "@/lib/payout";

/** (Design doc 9) The tester's payout-failure banner: a button to Stripe; the money stays in their Stripe balance. */
export function PayoutBanner() {
  return (
    <section role="alert" data-payout-banner="" className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-400/40 bg-amber-500/10 p-4 text-sm text-amber-100">
      <Banknote className="h-5 w-5 shrink-0" />
      <p className="min-w-[min(100%,12rem)] flex-1"><b>{PAYOUT_LINE}</b> <span className="text-amber-100/80">The money stays in your Stripe balance until it works.</span></p>
      {/* (Owner, Nov 5, §200) To Stripe's pages for this account (its Express dashboard, or onboarding while Stripe still needs details), not setup: setup
          refused a connected account ("already connected", §157), and a failed payout usually happens on one. */}
      <form method="post" action="/api/payments/payout-dashboard"><input type="hidden" name="press" value="Update payout details" /><button className="btn">Update payout details</button></form>
    </section>
  );
}
