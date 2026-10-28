import Link from "next/link";
import { Eye } from "lucide-react";
import { AutoRefresh } from "@/components/AutoRefresh";
import { ScrollList } from "@/components/ScrollList";
import { CategoryTile, mainCategory } from "@/components/Ui";
import { num } from "@/lib/format";
import { visitedTests, visitedV, type VisitState } from "@/lib/server/testVisits";
import { VisitedCard } from "./RemoveVisit";

/** A card's one link, stretched over the whole card (the dashboard's CARD_LINK). */
const CARD_LINK = "after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-volt-300";
const TONE: Record<VisitState, string> = {
  Open: "border-emerald-400/40 text-emerald-200",
  Invited: "border-emerald-400/40 text-emerald-200",
  Applied: "border-amber-300/40 text-amber-200",
  Paused: "border-amber-300/40 text-amber-200",
  Full: "border-slate-400/40 text-slate-300",
  "Joining closed": "border-slate-400/40 text-slate-300",
  "Invite only": "border-slate-400/40 text-slate-300",
  Stopped: "border-slate-400/40 text-slate-300",
  Closed: "border-slate-400/40 text-slate-300",
};

/**
 * (Owner, Oct 28, batch 17 §18) "Tests visited" on the tester dashboard: every test whose join page they opened but never joined, most recent visit first, in a plain
 * scroll box (batch 16 §14). Each card shows the test, the developer and its state now, and opens the join page (an invite opens the invitation there); "Remove" (×)
 * drops a card. The dashboard's poll (`visited=1`) refreshes it when a listed test's state changes.
 */
export async function TestsVisited({ testerId }: { testerId: string }) {
  const rows = await visitedTests(testerId);
  return (
    <>
      <AutoRefresh query="visited=1" v={visitedV(rows)} />
      {rows.length > 0 && (
        <section className="space-y-3" id="tests-visited">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white"><Eye className="h-5 w-5 text-sky-300" /> Tests visited <span className="text-sm font-normal text-slate-400">{num(rows.length)}</span></h2>
          <ScrollList className="space-y-2" label="Tests visited">
            {rows.map((r) => (
              <VisitedCard key={r.testId} testId={r.testId} title={r.title}>
                <CategoryTile category={mainCategory(r.categories)} size="h-10 w-10" />
                <div className="min-w-[12rem] flex-1">
                  {r.productName && <p className="kicker truncate" title={r.productName}>{r.productName}</p>}
                  <p className="truncate font-semibold text-white" title={r.title}><Link href={r.href} className={`text-white no-underline hover:no-underline ${CARD_LINK}`} data-visited-open={r.testId}>{r.title}</Link></p>
                  <p className="truncate text-sm text-slate-400" title={`by ${r.developer}`}>by {r.developer}</p>
                </div>
                <span className={`badge ${TONE[r.state]}`} data-visited-state={r.state}>{r.label}</span>
              </VisitedCard>
            ))}
          </ScrollList>
        </section>
      )}
    </>
  );
}
