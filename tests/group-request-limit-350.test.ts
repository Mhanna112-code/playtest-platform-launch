import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// (Owner, Nov 9, §350; audit D04) A group Request a time where one tester's time is over a limit (or busy): the server stops once with "Press again to send to the
// others (Ben Okafor)." and limitSeen, but the page's box said "Press Request a time again to go ahead.", marked Ana's time red (blocking the press) and never sent
// limitSeen back, so Ben never got the request. The server side (sendTo, the second press) is tested in separate-times-208; here, the page's wiring.
const page = fs.readFileSync(path.join(process.cwd(), "src/app/app/tests/[id]/DevCallPanel.tsx"), "utf8");

describe("§350 the developer's Request a time follows the server's partial-group stop", () => {
  it("the box shows the server's tail", () => {
    expect(page).toContain('{...(k === "request" && typeof errData.tail === "string" ? { tail: errData.tail } : {})');
  });
  it("the stop's limitSeen and sendTo are kept, and the next press sends limitSeen back", () => {
    expect(page).toContain("takeLimit(data);");
    expect(page).toContain("setLimitSeen(data.limitSeen);");
    expect(page).toContain("setLimitSendTo(Array.isArray(data.sendTo) ? (data.sendTo as string[]) : null);");
    expect(page).toContain("rows: filled, ...(limitSeen ? { limitSeen } : {})");
  });
  it("the testers the stop leaves out aren't checked red (their red line blocked the second press)", () => {
    expect(page).toContain("checked.filter((t) => ticked.includes(t.contractId) && (!limitSendTo || limitSendTo.includes(t.contractId)))");
  });
  it("another time, length or tick clears it (the server stops again if it still applies)", () => {
    expect(page).toContain('setLimitSeen(""); setLimitSendTo(null);');
  });
});
