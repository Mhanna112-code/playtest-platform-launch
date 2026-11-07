import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { act, atHours, joined, sact, seen, setup } from "./fixtures";

// (Owner, Nov 6, §323) Every "Booked: a call with …" line (both sides: an accepted request, an auto-match "you both picked") is `always`: it reaches the end-of-day
// email even with email Off. Its stack ("Booked calls"), words and link are unchanged. (§324) The 15-minute call reminder is always too (emailed at once).

const booked = (userId: string) => db.notification.findMany({ where: { userId, groupKey: "booked" }, orderBy: { createdAt: "asc" } });

describe("§323 every booked-call line is always emailed", () => {
  it("an accepted request: the other side's line is always, in Booked calls", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId, "Ana Silva");
    expect((await sact(sessionId, "request-time", tester.cookie, { startsAt: atHours(60), seenAt: seen(), confirmed: true })).status).toBe(200);
    const r = await db.callRequest.findFirstOrThrow({ where: { contractId: sessionId, fromSide: "tester", status: "pending" } });
    expect((await act(testId, "answer-request", dev.cookie, { contractId: sessionId, requestId: r.id, action: "accept", seenAt: seen(), confirmed: true })).body.booked).toBe(true);
    const [l] = await booked(tester.user.id);
    expect(l.text).toMatch(/^Booked: a call with .+ on “Harbor Run”, /);
    expect(l).toMatchObject({ mustEmail: true, groupKey: "booked" });
  });

  it("an auto-match (\"you both picked\"): always, for the side that was told", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId, "Ana Silva");
    const t = atHours(70);
    expect((await act(testId, "request-time", dev.cookie, { contractIds: [sessionId], startsAt: t, seenAt: seen(), confirmed: true })).status).toBe(200);
    const second = await sact(sessionId, "request-time", tester.cookie, { startsAt: t, seenAt: seen(), confirmed: true });
    expect(second.body.message).toMatch(/^Booked: a call with .+: you both picked /);
    const [l] = await booked(dev.user.id);
    expect(l.text).toMatch(/^Booked: a call with Ana Silva on “Harbor Run”: you both picked /);
    expect(l).toMatchObject({ mustEmail: true, groupKey: "booked" });
  });

  it("the source: all three booked lines always; (§324) the 15-minute reminder too", () => {
    const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
    expect(src("lib/server/requests.ts").match(/group: BOOKED_GROUP, always: true/g)).toHaveLength(3);
    // (Owner, Nov 6, §324) The 15-minute reminder is now always too (emailed at once, Off included).
    expect(src("lib/server/calls.ts").match(/reminder: reminderKey\(call\.id\), now: true, always: true/g)).toHaveLength(2);
  });
});
