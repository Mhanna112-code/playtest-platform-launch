import { Banknote, CreditCard, ShieldCheck } from "lucide-react";
import { db } from "@/lib/db";
import { displayName, fmtDateTime, money } from "@/lib/format";
import { requirePageUser } from "@/lib/server/page-auth";
import { stripeOn } from "@/lib/server/stripe";
import { owedForBox } from "@/lib/server/holds";
import { OwedBox } from "@/components/OwedBox";
import { ChargebackSteps } from "@/components/ChargebackSteps";
import { chargebackSteps } from "@/lib/server/chargeback";
import { sideFor } from "@/lib/sides";
import { PayoutBanner } from "@/components/PayoutBanner";
import { waitingForReview } from "@/lib/server/payments";
import { testerShare } from "@/lib/rules";

export const metadata = { title: "Payments · Playtest" };
export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  off: "Payments aren't set up in this environment yet: Pay presses are recorded as “payments not set up” and nothing is charged.",
  card: "We couldn't save the card. Try again.",
  payout: "We couldn't open the payout setup. Try again.",
  verify: "We couldn't verify the card. Try again or use another card.",
};

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string; pending?: string }> }) {
  const u = await requirePageUser();
  const q = await searchParams;
  const on = stripeOn();
  // (NEXT-UI 6 / 15) Each side has its own payments page, as in the full app (Billing / Payments): the side in use.
  const side = sideFor(u, "/app/payments");
  const dev = side === "developer", tester = side === "tester";
  const cbSteps = dev ? await chargebackSteps(u.id) : null;
  // The tester's "Everything you sent": each part by test, newest first, with where its money is.
  const sent = tester
    ? await db.contract.findMany({
        where: { testerId: u.id },
        orderBy: { joinedAt: "desc" },
        include: { test: { include: { developer: true } }, submissions: { include: { review: true, dispute: true } }, calls: { include: { review: true, dispute: true } } },
      })
    : [];
  // (NEXT-UI 27) A developer's "Waiting for your review": every test with sent work or held calls still to be paid / rejected.
  const waitingTests = dev ? await waitingForReview(u.id) : [];
  const owed = tester ? await db.payment.findMany({ where: { testerId: u.id, status: "failed", settledAt: null, owedUntil: { not: null } }, select: { submissionId: true, callId: true } }) : [];
  const owedKeys = new Set(owed.map((p) => p.submissionId ?? p.callId));
  const [paidOut, paidIn] = await Promise.all([
    dev ? db.payment.findMany({ where: { developerId: u.id, status: { in: ["charged", "not_set_up"] } }, orderBy: { createdAt: "desc" }, take: 100 }) : [],
    tester ? db.payment.findMany({ where: { testerId: u.id, status: { in: ["charged", "not_set_up"] } }, orderBy: { createdAt: "desc" }, take: 100 }) : [],
  ]);
  // The full app's billing / payouts pages: one column of cards, each with its icon heading; lists as rows.
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-3xl font-bold tracking-tight text-white">Payments</h1>
      {tester && u.payoutProblemAt && <PayoutBanner />}
      {!on && <p className="info">{MESSAGES.off}</p>}
      {cbSteps && <ChargebackSteps steps={cbSteps} />}
      {dev && (await owedForBox(u.id).then((o) => (u.holdStartedAt || (o.length && !u.suspendedAt) ? <OwedBox onHold={!!u.holdStartedAt} owed={o} chargeback={!!cbSteps} /> : null)))}
      {q.error && q.error !== "off" && <p className="err">{MESSAGES[q.error]}</p>}
      {q.saved === "verified" && <p className="card border-emerald-400/30 text-sm text-emerald-200">Card verified.</p>}
      {q.saved === "card" && <p className="card border-emerald-400/30 text-sm text-emerald-200">Card saved.</p>}
      {q.saved === "payout" && <p className="card border-emerald-400/30 text-sm text-emerald-200">Your payout account is connected.</p>}
      {q.pending === "payout" && <p className="info">Stripe still needs a few details before you can be paid. Continue setup below.</p>}

      {dev && (
        <>
          <section id="card" className="card scroll-mt-24 space-y-3">
            <h2 className="flex items-center gap-2 font-semibold text-white"><CreditCard className="h-5 w-5 text-indigo-300" /> Your card</h2>
            <p className="text-sm text-slate-300">{u.stripePaymentMethodId ? "A card is saved." : "No card yet."} You&apos;re charged only when you press Pay, for exactly the amount you tick.</p>
            {on && <a className="btn no-underline hover:no-underline" href="/api/payments/card"><CreditCard className="h-4 w-4" /> {u.stripePaymentMethodId ? "Change card" : "Add a card"}</a>}
            <p className="flex items-center gap-1.5 text-xs text-slate-500"><ShieldCheck className="h-3.5 w-3.5" /> Card details are entered on Stripe&apos;s page and never reach this site.</p>
          </section>
          <section className="card space-y-3" id="waiting-review" aria-label="Waiting for your review">
            <h2 className="font-semibold text-white">Waiting for your review</h2>
            {u.suspendedAt && <p className="text-sm text-slate-400" data-suspended-pay-note="">Paying and reviewing work wait until your suspension is lifted.</p>}
            {waitingTests.length === 0 ? <p className="text-sm text-slate-500">Nothing waits for your review.</p> : (
              <ul className="divide-y divide-white/5 text-sm">
                {waitingTests.map((t) => {
                  const n = t.contracts.reduce((a, c) => a + c.submissions.length + c.calls.length, 0);
                  return (
                    <li key={t.id} className="space-y-2 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-slate-200">{t.title} <span className="text-slate-400">· {n} part{n === 1 ? "" : "s"} to pay or reject</span></span>
                        {/* (Owner, Oct 26) A suspended developer can neither Pay nor Reject: the button is hidden until the suspension is lifted. */}
                        {!u.suspendedAt && <a href={`/app/tests/${t.id}#needs-you`} className="btn-secondary px-3 py-1 text-xs no-underline hover:no-underline">Pay</a>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <section className="card space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-white">What you&apos;ve paid</h2>
              <span className="text-sm text-slate-400">Total {money(paidOut.reduce((a, p) => a + p.amountCents, 0))}</span>
            </div>
            <ul className="divide-y divide-white/5 text-sm">
              {paidOut.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="text-slate-200">{p.kind === "call" ? "Live call" : p.kind === "dispute" ? "Dispute decision" : p.kind === "extra" ? "Extra pay" : "Sent work"}</span>
                  <span className="text-slate-400">{fmtDateTime(p.createdAt)} · {money(p.amountCents)}{p.status === "not_set_up" ? " · recorded (payments not set up)" : ""}</span>
                </li>
              ))}
              {paidOut.length === 0 && <li className="py-2 text-slate-500">Nothing yet.</li>}
            </ul>
          </section>
        </>
      )}

      {tester && (
        <>
          <section id="sent" className="card scroll-mt-24 space-y-3">
            <h2 className="font-semibold text-white">Everything you sent</h2>
            <p className="text-xs text-slate-500">Each part you sent, by test, newest first, and where its money is now. A rejected or partly paid part can be disputed once, on its session page.</p>
            {sent.every((c) => c.submissions.length + c.calls.filter((x) => x.review).length === 0) && <p className="text-sm text-slate-500">Nothing sent yet.</p>}
            {sent.filter((c) => c.submissions.length + c.calls.filter((x) => x.review).length > 0).map((c) => (
              <div key={c.id} className="space-y-1">
                <p className="text-sm font-medium text-slate-200">{c.title} <span className="font-normal text-slate-500">· {c.test.developer.name || c.test.developer.email}</span></p>
                <ul className="divide-y divide-white/5 text-sm">
                  {[
                    ...c.submissions.map((x) => ({ id: x.id, at: x.sentAt, what: x.kind === "recording" ? "Screen recording" : "Written answers", review: x.review, dispute: x.dispute })),
                    ...c.calls.filter((x) => x.review).map((x) => ({ id: x.id, at: x.startsAt, what: "Live call", review: x.review, dispute: x.dispute })),
                  ].sort((a, b) => b.at.getTime() - a.at.getTime()).map((r) => {
                    const status = owedKeys.has(r.id) ? { label: "Payment may be delayed", tone: "text-amber-200" }
                      : !r.review ? { label: "Waiting for review", tone: "text-slate-300" }
                      : r.dispute ? { label: r.dispute.status === "open" ? "Disputed: waiting for the team" : "Dispute decided", tone: "text-amber-200" }
                      : r.review.rejected ? { label: "Not accepted", tone: "text-rose-300" }
                      : { label: `Paid · you get ${money(testerShare(r.review.amountCents))}`, tone: "text-emerald-300" };
                    return (
                      <li key={r.id} className="py-2">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                          <a href={`/app/sessions/${c.id}#parts`} className="text-slate-200 hover:underline">{r.what}</a>
                          <span className={status.tone}>{status.label}</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>
          <section id="payout" className="card scroll-mt-24 space-y-3">
            <h2 className="flex items-center gap-2 font-semibold text-white"><Banknote className="h-5 w-5 text-emerald-300" /> Where your money goes</h2>
            <p className="text-sm text-slate-300">
              {u.payoutsReady ? "Your payout account is connected. Each payment is sent to it." : u.stripeAccountId ? "Stripe still needs a few details before you can be paid." : "Connect a payout account to receive money for your work."}
            </p>
            {on && !u.payoutsReady && <a className="btn no-underline hover:no-underline" href="/api/payments/payout"><Banknote className="h-4 w-4" /> {u.stripeAccountId ? "Continue setup" : "Connect a payout account"}</a>}
            <p className="flex items-center gap-1.5 text-xs text-slate-500"><ShieldCheck className="h-3.5 w-3.5" /> Bank details go to Stripe and never reach this site.</p>
          </section>
          <section className="card space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-white">Your earnings</h2>
              <span className="text-sm text-slate-400">Total {money(paidIn.reduce((a, p) => a + p.testerCents, 0))}</span>
            </div>
            <ul className="divide-y divide-white/5 text-sm">
              {paidIn.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="text-slate-200">You get {money(p.testerCents)}{p.kind === "extra" ? " · extra pay" : ""}</span>
                  <span className="text-slate-400">{fmtDateTime(p.createdAt)}{p.transferStatus === "held" ? " · yours once your account is active again" : p.status === "not_set_up" || p.transferStatus === "waiting" ? " · delayed until your payout account is ready" : ""}</span>
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
