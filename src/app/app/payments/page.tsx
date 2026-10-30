import { Banknote, CreditCard, ShieldCheck } from "lucide-react";
import { db } from "@/lib/db";
import { fmtDateTime, money } from "@/lib/format";
import { adminAway, requirePageUser } from "@/lib/server/page-auth";
import { stripeOn } from "@/lib/server/stripe";
import { owedForBox } from "@/lib/server/holds";
import { OwedBox } from "@/components/OwedBox";
import { AutoRefresh } from "@/components/AutoRefresh";
import { owedV } from "@/lib/server/pulseV";
import { HOLD_APPROVAL_AFTER, reservedLine, retryStatusLine } from "@/lib/rules";
import { confirmItems } from "@/lib/server/confirm";
import { ConfirmList } from "./ConfirmList";
import { ChargebackSteps } from "@/components/ChargebackSteps";
import { chargebackSteps } from "@/lib/server/chargeback";
import { sideFor } from "@/lib/sides";
import { PayoutBanner } from "@/components/PayoutBanner";
import { LongList } from "@/components/LongList";
import { paidRows } from "@/lib/server/paymentRows";
import { testerShare } from "@/lib/rules";
import { SubscriptionBox } from "./SubscriptionBox";
import { launchState } from "@/lib/server/subscription";
import { RETRY_DAYS, fmtSubDay, subState } from "@/lib/subscription";
import { AccountRefresh } from "@/components/AccountRefresh";
import { accountChangesSince } from "@/lib/server/accountChanges";
import { AccountFormButton } from "./AccountFormButton";

export const metadata = { title: "Payments · Playtest" };
export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  off: "Payments aren't set up in this environment yet: Pay presses are recorded as “payments not set up” and nothing is charged.",
  card: "We couldn't save the card. Try again.",
  payout: "We couldn't open the payout setup. Try again.",
  verify: "We couldn't verify the card. Try again or use another card.",
  confirm: "Confirm your email first: payouts go only to a confirmed account. We sent you a link.",
};

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string; pending?: string; stop?: string; since?: string; tab?: string }> }) {
  const u = await requirePageUser();
  adminAway(u, "/app/payments"); // (batch 20 section 16) admin only
  await (await import("@/lib/server/recovery")).checkStuck({ developerId: u.id }); // (batch 15 section 9) payments stuck "in progress"
  const q = await searchParams;
  const on = stripeOn();
  // (NEXT-UI 6 / 15) Each side has its own payments page, as in the full app (Billing / Payments): the side in use.
  const side = sideFor(u, "/app/payments");
  const dev = side === "developer", tester = side === "tester";
  // (Batch 30 §8) The owed fingerprint as of before the page reads what it shows: AutoRefresh starts from it, so a change right after this render is caught.
  const owedFp = dev ? await owedV(u.id) : "";
  const cbSteps = dev ? await chargebackSteps(u.id) : null;
  // The tester's "Everything you sent": each part by test, newest first, with where its money is.
  const sent = tester
    ? await db.contract.findMany({
        where: { testerId: u.id },
        orderBy: { joinedAt: "desc" },
        include: { test: { include: { developer: true } }, submissions: { include: { review: true, dispute: true } }, calls: { include: { review: true, dispute: true } } },
      })
    : [];
  const owed = tester ? await db.payment.findMany({ where: { testerId: u.id, OR: [{ status: "failed", settledAt: null, owedUntil: { not: null } }, { status: "owed" }] }, select: { submissionId: true, callId: true } }) : [];
  const owedKeys = new Set(owed.map((p) => p.submissionId ?? p.callId));
  // (Batch 32 §3) A paid part's total, Pay more and extra pay included (as the session page's "Paid so far").
  const partPaid = tester ? new Map((await db.payment.groupBy({ by: ["submissionId", "callId"], where: { testerId: u.id, status: { in: ["charged", "not_set_up"] } }, _sum: { amountCents: true } })).map((g) => [g.submissionId ?? g.callId ?? "", g._sum.amountCents ?? 0])) : new Map<string, number>();
  const [paidOut, paidIn] = await Promise.all([
    // (Batch 10) A repaid chargeback refunded after the platform won it stays in the list, marked refunded (not in the total).
    dev ? db.payment.findMany({ where: { developerId: u.id, OR: [{ status: { in: ["charged", "not_set_up"] } }, { status: "refunded", kind: "chargeback" }] }, orderBy: { createdAt: "desc" }, take: 500 }) : [],
    tester ? db.payment.findMany({ where: { testerId: u.id, kind: { not: "subscription" }, status: { in: ["charged", "not_set_up"] } }, orderBy: { createdAt: "desc" }, take: 500 }) : [],
  ]);
  // (Batch 32 §18) What each paid line was for (who, which part, which test, how it was paid; a reversed payment says so).
  const rows = new Map([...(dev ? await paidRows(paidOut, "developer") : []), ...(tester ? await paidRows(paidIn, "tester") : [])]);
  // (Owner, Oct 28, batch 16 section 27) Change card / payout setup stopped once (the account changed in another tab or device): the box under that button.
  const seenAt = new Date().toISOString();
  const since = q.since ? new Date(q.since) : null;
  const stopLines = (q.stop === "card" || q.stop === "payout") && since && !isNaN(since.getTime()) ? await accountChangesSince(u.id, since, "payments", q.tab ?? "") : [];
  const stopFor = (press: string) => (q.stop === press && stopLines.length ? { changes: stopLines.map((c) => ({ ...c, at: c.at.toISOString() })), at: seenAt } : null);
  // The full app's billing / payouts pages: one column of cards, each with its icon heading; lists as rows.
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-3xl font-bold tracking-tight text-white">Payments</h1>
      {/* (Batch 16 section 27) Changes made in another tab or device update this page silently. */}
      <AccountRefresh />
      {tester && u.payoutProblemAt && <PayoutBanner />}
      {!on && <p className="info">{MESSAGES.off}</p>}
      {cbSteps && <ChargebackSteps steps={cbSteps} />}
      {/* (Owner, Oct 27) "Pay what you owe" shows only during a hold (a declined payment starts one at once). Pay and Reject left this page: the dashboard has the Needs review box. */}
      {/* (Owner, Oct 29, batch 10) The box updates live (about every 20 s) and disappears when nothing is owed. */}
      {dev && <AutoRefresh query="owed=1" v={owedFp} />}
      {dev && (await owedForBox(u.id).then((o) => {
        const review = !!(u.holdStartedAt && u.holdReason !== "chargeback" && u.holdCount > HOLD_APPROVAL_AFTER);
        if (!u.holdStartedAt) return null;
        // (Owner, Oct 28, batch 16 section 41) A chargeback hold: paying never lifts it (step 2 shows ✓; the team's Approve, step 3, lifts it).
        // (Batch 23 section 6) Everything owed reserved on the card: "Reserved $X: it's taken when the team approves lifting your hold."
        if (!o.length) return cbSteps ? <p className="info" data-chargeback-paid="">{cbSteps.reservedCents > 0 ? reservedLine(cbSteps.reservedCents) : "Paid. Your tests stay paused until the team approves."}</p> : review ? <p className="info" data-hold-review-paid="">You&apos;ve paid what you owe. The team will review your account before your tests resume.</p> : null;
        return <OwedBox onHold={!!u.holdStartedAt} owed={o} chargeback={!!cbSteps} review={review} retryLine={cbSteps ? "" : retryStatusLine(u, fmtDateTime)} verifyFirst={!!cbSteps && !cbSteps.cardVerified} reservedCents={cbSteps?.reservedCents ?? 0} reserveExpired={cbSteps?.expired ?? false} />;
      }))}
      {/* (Batch 11) Payments the developer's bank wants confirmed (made while they weren't here). (Batch 17 §11) A charge on a test links to its test page's button. */}
      {dev && <ConfirmList items={await confirmItems(u.id)} />}
      {q.error && q.error !== "off" && <p className="err">{MESSAGES[q.error]}</p>}
      {q.saved === "verified" && <p className="card border-emerald-400/30 text-sm text-emerald-200">Card verified.</p>}
      {q.saved === "card" && <p className="card border-emerald-400/30 text-sm text-emerald-200">Card saved.</p>}
      {q.saved === "payout" && <p className="card border-emerald-400/30 text-sm text-emerald-200">Your payout account is connected.</p>}
      {q.pending === "payout" && <p className="info">Stripe still needs a few details before you can be paid. Continue setup below.</p>}

      {dev && await (async () => {
        // (Owner, Oct 28, batch 8) The subscription, before the card.
        const launch = await launchState();
        return (
          <SubscriptionBox state={subState(u)} since={u.subscribedAt ? fmtSubDay(u.subscribedAt) : null} renews={u.subscriptionRenewsAt ? fmtSubDay(u.subscriptionRenewsAt) : null}
            endedReason={u.subscriptionEndReason} seenAt={seenAt} hasCard={!!u.stripePaymentMethodId} needsCard={on} restricted={!!(u.holdStartedAt || u.devSuspendedAt)}
            launch={{ free: launch.free, until: launch.until ? fmtSubDay(launch.until) : null }}
            pastDueBy={u.subscriptionPastDueAt ? fmtSubDay(new Date(u.subscriptionPastDueAt.getTime() + RETRY_DAYS * 86_400_000)) : null} />
        );
      })()}
      {dev && (
        <>
          <section id="card" className="card scroll-mt-24 space-y-3">
            <h2 className="flex items-center gap-2 font-semibold text-white"><CreditCard className="h-5 w-5 text-indigo-300" /> Your card</h2>
            <p className="text-sm text-slate-300">{u.stripePaymentMethodId ? "A card is saved." : "No card yet."} You&apos;re charged only when you press Pay, for exactly the amount you tick.</p>
            {/* (Batch 15 section 41, L5) Stripe objects are made only on a POST. */}
            {on && <AccountFormButton action="/api/payments/card" seenAt={seenAt} press={u.stripePaymentMethodId ? "Change card" : "Add a card"} stop={stopFor("card")}><CreditCard className="h-4 w-4" /> {u.stripePaymentMethodId ? "Change card" : "Add a card"}</AccountFormButton>}
            <p className="flex items-center gap-1.5 text-xs text-slate-500"><ShieldCheck className="h-3.5 w-3.5" /> Card details are entered on Stripe&apos;s page and never reach this site.</p>
          </section>
          <section className="card space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-white">What you&apos;ve paid</h2>
              <span className="text-sm text-slate-400">Total {money(paidOut.filter((p) => p.status !== "refunded").reduce((a, p) => a + p.amountCents, 0))}</span>
            </div>
            {/* Newest first: 8 rows, then "Show N more" opening a scroll box (the long-list rule). */}
            <LongList shown={8} tall="max-h-96" className="divide-y divide-white/5 text-sm">
              {paidOut.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="text-slate-200" data-paid-what="">{rows.get(p.id) ? <><a className="hover:underline" href={`/app/tests/${rows.get(p.id)!.testId}`}>{rows.get(p.id)!.what}</a>{rows.get(p.id)!.how ? <span className="text-slate-400">, {rows.get(p.id)!.how}</span> : null}</> : p.kind === "call" ? "Live call" : p.kind === "dispute" ? "Dispute decision" : p.kind === "extra" ? "Extra pay" : p.kind === "chargeback" ? "A reversed payment, paid again" : p.kind === "subscription" ? "Subscription" : "Sent work"}</span>
                  <span className="text-slate-400">{fmtDateTime(p.createdAt)} · {money(p.amountCents)}{p.status === "not_set_up" ? " · recorded (payments not set up)" : p.status === "refunded" ? " · refunded (your bank's chargeback was reversed)" : rows.get(p.id)?.reversed ? " · your bank reversed this (chargeback)" : ""}</span>
                </li>
              ))}
              {paidOut.length === 0 && <li className="py-2 text-slate-500">Nothing yet.</li>}
            </LongList>
          </section>
        </>
      )}

      {tester && (
        <>
          <section id="sent" className="card scroll-mt-24 space-y-3">
            <h2 className="font-semibold text-white">Everything you sent</h2>
            <p className="text-xs text-slate-500">Each part you sent, by test, newest first, and where its money is now. Whatever the developer paid for a part, $0 included, can be disputed once, on its session page.</p>
            {sent.every((c) => c.submissions.length + c.calls.filter((x) => x.review).length === 0) && <p className="text-sm text-slate-500">Nothing sent yet.</p>}
            <LongList as="div" shown={5} tall="max-h-[28rem]" className="space-y-3">
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
                      : { label: `Paid ${money(partPaid.get(r.id) ?? r.review.amountCents)} · you get ${money(testerShare(partPaid.get(r.id) ?? r.review.amountCents))}`, tone: "text-emerald-300" };
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
            </LongList>
          </section>
          <section id="payout" className="card scroll-mt-24 space-y-3">
            <h2 className="flex items-center gap-2 font-semibold text-white"><Banknote className="h-5 w-5 text-emerald-300" /> Where your money goes</h2>
            <p className="text-sm text-slate-300">
              {u.payoutsReady ? "Your payout account is connected. Each payment is sent to it." : u.stripeAccountId ? "Stripe still needs a few details before you can be paid." : "Connect a payout account to receive money for your work."}
            </p>
            {on && !u.payoutsReady && <AccountFormButton action="/api/payments/payout" seenAt={seenAt} press={u.stripeAccountId ? "Continue setup" : "Connect a payout account"} stop={stopFor("payout")}><Banknote className="h-4 w-4" /> {u.stripeAccountId ? "Continue setup" : "Connect a payout account"}</AccountFormButton>}
            <p className="flex items-center gap-1.5 text-xs text-slate-500"><ShieldCheck className="h-3.5 w-3.5" /> Bank details go to Stripe and never reach this site.</p>
          </section>
          <section className="card space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-white">Your earnings</h2>
              <span className="text-sm text-slate-400">Total {money(paidIn.reduce((a, p) => a + p.testerCents, 0))}</span>
            </div>
            <LongList shown={8} tall="max-h-96" className="divide-y divide-white/5 text-sm">
              {paidIn.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="text-slate-200" data-earned-what="">You get {money(p.testerCents)}{rows.get(p.id) ? ` ${rows.get(p.id)!.what}${rows.get(p.id)!.how ? `, ${rows.get(p.id)!.how}` : ""}` : p.kind === "extra" ? " · extra pay" : ""}</span>
                  <span className="text-slate-400">{fmtDateTime(p.createdAt)}{p.status === "not_set_up" || p.transferStatus === "waiting" ? " · delayed until your payout account is ready" : ""}</span>
                </li>
              ))}
              {paidIn.length === 0 && <li className="py-2 text-slate-500">Nothing yet.</li>}
            </LongList>
          </section>
        </>
      )}
    </div>
  );
}
