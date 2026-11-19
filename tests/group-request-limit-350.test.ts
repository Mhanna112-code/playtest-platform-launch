import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// (Owner, Nov 9, §350; audit D04) A group Request a time where one ticked tester was over a limit (or busy) used to stop once ("Press again to send to the
// others (Ben Okafor)." with limitSeen / sendTo) and send to the others on the second press.
// (Owner, Nov 2026: refuse naming who can't get it; no partial send) Now it is a refusal naming who and why, shown under the button like other refusals;
// nothing is sent. The server side is tested in separate-times-208, no-clash-requests-292, call-limit-request-boxes-185 and stop-again; here, the pages' wiring.
const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
const panel = read("src/app/app/tests/[id]/DevCallPanel.tsx");
const session = read("src/components/CallRequests.tsx");
const server = read("src/lib/server/requests.ts");

describe("§350 / D04 → (Owner, Nov 2026) the group Request a time refuses instead of stopping once", () => {
  it("the developer's panel keeps no limitSeen / sendTo, sends none back, and shows no server tail", () => {
    for (const gone of ["setLimitSeen", "data.limitSeen", "limitSeen }", "limitSendTo", "takeLimit", "errData.tail", "sendTo"]) expect(panel).not.toContain(gone);
    expect(panel).toContain("rows: filled }); }}");
  });
  it("every ticked tester is checked red as the form is filled (none skipped)", () => {
    expect(panel).toContain("checked.filter((t) => ticked.includes(t.contractId)).map");
  });
  it("the session page's form sends no limitSeen", () => {
    for (const gone of ["setLimitSeen", "d.limitSeen", "ticked, limitSeen"]) expect(session).not.toContain(gone);
    expect(session).toContain("{ contractIds: ticked }");
  });
  it("the server has no 'Press again to send to the others' stop", () => {
    expect(server).not.toMatch(/HttpError\(409, "stop_once", "Press again to send to the others/);
    expect(server).not.toContain("body.limitSeen");
  });
});
