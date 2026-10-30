import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { keyBoxes, keyOf } from "@/lib/server/accessKeys";
import { testerChanges } from "@/lib/server/testerGate";
import { keyNeedLine } from "@/lib/keys";
import { act, joined, sact, seen, settle, setup } from "./fixtures";

// Batch 30 §17 (owner, Oct 29): access keys added to a test that had none go to its working testers, in order of joining.

const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const edit = async (testId: string, cookie: string, extra: Record<string, unknown>) => {
  const r = await act(testId, "edit", cookie, { version: (await db.test.findUniqueOrThrow({ where: { id: testId } })).version, fields: {}, seenAt: seen(), confirmed: true, ...extra });
  await settle();
  return r;
};

describe("batch 30 §17: the need line counts working testers without a key", () => {
  it("names the working testers and the open spots", () => {
    expect(keyNeedLine(4, 5, 3)).toBe("Add 2 more keys: 3 working testers and 4 open spots need 7, you have 5.");
    expect(keyNeedLine(0, 0, 1)).toBe("Add 1 more key: 1 working tester needs 1, you have 0.");
    expect(keyNeedLine(1, 2, 2)).toBe("Add 1 more key: 2 working testers and 1 open spot need 3, you have 2.");
    expect(keyNeedLine(3, 5, 2)).toBe("");
    expect(keyNeedLine(3, 2)).toBe("Add 1 more key: 3 open spots, 2 free keys."); // no keyless testers: today's line
    expect(src("app/app/tests/TestForm.tsx")).toContain("keyNeedLine(openN, freeAfter, edit ? keysData?.keyless ?? 0 : 0)");
  });
});

describe("batch 30 §17: a keyless test's Save with keys", () => {
  it("2 working testers, Save with 5 keys: each gets one, in order of joining, with a top-box line and a bell line (no key in it)", async () => {
    const { dev, testId } = await setup({ spots: 3 });
    const a = await joined(testId, "Ana Silva");
    const b = await joined(testId, "Ben Okafor");
    const loaded = new Date();
    await settle();
    expect((await keyBoxes(testId)).keyless).toBe(2);
    const r = await edit(testId, dev.cookie, { keysAdd: ["K1", "K2", "K3", "K4", "K5"] });
    expect(r.status).toBe(200);
    expect((await keyOf(a.sessionId))?.value).toBe("K1");
    expect((await keyOf(b.sessionId))?.value).toBe("K2");
    const k = await keyBoxes(testId);
    expect(k.free.map((x) => x.value)).toEqual(["K3", "K4", "K5"]);
    expect(k.inUse.map((x) => `${x.value} · ${x.tester}`)).toEqual(["K1 · Ana Silva", "K2 · Ben Okafor"]); // the developer's Given
    expect(k.keyless).toBe(0);
    // The tester's top box (live) and the bell; the key is only on their page.
    const lines = (await testerChanges(a.tester.user.id, a.sessionId, testId, loaded)).filter((e) => e.kind === "keygiven");
    expect(lines.map((e) => e.text)).toEqual(["Nora Lane gave you an access key for “Harbor Run”"]);
    const bells = await db.notification.findMany({ where: { userId: a.tester.user.id, text: { contains: "access key" } } });
    expect(bells.map((n) => n.text)).toEqual(["Nora Lane gave you an access key for “Harbor Run”"]);
    expect(bells[0].link).toBe(`/app/sessions/${a.sessionId}`);
    expect(bells.some((n) => n.text.includes("K1"))).toBe(false);
    // It stops a press once from a page opened before it, like other changes (the second press goes ahead).
    const stop = await sact(a.sessionId, "written", a.tester.cookie, { answers: ["x".repeat(60), "y".repeat(60)], seenAt: loaded.toISOString() });
    expect(stop.status).toBe(409);
    expect(JSON.stringify(stop.body)).toContain("gave you an access key");
    // The admin timeline reads the event in the third person.
    expect((await db.testEvent.findFirstOrThrow({ where: { testId, kind: "key_given", contractId: a.sessionId } })).text).toBe("Nora Lane gave Ana Silva an access key");
    // A tester joining later gets a key on joining, as today.
    const c = await joined(testId, "Cam Lee");
    expect((await keyOf(c.sessionId))?.value).toBe("K3");
  });

  it("too few keys: red at Save, nothing given", async () => {
    const { dev, testId } = await setup({ spots: 3 });
    const a = await joined(testId, "Ana Silva");
    await joined(testId, "Ben Okafor");
    const r = await edit(testId, dev.cookie, { keysAdd: ["K1", "K2"] });
    expect(r.status).toBe(400);
    expect(r.body.error.errors).toContain("Add 1 more key: 2 working testers and 1 open spot need 3, you have 2.");
    expect(await db.accessKey.count({ where: { testId } })).toBe(0);
    expect(await keyOf(a.sessionId)).toBeNull();
  });

  it("a tester whose work ended gets none (and isn't counted)", async () => {
    const { dev, testId } = await setup({ spots: 3 });
    const a = await joined(testId, "Ana Silva");
    const b = await joined(testId, "Ben Okafor");
    expect((await sact(a.sessionId, "leave", a.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    await settle();
    // 1 working tester + 2 open spots = 3 keys.
    expect((await edit(testId, dev.cookie, { keysAdd: ["K1", "K2", "K3"] })).status).toBe(200);
    expect(await db.accessKey.count({ where: { contractId: a.sessionId } })).toBe(0);
    expect((await keyOf(b.sessionId))?.value).toBe("K1");
    expect(await db.notification.count({ where: { userId: a.tester.user.id, text: { contains: "access key" } } })).toBe(0);
  });
});
