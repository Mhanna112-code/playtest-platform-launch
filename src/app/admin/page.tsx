import Link from "next/link";
import { notFound } from "next/navigation";
import { Brand } from "@/components/Brand";
import { db } from "@/lib/db";
import { displayName, fmtDateTime, money } from "@/lib/format";
import { requirePageUser } from "@/lib/server/page-auth";
import { isAdmin } from "@/lib/server/session";
import { AdminButton } from "./AdminButton";
import { PreviewButton } from "./PreviewButton";
import { DisputeDecision } from "./DisputeDecision";
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
  // (Item 28) What each open dispute may be decided at, and the facts for its row.
  const { disputeBounds } = await import("@/lib/server/payments");
  const bounds = new Map(await Promise.all(disputes.filter((d) => d.status === "open").map(async (d) => [d.id, await disputeBounds(d)] as const)));
  const subs = new Map((await db.submission.findMany({ where: { id: { in: subIds } } })).map((x) => [x.id, x]));
  const calls = new Map((await db.call.findMany({ where: { id: { in: callIds } } })).map((x) => [x.id, x]));
  const held = users.filter((x) => x.holdStartedAt);
  // (Design doc 10) Held tester shares (a suspended tester's pay): the team refunds the developer or releases it to the tester.
  const heldShares = await db.payment.findMany({ where: { transferStatus: "held" }, orderBy: { createdAt: "asc" } });
  // Reports: problems reported on calls (no-show / late), per person; more than three flags the account (a count is never proof by itself).
  const reportedOn = new Map<string, number>();
  for (const c of noShows) {
    const accused = c.noShowBy === "tester" ? c.contract.test.developerId : c.contract.testerId;
    reportedOn.set(accused, (reportedOn.get(accused) ?? 0) + 1);
  }
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
                <b>{c ? displayName(c.tester) : "?"}</b> vs {c ? displayName(c.test.developer) : "?"} · {c?.title} · {d.callId ? `Live call (${calls.get(d.callId) ? fmtDateTime(calls.get(d.callId)!.startsAt) : ""})` : `${subs.get(d.submissionId ?? "")?.kind === "recording" ? "Recording" : "Written answers"} (sent ${subs.get(d.submissionId ?? "") ? fmtDateTime(subs.get(d.submissionId ?? "")!.sentAt) : ""})`}
              </p>
              <p>
                Listing {money(r?.agreedCents)} · Paid for this piece {money(r?.amountCents)}{r?.rejected ? " (rejected)" : ""}{bounds.get(d.id) ? ` · Paid for this part so far ${money(bounds.get(d.id)!.other + (r?.amountCents ?? 0))}` : ""}
              </p>
              <p>
                Tester: “{d.reason}”{r?.reason ? ` · Developer's note when ${r.rejected ? "rejecting" : "paying"}: “${r.reason}”` : ""}{d.devSide ? ` · Developer's side: “${d.devSide}”` : ""}
              </p>
              {d.status === "open" && bounds.get(d.id) ? (
                <DisputeDecision id={d.id} minCents={bounds.get(d.id)!.min} maxCents={bounds.get(d.id)!.max} />
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

      <section className="card space-y-3" id="held-shares">
        <h2 className="text-lg font-semibold text-white">Held tester shares ({heldShares.length})</h2>
        <p className="note">A suspended tester&apos;s pay is charged to the developer, but their share waits. It goes out when the suspension is lifted; if it never is, refund the developer or release it here.</p>
        {heldShares.length === 0 && <p className="note">None.</p>}
        {heldShares.map((p) => (
          <p key={p.id} className="text-sm">
            {fmtDateTime(p.createdAt)} · {money(p.testerCents)} for {byId.get(p.testerId)?.email} (paid by {byId.get(p.developerId)?.email}){" "}
            <AdminButton action="release-share" id={p.id} label="Release to the tester" /> <AdminButton action="refund-share" id={p.id} label="Refund the developer" danger />
          </p>
        ))}
      </section>

      <section className="card space-y-3" id="users">
        <h2 className="text-lg font-semibold text-white">Users</h2>
        <ul className="divide-y divide-white/5 text-sm">
          {users.map((x) => (
            <li key={x.id} className="space-y-1 py-2 text-slate-300">
              <p>
                {x.email} · {displayName(x)} · {[x.isDeveloper && "developer", x.isTester && "tester"].filter(Boolean).join(" + ") || "no role"}
                {(reportedOn.get(x.id) ?? 0) > 3 && <span className="badge ml-2 border-amber-300/40 text-amber-200">{reportedOn.get(x.id)} reports: look at them (a count is not proof)</span>}
                {(reportedOn.get(x.id) ?? 0) > 0 && (reportedOn.get(x.id) ?? 0) <= 3 && <span className="ml-2 text-xs text-slate-500">{reportedOn.get(x.id)} report{reportedOn.get(x.id) === 1 ? "" : "s"}</span>}
              </p>
              {x.deletedAt ? (
                <p className="text-xs text-rose-300">Deleted {fmtDateTime(x.deletedAt)} by {x.deletedBy === "admin" ? "the team" : "the owner of the account"}{x.deleteReason ? `: ${x.deleteReason}` : ""}</p>
              ) : x.suspendedAt ? (
                <p className="flex flex-wrap items-center gap-2"><b>suspended</b> {fmtDateTime(x.suspendedAt)}{x.suspendedById ? ` by ${byId.get(x.suspendedById)?.email ?? "an admin"}` : ""}{x.suspendNote && ` · “${x.suspendNote}”`} <AdminButton action="unsuspend" id={x.id} label="Lift the suspension" /></p>
              ) : (
                <p className="flex flex-wrap items-center gap-2">
                  <PreviewButton id={x.id} />
                  <AdminButton action="suspend" id={x.id} label="Suspend" danger fields={[{ name: "note", label: "Why" }]} />
                  <AdminButton action="delete-account" id={x.id} label="Delete account" danger fields={[{ name: "note", label: "Why" }]} />
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="card space-y-3" id="tests">
        <h2 className="text-lg font-semibold text-white">Tests</h2>
        <ul className="divide-y divide-white/5 text-sm">
          {tests.map((t) => (
            <li key={t.id} className="space-y-1 py-2 text-slate-300">
              <p>{fmtDateTime(t.createdAt)} · “{t.title}” · {t.adminStoppedAt ? "stopped by the team" : t.adminPausedAt ? "paused by the team" : t.status} · {displayName(t.developer)} · {t._count.contracts} joined{t.criticalChanges > 0 ? ` · ${t.criticalChanges} critical change${t.criticalChanges === 1 ? "" : "s"}` : ""}</p>
              {t.status !== "stopped" && (
                <p className="flex flex-wrap items-center gap-2">
                  {t.adminPausedAt ? <AdminButton action="unpause-test" id={t.id} label="Lift the pause" /> : <AdminButton action="pause-test" id={t.id} label="Pause" fields={[{ name: "note", label: "Why" }]} />}
                  <AdminButton action="stop-test" id={t.id} label="Stop (close)" danger fields={[{ name: "note", label: "Why" }]} />
                  {t.criticalChanges >= 3 && <AdminButton action="allow-critical-changes" id={t.id} label="Allow 3 more critical changes" />}
                </p>
              )}
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
