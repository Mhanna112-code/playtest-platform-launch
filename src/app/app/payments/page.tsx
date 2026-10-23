import { Banknote, CreditCard, ShieldCheck } from "lucide-react";
import { db } from "@/lib/db";
import { fmtDateTime, money } from "@/lib/format";
import { requirePageUser } from "@/lib/server/page-auth";
import { stripeOn } from "@/lib/server/stripe";
import { owedForBox } from "@/lib/server/holds";
import { OwedBox } from "@/components/OwedBox";

export const metadata = { title: "Payments · Playtest" };
export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  off: "Payments aren't set up in this environment yet: Pay presses are recorded as “payments not set up” and nothing is charged.",
  card: "We couldn't save the card. Try again.",
  payout: "We couldn't open the payout setup. Try again.",
};

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string; pending?: string }> }) {
  const u = await requirePageUser();
  const q = await searchParams;
  const on = stripeOn();
  const [paidOut, paidIn] = await Promise.all([
    u.isDeveloper ? db.payment.findMany({ where: { developerId: u.id, status: { in: ["charged", "not_set_up"] } }, orderBy: { createdAt: "desc" }, take: 100 }) : [],
    u.isTester ? db.payment.findMany({ where: { testerId: u.id, status: { in: ["charged", "not_set_up"] } }, orderBy: { createdAt: "desc" }, take: 100 }) : [],
  ]);
  // The full app's billing / payouts pages: one column of cards, each with its icon heading; lists as rows.
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-3xl font-bold tracking-tight text-white">Payments</h1>
      {!on && <p className="info">{MESSAGES.off}</p>}
      {u.isDeveloper && (await owedForBox(u.id).then((o) => (u.holdStartedAt || o.length ? <OwedBox onHold={!!u.holdStartedAt} owed={o} /> : null)))}
      {q.error && q.error !== "off" && <p className="err">{MESSAGES[q.error]}</p>}
      {q.saved === "card" && <p className="card border-emerald-400/30 text-sm text-emerald-200">Card saved.</p>}
      {q.saved === "payout" && <p className="card border-emerald-400/30 text-sm text-emerald-200">Your payout account is connected.</p>}
      {q.pending === "payout" && <p className="info">Stripe still needs a few details before you can be paid. Continue setup below.</p>}

      {u.isDeveloper && (
        <>
          <section id="card" className="card scroll-mt-24 space-y-3">
            <h2 className="flex items-center gap-2 font-semibold text-white"><CreditCard className="h-5 w-5 text-indigo-300" /> Your card (developer)</h2>
            <p className="text-sm text-slate-300">{u.stripePaymentMethodId ? "A card is saved." : "No card yet."} You&apos;re charged only when you press Pay, for exactly the amount you tick.</p>
            {on && <a className="btn no-underline hover:no-underline" href="/api/payments/card"><CreditCard className="h-4 w-4" /> {u.stripePaymentMethodId ? "Change card" : "Add a card"}</a>}
            <p className="flex items-center gap-1.5 text-xs text-slate-500"><ShieldCheck className="h-3.5 w-3.5" /> Card details are entered on Stripe&apos;s page and never reach this site.</p>
          </section>
          <section className="card space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-white">What you&apos;ve paid</h2>
              <span className="text-sm text-slate-400">Total {money(paidOut.reduce((a, p) => a + p.amountCents, 0))}</span>
            </div>
            <ul className="divide-y divide-white/5 text-sm">
              {paidOut.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="text-slate-200">{p.kind === "call" ? "Live call" : p.kind === "dispute" ? "Dispute decision" : "Sent work"}</span>
                  <span className="text-slate-400">{fmtDateTime(p.createdAt)} · {money(p.amountCents)}{p.status === "not_set_up" ? " · recorded (payments not set up)" : ""}</span>
                </li>
              ))}
              {paidOut.length === 0 && <li className="py-2 text-slate-500">Nothing yet.</li>}
            </ul>
          </section>
        </>
      )}

      {u.isTester && (
        <>
          <section className="card space-y-3">
            <h2 className="flex items-center gap-2 font-semibold text-white"><Banknote className="h-5 w-5 text-emerald-300" /> Your payout account (tester)</h2>
            <p className="text-sm text-slate-300">
              {u.payoutsReady ? "Your payout account is connected. Each payment is sent to it." : u.stripeAccountId ? "Stripe still needs a few details before you can be paid." : "Connect a payout account to receive money for your work."}
            </p>
            {on && !u.payoutsReady && <a className="btn no-underline hover:no-underline" href="/api/payments/payout"><Banknote className="h-4 w-4" /> {u.stripeAccountId ? "Continue setup" : "Connect a payout account"}</a>}
            <p className="flex items-center gap-1.5 text-xs text-slate-500"><ShieldCheck className="h-3.5 w-3.5" /> Bank details go to Stripe and never reach this site.</p>
          </section>
          <section className="card space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-white">What you&apos;ve earned</h2>
              <span className="text-sm text-slate-400">Total {money(paidIn.reduce((a, p) => a + p.testerCents, 0))}</span>
            </div>
            <ul className="divide-y divide-white/5 text-sm">
              {paidIn.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="text-slate-200">You get {money(p.testerCents)}</span>
                  <span className="text-slate-400">{fmtDateTime(p.createdAt)}{p.status === "not_set_up" || p.transferStatus === "waiting" ? " · delayed until your payout account is ready" : ""}</span>
                </li>
              ))}
              {paidIn.length === 0 && <li className="py-2 text-slate-500">Nothing yet.</li>}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
