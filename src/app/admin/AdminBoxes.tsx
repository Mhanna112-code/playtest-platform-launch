import { withDateZone } from "@/lib/server/dateZone";
import { adminPage, testRowsByIds, userTotals, type Kind, type Page } from "@/lib/server/adminLists";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/server/dateFormat";
import { pronouns } from "@/lib/format";
import { pauseClosesAt, pauseCountdownLine } from "@/lib/pause";
import { TestActions } from "./TestActions";
import { accountState } from "@/lib/server/accountState";
import { AccountActions } from "./AccountActions";
import { PagedList } from "./PagedList";
import { TeamCloseBox } from "./TeamCloseBox";
import { AutoRefresh } from "@/components/AutoRefresh";
import { adminPersonV } from "@/lib/server/pulseV";
import { accountPaymentsForAdmin, stripeUrl } from "@/lib/server/paymentLists";
import { DevPaidList, OwedReadOnly, TesterEarnedList } from "@/components/PaymentLists";
import { testHref } from "@/lib/server/adminLinks";
import { displayName, fmtDateTimeIn } from "@/lib/format";

// (Owner, Oct 27) Admin-only boxes on a person's profile and on a test's own page, newest first. Never shown to anyone else. (Batch 17 §7) Each is a scroll box
// that loads the next 25 as it nears its end, its heading keeping the total.

const first = async (kind: Kind, adminId: string, arg: string) => (await adminPage(kind, adminId, null, arg)) as Page<never>;

/** (Batch 33 §4) An empty box is its heading with (0) alone: no "None." line under it. */
function Box({ title, kind, arg, page }: { title: string; kind: Kind; arg: string; page: Page<never> }) {
  return (
    <section className="space-y-1" data-admin-box={kind}>
      <PagedList kind={kind} arg={arg} initial={page} title={title} level={3} />
    </section>
  );
}

/**
 * On a profile: totals, then (batch 17 §6) the account's Suspend / Reinstate / Delete (exactly as on the Accounts list, with the Preview check), then payments,
 * (batch 33 §3) payment failures, payouts, disputes, chargebacks, holds and suspensions, tests posted or joined, reports against them (and, for a tester, their sent parts).
 */
export async function AdminPersonBoxes({ userId, adminId, developer, tester }: { userId: string; adminId: string; developer: boolean; tester: boolean }) {
  const admin = await db.user.findUnique({ where: { id: adminId } });
  return withDateZone(admin?.timeZone, async () => {

  // (Owner, Oct 30, batch 33 §7) The fingerprint as of BEFORE the boxes are read: another admin's suspend, reinstate, delete or $0 close-out redraws this box.
  const liveV = await adminPersonV(userId);
  // (Batch 35 §162) The box titles in the person's own pronoun ("Payments she made", "Payouts to him", "Parts they sent").
  const who = await db.user.findUnique({ where: { id: userId }, select: { pronoun: true, name: true, email: true, deletedAt: true } });
  const p = pronouns(who?.pronoun);
  // (Owner, Nov 4, §190) Their Payments lists as they see them (admins only: null for anyone else).
  const theirs = admin ? await accountPaymentsForAdmin(admin, userId) : null;
  const totals = await userTotals(userId);
  const acct = await accountState(userId);
  const [payments, payouts, disputes, chargebacks, holds, tests, reports, parts, failures] = await Promise.all(
    (["u-payments", "u-payouts", "u-disputes", "u-chargebacks", "u-holds", "u-tests", "u-reports", "u-parts", "u-failures"] as const).map((k) => first(k, adminId, userId)),
  );
  return (
    <section className="card space-y-4 border-amber-300/30" id="admin-boxes" data-admin-only="">
      <h2 className="text-lg font-semibold text-white">For the team (only admins see this)</h2>
      <AutoRefresh query={`adminPerson=${userId}`} v={liveV} />
      <p className="text-sm text-slate-200" data-admin-totals="">{totals.line}</p>
      {acct && <div className="text-sm text-slate-300" data-admin-account=""><AccountActions initial={acct} /></div>}
      {theirs && (theirs.developer || theirs.tester) && <TheirPayments name={who ? displayName(who) : "This account"} theirs={theirs} fmt={(d) => fmtDateTimeIn(d, admin?.timeZone)} />}
      {developer && <Box title={`Payments ${p.subj} made`} kind="u-payments" arg={userId} page={payments} />}
      {/* (Owner, Oct 30, batch 33 §3) Every charge of theirs that failed, newest first, and what became of it (paid later, still owed, settled by the team). */}
      {developer && <Box title="Payment failures" kind="u-failures" arg={userId} page={failures} />}
      {tester && <Box title={`Payouts to ${p.obj}`} kind="u-payouts" arg={userId} page={payouts} />}
      <Box title="Disputes" kind="u-disputes" arg={userId} page={disputes} />
      <Box title="Chargebacks" kind="u-chargebacks" arg={userId} page={chargebacks} />
      <Box title="Holds and suspensions" kind="u-holds" arg={userId} page={holds} />
      <Box title="Tests posted or joined" kind="u-tests" arg={userId} page={tests} />
      <Box title={`Reports against ${p.obj}`} kind="u-reports" arg={userId} page={reports} />
      {tester && (
        <>
          <p className="text-sm text-slate-200" data-admin-parts-totals="">{totals.partsLine}</p>
          <Box title={`Parts ${p.subj} sent, across tests`} kind="u-parts" arg={userId} page={parts} />
        </>
      )}
    </section>
  );

  });
}

/**
 * (Owner, Nov 4, §190) The person's own Payments lists, read-only, exactly as they read them (the same component and the same lines: "you", "your bank"), with dates
 * in the admin's time zone, each test opening its team page, and a "Stripe" link on each payment with a PaymentIntent. No Pay, Confirm or Cancel.
 */
function TheirPayments({ name, theirs, fmt }: { name: string; theirs: NonNullable<Awaited<ReturnType<typeof accountPaymentsForAdmin>>>; /** a date in the admin's zone (bound here: the lists draw after this request's zone store) */ fmt: (d: Date) => string }) {
  return (
    <section className="space-y-3" data-admin-their-payments="">
      <h3 className="font-semibold text-white">Payments as {name} sees them</h3>
      <p className="text-xs text-slate-400">Their Payments page&apos;s lists, read-only: each line as they read it, dates in your time zone.</p>
      {/* As on their page: Pay what you owe (during a hold) above what they've paid. */}
      {theirs.owed && <OwedReadOnly owed={theirs.owed} stripeUrl={theirs.owedStripe} />}
      {theirs.developer && <DevPaidList paid={theirs.developer} fmtDateTime={fmt} stripeUrl={stripeUrl} testHref={testHref} />}
      {theirs.tester && <TesterEarnedList earned={theirs.tester} fmtDateTime={fmt} stripeUrl={stripeUrl} />}
    </section>
  );
}

/** On a test's own page: the timeline, the contract changes (the terms each tester joined on, and offers), and the payments. */
export async function AdminTestBoxes({ testId, adminId }: { testId: string; adminId: string }) {
  return withDateZone((await db.user.findUnique({ where: { id: adminId }, select: { timeZone: true } }))?.timeZone, async () => {

  const [timeline, contracts, payments] = await Promise.all((["t-timeline", "t-contracts", "t-payments"] as const).map((k) => first(k, adminId, testId)));
  // (Batch 22 section 5; batch 34 §1) The test's own admin actions, with when they were read.
  const [row] = await testRowsByIds([testId]);
  const t = await db.test.findUnique({ where: { id: testId }, include: { developer: true } });
  const info = t && t.status !== "stopped" ? pauseClosesAt(t.developer, t) : null;
  return (
    <section className="card space-y-4 border-amber-300/30" id="admin-boxes" data-admin-only="">
      <h2 className="text-lg font-semibold text-white">For the team (only admins see this)</h2>
      {/* (Batch 30 §5) This test's open reviews, closed at $0 by the team (Preview first, then the reason). */}
      {row && <TestActions id={testId} seen={row.seen ?? new Date().toISOString()} adminPaused={row.adminPaused} stopped={row.stopped} critical={row.critical} closure={info ? `${pauseCountdownLine(info.at, info.causes)} (${fmtDateTime(info.at)})` : null} />}
      <TeamCloseBox id={testId} scope="test" />
      <Box title="Timeline" kind="t-timeline" arg={testId} page={timeline} />
      <Box title="Contract changes" kind="t-contracts" arg={testId} page={contracts} />
      <Box title="Payments" kind="t-payments" arg={testId} page={payments} />
    </section>
  );

  });
}
