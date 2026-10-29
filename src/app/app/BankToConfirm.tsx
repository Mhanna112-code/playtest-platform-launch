import { AutoRefresh } from "@/components/AutoRefresh";
import { ScrollList } from "@/components/ScrollList";
import { bankTopHeading, bankTopV, type BankTopRow } from "@/lib/bankTop";
import { CONFIRM_WITH_BANK } from "@/lib/rules";
import { bankToConfirm } from "@/lib/server/confirm";

/**
 * (Owner, Oct 29, batch 24 section 1) "Your bank wants you to confirm (N)" at the very top of the developer dashboard (above the blue box during a hold or suspension too),
 * hidden when there's nothing to confirm. Every row in a plain scroll box about 3 rows tall (batch 16 section 14: no "Show N more"), soonest deadline first; under 24 hours
 * left the "confirm by" part is red. "Confirm with your bank →" opens the piece's button on the test page (or a renewal's row on Payments), marked like the bell line's link
 * (a page load, so HashJump marks it). The dashboard's poll (`bank=1`) brings a new row in and takes one out (confirmed anywhere, expired, cancelled) without a reload.
 */
export async function BankToConfirm({ userId, now }: { userId: string; now: Date }) {
  const rows = await bankToConfirm(userId, now);
  return (
    <>
      <AutoRefresh query="bank=1" v={bankTopV(rows)} />
      <BankToConfirmBox rows={rows} />
    </>
  );
}

export function BankToConfirmBox({ rows }: { rows: BankTopRow[] }) {
  if (!rows.length) return null;
  return (
    <section className="card space-y-3 border-sky-300/30" id="bank-to-confirm" aria-label="Your bank wants you to confirm" data-bank-top="">
      <h2 className="font-semibold text-white">{bankTopHeading(rows.length)}</h2>
      <ScrollList size="three" className="space-y-2" label="Payments to confirm">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-col gap-2 rounded-lg border border-white/10 p-3 text-sm sm:flex-row sm:items-center" data-bank-top-row={r.id}>
            <p className="min-w-0 flex-1 text-slate-200">
              {r.lead} · <span className={r.soon ? "font-medium text-rose-300" : "text-slate-300"} data-confirm-by={r.soon ? "soon" : ""}>{r.by}</span>
            </p>
            <a href={r.href} className="btn-secondary w-full shrink-0 px-3 py-1.5 text-sm no-underline hover:no-underline sm:w-auto" data-bank-top-link="">{CONFIRM_WITH_BANK} →</a>
          </li>
        ))}
      </ScrollList>
    </section>
  );
}
