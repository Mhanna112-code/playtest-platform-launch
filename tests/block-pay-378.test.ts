import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as blocksPOST } from "@/app/api/blocks/route";
import { pauseTest } from "@/lib/server/restrictions";
import { reportPerson } from "@/lib/server/reports";
import { json, makeUser, req } from "./helpers";
import { joined, seen, settle, setup } from "./fixtures";

// (Owner, Nov 11, §378) Block never stops once; Pay, Pay more and Charge / Let it go on a piece close on the same date (that piece's Charge window end).

describe("§378 item 1: Block never stops once", () => {
  it("a pause of their test since the profile loaded: Block goes through on the first press; Report keeps its §271 stop", async () => {
    const s = await setup();
    const a = await joined(s.testId);
    const pageAt = seen();
    await settle();
    await pauseTest((await makeUser({ name: "Team Admin", email: "owner@playtest.test" })).user.id, s.testId, "Checking");
    await settle();
    const r = await reportPerson(a.tester.user, { userId: s.dev.user.id, note: "Something happened here, please look.", seenAt: pageAt }).then(() => null, (e) => e);
    expect(r?.code).toBe("stop_once");
    const b = await blocksPOST(req("/api/blocks", { cookie: a.tester.cookie, body: { userId: s.dev.user.id, seenAt: pageAt } })).then(json);
    expect(b.status, JSON.stringify(b.body)).toBe(200);
    expect(await db.block.count({ where: { blockerId: a.tester.user.id, blockedId: s.dev.user.id } })).toBe(1);
    // The race refusal stays: already blocked in another tab.
    const again = await blocksPOST(req("/api/blocks", { cookie: a.tester.cookie, body: { userId: s.dev.user.id } })).then(json);
    expect(again.body.error.code).toBe("already");
  });
});
