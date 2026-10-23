import { describe, expect, it } from "vitest";
import { doesntListTag, shortList, withYouText } from "@/lib/inviteRows";
import { act, joined, setup } from "./fixtures";
import { makeUser } from "./helpers";
import { db } from "@/lib/db";

// (Owner) Invite rows in the full app's format; Find testers: nothing invited without a tick.
describe("invite rows", () => {
  it("the amber pill names the needs they don't list; the grey detail says your rating and tests together", () => {
    expect(doesntListTag({ devices: ["iPhone", "Android phone"], languages: [] }, { devices: ["Mac"], languages: [] })).toBe("Doesn't list iPhone or Android phone");
    expect(doesntListTag({ devices: ["Mac"], languages: ["English"] }, { devices: [], languages: [] })).toBe("Doesn't list English, or Mac");
    expect(doesntListTag({ devices: ["Mac"], languages: ["English"] }, { devices: ["Mac"], languages: ["English"] })).toBe("");
    expect(shortList(["English", "Spanish", "French", "German"], "language")).toBe("English, Spanish or 2 more languages");
    expect(withYouText(5, 1)).toBe("you rated 5.0/5 · 1 test with you");
    expect(withYouText(null, 4)).toBe("not rated by you · 4 tests with you");
  });

  it("Invite with nothing ticked is refused: 'Tick at least one tester.'", async () => {
    const { dev, testId } = await setup();
    await makeUser({ tester: true, name: "Ben Ito" });
    const r = await act(testId, "invite", dev.cookie, { testerIds: [], seenAt: new Date().toISOString() });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toBe("Tick at least one tester.");
  });

  it("the invite list carries the pill and the detail", async () => {
    const { invitable } = await import("@/lib/server/invites");
    const { dev, testId } = await setup();
    const { tester } = await joined(testId, "Ana Silva");
    await db.test.update({ where: { id: testId }, data: { devices: ["Mac"] } });
    const rows = await invitable(dev.user.id, testId);
    const ana = rows.find((r) => r.id === tester.user.id)!;
    expect(ana.tag).toBe("Doesn't list Mac");
    expect(ana.detail).toBe("not rated by you · 1 test with you");
    expect(ana.grey).toBe("Already in this test");
  });
});
