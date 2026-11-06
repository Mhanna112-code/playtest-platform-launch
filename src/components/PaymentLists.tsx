import { LongList } from "@/components/LongList";
import { WhatLine } from "@/components/WholeLine";
import { withLineLinks, type LineLink } from "@/components/LineLinks";
import { money } from "@/lib/format";
import { OWED_BANK_WAITING } from "@/lib/rules";
import { plainLabel } from "@/lib/server/paymentRows";
import type { OwedList, PaidGroup, PaidList } from "@/lib/server/paymentLists";
import type { PaidRow, RefundLine } from "@/lib/server/paymentRows";

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

type Pay = PaidList["list"][number];
/** A payment's marks after its amount: recorded without payments set up, refunded (a chargeback won after it was repaid), reversed by the bank (all or part). */
// (Owner, Nov 5, §218; recording R10b) A chargeback the bank then decided in the developer's favour no longer reads "your bank reversed this": it says how it ended.
const marks = (p: Pay, row: PaidRow | undefined) =>
  p.status === "not_set_up" ? " · recorded (payments not set up)" : p.status === "refunded" ? " · refunded (your bank's chargeback was reversed)" : row?.reversed && p.chargeback === "won" ? " · your bank reversed this, then decided in your favour (chargeback won)" : row?.reversed ? (row?.reversedCents ? ` · your bank reversed ${money(row.reversedCents)} of this (chargeback)` : " · your bank reversed this (chargeback)") : "";
/** A line's "what": its test linked, then how it was paid. (Owner, Nov 5, §246; was §216's per-name cut) The "what" cut at 50 (§251) with the arrow, opened in place (WhatLine). */
function What({ p, line, testId, testHref, exact }: { p: Pay; line: { what: string; full: string; how: string; links?: LineLink[] } | undefined; testId: string | null | undefined; testHref: (testId: string) => string;
  /** (Owner, Nov 5, §270) the exact part on the test page ("/app/tests/<id>#piece-<id>"; the team's copy opens the same part on its own test page) */ exact?: string | null }) {
  if (!line) return <>{plainLabel(p.kind)}</>;
  // (§270) Each person and test named is its own green link; the other words open the exact part (beside them, never nested).
  const onPage = (href: string) => { const m = /^\/app\/tests\/([^/#?]+)(.*)$/.exec(href); return m ? `${testHref(m[1])}${m[2]}` : href; };
  const links = line.links?.map((l) => (l.kind === "test" ? { ...l, href: onPage(l.href) } : l));
  return <WhatLine text={line.full || line.what} href={exact ? onPage(exact) : testId ? testHref(testId) : undefined} links={links} after={line.how ? <span className="text-slate-400">, {withLineLinks(line.how, links)}</span> : null} />;
}

/** (Owner, Nov 4, §192) A refund's amount: "−$25.00" (a true minus sign). */
const minus = (cents: number) => `−${money(cents)}`;
/**
 * (Owner, Nov 4, §192) A refund the developer received, as its own negative line right under the payment it refunds: "Refunded: your bank's chargeback on your $10.00
 * Pay more for … was reversed in your favour · −$25.00 · <date>". Inside a group it is a row of the group; under a payment on its own it is a row inside that payment's
 * line (so the long-list rule still counts payments). The team's copy links the PaymentIntent it was refunded from in Stripe.
 */
function RefundItem({ r, fmtDateTime, stripeUrl, inGroup }: { r: RefundLine; fmtDateTime: (d: Date) => string; stripeUrl?: Common["stripeUrl"]; inGroup: boolean }) {
  const body = (
    <>
      <span data-paid-refund-what=""><WhatLine text={r.full || r.what} className="text-slate-200" links={r.links} after={<><span className="text-slate-400"> · <span className="whitespace-nowrap" data-paid-refund-amount="">{minus(r.amountCents)}</span>{r.createdAt ? <> · {fmtDateTime(r.createdAt)}</> : null}{stripeUrl && <StripeLink href={stripeUrl(r.stripePaymentIntentId)} />}</span></>} /></span>
    </>
  );
  return inGroup
    ? <li data-paid-refund={r.id} data-refund-of={r.paymentId}>{body}</li>
    : <span className="mt-1.5 block" data-paid-refund={r.id} data-refund-of={r.paymentId}>{body}</span>;
}

/**
 * (Owner, Nov 4, §191) ONE charge that paid several items (Pay what you owe, Confirm all): one line, closed, with the charge's amount, date and (the team's copy) its
 * Stripe link; open, each item it paid, named exactly (paymentRows' group line: the tester, the part, a call by its date and time, the test, what kind of payment;
 * a repayment names the payment the bank reversed), never "paid through Pay what you owe" / "confirmed with Confirm all" (the group says it). Covered items are
 * only here. A closed group still opens on the browser's find-in-page (a <details>).
 */
function PaidGroupLine({ g, rows, refunds, fmtDateTime, stripeUrl, testHref }: { g: PaidGroup; rows: PaidList["rows"]; refunds?: PaidList["refunds"]; fmtDateTime: (d: Date) => string; stripeUrl?: Common["stripeUrl"]; testHref: (testId: string) => string }) {
  return (
    <li className="py-2" data-paid-group={g.id}>
      <details className="group/paid">
        <summary className="flex cursor-pointer list-none items-baseline gap-1.5 text-slate-200 [&::-webkit-details-marker]:hidden">
          <span aria-hidden="true" className="inline-block w-3 shrink-0 text-slate-400 transition-transform group-open/paid:rotate-90">▸</span>
          <span className="min-w-0">
            <span data-paid-group-what="">{g.label}</span>
            <span className="text-slate-400"> · <span className="whitespace-nowrap" data-paid-group-amount="">{money(g.amountCents)}</span> · {fmtDateTime(g.createdAt)}{g.reversed ? (g.reversedCents ? ` · your bank reversed ${money(g.reversedCents)} of this (chargeback)` : " · your bank reversed this (chargeback)") : ""}{stripeUrl && <StripeLink href={stripeUrl(g.stripePaymentIntentId)} />}</span>
          </span>
        </summary>
        <ul className="ml-1.5 mt-1.5 space-y-1.5 border-l border-white/10 pl-3">
          {g.items.flatMap((p) => [
            <li key={p.id} className="text-slate-200" data-paid-group-item={p.id}>
              <span data-paid-what=""><What p={p} line={rows.get(p.id)?.group} testId={rows.get(p.id)?.testId} testHref={testHref} exact={rows.get(p.id)?.href ?? null} /></span>
              {/* A repayment: "$1.00 + $15.00 chargeback fee" (what the bank reversed, and the fee); anything else its amount. */}
              <span className="text-slate-400"> · <span className="whitespace-nowrap" data-paid-group-item-amount="">{rows.get(p.id)?.group?.amount ?? money(p.amountCents)}</span>{marks(p, rows.get(p.id))}</span>
            </li>,
            // (§192) Its refunds, each its own negative line right under it.
            ...(refunds?.get(p.id) ?? []).map((r) => <RefundItem key={r.id} r={r} fmtDateTime={fmtDateTime} stripeUrl={stripeUrl} inGroup />),
          ])}
        </ul>
      </details>
    </li>
  );
}

/** The developer's "What you've paid": newest first, 8 rows, then "Show N more" opening a scroll box (the long-list rule); the total beside the heading. */
export function DevPaidList({ paid, fmtDateTime, stripeUrl, heading = "What you've paid", testHref = (id) => `/app/tests/${id}` }: Common & { paid: PaidList; testHref?: (testId: string) => string }) {
  const { list: paidOut, rows } = paid;
  // (Owner, Nov 5, §270) A row's words open the exact part on the test page (the team's copy: the same part on its own test page, §190's same lines).
  // (Owner, Nov 4, §191) The items one charge paid together are one group line; the rest one line each (as before).
  const entries = paid.entries ?? paidOut.map((pay) => ({ pay }));
  // A payment paid on its own: what it was for and how, then its date, amount and marks.
  const ownLine = (p: Pay) => (
    <li key={p.id} className="space-y-0.5 py-2">
      <span className="block text-slate-200" data-paid-what=""><What p={p} line={rows.get(p.id)} testId={rows.get(p.id)?.testId} testHref={testHref} exact={rows.get(p.id)?.href ?? null} /></span>
      {/* (§133) Part of a payment reversed: "your bank reversed $96.00 of this (chargeback)". */}
      <span className="block text-slate-400">{fmtDateTime(p.createdAt)} · <span className="whitespace-nowrap">{money(p.amountCents)}</span>{marks(p, rows.get(p.id))}{stripeUrl && <StripeLink href={stripeUrl(p.stripePaymentIntentId)} />}</span>
      {/* (Owner, Nov 4, §192) Each refund of it: its own negative line right under it. */}
      {(paid.refunds?.get(p.id) ?? []).map((r) => <RefundItem key={r.id} r={r} fmtDateTime={fmtDateTime} stripeUrl={stripeUrl} inGroup={false} />)}
    </li>
  );
  return (
    <section className="card space-y-3" data-paid-list="developer">
      {/* (Owner, Nov 3, long text) The total is never split: it moves under the heading when there is no room beside it. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="font-semibold text-white">{heading}</h2>
        <span className="whitespace-nowrap text-sm text-slate-400" data-paid-total="">Total {money(paid.totalCents)}{/* (Owner, Nov 2) a payment your bank reversed counts once, as its repayment; (§133) part of one: the rest of it counts; (§191) the same total, grouped or not; (§192) each refund line taken off (paidLinesTotal) */}</span>
      </div>
      {/* Newest first: 8 rows, then "Show N more" opening a scroll box (the long-list rule). */}
      <LongList shown={8} tall="max-h-96" className="divide-y divide-white/5 text-sm">
        {entries.map((e) => ("group" in e ? <PaidGroupLine key={e.group.id} g={e.group} rows={rows} refunds={paid.refunds} fmtDateTime={fmtDateTime} stripeUrl={stripeUrl} testHref={testHref} /> : ownLine(e.pay)))}
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
            <span className="block text-slate-200" data-earned-what="">You get <span className="whitespace-nowrap">{money(p.testerCents)}</span>{rows.get(p.id) ? <> <WhatLine text={rows.get(p.id)!.full || rows.get(p.id)!.what} links={rows.get(p.id)!.links} after={rows.get(p.id)!.how ? `, ${rows.get(p.id)!.how}` : null} /></> : p.kind === "extra" ? " · extra pay" : ""}</span>
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
          <li key={o.id} className="py-2 text-slate-200" data-owed-line={o.id}>
            {o.what != null ? <WhatLine text={o.what} after={o.rest ? <span data-owed-rest="">{o.rest}</span> : null} /> : <WhatLine text={o.full || o.text} />}
            {o.waiting && !o.after && <> · <b>{OWED_BANK_WAITING}</b></>}
            {o.after && <> · <b>{o.after}</b></>}
            {stripeUrl && <StripeLink href={stripeUrl(o.id)} />}
            {covers && covers.length > 0 && (
              <div className="mt-1 text-xs text-slate-400">
                That payment covered:
                <ul className="list-[circle] pl-5">{covers.map((x, j) => <li key={j}><WhatLine text={x.full || x.text} /></li>)}</ul>
              </div>
            )}
          </li>
        ))}
      </LongList>
    </section>
  );
}
