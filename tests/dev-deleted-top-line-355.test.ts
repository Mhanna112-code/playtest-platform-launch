import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { devDeletedStopLine, endedByDevDeletion, endedLine, stillWorksLine, workOverLine } from "@/lib/rules";
import { deleteAccount } from "@/lib/server/restrictions";
import { sessionRefusal } from "@/lib/server/tests";
import { fmtDate } from "@/lib/server/dateFormat";
import { act, joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 9, §355) When the developer deletes their account, the deletion stops their tests. A tester whose session it ended reads ONE top line:
// "The developer deleted their account, so this test was stopped on {date}. Work you sent that's listed is paid automatically when it's due; chat and excerpt
// requests are closed." Sessions that had already ended (left, ended early, closed, rated, an earlier Stop) keep their own line.

const LINE = /^The developer deleted their account, so this test was stopped on .+\. Work you sent that's listed is paid automatically when it's due; chat and excerpt requests are closed\.$/;
const contract = (id: string) => db.contract.findUniqueOrThrow({ where: { id }, include: { test: { include: { developer: true } }, tester: true } });

describe("§355 the tester's top line after the developer deleted their account", () => {
  it("a working tester's session ended by the deletion: the one line, everywhere it shows; no \"You can still …\"", async () => {
    const { dev, testId } = await setup();
    const j = await joined(testId);
    await deleteAccount(dev.user.id, "self");
    const c = await contract(j.sessionId);
    expect(c.status).toBe("ended");
    expect(endedByDevDeletion(c)).toBe(true);
    expect(sessionRefusal(c, c.test, "Deleted user")).toBe(devDeletedStopLine(c.endedAt!, fmtDate));
    expect(sessionRefusal(c, c.test, "Deleted user")).toMatch(LINE);
    const top = stillWorksLine(c, "Deleted user", fmtDate, { excerpt: true, chat: true, dispute: true });
    expect(top).toMatch(LINE);
    expect(top).not.toContain("You can still");
    expect(top).not.toContain("Work you sent is still reviewed");
    // An old page's Send: the same line, naming the press.
    const r = await sact(j.sessionId, "written", j.tester.cookie, { answers: ["The harbour level was clear and the boats handled well.", "Fine."], seenAt: seen(), confirmed: true });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toMatch(/^The developer deleted their account, so this test was stopped on .+: your Send didn't go through\. Work you sent that's listed is paid automatically when it's due; chat and excerpt requests are closed\.$/);
    expect(workOverLine(c, "Deleted user", fmtDate, "")).toMatch(LINE);
  });

  it("sessions that had already ended keep their own line", async () => {
    const { dev, testId } = await setup({ spots: 3 });
    const left = await joined(testId, "Ana Silva");
    const early = await joined(testId, "Ben Carter", "he");
    expect((await sact(left.sessionId, "leave", left.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await act(testId, "end-early", dev.cookie, { contractIds: [early.sessionId], reason: "We have enough feedback.", seenAt: seen(), confirmed: true })).status).toBe(200);
    await settle();
    await deleteAccount(dev.user.id, "self");
    const l = await contract(left.sessionId), e = await contract(early.sessionId);
    expect(endedByDevDeletion(l)).toBe(false);
    expect(endedByDevDeletion(e)).toBe(false);
    expect(sessionRefusal(l, l.test, "Deleted user")).toBe("You left this test.");
    expect(sessionRefusal(e, e.test, "Deleted user")).toMatch(/ended your session early on /);
  });

  it("an earlier Stop by the developer keeps its line after a later deletion", async () => {
    const { dev, testId } = await setup();
    const j = await joined(testId);
    expect((await act(testId, "stop", dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    await deleteAccount(dev.user.id, "self");
    const c = await contract(j.sessionId);
    expect(endedByDevDeletion(c)).toBe(false);
    expect(endedLine(c, "Deleted user", fmtDate)).toMatch(/^Deleted user stopped the test on /);
  });
});
