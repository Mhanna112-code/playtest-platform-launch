import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import * as R from "@/lib/rules";
import { reviewReminders } from "@/lib/server/holds";
import { DAY, sentWork } from "./b15";

// (Owner, Nov 11, §383) Each countdown mark is saved together with its bell line, in ONE transaction: a failure writing the line leaves no mark (the next run
// sends it), and a failure after the line was written (the mark's write) leaves no line either (never a duplicate later).
const fail = vi.hoisted(() => ({ mode: "" as "" | "before" | "after" }));
vi.mock("@/lib/server/notify", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/notify")>();
  return {
    ...real,
    bell: async (...args: Parameters<typeof real.bell>) => {
      const reminder = args[4]?.reminder ?? "";
      if (fail.mode === "before" && reminder.startsWith("unreviewed:")) throw new Error("the line's write failed");
      await real.bell(...args);
      if (fail.mode === "after" && reminder.startsWith("unreviewed:")) throw new Error("the write after the line failed");
    },
  };
});
afterEach(() => {
  fail.mode = "";
});

async function dueTomorrow() {
  const w = await sentWork();
  const c = await db.contract.findUniqueOrThrow({ where: { id: w.sessionId }, include: { test: true } });
  const reviewDate = R.chargeOpensAt(w.sub, c.test, c)!;
  const now = new Date(reviewDate.getTime() - 0.5 * DAY); // the 1-day mark ("by tomorrow") is due
  const lines = () => db.notification.count({ where: { userId: w.dev.user.id, reminderKey: `unreviewed:${w.sub.id}`, text: { contains: " by tomorrow " } } });
  const marks = async () => (await db.submission.findUniqueOrThrow({ where: { id: w.sub.id } })).devMarks.filter((m) => m.startsWith("r:"));
  return { w, now, lines, marks };
}

describe("§383 a countdown mark and its line are written together", () => {
  it("the line's write fails: no mark is saved, so the next run sends it (once)", async () => {
    const { w, now, lines, marks } = await dueTomorrow();
    fail.mode = "before";
    await expect(reviewReminders(now, undefined, [w.sessionId])).rejects.toThrow("the line's write failed");
    expect(await lines()).toBe(0);
    expect(await marks()).toEqual([]);
    fail.mode = "";
    await reviewReminders(new Date(now.getTime() + 60_000), undefined, [w.sessionId]);
    expect(await lines()).toBe(1);
    expect((await marks()).length).toBeGreaterThan(0);
    await reviewReminders(new Date(now.getTime() + 120_000), undefined, [w.sessionId]);
    expect(await lines()).toBe(1); // never twice
  }, 60_000);

  it("a write after the line fails: the line is undone with the mark, so the next run sends it once (never a duplicate)", async () => {
    const { w, now, lines, marks } = await dueTomorrow();
    fail.mode = "after";
    await expect(reviewReminders(now, undefined, [w.sessionId])).rejects.toThrow("the write after the line failed");
    expect(await lines()).toBe(0);
    expect(await marks()).toEqual([]);
    fail.mode = "";
    await reviewReminders(new Date(now.getTime() + 60_000), undefined, [w.sessionId]);
    await reviewReminders(new Date(now.getTime() + 120_000), undefined, [w.sessionId]);
    expect(await lines()).toBe(1);
  }, 60_000);
});
