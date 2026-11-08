import { SearchPanel } from "@/components/SearchPanel";
import { FindTestCard } from "@/components/FindTestCard";
import { asListing } from "@/lib/server/tests";
import { termsLine } from "@/lib/rules";



import { AutoRefresh } from "@/components/AutoRefresh";



import { visitedTests, visitedV } from "@/lib/server/testVisits";
import { VisitedCard } from "./RemoveVisit";

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
        <SearchPanel id="tests-visited" title="Tests visited" placeholder="Search visited tests by developer or test" filters={["Open","Full","Joining closed","Paused","Stopped","Closed","Applied","Invited","Invite only"]} items={rows.map(r=>({key:r.testId,search:`${r.title} ${r.developer}`,states:[r.state],node:<VisitedCard testId={r.testId} title={r.title}><FindTestCard test={r.test} href={r.href} developerName={r.developer} terms={termsLine(asListing(r.test),true)} state={r.label} redacted={r.state==="Invite only"}/></VisitedCard>}))}/>

      )}
    </>
  );
}
