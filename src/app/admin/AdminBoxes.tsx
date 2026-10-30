import { adminPage, userTotals, type Kind, type Page } from "@/lib/server/adminLists";
import { accountState } from "@/lib/server/accountState";
import { AccountActions } from "./AccountActions";
import { PagedList } from "./PagedList";
import { TeamCloseBox } from "./TeamCloseBox";
import { AutoRefresh } from "@/components/AutoRefresh";
import { adminPersonV } from "@/lib/server/pulseV";

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
  // (Owner, Oct 30, batch 33 §7) The fingerprint as of BEFORE the boxes are read: another admin's suspend, reinstate, delete or $0 close-out redraws this box.
  const liveV = await adminPersonV(userId);
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
      {developer && <Box title="Payments they made" kind="u-payments" arg={userId} page={payments} />}
      {/* (Owner, Oct 30, batch 33 §3) Every charge of theirs that failed, newest first, and what became of it (paid later, still owed, settled by the team). */}
      {developer && <Box title="Payment failures" kind="u-failures" arg={userId} page={failures} />}
      {tester && <Box title="Payouts to them" kind="u-payouts" arg={userId} page={payouts} />}
      <Box title="Disputes" kind="u-disputes" arg={userId} page={disputes} />
      <Box title="Chargebacks" kind="u-chargebacks" arg={userId} page={chargebacks} />
      <Box title="Holds and suspensions" kind="u-holds" arg={userId} page={holds} />
      <Box title="Tests posted or joined" kind="u-tests" arg={userId} page={tests} />
      <Box title="Reports against them" kind="u-reports" arg={userId} page={reports} />
      {tester && (
        <>
          <p className="text-sm text-slate-200" data-admin-parts-totals="">{totals.partsLine}</p>
          <Box title="Parts they sent, across tests" kind="u-parts" arg={userId} page={parts} />
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
      <Box title="Timeline" kind="t-timeline" arg={testId} page={timeline} />
      <Box title="Contract changes" kind="t-contracts" arg={testId} page={contracts} />
      <Box title="Payments" kind="t-payments" arg={testId} page={payments} />
    </section>
  );
}
