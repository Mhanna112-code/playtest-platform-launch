import type { PartPayLine } from "@/lib/server/partPayments";
import { WholeLine } from "@/components/WholeLine";
import { LIST_PANEL, PAY_LINES_SHOWN, PanelWhen } from "@/components/ScrollList";

/**
 * (Owner, Nov 3, batch 35 §152) Under a part on the developer's test page (in the tester rows and Needs you, where its paid total shows): that part's payments, oldest
 * first, each as Payments' "What you've paid" line, then its date, amount and status ("waiting for your bank", "card declined", "your bank reversed this
 * (chargeback)"…). Up to 4: a plain list; more: the draggable panel (ResizeBox, kept by `part-pays-<part id>`). Nothing when the part has no payments.
 */
export function PartPayments({ id, lines }: { /** the part: the sent work's or the call's id */ id: string; lines: PartPayLine[] | undefined }) {
  if (!lines?.length) return null;
  const panel = lines.length > PAY_LINES_SHOWN;
  return (
    <div className="w-full space-y-1" data-part-payments={id}>
      <p className="text-xs font-medium text-slate-400">Payments for this part</p>
      <PanelWhen on={panel} id={`part-pays-${id}`} label="Payments for this part" defaultMax={LIST_PANEL.devPayLines}>
        <ul className="divide-y divide-white/5 text-sm" data-part-pay-list={panel ? "panel" : "plain"}>
          {lines.map((l) => (
            <li key={l.id} className="space-y-0.5 py-1.5" data-part-pay={l.id}>
              <span className="block text-slate-200"><WholeLine shown={l.what} full={l.full}>{l.what}{l.how && <span className="text-slate-400">, {l.how}</span>}</WholeLine></span>
              <span className="block text-slate-400">{l.when} · <span className="whitespace-nowrap">{l.amount}</span>{l.status && ` · ${l.status}`}</span>
            </li>
          ))}
        </ul>
      </PanelWhen>
    </div>
  );
}
