import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { keyBoxes } from "@/lib/server/accessKeys";
import { givenDeletedLine } from "@/lib/keys";
import { act, joined, setup } from "./fixtures";

// Found while recording the owner's access keys race (scripts/media.cjs, group "keysrace").
describe("the access keys race", () => {
  const edit = async (testId: string, cookie: string, extra: Record<string, unknown>) =>
    act(testId, "edit", cookie, { version: (await db.test.findUniqueOrThrow({ where: { id: testId } })).version, fields: {}, ...extra });

  it("(batch 16 section 20) a key deleted here that a joining tester was given meanwhile: Save stops once with the warning (no red); the second press saves the rest", async () => {
    const { dev, testId } = await setup({ spots: 3, accessKeys: "K1\nK2\nK3\nK4" });
    const seenAt = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 25));
    await joined(testId, "Ana Silva"); // gets K1, the oldest free key
    const r = await edit(testId, dev.cookie, { keysRemove: ["K1", "K4"], seenAt });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("changed");
    expect(r.body.error.errors).toEqual([]);
    expect((r.body.error.changes as { text: string }[]).map((c) => c.text)).toContain(givenDeletedLine([{ name: "Ana Silva", value: "K1" }]));
    expect(givenDeletedLine([{ name: "Ana Silva", value: "K1" }])).toBe("Ana Silva joined and was given K1, which you had deleted here.");
    // Nothing saved yet: K4 is still free and K1 in use.
    expect((await db.accessKey.findFirstOrThrow({ where: { testId, value: "K4" } })).status).toBe("free");
    // The second press saves the rest (K4 goes; K1 stays in use).
    // (The page drops K1 from its pending deletions when the stop shows it.)
    expect((await edit(testId, dev.cookie, { keysRemove: ["K4"], seenAt, confirmed: true, boxAt: r.body.error.now ?? new Date().toISOString() })).status).toBe(200);
    expect(await db.accessKey.count({ where: { testId, value: "K4", status: "free" } })).toBe(0);
    expect((await db.accessKey.findFirstOrThrow({ where: { testId, value: "K1" } })).status).toBe("inuse");
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
