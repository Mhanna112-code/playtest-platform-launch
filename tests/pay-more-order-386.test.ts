import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { startHold } from "@/lib/server/holds";
import { joined, sact, seen, settle, setup } from "./fixtures";
import { makeUser } from "./helpers";
import { pay, payMore } from "./b15";

// (Owner, Nov 11, §386 D) Pay more's refusals: the hold first, then the block, then not paid, the $0 closures and the closing date (the block used to come after
// those).

async function sent() {
  const s = await setup();
  const j = await joined(s.testId);
  expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["the boats", "level two gate"], notes: "", seenAt: seen(), confirmed: true })).status).toBe(200);
  await settle();
  const sub = await db.submission.findUniqueOrThrow({ where: { contractId_kind: { contractId: j.sessionId, kind: "written" } } });
  return { ...s, ...j, sub };
}
const block = (w: Awaited<ReturnType<typeof sent>>, by: "developer" | "tester") =>
  db.block.create({ data: by === "developer" ? { blockerId: w.dev.user.id, blockedId: w.tester.user.id } : { blockerId: w.tester.user.id, blockedId: w.dev.user.id } });
const more = (w: Awaited<ReturnType<typeof sent>>) => payMore(w.testId, w.dev.cookie, { contractId: w.sessionId, submissionId: w.sub.id, amount: "1.00" });

describe("§386 D Pay more: hold → block → not paid → $0 → closed", () => {
  it("the block comes before 'not paid yet'", async () => {
    for (const by of ["developer", "tester"] as const) {
      const w = await sent();
      expect((await more(w)).body.error.message).toBe("Pay this part first: Pay more is for a part you've already paid.");
      await block(w, by);
      expect((await more(w)).body.error.message).toBe(by === "developer" ? "You blocked Ana Silva, so your Pay more didn't go through." : "This payment isn't available.");
    }
  });

  it("the block comes before the team's $0 closure", async () => {
    const w = await sent();
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "0", reason: "Nothing usable here" })).status).toBe(200);
    const admin = await makeUser({ name: "Team Admin" });
    await db.review.update({ where: { submissionId: w.sub.id }, data: { teamClosedById: admin.user.id } });
    expect((await more(w)).body.error.message).toBe("The team closed this for $0.");
    await block(w, "developer");
    expect((await more(w)).body.error.message).toBe("You blocked Ana Silva, so your Pay more didn't go through.");
  });

  it("the hold comes before the block", async () => {
    const w = await sent();
    await block(w, "developer");
    await startHold(w.dev.user.id, "unpaid");
    expect((await more(w)).body.error.message).toBe("Your tests are paused, so your Pay more didn't go through.");
  });
});
