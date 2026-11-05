import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (f: string) => fs.readFileSync(path.resolve(__dirname, "..", f), "utf8");

describe("(Owner, Nov 5) §252/§253 a dispute is one drop-down; the dashboard groups them by person", () => {
  it("§252: on the test page the dispute line is the drop-down's summary; the reason and Add your side are inside it, the reason with no drop-down of its own", () => {
    const s = read("src/app/app/tests/[id]/page.tsx");
    const at = s.indexOf("<Fold id={`needs-dispute-${d.id}`}");
    const end = s.indexOf("</Fold>", at);
    expect(at).toBeGreaterThan(0);
    const inside = s.slice(at, end);
    expect(inside).toContain("<ReasonQuote id={`dispute-${d.id}`}");
    expect(inside).toContain("<DisputeSide seenAt={seenAt} testId={t.id} disputeId={d.id} />");
  });
  it("§253: Disputes: add your side has one drop-down per person and, inside, one per dispute with its reason and Add your side", () => {
    const s = read("src/app/app/page.tsx");
    const person = s.indexOf("<Fold id={`dispute-person-");
    const one = s.indexOf("<Fold id={`dashboard-dispute-${d.id}`}");
    expect(person).toBeGreaterThan(0);
    expect(one).toBeGreaterThan(person);
    const inside = s.slice(one, s.indexOf("</Fold>", one));
    expect(inside).toContain('<ReasonQuote id={`dispute-reason-${d.id}`} label="Their reason"');
    expect(inside).toContain("<DisputeSide seenAt={now.toISOString()} testId={d.testId} disputeId={d.id} />");
    expect(s).toContain('{ds.length === 1 ? "1 dispute" : `${ds.length} disputes`}');
  });
});
