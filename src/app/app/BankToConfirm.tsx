import { AutoRefresh } from "@/components/AutoRefresh";
import { DashboardActionBox } from "./DashboardActionBox";
import { BankWaiting } from "@/components/BankWaiting";
import { bankTopV, type BankTopRow } from "@/lib/bankTop";
import { bankToConfirm } from "@/lib/server/confirm";

/**
 * (Owner, Oct 29, batch 24 section 1) "Your bank wants you to confirm (N)" below the developer name, in the same box for active and restricted accounts,
 * hidden when there's nothing to confirm. Every row in a plain scroll box about 3 rows tall (batch 16 section 14: no "Show N more"), soonest deadline first; under 24 hours
 * left the "confirm by" part is red. "Confirm with your bank" opens the existing inline check in its row. The dashboard's poll (`bank=1`) brings a new row in and takes one out (confirmed anywhere, expired, cancelled) without a reload.
 */
export async function BankToConfirm({ userId, now }: { userId: string; now: Date }) {
  const rows = await bankToConfirm(userId, now);
  return (
    <>
      <AutoRefresh query="bank=1" v={bankTopV(rows)} />
      <BankToConfirmBox rows={rows} seenAt={now.toISOString()} />
    </>
  );
}

export function BankToConfirmBox({ rows, seenAt = "" }: { rows: BankTopRow[]; seenAt?: string }) {
  return (
    <DashboardActionBox id="bank-to-confirm" title="Your bank wants you to confirm" count={rows.length} kind="bank">
      {rows.map((r) => (
        <li key={r.id} className="rounded-lg border border-white/10 p-3 text-sm" data-bank-top-row={r.id}>
          <BankWaiting wide paymentId={r.id} seenAt={seenAt} line={<>{r.lead} · <span className={r.soon ? "font-medium text-rose-300" : "text-slate-300"} data-confirm-by={r.soon ? "soon" : ""}>{r.by}</span></>} />
        </li>
      ))}
    </DashboardActionBox>
  );
}
