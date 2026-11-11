import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as blocksPOST } from "@/app/api/blocks/route";
import { POST as releasePOST } from "@/app/api/test/race-release/route";
import { json, req } from "./helpers";
import { settle } from "./fixtures";
import { pay, payMore, sentWork } from "./b15";

// (Owner, Nov 11, §380 F) A Pay more and a Block at the same moment: only two orders. The Block takes the lock of every test the two share before writing its row,
// and Pay more reads the block again under its test's lock: the press first (it goes through, then the block), or the block first (the press is refused with its
// existing line, "This payment isn't available."). The test-only race hold (RACE_HOLDS=1) forces each order.

const release = (body: Record<string, unknown>) => releasePOST(req("/api/test/race-release", { body }));
const waiting = async (name: string) => {
  for (let i = 0; i < 200 && !(await (await release({ name, peek: true })).json()).waiting; i++) await settle();
  expect((await (await release({ name, peek: true })).json()).waiting).toBe(true);
};
const block = (cookie: string, userId: string, extra: Record<string, unknown> = {}) => blocksPOST(req("/api/blocks", { cookie, body: { userId, ...extra } })).then(json);

async function paid() {
  const w = await sentWork();
  expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
  return w;
}
const more = (w: Awaited<ReturnType<typeof paid>>, extra: Record<string, unknown> = {}) => payMore(w.testId, w.dev.cookie, { contractId: w.sessionId, submissionId: w.sub.id, amount: "2.00", tickedCents: 200, ...extra });

describe("§380 F: Pay more and Block racing", () => {
  afterEach(() => { delete process.env.RACE_HOLDS; });

  it("the Block first: Pay more, held after its first checks, is refused under its lock with its block line; nothing is paid", async () => {
    process.env.RACE_HOLDS = "1";
    const w = await paid();
    const pending = more(w, { raceHold: "pm" });
    await waiting("pm");
    // The tester blocks the developer from her profile while the Pay more waits before its lock.
    expect((await block(w.tester.cookie, w.dev.user.id)).status).toBe(200);
    expect((await (await release({ name: "pm" })).json()).released).toBe(true);
    const r = await pending;
    expect([r.status, r.body.error?.message]).toEqual([409, "This payment isn't available."]);
    expect(await db.payment.count({ where: { kind: "extra", contractId: w.sessionId } })).toBe(0);
  });

  it("the Pay more first: the Block, held before its locks, waits; the Pay more goes through, then the block", async () => {
    process.env.RACE_HOLDS = "1";
    const w = await paid();
    const pending = block(w.tester.cookie, w.dev.user.id, { raceHold: "bl" });
    await waiting("bl");
    const r = await more(w);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await (await release({ name: "bl" })).json()).released).toBe(true);
    expect((await pending).status).toBe(200);
    expect(await db.payment.count({ where: { kind: "extra", contractId: w.sessionId } })).toBe(1);
    expect(await db.block.count({ where: { blockerId: w.tester.user.id, blockedId: w.dev.user.id } })).toBe(1);
    // After the block: refused with its line.
    expect((await more(w)).body.error?.message).toBe("This payment isn't available.");
  });

  it("a Block holds every test of both people while it writes: their sessions end in the same step as the row", async () => {
    const w = await paid();
    expect((await block(w.dev.cookie, w.tester.user.id)).status).toBe(200);
    const c = await db.contract.findUniqueOrThrow({ where: { id: w.sessionId } });
    const b = await db.block.findFirstOrThrow({ where: { blockerId: w.dev.user.id } });
    expect([c.status, c.endKind]).toEqual(["ended", "blocked"]);
    expect(Math.abs(c.endedAt!.getTime() - b.createdAt.getTime())).toBeLessThan(5_000);
  });
});
