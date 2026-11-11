"use client";
import { WhatLine } from "@/components/WholeLine";
import { lineRender, withTests } from "@/components/LineLinks";
import { splitLead, type BankTopRow } from "@/lib/bankTop";
import { CONFIRM_WITH_BANK } from "@/lib/rules";

/**
 * (Owner, Nov 11, §380 B) A row of the dashboard's "Your bank wants you to confirm": its line as before (the amount and "confirm by" always shown, the "what" cut
 * at 50 with the arrow, its people and test as green links: §246, §251, §270), and a LINK to its "Confirm with your bank" on the test page under its piece (the
 * one page that confirms it; a row with no test links to Payments). The server hands it the row as data (never a function: the §230 hotfix).
 */
export function BankTopLink({ row }: { row: BankTopRow }) {
  const lead = splitLead(row.lead), whole = splitLead(row.full || row.lead);
  return (
    <div className="min-w-0 max-w-full basis-full space-y-2 border border-sky-300/40 bg-sky-500/10 p-3 text-sm text-sky-100" data-bank-top-link={row.id}>
      <p className="[overflow-wrap:anywhere]">
        {lead.amount ? <><span className="whitespace-nowrap" data-bank-top-amount="">{lead.amount}</span>{lead.sep}</> : null}
        <WhatLine text={whole.what || lead.what} render={lineRender(withTests(row.links, row.tests), { newTab: true })} after={<> · <span className={row.soon ? "font-medium text-rose-300" : "text-slate-300"} data-confirm-by={row.soon ? "soon" : ""}>{row.by}</span></>} />
      </p>
      <a href={row.href} className="btn inline-block w-full px-3 py-1.5 text-center text-sm no-underline hover:no-underline sm:w-auto" data-bank-link="">{CONFIRM_WITH_BANK} →</a>
    </div>
  );
}
