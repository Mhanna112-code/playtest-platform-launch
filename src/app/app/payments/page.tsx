import { db } from "@/lib/db";
import { fmtDateTime, money } from "@/lib/format";
import { requirePageUser } from "@/lib/server/page-auth";
import { stripeOn } from "@/lib/server/stripe";
import { owed } from "@/lib/server/holds";
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
  return (
    <>
      <h1>Payments</h1>
      {!on && <p className="info">{MESSAGES.off}</p>}
      {u.isDeveloper && (await owed(u.id).then((o) => (u.holdStartedAt || o.length ? <OwedBox onHold={!!u.holdStartedAt} owed={o.map((p) => ({ amountCents: p.amountCents, until: p.owedUntil!.toISOString() }))} /> : null)))}
      {q.error && q.error !== "off" && <p className="err">{MESSAGES[q.error]}</p>}
      {q.saved === "card" && <p className="ok">Card saved.</p>}
      {q.saved === "payout" && <p className="ok">Your payout account is connected.</p>}
      {q.pending === "payout" && <p className="info">Stripe still needs a few details before you can be paid. Continue setup below.</p>}

      {u.isDeveloper && (
        <section className="panel">
          <h2>Your card (developer)</h2>
          <p className="note">You&apos;re charged only when you press Pay, for exactly the amount you tick.</p>
          {u.stripePaymentMethodId ? <p className="text-sm">A card is saved.</p> : <p className="text-sm">No card yet.</p>}
          {on && <a className="btn-ghost" href="/api/payments/card">{u.stripePaymentMethodId ? "Change card" : "Add a card"}</a>}
          <h3>What you&apos;ve paid</h3>
          {paidOut.length === 0 ? <p className="note">Nothing yet.</p> : (
            <ul className="text-sm">
              {paidOut.map((p) => (
                <li key={p.id}>{fmtDateTime(p.createdAt)} · {money(p.amountCents)} · {p.kind === "call" ? "live call" : p.kind === "dispute" ? "dispute decision" : "sent work"}{p.status === "not_set_up" ? " · recorded (payments not set up)" : ""}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {u.isTester && (
        <section className="panel">
          <h2>Your payout account (tester)</h2>
          <p className="note">
            {u.payoutsReady ? "Your payout account is connected. Each payment is sent to it." : u.stripeAccountId ? "Stripe still needs a few details before you can be paid." : "Connect a payout account to receive money for your work."}
          </p>
          {on && !u.payoutsReady && <a className="btn-ghost" href="/api/payments/payout">{u.stripeAccountId ? "Continue setup" : "Connect a payout account"}</a>}
          <h3>What you&apos;ve earned</h3>
          {paidIn.length === 0 ? <p className="note">Nothing yet.</p> : (
            <ul className="text-sm">
              {paidIn.map((p) => (
                <li key={p.id}>
                  {fmtDateTime(p.createdAt)} · you get {money(p.testerCents)}
                  {p.status === "not_set_up" || p.transferStatus === "waiting" ? " · delayed until your payout account is ready" : ""}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
