import type { PartPayLine } from "@/lib/server/partPayments";
import { WhatLine } from "@/components/WholeLine";
import { withLineLinks } from "@/components/LineLinks";
import { LIST_PANEL, PAY_LINES_SHOWN, PanelWhen } from "@/components/ScrollList";
import { Fold, PART_PANEL } from "@/components/Panel";

/**
 * (Owner, Nov 3, batch 35 §152) Under a part on the developer's test page (in the tester rows and Needs you, where its paid total shows): that part's payments, oldest
 * first, each as Payments' "What you've paid" line, then its date, amount and status ("waiting for your bank", "card declined", "your bank reversed this
 * (chargeback)"…). Up to 4: a plain list; more: the draggable panel (ResizeBox, kept by `part-pays-<part id>`). Nothing when the part has no payments.
 * (Owner, Nov 6, §301; replaces the plain "Payments for this part" label) The list sits in a "Payments (N)" drop-down (N: its lines), closed at first, its open
 * state kept per part (Fold's keptFold, `row-pays-<part id>`); a link to the part doesn't open it. In the Testers list it sits right under the part's heading
 * line, above its content panel.
 */
export function PartPayments({ id, lines }: { /** the part: the sent work's or the call's id */ id: string; lines: PartPayLine[] | undefined }) {
  if (!lines?.length) return null;
  const panel = lines.length > PAY_LINES_SHOWN;
  return (
    <div className={`w-full ${PART_PANEL}`} data-part-payments={id}>
      <Fold id={`row-pays-${id}`} defaultOpen={false} jumpOpen={false} summaryClassName="!text-sm font-medium !text-slate-200"
        summary={<span data-part-pays-toggle="" data-part-pays-count={lines.length}>Payments ({lines.length})</span>}>
        <PanelWhen on={panel} id={`part-pays-${id}`} label="Payments for this part" defaultMax={LIST_PANEL.devPayLines}>
          <ul className="divide-y divide-white/5 text-sm" data-part-pay-list={panel ? "panel" : "plain"}>
            {lines.map((l) => (
              <li key={l.id} className="space-y-0.5 py-1.5" data-part-pay={l.id}>
                <span className="block text-slate-200"><WhatLine text={l.full || l.what} links={l.links} after={l.how ? <span className="text-slate-400">, {withLineLinks(l.how, l.links)}</span> : null} /></span>
                <span className="block text-slate-400">{l.when} · <span className="whitespace-nowrap">{l.amount}</span>{l.status && ` · ${l.status}`}</span>
              </li>
            ))}
          </ul>
        </PanelWhen>
      </Fold>
    </div>
  );
}
