import { LongList } from "@/components/LongList";
import { money } from "@/lib/format";
import { OWED_BANK_WAITING } from "@/lib/rules";
import { plainLabel } from "@/lib/server/paymentRows";
import type { OwedList, PaidList } from "@/lib/server/paymentLists";

// (Owner, Nov 4, §190) Payments' paid lists, drawn by ONE component for the account holder (Payments) and for the team (a person's admin box), so the two can't
// drift: the same lines, the same "how" words, the same total. The team's copy adds a "Stripe" link on each line with a PaymentIntent, and links each test to its
// team page; it has no button of any kind.

type Common = {
  /** A date as the reader sees it (Payments: the account holder's zone; the admin box: the admin's). */
  fmtDateTime: (d: Date) => string;
  /** (§190) The team's copy: a payment's Stripe Dashboard page ("" for none). */
  stripeUrl?: (pi: string | null | undefined) => string;
  heading?: string;
};

/** (§190) " · Stripe": the payment in the Stripe Dashboard (new tab). */
function StripeLink({ href }: { href: string }) {
  return href ? <> · <a href={href} target="_blank" rel="noreferrer" data-stripe-link="">Stripe</a></> : null;
}

/** The developer's "What you've paid": newest first, 8 rows, then "Show N more" opening a scroll box (the long-list rule); the total beside the heading. */
export function DevPaidList({ paid, fmtDateTime, stripeUrl, heading = "What you've paid", testHref = (id) => `/app/tests/${id}` }: Common & { paid: PaidList; testHref?: (testId: string) => string }) {
  const { list: paidOut, rows } = paid;
  return (
    <section className="card space-y-3" data-paid-list="developer">
      {/* (Owner, Nov 3, long text) The total is never split: it moves under the heading when there is no room beside it. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="font-semibold text-white">{heading}</h2>
        <span className="whitespace-nowrap text-sm text-slate-400" data-paid-total="">Total {money(paid.totalCents)}{/* (Owner, Nov 2) a payment your bank reversed counts once, as its repayment; (§133) part of one: the rest of it counts (paidOutTotal) */}</span>
      </div>
      {/* Newest first: 8 rows, then "Show N more" opening a scroll box (the long-list rule). */}
      <LongList shown={8} tall="max-h-96" className="divide-y divide-white/5 text-sm">
        {paidOut.map((p) => (
          <li key={p.id} className="space-y-0.5 py-2">
            <span className="block text-slate-200" data-paid-what="">{rows.get(p.id) ? <>{rows.get(p.id)!.testId ? <a className="hover:underline" href={testHref(rows.get(p.id)!.testId!)} title={rows.get(p.id)!.full}>{rows.get(p.id)!.what}</a> : <span title={rows.get(p.id)!.full}>{rows.get(p.id)!.what}</span>}{rows.get(p.id)!.how ? <span className="text-slate-400">, {rows.get(p.id)!.how}</span> : null}</> : plainLabel(p.kind)}</span>
            {/* (§133) Part of a payment reversed: "your bank reversed $96.00 of this (chargeback)". */}
            <span className="block text-slate-400">{fmtDateTime(p.createdAt)} · <span className="whitespace-nowrap">{money(p.amountCents)}</span>{p.status === "not_set_up" ? " · recorded (payments not set up)" : p.status === "refunded" ? " · refunded (your bank's chargeback was reversed)" : rows.get(p.id)?.reversed ? (rows.get(p.id)?.reversedCents ? ` · your bank reversed ${money(rows.get(p.id)!.reversedCents!)} of this (chargeback)` : " · your bank reversed this (chargeback)") : ""}{stripeUrl && <StripeLink href={stripeUrl(p.stripePaymentIntentId)} />}</span>
          </li>
        ))}
        {paidOut.length === 0 && <li className="py-2 text-slate-500">Nothing yet.</li>}
      </LongList>
    </section>
  );
}

/** The tester's "Your earnings": what they get for each payment, newest first, a delayed share marked as theirs ("delayed until your payout account is ready"). */
export function TesterEarnedList({ earned, fmtDateTime, stripeUrl, heading = "Your earnings" }: Common & { earned: PaidList }) {
  const { list: paidIn, rows } = earned;
  return (
    <section className="card space-y-3" data-paid-list="tester">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="font-semibold text-white">{heading}</h2>
        <span className="whitespace-nowrap text-sm text-slate-400" data-earned-total="">Total {money(earned.totalCents)}</span>
      </div>
      <LongList shown={8} tall="max-h-96" className="divide-y divide-white/5 text-sm">
        {paidIn.map((p) => (
          <li key={p.id} className="space-y-0.5 py-2">
            <span className="block text-slate-200" data-earned-what="">You get <span className="whitespace-nowrap">{money(p.testerCents)}</span>{rows.get(p.id) ? ` ${rows.get(p.id)!.what}${rows.get(p.id)!.how ? `, ${rows.get(p.id)!.how}` : ""}` : p.kind === "extra" ? " · extra pay" : ""}</span>
            <span className="block text-slate-400">{fmtDateTime(p.createdAt)}{p.status === "not_set_up" || p.transferStatus === "waiting" ? " · delayed until your payout account is ready" : ""}{stripeUrl && <StripeLink href={stripeUrl(p.stripePaymentIntentId)} />}</span>
          </li>
        ))}
        {paidIn.length === 0 && <li className="py-2 text-slate-500">Nothing yet.</li>}
      </LongList>
    </section>
  );
}

/**
 * (Owner, Nov 4, §190) The team's read-only copy of the developer's Pay what you owe list: the same lines (owedForBox), "Waiting for your bank" and what a reversed
 * Pay what you owe payment covered, and the amount its button would pay. No Pay, no Cancel this check.
 */
export function OwedReadOnly({ owed, stripeUrl, heading = "What you owe" }: { owed: OwedList; stripeUrl?: (id: string) => string; heading?: string }) {
  return (
    <section className="card space-y-3" data-owed-readonly="">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="font-semibold text-white">{heading}</h2>
        <span className="whitespace-nowrap text-sm text-slate-400" data-owed-total="">Total {money(owed.totalCents)}</span>
      </div>
      <LongList shown={8} tall="max-h-96" className="divide-y divide-white/5 text-sm">
        {owed.lines.map((o) => ({ o, covers: "covers" in o ? o.covers : undefined })).map(({ o, covers }) => (
          <li key={o.id} className="py-2 text-slate-200" data-owed-line={o.id} title={o.full}>
            {o.text}
            {o.waiting && !o.after && <> · <b>{OWED_BANK_WAITING}</b></>}
            {o.after && <> · <b>{o.after}</b></>}
            {stripeUrl && <StripeLink href={stripeUrl(o.id)} />}
            {covers && covers.length > 0 && (
              <div className="mt-1 text-xs text-slate-400">
                That payment covered:
                <ul className="list-[circle] pl-5">{covers.map((x, j) => <li key={j} title={x.full}>{x.text}</li>)}</ul>
              </div>
            )}
          </li>
        ))}
      </LongList>
    </section>
  );
}
