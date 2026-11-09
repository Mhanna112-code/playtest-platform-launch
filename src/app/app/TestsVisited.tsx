import { SearchPanel } from "@/components/SearchPanel";
import { FindTestCard } from "@/components/FindTestCard";
import { asListing } from "@/lib/server/tests";
import { termsLine } from "@/lib/rules";
import { AutoRefresh } from "@/components/AutoRefresh";
import { visitedTests, visitedV } from "@/lib/server/testVisits";
import { VisitedCard } from "./RemoveVisit";

/** The dashboard poll refreshes this panel when a visited test's eligibility or state changes. */
export async function TestsVisited({ testerId }: { testerId: string }) {
  const rows = await visitedTests(testerId);
  return (
    <>
      <AutoRefresh query="visited=1" v={visitedV(rows)} />
      {rows.length > 0 && (
        <SearchPanel
          id="tests-visited"
          title="Tests visited"
          placeholder="Search visited tests by developer or test"
          filters={["Applied", "Open", "Paused"]}
          items={rows.map((r) => ({
            key: r.testId,
            search: `${r.title} ${r.developer}`,
            states: [r.state],
            node: (
              <VisitedCard testId={r.testId} title={r.title}>
                <FindTestCard test={r.test} href={r.href} developerName={r.developer} terms={termsLine(asListing(r.test), true)} state={r.label} />
              </VisitedCard>
            ),
          }))}
        />
      )}
    </>
  );
}
