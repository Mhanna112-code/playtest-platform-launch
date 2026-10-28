import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { keyBoxes } from "@/lib/server/accessKeys";
import { tickedInUseLine } from "@/lib/keys";
import { act, joined, setup } from "./fixtures";

// Found while recording the owner's access keys race (scripts/media.cjs, group "keysrace").
describe("the access keys race", () => {
  const edit = async (testId: string, cookie: string, extra: Record<string, unknown>) =>
    act(testId, "edit", cookie, { version: (await db.test.findUniqueOrThrow({ where: { id: testId } })).version, fields: {}, ...extra });

  it("a key ticked for removal that a joining tester was given meanwhile is red, never dropped silently", async () => {
    const { dev, testId } = await setup({ spots: 3, accessKeys: "K1\nK2\nK3\nK4" });
    await joined(testId, "Ana Silva"); // gets K1, the oldest free key
    const r = await edit(testId, dev.cookie, { keysRemove: ["K1", "K4"] });
    expect(r.status).toBe(400);
    expect(r.body.error.errors).toContain(tickedInUseLine("K1"));
    // Nothing saved: K4 is still free and K1 still in use.
    expect((await db.accessKey.findFirstOrThrow({ where: { testId, value: "K4" } })).status).toBe("free");
    expect((await db.accessKey.findFirstOrThrow({ where: { testId, value: "K1" } })).status).toBe("inuse");
    // Without the in-use key the same removal saves.
    expect((await edit(testId, dev.cookie, { keysRemove: ["K4"] })).status).toBe(200);
  });

  it("Edit's key boxes report the working testers, so the open spots follow joins live", async () => {
    const { testId } = await setup({ spots: 3, accessKeys: "K1\nK2\nK3" });
    await joined(testId, "Ana Silva");
    await joined(testId, "Ben Cole", "he");
    const k = await keyBoxes(testId);
    expect(k.testersIn).toBe(2);
    expect(k.open).toBe(1);
  });
});
