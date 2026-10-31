import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { makeUser } from "./helpers";
import { act, joined, seen, settle, setup } from "./fixtures";

const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const later = () => new Promise((r) => setTimeout(r, 25));

// Owner bug, Oct 31 (batch 35 §74): the developer's own call-request withdraw is theirs.
describe("batch 35 §74: the developer's own call-request actions never stop that page", () => {
  it("withdrawn on the same page: the next press goes through; from another tab: one stop, \"You withdrew a call request for … in another tab\"", async () => {
    const { dev, testId } = await setup();
    const w = await joined(testId, "Hal", "he");
    const startsAt = new Date(Date.now() + 72 * 3_600_000);
    startsAt.setSeconds(0, 0);
    expect((await act(testId, "request-time", dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [w.sessionId], startsAt: startsAt.toISOString(), tab: "A" })).status).toBe(200);
    const r = await db.callRequest.findFirstOrThrow({ where: { contractId: w.sessionId, status: "pending", fromSide: "developer" } });
    await settle();
    await later();
    const loaded = seen();
    await later();
    expect((await act(testId, "answer-request", dev.cookie, { contractId: w.sessionId, requestId: r.id, action: "withdraw", seenAt: loaded, tab: "A" })).status).toBe(200);
    const ev = await db.testEvent.findFirstOrThrow({ where: { testId, kind: "withdrew_req" } });
    expect(ev.text).toBe(`You withdrew a call request for ${fmtDateTime(startsAt)}`);
    const third = await makeUser({ tester: true, name: "Ivo" });
    // Another tab (B), drawn before the withdraw: it stops once, in the developer's own voice (no Alerts chip: "own" is no alert type).
    const stop = await act(testId, "invite", dev.cookie, { testerIds: [third.user.id], seenAt: loaded, tab: "B" });
    expect(stop.status).toBe(409);
    expect(stop.body.error.code).toBe("stop_once");
    const lines = stop.body.error.changes as { text: string; alert?: string }[];
    expect(lines.map((c) => c.text)).toEqual([`You withdrew a call request for ${fmtDateTime(startsAt)} in another tab`]);
    expect(lines[0].alert).toBeUndefined();
    // The same page (A): nothing stops.
    expect((await act(testId, "invite", dev.cookie, { testerIds: [third.user.id], seenAt: loaded, tab: "A" })).status).toBe(200);
    expect(src("lib/server/requests.ts")).not.toContain("${status} a call request");
  });
});

// Owner bug, Oct 31 (batch 35 §75): the test page's top presses each have their own box.
describe("batch 35 §75: one box at a time in the top panel, named after its own press", () => {
  it("usePress per key: another key's box never confirms or merges; the boxes are named; another top button clears the box", () => {
    const u = src("lib/usePress.ts");
    expect(u).toContain("const again = changes != null && (!opts.perKey || key === at);");
    expect(u).toContain("confirmed: again || body.confirmed === true");
    expect(u).toContain("c && again ? mergeChanges(");
    const t = src("app/app/tests/[id]/TopPanel.tsx");
    expect(t).toContain('"end-early": "End early"');
    expect(t).toContain("<ChangesBox press={TOP_PRESS[k]}");
    expect(t).toContain("{ perKey: true, onFresh:");
    expect(t).toContain('onClick={() => { clear(); setOpen(open === "next" ? "" : "next"); }}');
    expect(t).toContain('onClick={() => { clear(); setOpen(open === "end" ? "" : "end"); }}');
    expect(t).toContain('before={() => { if (at !== "stop") clear(); return true; }}');
  });
});
