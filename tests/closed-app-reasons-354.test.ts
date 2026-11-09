import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { appClosedForDev, joinPageChanges, withdrawGoneLine } from "@/lib/server/joining";
import { closeJoiningAfterOpenUntil } from "@/lib/server/tests";
import { fmtDate } from "@/lib/server/dateFormat";
import { makeUser } from "./helpers";
import { act, seen, settle, setup } from "./fixtures";

// (Owner, Nov 9, §354) The developer's Accept / Decline on a CLOSED application names the real reason: the test filled up, joining closed (Open until passed),
// the test was stopped, or the listing changed. A block's closing stays neutral. The tester's lines (Withdraw, the join page's top box) give the same reasons.

async function applied() {
  const { dev, testId } = await setup({ joinMode: "apply", spots: 3 });
  const ben = await makeUser({ tester: true, name: "Ben Carter", pronoun: "he" });
  expect((await act(testId, "apply", ben.cookie, { note: "I play a lot of sailing games." })).status).toBe(200);
  const app = await db.application.findFirstOrThrow({ where: { testId, testerId: ben.user.id } });
  return { dev, testId, ben, app };
}
const accept = (x: Awaited<ReturnType<typeof applied>>) => act(x.testId, "application", x.dev.cookie, { applicationId: x.app.id, action: "accept", seenAt: seen(), confirmed: true });

describe("§354 a closed application's Accept / Decline names why it closed", () => {
  it("the test was stopped: the developer's line, the tester's Withdraw and join page say so", async () => {
    const x = await applied();
    const loaded = seen();
    await settle();
    expect((await act(x.testId, "stop", x.dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await db.application.findUniqueOrThrow({ where: { id: x.app.id } })).closedReason).toBe("stopped");
    const r = await accept(x);
    expect(r.status).toBe(409);
    expect(r.body.error.message).toMatch(/^Ben Carter's application closed when the test was stopped at \d{1,2}:\d{2}\W(AM|PM)\.$/);
    expect(await withdrawGoneLine(x.ben.user.id, x.testId)).toMatch(/^It closed when the test was stopped at /);
    const top = (await joinPageChanges(x.ben.user.id, x.testId, loaded, "")).map((l) => l.text);
    expect(top).toContain("Harbor Run was stopped: your application was closed");
    expect(top.join("\n")).not.toContain("changed the listing");
  });

  it("joining closed (Open until passed): the date of Open until", async () => {
    const x = await applied();
    const loaded = seen();
    const until = new Date(Date.now() - 2 * 86_400_000);
    await db.test.update({ where: { id: x.testId }, data: { openUntil: until } });
    await settle();
    expect(await closeJoiningAfterOpenUntil()).toBeGreaterThanOrEqual(1);
    expect((await db.application.findUniqueOrThrow({ where: { id: x.app.id } })).closedReason).toBe("joining_closed");
    const r = await accept(x);
    expect(r.status).toBe(409);
    expect(r.body.error.message).toBe(`Ben Carter's application closed when joining closed (Open until passed) on ${fmtDate(until)}.`);
    expect(await withdrawGoneLine(x.ben.user.id, x.testId)).toBe(`It closed when joining closed (Open until passed) on ${fmtDate(until)}.`);
    const top = (await joinPageChanges(x.ben.user.id, x.testId, loaded, "")).map((l) => l.text);
    expect(top).toContain(`Joining Harbor Run closed (Open until passed) on ${fmtDate(until)}: your application was closed`);
  });

  it("a listing change keeps its line; full, invite only and a block keep theirs", async () => {
    const x = await applied();
    const t = await db.test.findUniqueOrThrow({ where: { id: x.testId } });
    expect((await act(x.testId, "edit", x.dev.cookie, { version: t.version, fields: { writtenCents: "12.00" }, seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await db.application.findUniqueOrThrow({ where: { id: x.app.id } })).closedReason).toBe("listing");
    expect((await accept(x)).body.error.message).toMatch(/^Ben Carter's application closed when you changed the listing in another tab at /);
    const at = new Date(2026, 10, 9, 15, 20);
    expect(appClosedForDev("Ben Carter", "full", at, null)).toMatch(/^Ben Carter's application closed when the test filled up at 3:20\WPM\.$/);
    expect(appClosedForDev("Ben Carter", "invite_only", at, null)).toMatch(/^Ben Carter's application closed when the test became invite only at /);
    expect(appClosedForDev("Ben Carter", "blocked", at, null)).toBe("Ben Carter's application was closed.");
  });
});
