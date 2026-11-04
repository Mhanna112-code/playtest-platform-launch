import { AutoRefresh } from "@/components/AutoRefresh";
import { DashboardActionBox } from "./DashboardActionBox";
import { BankWaiting } from "@/components/BankWaiting";
import { bankTopV, type BankTopRow } from "@/lib/bankTop";
import { withTestLinks } from "@/components/TestLinks";
import { bankToConfirm } from "@/lib/server/confirm";
import { confirmAllState, type ConfirmAllState } from "@/lib/server/confirmAll";
import { ConfirmAll } from "@/components/ConfirmAll";
import { KeepLoadTime } from "@/components/KeepLoadTime";

/**
 * (Owner, Oct 29, batch 24 section 1) "Your bank wants you to confirm (N)" below the developer name, in the same box for active and restricted accounts,
 * hidden when there's nothing to confirm. Every row in a plain scroll box about 3 rows tall (batch 16 section 14: no "Show N more"), soonest deadline first; under 24 hours
 * left the "confirm by" part is red. "Confirm with your bank" opens the existing inline check in its row. The dashboard's poll (`bank=1`) brings a new row in and takes one out (confirmed anywhere, expired, cancelled) without a reload.
 */
export async function BankToConfirm({ userId, now }: { userId: string; now: Date }) {
  // (§147) Confirm all first: it lets a Confirm all check that ran out go, so the rows below are as they stand.
  const all = await confirmAllState(userId, now);
  const rows = await bankToConfirm(userId, now);
  return (
    <>
      <AutoRefresh query="bank=1" v={bankTopV(rows)} />
      {/* (Owner bug, Nov 4, batch 35 §176) Its presses count from the dashboard's first load, never from a redraw (the dashboard shows no change lines). */}
      <KeepLoadTime at={now.toISOString()}>
        <BankToConfirmBox rows={rows} seenAt={now.toISOString()} all={all} />
      </KeepLoadTime>
    </>
  );
}

export function BankToConfirmBox({ rows, seenAt = "", all }: { rows: BankTopRow[]; seenAt?: string; /** (Owner, Nov 3, §147) Confirm all, above the rows */ all?: ConfirmAllState }) {
  return (
    <DashboardActionBox id="bank-to-confirm" title="Your bank wants you to confirm" count={rows.length} kind="bank" top={all && <ConfirmAll {...all} seenAt={seenAt} />}>
      {/* (§147) An open Confirm all check is a row too (the count, the poll), drawn by Confirm all above the list. */}
      {rows.filter((r) => !r.all).map((r) => (
        <li key={r.id} className="rounded-lg border border-white/10 p-3 text-sm" data-bank-top-row={r.id}>
          <BankWaiting wide paymentId={r.id} cents={r.cents} seenAt={seenAt} full={`${r.full} · ${r.by}`} line={<>{withTestLinks(r.lead, r.tests)} · <span className={r.soon ? "font-medium text-rose-300" : "text-slate-300"} data-confirm-by={r.soon ? "soon" : ""}>{r.by}</span></>} />
        </li>
      ))}
    </DashboardActionBox>
  );
}
