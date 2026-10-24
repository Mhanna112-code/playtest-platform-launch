import Link from "next/link";
import { notFound } from "next/navigation";
import { Brand } from "@/components/Brand";
import { db } from "@/lib/db";
import { displayName, fmtDateTime, money } from "@/lib/format";
import { requirePageUser } from "@/lib/server/page-auth";
import { isAdmin } from "@/lib/server/session";
import { AdminButton } from "./AdminButton";
import { adminCases } from "@/lib/server/holds";
import { StatTile } from "@/components/StatTile";
import { BadgeDollarSign, FlaskConical, Inbox, ListChecks, Users, Wallet } from "lucide-react";

export const metadata = { title: "Admin · Playtest" };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const u = await requirePageUser();
  if (!isAdmin(u)) notFound();
  const [disputes, users, tests, waiting, payments, waitlist, noShows] = await Promise.all([
    db.dispute.findMany({ orderBy: [{ status: "desc" }, { createdAt: "desc" }], take: 100 }),
    db.user.findMany({ orderBy: { createdAt: "desc" }, take: 300 }),
    db.test.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { developer: true, _count: { select: { contracts: true } } } }),
    db.payment.findMany({ where: { transferStatus: "waiting" }, orderBy: { createdAt: "asc" } }),
    db.payment.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    db.waitlistEntry.findMany({ orderBy: { createdAt: "desc" }, take: 500 }),
    db.call.findMany({ where: { noShowBy: { not: null } }, orderBy: { noShowAt: "desc" }, take: 50, include: { contract: { include: { tester: true, test: { include: { developer: true } } } } } }),
  ]);
  const subIds = disputes.map((d) => d.submissionId).filter((x): x is string => !!x);
  const callIds = disputes.map((d) => d.callId).filter((x): x is string => !!x);
  const reviews = await db.review.findMany({ where: { OR: [{ submissionId: { in: subIds } }, { callId: { in: callIds } }] } });
  const contracts = await db.contract.findMany({ where: { id: { in: disputes.map((d) => d.contractId) } }, include: { tester: true, test: { include: { developer: true } } } });
  const byId = new Map(users.map((x) => [x.id, x]));
  const held = users.filter((x) => x.holdStartedAt);
  const cases = await adminCases();
  const chargebacks = await db.payment.findMany({ where: { chargeback: "open" } });
  // The full app's admin tiles: people, parts awaiting review, what was charged, the platform's share, what testers are owed.
  const charged = await db.payment.aggregate({ where: { status: { in: ["charged", "not_set_up"] } }, _sum: { amountCents: true, feeCents: true }, _count: { _all: true } });
  const toReview = (await db.submission.count({ where: { review: null } })) + (await db.call.count({ where: { review: null, status: "booked", startsAt: { lte: new Date() } } }));
  const openTests = tests.filter((t) => t.status === "open").length;
  const owedToTesters = payments.length ? (await db.payment.aggregate({ where: { transferStatus: "waiting" }, _sum: { testerCents: true } }))._sum.testerCents ?? 0 : 0;
  return (
    <main className="wrap space-y-8">
      <div className="flex items-center gap-4">
        <Brand />
        <Link href="/app">Back to the app</Link>
      </div>
      <h1 className="text-3xl font-bold tracking-tight text-white">Admin</h1>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile icon={Users} label="Developers / testers" value={`${users.filter((x) => x.isDeveloper).length} / ${users.filter((x) => x.isTester).length}`} hint={`${openTests} tests accepting testers`} tone="indigo" />
        <StatTile icon={Inbox} label="Parts awaiting review" value={String(toReview)} hint="written answers, recordings and calls" tone="amber" />
        <StatTile icon={Wallet} label="Charged so far" value={money(charged._sum.amountCents ?? 0)} hint={`${charged._count._all} payment${charged._count._all === 1 ? "" : "s"}`} tone="emerald" />
        <StatTile icon={FlaskConical} label="Your revenue (20%)" value={money(charged._sum.feeCents ?? 0)} hint="the platform's share of what was charged" tone="fuchsia" />
        <StatTile icon={BadgeDollarSign} label="Owed to testers" value={money(owedToTesters)} hint="waiting for a payout account" tone="amber" />
        <StatTile icon={ListChecks} label="On the waitlist" value={String(waitlist.length)} hint="→ Waitlist" tone="indigo" />
      </section>

      <section className="card space-y-3">
        <h2 className="text-lg font-semibold text-white">Needs the team today ({cases.length})</h2>
        <p className="note">The same list goes out once a day in the admin digest email.</p>
        {cases.length === 0 ? <p className="note">Nothing waiting.</p> : (
          <ul className="list-disc pl-5 text-sm">
            {cases.map((c, i) => <li key={i}><a href={c.link}>{c.text}</a></li>)}
          </ul>
        )}
      </section>

      <section className="card scroll-mt-24 space-y-3" id="disputes">
        <h2 className="text-lg font-semibold text-white">Disputes</h2>
        <p className="note">A decision can only raise the pay, up to the listing amount. The extra is charged to the developer. Stripe card disputes are handled by hand in the Stripe dashboard.</p>
        {disputes.length === 0 && <p className="note">No disputes.</p>}
        {disputes.map((d) => {
          const r = reviews.find((x) => (d.submissionId && x.submissionId === d.submissionId) || (d.callId && x.callId === d.callId));
          const c = contracts.find((x) => x.id === d.contractId);
          return (
            <div key={d.id} className="space-y-1 border-t border-white/[0.06] pt-2 text-sm">
              <p>
                <b>{c ? displayName(c.tester) : "?"}</b> vs {c ? displayName(c.test.developer) : "?"} on “{c?.title}” · {d.callId ? "live call" : "sent work"} · paid {money(r?.amountCents)}
                {r?.rejected ? " (rejected)" : ""}, listing {money(r?.agreedCents)}
              </p>
              <p>
                Tester: “{d.reason}”{r?.reason ? ` · Developer's note when paying: “${r.reason}”` : ""}{d.devSide ? ` · Developer's side: “${d.devSide}”` : ""}
              </p>
              {d.status === "open" ? (
                <AdminButton action="decide" id={d.id} label="Decide" fields={[{ name: "total", label: "Total pay ($)", ph: "Total pay, e.g. 10.00" }, { name: "note", label: "Note to both" }]} />
              ) : (
                <p className="note">
                  Decided {d.decidedAt && fmtDateTime(d.decidedAt)}: {money(d.decidedCents)} in all{d.decisionNote ? ` · “${d.decisionNote}”` : ""}
                </p>
              )}
            </div>
          );
        })}
      </section>

      <section className="card space-y-3">
        <h2 id="holds" className="scroll-mt-24 text-lg font-semibold text-white">Payment holds and chargebacks</h2>
        {held.length === 0 && chargebacks.length === 0 && <p className="note">None.</p>}
        {held.map((x) => (
          <p key={x.id} className="text-sm">
            {x.email} · on hold since {fmtDateTime(x.holdStartedAt!)} ({x.holdReason}){x.holdAlertedAt ? " · 30 days: close their tests" : ""}{" "}
            <AdminButton action="close-held" id={x.id} label="Close their tests" danger />
          </p>
        ))}
        {chargebacks.map((p) => (
          <p key={p.id} className="text-sm">
            Chargeback open: {money(p.amountCents)} · {byId.get(p.developerId)?.email} · {p.stripePaymentIntentId} <AdminButton action="resolve-chargeback" id={p.id} label="Mark resolved" />
          </p>
        ))}
      </section>

      <section className="card space-y-3">
        <h2 id="no-shows" className="scroll-mt-24 text-lg font-semibold text-white">No-show reports</h2>
        {noShows.length === 0 && <p className="note">None.</p>}
        {noShows.map((c) => (
          <p key={c.id} className="text-sm">
            {fmtDateTime(c.startsAt)} · “{c.contract.title}” · reported by the {c.noShowBy} ({c.noShowBy === "tester" ? displayName(c.contract.tester) : displayName(c.contract.test.developer)}): “{c.noShowNote}”
          </p>
        ))}
      </section>

      <section className="card space-y-3">
        <h2 id="payouts" className="scroll-mt-24 text-lg font-semibold text-white">Payouts waiting for a payout account</h2>
        {waiting.length === 0 && <p className="note">None.</p>}
        {waiting.map((p) => (
          <p key={p.id} className="text-sm">
            {fmtDateTime(p.createdAt)} · {byId.get(p.testerId)?.email} · {money(p.testerCents)} <AdminButton action="transfer" id={p.id} label="Send now" />
          </p>
        ))}
        <h3 className="font-semibold text-white">Latest payments</h3>
        <ul className="divide-y divide-white/5 text-sm">
          {payments.map((p) => (
            <li key={p.id} className="py-2 text-slate-300">
              {fmtDateTime(p.createdAt)} · {p.kind} · {money(p.amountCents)} (fee {money(p.feeCents)}) · {p.status}
              {p.failure ? ` · ${p.failure}` : ""} · {byId.get(p.developerId)?.email} → {byId.get(p.testerId)?.email}
            </li>
          ))}
        </ul>
      </section>

      <section className="card space-y-3">
        <h2 className="text-lg font-semibold text-white">Users</h2>
        <ul className="divide-y divide-white/5 text-sm">
          {users.map((x) => (
            <li key={x.id} className="py-2 text-slate-300">
              {x.email} · {displayName(x)} · {[x.isDeveloper && "developer", x.isTester && "tester"].filter(Boolean).join(" + ") || "no role"}
              {x.suspendedAt ? (
                <>
                  {" "}· <b>suspended</b> {x.suspendNote && `(${x.suspendNote})`} <AdminButton action="unsuspend" id={x.id} label="Unsuspend" />
                </>
              ) : (
                <> <AdminButton action="suspend" id={x.id} label="Suspend" danger fields={[{ name: "note", label: "Why" }]} /></>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="card space-y-3">
        <h2 className="text-lg font-semibold text-white">Tests</h2>
        <ul className="divide-y divide-white/5 text-sm">
          {tests.map((t) => (
            <li key={t.id} className="py-2 text-slate-300">
              {fmtDateTime(t.createdAt)} · “{t.title}” · {t.status} · {displayName(t.developer)} · {t._count.contracts} joined
            </li>
          ))}
        </ul>
      </section>

      <section className="card space-y-3">
        <h2 className="text-lg font-semibold text-white">Waitlist ({waitlist.length})</h2>
        <ul className="divide-y divide-white/5 text-sm">
          {waitlist.map((w) => (
            <li key={w.id} className="py-2 text-slate-300">
              {fmtDateTime(w.createdAt)} · {w.email} · {w.role}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
