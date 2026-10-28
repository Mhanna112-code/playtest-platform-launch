import { fmtSubDay } from "@/lib/subscription";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Brand } from "@/components/Brand";
import { db } from "@/lib/db";
import { displayName, fmtDateTime, money } from "@/lib/format";
import { requirePageUser } from "@/lib/server/page-auth";
import { ADMIN_PAUSED, adminAccount, isAdmin } from "@/lib/server/session";
import { AdminButton } from "./AdminButton";
import { PagedList } from "./PagedList";
import { adminCases } from "@/lib/server/holds";
import { configProblems, seesConfigBox } from "@/lib/server/config";
import { adminOutages, lengthText, outageLine } from "@/lib/server/outages";
import { renderTimes } from "@/lib/tz";
import { adminPage, disputeRow, type DisputeVM, type Page } from "@/lib/server/adminLists";
import { StatTile } from "@/components/StatTile";
import { BadgeDollarSign, FlaskConical, Inbox, ListChecks, Users, Wallet } from "lucide-react";

export const metadata = { title: "Admin · Playtest" };
export const dynamic = "force-dynamic";

const rows = <T,>(p: Page<unknown>) => p as unknown as Page<T>;

/** The admin dashboard, laid out like the developer and tester dashboards: open disputes first, then this admin's own actions, then the lists. */
export default async function AdminPage({ searchParams }: { searchParams: Promise<{ dispute?: string; user?: string }> }) {
  const u = await requirePageUser();
  // (Batch 15 section 35) A suspended admin keeps no admin access: the console says why.
  if (adminAccount(u) && !isAdmin(u)) return <main className="wrap space-y-4"><Brand /><p className="info" data-admin-paused="">{ADMIN_PAUSED} Contact the owner if you think this is a mistake.</p></main>;
  if (!isAdmin(u)) notFound();
  const q = await searchParams;
  const [disputes, liftsP, mine, paused, chargebacks, decided, noShows, reportsP, usersP, testsP, paymentsP, waitlistP] = await Promise.all(
    (["disputes", "lifts", "mine", "paused", "chargebacks", "decided", "noshows", "reports", "users", "tests", "payments", "waitlist"] as const).map((k) => adminPage(k, u.id, null)),
  );
  const [waiting, heldShares, held, devCount, testerCount, openTests] = await Promise.all([
    db.payment.findMany({ where: { transferStatus: "waiting" }, orderBy: { createdAt: "asc" }, take: 100 }),
    db.payment.findMany({ where: { transferStatus: "held" }, orderBy: { createdAt: "asc" }, take: 100 }),
    db.user.findMany({ where: { holdStartedAt: { not: null }, holdReason: { not: "chargeback" } }, orderBy: { holdStartedAt: "asc" }, take: 100 }),
    db.user.count({ where: { isDeveloper: true } }),
    db.user.count({ where: { isTester: true } }),
    db.test.count({ where: { status: "open" } }),
  ]);
  const people = new Map((await db.user.findMany({ where: { id: { in: [...waiting, ...heldShares].flatMap((p) => [p.developerId, p.testerId]) } }, select: { id: true, email: true } })).map((x) => [x.id, x.email]));
  // A link or a bell line can open one exact row: ?dispute=ID or ?user=ID shows it first.
  const focusDispute: DisputeVM | null = q.dispute ? await db.dispute.findUnique({ where: { id: q.dispute } }).then((d) => (d ? disputeRow(d) : null)) : null;
  const focusUser = q.user ? await db.user.findUnique({ where: { id: q.user } }) : null;
  const cases = await adminCases();
  const outages = await adminOutages();
  // The full app's admin tiles: people, parts awaiting review, what was charged, the platform's share, what testers are owed.
  const charged = await db.payment.aggregate({ where: { status: { in: ["charged", "not_set_up"] } }, _sum: { amountCents: true, feeCents: true }, _count: { _all: true } });
  const toReview = (await db.submission.count({ where: { review: null } })) + (await db.call.count({ where: { review: null, status: "booked", startsAt: { lte: new Date() } } }));
  const owedToTesters = (await db.payment.aggregate({ where: { transferStatus: "waiting" }, _sum: { testerCents: true } }))._sum.testerCents ?? 0;
  return (
    <main className="wrap space-y-8">
      <div className="flex items-center gap-4">
        <Brand />
        <Link href="/app">Back to the app</Link>
      </div>
      <h1 className="text-3xl font-bold tracking-tight text-white">Admin</h1>
      {/* (Batch 15 section 12) The settings problems: only the owner (OWNER_EMAIL) sees them; every admin when it's unset. */}
      {seesConfigBox(u) && configProblems().length > 0 && (
        <section className="rounded-xl border border-rose-500/60 bg-rose-950/40 p-4" data-config-problems>
          <h2 className="font-semibold text-rose-200">Settings to fix</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-rose-100">
            {configProblems().map((p) => (
              <li key={p.message}>{p.message}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile icon={Users} label="Developers / testers" value={`${devCount} / ${testerCount}`} hint={`${openTests} tests accepting testers`} tone="indigo" />
        <StatTile icon={Inbox} label="Parts awaiting review" value={String(toReview)} hint="written answers, recordings and calls" tone="amber" />
        <StatTile icon={Wallet} label="Charged so far" value={money(charged._sum.amountCents ?? 0)} hint={`${charged._count._all} payment${charged._count._all === 1 ? "" : "s"}`} tone="emerald" />
        <StatTile icon={FlaskConical} label="Your revenue (20%)" value={money(charged._sum.feeCents ?? 0)} hint="the platform's share of what was charged" tone="fuchsia" />
        <StatTile icon={BadgeDollarSign} label="Owed to testers" value={money(owedToTesters)} hint="waiting for a payout account" tone="amber" />
        <StatTile icon={ListChecks} label="On the waitlist" value={String(waitlistP.total)} hint="→ Waitlist" tone="indigo" />
      </section>

      {/* (Batch 15 section 10) Outages, from the uptime service's own down/up alerts: the open "down" and the latest recorded outages. */}
      {(outages.downSince || outages.rows.length > 0) && (
        <section className="card space-y-2" id="outages" data-outages>
          <h2 className="text-lg font-semibold text-white">Outages</h2>
          {outages.downSince && <p className="text-sm text-amber-200">The uptime service says the site has been down since {fmtDateTime(outages.downSince)}. The outage is recorded when it says the site is up again (if it lasted 15 minutes or more).</p>}
          <ul className="space-y-1 text-sm">
            {outages.rows.map((o) => (
              <li key={o.id} data-outage-line>
                {o.needsApproval && !o.approvedAt ? (
                  <span className="text-amber-200">Over 24 hours: the uptime service says the site was down from {fmtDateTime(o.startAt)} to {fmtDateTime(o.endAt)} ({lengthText(o.ms)}). Nothing has moved yet. <AdminButton action="approve-outage" id={o.id} label="Approve: move every timer" /></span>
                ) : (
                  <>{renderTimes(outageLine(o.startAt, o.endAt, o.ms), u.timeZone)} <span className="text-slate-400">({lengthText(o.ms)}, recorded {fmtDateTime(o.recordedAt)}{o.approvedAt ? ", approved" : ""})</span></>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(focusDispute || focusUser) && (
        <section className="card space-y-2" id="focus" data-focus="">
          <h2 className="text-lg font-semibold text-white">Opened from a link</h2>
          {focusDispute && <PagedList kind="disputes" initial={{ rows: [focusDispute], next: null, total: 1 }} />}
          {focusUser && (
            <p className="scroll-mt-24 text-sm" id={`user-${focusUser.id}`}>
              {focusUser.email} · {displayName(focusUser)} · {[focusUser.isDeveloper && "developer", focusUser.isTester && "tester"].filter(Boolean).join(" + ") || "no role"}
              {focusUser.devSuspendedAt ? ` · suspended (developer side) ${fmtDateTime(focusUser.devSuspendedAt)}` : ""}
              {focusUser.testerSuspendedAt ? ` · suspended (tester side) ${fmtDateTime(focusUser.testerSuspendedAt)}` : ""}
              {focusUser.deletedAt ? ` · deleted ${fmtDateTime(focusUser.deletedAt)}` : ""}
            </p>
          )}
        </section>
      )}

      <section className="card scroll-mt-24 space-y-3" id="disputes">
        <h2 className="text-lg font-semibold text-white">Open disputes ({disputes.total})</h2>
        <p className="note">Newest first. A decision can only raise the pay, up to the listing amount. The extra is charged to the developer. Stripe card disputes are handled by hand in the Stripe dashboard.</p>
        <PagedList kind="disputes" initial={rows(disputes)} empty="No open disputes." scroll />
      </section>

      <section className="card scroll-mt-24 space-y-3" id="lifts">
        <h2 className="text-lg font-semibold text-white">Lifts ({liftsP.total})</h2>
        <p className="note">A payment hold from the 4th onward needs an Approve to lift, even after the developer paid what they owe. Newest first. The first press wins.</p>
        <PagedList kind="lifts" initial={rows(liftsP)} empty="No lifts waiting." scroll />
      </section>

      <section className="card scroll-mt-24 space-y-3" id="chargebacks">
        <h2 className="text-lg font-semibold text-white">Chargeback holds ({chargebacks.total})</h2>
        <p className="note">After a chargeback the developer verifies a card with 3D Secure and pays what they owe; paying alone never lifts the hold. Approve once both are done.</p>
        <PagedList kind="chargebacks" initial={rows(chargebacks)} />
      </section>

      <section className="card scroll-mt-24 space-y-3" id="mine">
        <h2 className="text-lg font-semibold text-white">Your actions ({mine.total})</h2>
        <p className="note">Tests you paused or stopped, or whose developer you suspended. Newest first.</p>
        <PagedList kind="mine" initial={rows(mine)} empty="You haven't paused, stopped or suspended anything." scroll />
      </section>

      <section className="card scroll-mt-24 space-y-3" id="paused-tests">
        <h2 className="text-lg font-semibold text-white">Paused tests ({paused.total})</h2>
        <p className="note">A paused test closes by itself after 7 days, whatever the cause (a payment hold, a chargeback hold, a suspension or a team pause). Soonest first. Extend moves its date later; Close now closes it like a Stop. Testers read only that the test ended; the developer is told why.</p>
        <PagedList kind="paused" initial={rows(paused)} />
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

      <section className="card space-y-3">
        <h2 id="holds" className="scroll-mt-24 text-lg font-semibold text-white">Payment holds</h2>
        {held.length === 0 && <p className="note">None.</p>}
        {held.map((x) => (
          <p key={x.id} className="text-sm">
            {x.email} {x.holdCount > 3 && <span className="badge border-amber-300/40 text-amber-200">More than 3 holds</span>} · on hold since {fmtDateTime(x.holdStartedAt!)} ({x.holdReason}){x.holdCount > 3 ? " · its lift needs an Approve (see Lifts)" : ""}. Their tests close after 7 days paused (see Paused tests).
          </p>
        ))}
      </section>

      <section className="card scroll-mt-24 space-y-3" id="decided">
        <h2 className="text-lg font-semibold text-white">Decided disputes ({decided.total})</h2>
        <PagedList kind="decided" initial={rows(decided)} empty="None yet." scroll />
      </section>

      <section className="card space-y-3" id="reports">
        <h2 className="scroll-mt-24 text-lg font-semibold text-white">Reports ({reportsP.total})</h2>
        <p className="note">What people reported about each other from a profile (once per pair). The reported person is not told.</p>
        <PagedList kind="reports" initial={rows(reportsP)} empty="None." />
      </section>

      <section className="card space-y-3">
        <h2 id="no-shows" className="scroll-mt-24 text-lg font-semibold text-white">No-show reports ({noShows.total})</h2>
        <PagedList kind="noshows" initial={rows(noShows)} />
      </section>

      <section className="card space-y-3">
        <h2 id="payouts" className="scroll-mt-24 text-lg font-semibold text-white">Payouts waiting for a payout account</h2>
        {waiting.length === 0 && <p className="note">None.</p>}
        {waiting.map((p) => (
          <p key={p.id} className="text-sm">
            {fmtDateTime(p.createdAt)} · {people.get(p.testerId)} · {money(p.testerCents)} <AdminButton action="transfer" id={p.id} label="Send now" />
          </p>
        ))}
        <h3 className="font-semibold text-white">Latest payments</h3>
        <PagedList kind="payments" initial={rows(paymentsP)} />
      </section>

      <section className="card space-y-3" id="held-shares">
        <h2 className="text-lg font-semibold text-white">Held tester shares ({heldShares.length})</h2>
        <p className="note">A suspended tester&apos;s pay is charged to the developer, but their share waits. It goes out when the suspension is lifted; if it never is, refund the developer or release it here.</p>
        {heldShares.length === 0 && <p className="note">None.</p>}
        {heldShares.map((p) => (
          <p key={p.id} className="text-sm">
            {fmtDateTime(p.createdAt)} · {money(p.testerCents)} for {people.get(p.testerId)} (paid by {people.get(p.developerId)}){" "}
            <AdminButton action="release-share" id={p.id} label="Release to the tester" /> <AdminButton action="refund-share" id={p.id} label="Refund the developer" danger />
          </p>
        ))}
      </section>

      {/* (Owner, Oct 28, batch 8) Free during launch; (batch 11) read-only: the date comes from the server configuration (FREE_UNTIL). */}
      {await (async () => {
        const launch = await (await import("@/lib/server/subscription")).launchState();
        return (
          <section className="card space-y-2" id="settings" data-free-until={launch.until ? launch.until.toISOString() : ""}>
            <h2 className="text-lg font-semibold text-white">Settings</h2>
            <p className="text-sm text-slate-300">Free during launch: {launch.until ? `${launch.free ? "free for everyone until" : "ended on"} ${fmtSubDay(launch.until)}` : "free for everyone, no end date"}.</p>
            <p className="text-xs text-slate-500">Set by FREE_UNTIL in the server configuration (at least 30 days ahead). Every developer is told 30 days and 7 days before (even with email Off).</p>
          </section>
        );
      })()}

      <section className="card space-y-3" id="users">
        <h2 className="text-lg font-semibold text-white">Accounts ({usersP.total})</h2>
        <PagedList kind="users" initial={rows(usersP)} />
      </section>

      <section className="card space-y-3" id="tests">
        <h2 className="text-lg font-semibold text-white">Tests ({testsP.total})</h2>
        <PagedList kind="tests" initial={rows(testsP)} />
      </section>

      <section className="card space-y-3">
        <h2 className="text-lg font-semibold text-white">Waitlist ({waitlistP.total})</h2>
        <PagedList kind="waitlist" initial={rows(waitlistP)} />
      </section>
    </main>
  );
}
