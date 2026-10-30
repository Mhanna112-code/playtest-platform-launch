import { adminPage, userTotals, type Kind, type Page } from "@/lib/server/adminLists";
import { accountState } from "@/lib/server/accountState";
import { AccountActions } from "./AccountActions";
import { PagedList } from "./PagedList";
import { TeamCloseBox } from "./TeamCloseBox";

// (Owner, Oct 27) Admin-only boxes on a person's profile and on a test's own page, newest first. Never shown to anyone else. (Batch 17 §7) Each is a scroll box
// that loads the next 25 as it nears its end, its heading keeping the total.

const first = async (kind: Kind, adminId: string, arg: string) => (await adminPage(kind, adminId, null, arg)) as Page<never>;

function Box({ title, kind, arg, page, empty }: { title: string; kind: Kind; arg: string; page: Page<never>; empty: string }) {
  return (
    <section className="space-y-1" data-admin-box={kind}>
      <PagedList kind={kind} arg={arg} initial={page} empty={empty} title={title} level={3} />
    </section>
  );
}

/**
 * On a profile: totals, then (batch 17 §6) the account's Suspend / Reinstate / Delete (exactly as on the Accounts list, with the Preview check), then payments,
 * payouts, disputes, chargebacks, holds and suspensions, tests posted or joined, reports against them (and, for a tester, their sent parts).
 */
export async function AdminPersonBoxes({ userId, adminId, developer, tester }: { userId: string; adminId: string; developer: boolean; tester: boolean }) {
  const totals = await userTotals(userId);
  const acct = await accountState(userId);
  const [payments, payouts, disputes, chargebacks, holds, tests, reports, parts] = await Promise.all(
    (["u-payments", "u-payouts", "u-disputes", "u-chargebacks", "u-holds", "u-tests", "u-reports", "u-parts"] as const).map((k) => first(k, adminId, userId)),
  );
  return (
    <section className="card space-y-4 border-amber-300/30" id="admin-boxes" data-admin-only="">
      <h2 className="text-lg font-semibold text-white">For the team (only admins see this)</h2>
      <p className="text-sm text-slate-200" data-admin-totals="">{totals.line}</p>
      {acct && <div className="text-sm text-slate-300" data-admin-account=""><AccountActions initial={acct} /></div>}
      {developer && <Box title="Payments they made" kind="u-payments" arg={userId} page={payments} empty="None." />}
      {tester && <Box title="Payouts to them" kind="u-payouts" arg={userId} page={payouts} empty="None." />}
      <Box title="Disputes" kind="u-disputes" arg={userId} page={disputes} empty="None." />
      <Box title="Chargebacks" kind="u-chargebacks" arg={userId} page={chargebacks} empty="None." />
      <Box title="Holds and suspensions" kind="u-holds" arg={userId} page={holds} empty="None." />
      <Box title="Tests posted or joined" kind="u-tests" arg={userId} page={tests} empty="None." />
      <Box title="Reports against them" kind="u-reports" arg={userId} page={reports} empty="None." />
      {tester && (
        <>
          <p className="text-sm text-slate-200" data-admin-parts-totals="">{totals.partsLine}</p>
          <Box title="Parts they sent, across tests" kind="u-parts" arg={userId} page={parts} empty="None." />
        </>
      )}
    </section>
  );
}

/** On a test's own page: the timeline, the contract changes (the terms each tester joined on, and offers), and the payments. */
export async function AdminTestBoxes({ testId, adminId }: { testId: string; adminId: string }) {
  const [timeline, contracts, payments] = await Promise.all((["t-timeline", "t-contracts", "t-payments"] as const).map((k) => first(k, adminId, testId)));
  return (
    <section className="card space-y-4 border-amber-300/30" id="admin-boxes" data-admin-only="">
      <h2 className="text-lg font-semibold text-white">For the team (only admins see this)</h2>
      {/* (Batch 30 §5) This test's open reviews, closed at $0 by the team (Preview first, then the reason). */}
      <TeamCloseBox id={testId} scope="test" />
      <Box title="Timeline" kind="t-timeline" arg={testId} page={timeline} empty="Nothing recorded yet." />
      <Box title="Contract changes" kind="t-contracts" arg={testId} page={contracts} empty="No testers yet." />
      <Box title="Payments" kind="t-payments" arg={testId} page={payments} empty="None." />
    </section>
  );
}
