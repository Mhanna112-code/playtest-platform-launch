import { EMPTY_POOL, lineLinks, linkPool } from "@/lib/server/lineLinks";
import { Cut, TestName } from "@/components/Cut";
import { WhatLine } from "@/components/WholeLine";
import { withDateZone } from "@/lib/server/dateZone";
import { displayName, fmtDateTimeIn } from "@/lib/format";
import { deferredForBox } from "@/lib/server/holds";
import { paymentsV } from "@/lib/server/pageFreshness";
import { savedCardLine } from "@/lib/server/savedCard";
import { Banknote, CreditCard, ShieldCheck } from "lucide-react";
import { db } from "@/lib/db";
import { money } from "@/lib/server/dateFormat";
import { adminAway, requirePageUser } from "@/lib/server/page-auth";
import { PAYMENTS_OFF, PAYOUT_ALREADY_CONNECTED, stripeOn } from "@/lib/server/stripe";
import { owedForBox } from "@/lib/server/holds";
import { OwedBox } from "@/components/OwedBox";
import { AutoRefresh } from "@/components/AutoRefresh";
import { OnePage } from "@/components/OnePage";
import { ownPageScope } from "@/lib/pageClaim";
import { owedV } from "@/lib/server/pulseV";
import { HOLD_APPROVAL_AFTER, reservedLine, reviewFirstLine } from "@/lib/rules";
import { confirmItems } from "@/lib/server/confirm";
import { ConfirmList } from "./ConfirmList";
import { ChargebackSteps } from "@/components/ChargebackSteps";
import { chargebackSteps } from "@/lib/server/chargeback";
import { hasBoth, sideFor } from "@/lib/sides";
import { OtherSidePage } from "@/components/OtherSidePage";
import { PayoutBanner } from "@/components/PayoutBanner";
import { LongList } from "@/components/LongList";
import { developerPaid, testerEarned } from "@/lib/server/paymentLists";
import { DevPaidList, TesterEarnedList } from "@/components/PaymentLists";
import { testerShare } from "@/lib/rules";
import { SubscriptionBox } from "./SubscriptionBox";
import { launchState } from "@/lib/server/subscription";
import { RETRY_DAYS, fmtSubDay, subState } from "@/lib/subscription";
import { AccountRefresh } from "@/components/AccountRefresh";
import { accountChangesSince } from "@/lib/server/accountChanges";
import { TOO_MANY_CARD_ATTEMPTS } from "@/lib/server/cardLimits";
import { AccountFormButton } from "./AccountFormButton";
import { CHANGE_PAYOUT, refusalLine } from "@/lib/pressLabels";

export const metadata = { title: "Payments · Playtest" };
export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  off: "Payments aren't set up in this environment yet: Pay presses are recorded as “payments not set up” and nothing is charged.",
  card: "We couldn't save the card. Try again.",
  payout: "We couldn't open the payout setup. Try again.",
  verify: "We couldn't verify the card. Try again or use another card.",
  confirm: "Confirm your email first: payouts go only to a confirmed account. We sent you a link.",
  card_limit: TOO_MANY_CARD_ATTEMPTS, // (batch 35 §127) shown under Add a card / Change card, not up here
  payout_ready: PAYOUT_ALREADY_CONNECTED, // (Owner, Nov 3, §157) payout setup pressed from a page that didn't show it connected
  paused: PAYMENTS_OFF, // (§130) live keys while payments are switched off (STRIPE_ALLOW_LIVE not set): Add a card / payout setup
  // (Owner, Nov 5, §200) Change payout details / Update payout details (the payout problem's).
  dashboard: "We couldn't open Stripe. Try again.",
  payout_none: "Your payout account isn't connected. Connect a payout account to be paid.",
  payout_gone: "Stripe doesn't know your payout account any more, so it was removed here. Connect a payout account to be paid.", // (§130)
};

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string; pending?: string; stop?: string; since?: string; tab?: string; press?: string }> }) {
  const u = await requirePageUser();
  return withDateZone(u.timeZone, async () => {

  const fmtDateTime = (d: Date | string) => fmtDateTimeIn(d, u.timeZone);
  adminAway(u, "/app/payments"); // (batch 20 section 16) admin only
  await (await import("@/lib/server/recovery")).checkStuck({ developerId: u.id }); // (batch 15 section 9) payments stuck "in progress"
  const freshV = await paymentsV(u);
  const q = await searchParams;
  const on = stripeOn();
  // (NEXT-UI 6 / 15) Each side has its own payments page, as in the full app (Billing / Payments): the side in use.
  // (Owner, Oct 30, batch 34 §5) Only the side in use's content; coming back from Stripe leaves the side as it is. A return that belongs to the other side
  // (card saved or verified: the developer's; payout setup: the tester's) shows the switch notice, so nothing of the other side is said here.
  const side = sideFor(u);
  const dev = side === "developer", tester = side === "tester";
  const returnSide = q.saved === "card" || q.saved === "verified" || q.error === "card" || q.error === "card_limit" || q.error === "verify" ? "developer"
    : q.saved === "payout" || q.pending === "payout" || q.error === "payout" || q.error === "payout_ready" || q.error === "confirm"
      || q.error === "dashboard" || q.error === "payout_none" || q.error === "payout_gone" ? "tester" : null;
  if (hasBoth(u) && returnSide && returnSide !== side) {
    const again = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => typeof e[1] === "string")).toString();
    return <OtherSidePage side={returnSide} next={`/app/payments${again ? `?${again}` : ""}`} />;
  }
  // (§130) Read first: a card Stripe doesn't know is cleared here (on `u` too), so this same page offers "Add a card".
  const cardLine = dev ? await savedCardLine(u) : "";
  // (Batch 30 §8) The owed fingerprint as of before the page reads what it shows: AutoRefresh starts from it, so a change right after this render is caught.
  const owedFp = dev ? await owedV(u.id) : "";
  const cbSteps = dev ? await chargebackSteps(u.id) : null;
  // (Owner, Nov 2, batch 35 §125) During a hold the charges waiting for the lift are listed IN Pay what you owe (they're paid with it, as one payment); the
  // separate list stays for the rest (e.g. a suspension still on after a lift).
  const owedNow = dev ? await owedForBox(u.id) : [];
  const ranOut = dev ? await (await import("@/lib/server/owedOnce")).ranOutLine(u.id) : null;
  const inBox = new Set(owedNow.map((o) => o.id));
  const waitingCharges = dev ? (await deferredForBox(u.id)).filter((p) => !inBox.has(p.id)) : [];
  // (Owner, Nov 5, §270) The reader's people and tests, for the green links in the lines built here.
  const pool = dev && waitingCharges.length ? await linkPool(u.id) : EMPTY_POOL;
  // The tester's "Everything you sent": each part by test, newest first, with where its money is.
  const sent = tester
    ? await db.contract.findMany({
        where: { testerId: u.id },
        orderBy: { joinedAt: "desc" },
        include: { test: { include: { developer: true } }, submissions: { include: { review: true, dispute: true } }, calls: { include: { review: true, dispute: true } } },
      })
    : [];
  // (Owner, Nov 2) A developer's repayment of a reversed payment ("chargeback" rows) and Pay what you owe's own record ("owed") are never the tester's: hidden from them.
  const owed = tester ? await db.payment.findMany({ where: { testerId: u.id, kind: { notIn: ["chargeback", "owed"] }, OR: [{ status: "failed", settledAt: null, owedUntil: { not: null } }, { status: "owed" }] }, select: { submissionId: true, callId: true } }) : [];
  const owedKeys = new Set(owed.map((p) => p.submissionId ?? p.callId));
  // (Batch 32 §3) A paid part's total, Pay more and extra pay included (as the session page's "Paid so far").
  const partPaid = tester ? new Map((await db.payment.groupBy({ by: ["submissionId", "callId"], where: { testerId: u.id, status: { in: ["charged", "not_set_up"] } }, _sum: { amountCents: true } })).map((g) => [g.submissionId ?? g.callId ?? "", g._sum.amountCents ?? 0])) : new Map<string, number>();
  // (Owner, Nov 4, §190) "What you've paid" and "Your earnings" are read by the shared functions (lib/server/paymentLists.ts: the queries, each line by paidRows, the
  // totals) and drawn by the shared lists (components/PaymentLists.tsx): a person's admin box shows the team the same lists.
  const [paid, earned] = await Promise.all([dev ? developerPaid(u.id) : null, tester ? testerEarned(u.id) : null]);
  // (Owner, Oct 28, batch 16 section 27) Change card / payout setup stopped once (the account changed in another tab or device): the box under that button.
  const seenAt = new Date().toISOString();
  const since = q.since ? new Date(q.since) : null;
  const stopLines = (q.stop === "card" || q.stop === "payout") && since && !isNaN(since.getTime()) ? await accountChangesSince(u.id, since, "payments", q.tab ?? "") : [];
  const stopFor = (press: string) => (q.stop === press && stopLines.length ? { changes: stopLines.map((c) => ({ ...c, at: c.at.toISOString() })), at: seenAt } : null);
  // (Owner, Nov 3, §156) A refused card or payout press names its button, like every refusal: "Your Add a card didn't go through: We couldn't save the card. …".
  // The card belongs to the developer side, the payout setup to the tester side: "paused" (§130) is the press of the side shown.
  const cardPress = u.stripePaymentMethodId ? "Change card" : "Add a card";
  // (Owner, Nov 5, §200) A connected account's press is "Change payout details"; a refusal from it (or the banner's Update payout details) names the one pressed.
  const payoutPress = q.press === "update" ? "Update payout details" : q.press === "change" ? "Change payout details"
    : u.payoutProblemAt ? "Update payout details" : u.payoutsReady ? "Change payout details" : u.stripeAccountId ? "Continue setup" : "Connect a payout account";
  const refusedPress = (code: string) => (code === "verify" ? "Verify this card"
    : code === "payout" || code === "confirm" || code === "dashboard" || code === "payout_none" || code === "payout_gone" || (code === "paused" && tester) ? payoutPress : cardPress);
  const refused = (code: string) => refusalLine(refusedPress(code), MESSAGES[code] ?? "");
  // The full app's billing / payouts pages: one column of cards, each with its icon heading; lists as rows.
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <AutoRefresh query="fresh=payments" v={freshV} />
      {/* (Owner, Nov 11, §380 K) Payments: one page at a time, across devices. */}
      <OnePage scope={ownPageScope("payments")} />
      <h1 className="text-3xl font-bold tracking-tight text-white">Payments</h1>
      {/* (Batch 16 section 27) Changes made in another tab or device update this page silently. */}
      <AccountRefresh />
      {tester && u.payoutProblemAt && <PayoutBanner />}
      {!on && <p className="info">{MESSAGES.off}</p>}
      {cbSteps && <ChargebackSteps steps={cbSteps} />}
      {/* (Owner, Oct 27) "Pay what you owe" shows only during a hold (a declined payment starts one at once). Pay and Reject left this page: the dashboard has the Needs review box. */}
      {/* (Owner, Oct 29, batch 10) The box updates live (about every 20 s) and disappears when nothing is owed. */}
      {dev && <AutoRefresh query="owed=1" v={owedFp} />}
      {dev && (await Promise.resolve(owedNow).then((o) => {
        const review = !!(u.holdStartedAt && u.holdReason !== "chargeback" && u.holdCount > HOLD_APPROVAL_AFTER);
        if (!u.holdStartedAt) return null;
        // (Owner, Oct 28, batch 16 section 41) A chargeback hold: paying never lifts it (step 2 shows ✓; the team's Approve, step 3, lifts it).
        // (Batch 23 section 6) Everything owed reserved on the card: "Reserved $X: it's taken when the team approves lifting your hold."
        if (!o.length) return cbSteps ? <p className="info" data-chargeback-paid="">{cbSteps.reservedCents > 0 ? reservedLine(cbSteps.reservedCents) : "Paid. Your tests stay paused until the team approves."}</p> : review ? <p className="info" data-hold-review-paid="">You&apos;ve paid what you owe. The team will review your account before your tests resume.</p> : null;
        return <OwedBox onHold={!!u.holdStartedAt} owed={o} ranOut={ranOut} chargeback={!!cbSteps && !cbSteps.reviewFirst} reviewFirst={cbSteps?.reviewFirst && !cbSteps.approved ? reviewFirstLine(cbSteps.count) : ""} review={review} verifyFirst={!!cbSteps && !cbSteps.cardVerified} reservedCents={cbSteps?.reservedCents ?? 0} reserveExpired={cbSteps?.expired ?? false} />;
      }))}
      {dev && waitingCharges.length > 0 && <section className="card space-y-3" id="waiting-charges" data-waiting-charges="">
        <h2>Charged once your tests resume</h2>
        <LongList className="space-y-2 text-sm">{waitingCharges.map((p) => <li key={p.id}><WhatLine text={p.full || p.what} href={p.href} links={lineLinks(pool, p.full || p.what)} after={<> · {money(p.amountCents)}</>} /></li>)}</LongList>
      </section>}
      {/* (Batch 11) Payments the developer's bank wants confirmed (made while they weren't here). (Batch 17 §11) A charge on a test links to its test page's button. */}
      {/* (Owner, Nov 3, §147) Confirm all above the list (its state first: a Confirm all check that ran out lets go before the list is read). */}
      {/* (Owner, Nov 11, §380 B) Confirm all lives only on the dashboard. */}
      {dev && <ConfirmList items={await confirmItems(u.id)} />}
      {q.error && q.error !== "off" && q.error !== "card_limit" && MESSAGES[q.error] && <p className="err" data-refusal="">{refused(q.error)}</p>}
      {q.saved === "verified" && <p className="card border-emerald-400/30 text-sm text-emerald-200">Card verified.</p>}
      {q.saved === "card" && <p className="card border-emerald-400/30 text-sm text-emerald-200">Card saved.</p>}
      {q.saved === "payout" && <p className="card border-emerald-400/30 text-sm text-emerald-200">Your payout account is connected.</p>}
      {q.pending === "payout" && <p className="info">Stripe still needs a few details before you can be paid. Continue setup below.</p>}

      {dev && await (async () => {
        // (Owner, Oct 28, batch 8) The subscription, before the card.
        const launch = await launchState();
        return (
          <SubscriptionBox state={subState(u)} since={u.subscribedAt ? fmtSubDay(u.subscribedAt, u.timeZone) : null} renews={u.subscriptionRenewsAt ? fmtSubDay(u.subscriptionRenewsAt, u.timeZone) : null}
            endedReason={u.subscriptionEndReason} seenAt={seenAt} hasCard={!!u.stripePaymentMethodId} needsCard={on} restricted={!!(u.holdStartedAt || u.devSuspendedAt)}
            launch={{ free: launch.free, until: launch.until ? fmtSubDay(launch.until, u.timeZone) : null }}
            pastDueBy={u.subscriptionPastDueAt ? fmtSubDay(new Date(u.subscriptionPastDueAt.getTime() + RETRY_DAYS * 86_400_000), u.timeZone) : null} />
        );
      })()}
      {dev && (
        <>
          <section id="card" className="card scroll-mt-24 space-y-3">
            <h2 className="flex items-center gap-2 font-semibold text-white"><CreditCard className="h-5 w-5 text-indigo-300" /> Your card</h2>
            <p className="text-sm text-slate-300">{cardLine}</p>
            {/* (Batch 15 section 41, L5) Stripe objects are made only on a POST. */}
            {on && <AccountFormButton action="/api/payments/card" seenAt={seenAt} press={u.stripePaymentMethodId ? "Change card" : "Add a card"} stop={stopFor("card")}><CreditCard className="h-4 w-4" /> {u.stripePaymentMethodId ? "Change card" : "Add a card"}</AccountFormButton>}
            {/* (Owner, Nov 2, batch 35 §127) Too many card attempts: the refusal under the button that was pressed. */}
            {q.error === "card_limit" && <p className="err" data-card-limit="">{refused("card_limit")}</p>}
            <p className="flex items-center gap-1.5 text-xs text-slate-500"><ShieldCheck className="h-3.5 w-3.5" /> Your full card number and security code are entered on Stripe&apos;s page and never reach this site.</p>
          </section>
          {paid && <DevPaidList paid={paid} fmtDateTime={fmtDateTime} />}
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
                <p className="text-sm font-medium text-slate-200"><TestName text={c.test.title} href={`/app/sessions/${c.id}`} /> <span className="font-normal text-slate-500">· {/* (Owner, Nov 9, §360) A deleted developer reads "Deleted account", as on every other page. */}<Cut text={c.test.developer.deletedAt ? displayName(c.test.developer) : c.test.developer.name || c.test.developer.email} kind={c.test.developer.deletedAt || c.test.developer.name ? "person" : "email"} /></span></p>
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
            {/* (Owner, Nov 5, §200) Connected: Stripe's own Express dashboard for this account, where the tester changes the bank account (same tab, as setup). */}
            {on && u.payoutsReady && u.stripeAccountId && (
              <div data-change-payout="" className="space-y-1.5">
                <AccountFormButton action="/api/payments/payout-dashboard" seenAt={seenAt} press={CHANGE_PAYOUT} stop={stopFor("payout")}><Banknote className="h-4 w-4" /> {CHANGE_PAYOUT}</AccountFormButton>
                <p className="text-xs text-slate-400">Opens Stripe, where you change the bank account payments go to. Payments already sent stay where they went.</p>
              </div>
            )}
            <p className="flex items-center gap-1.5 text-xs text-slate-500"><ShieldCheck className="h-3.5 w-3.5" /> Bank details go to Stripe and never reach this site.</p>
          </section>
          {earned && <TesterEarnedList earned={earned} fmtDateTime={fmtDateTime} />}
        </>
      )}
    </div>
  );

  });
}
