import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { keyBoxes } from "@/lib/server/accessKeys";
import { FREE_KEYS_RULE, keyRefusal, reusedKeyLine } from "@/lib/keys";
import { freeBoxCheck, type KeysData } from "@/app/app/tests/KeyBoxes";
import { act, joined, sact, seen, settle, setup } from "./fixtures";

// Batch 15 sections 19, 44 and 45: Edit's Free keys as one text box, keys typed back from testers who left or finished, the broken-key warning.
const src = (p: string) => fs.readFileSync(path.resolve(__dirname, "../src", p), "utf8");
const edit = async (testId: string, cookie: string, extra: Record<string, unknown>) =>
  act(testId, "edit", cookie, { version: (await db.test.findUniqueOrThrow({ where: { id: testId } })).version, fields: {}, seenAt: seen(), confirmed: true, ...extra });

describe("the Free box (section 19)", () => {
  it("works out added and deleted lines against the keys the page LOADED; red lines and warning-only lines", () => {
    const data: KeysData = {
      free: [], open: 2, uses: true,
      inUse: [
        { id: "1", value: "HR-1111", broken: false, tester: "Ana Silva", contractId: "a" },
        { id: "2", value: "HR-2222", broken: true, tester: "Ben Okafor", contractId: "b", gone: "left" },
        { id: "3", value: "HR-3333", broken: false, tester: "Cam Lee", contractId: "c", gone: "finished" },
        { id: "4", value: "HR-4444", broken: false, tester: "Dee Marsh", contractId: "d" },
      ],
    };
    // Loaded with HR-4444 and HR-5555 free; HR-4444 was given to Dee since; the developer deleted it and typed three keys.
    const r = freeBoxCheck("HR-5555\nHR-1111\nHR-2222\nHR-3333\nHR-6666", ["HR-4444", "HR-5555"], data);
    expect(r.added).toEqual(["HR-1111", "HR-2222", "HR-3333", "HR-6666"]);
    expect(r.removed).toEqual(["HR-4444"]);
    // (Batch 16 section 20) HR-4444, deleted here and given to Dee meanwhile, is no red mistake (the page shows a blue warning instead).
    expect(r.errors).toEqual(["HR-1111 is in use by Ana Silva, so it can't be added."]);
    expect(r.warnings).toEqual(["HR-2222: reported as broken by Ben Okafor.", "HR-3333: reused, previously given to Cam Lee."]);
    expect(freeBoxCheck("A\nA", [], data).errors[0]).toMatch(/typed more than once/);
    expect(keyRefusal("HR-9", "held", { working: false, name: "Ben" })).toBe("");
    expect(keyRefusal("HR-9", "broken", { working: true, name: "Ben Okafor" })).toBe("HR-9 is in use by Ben Okafor, so it can't be added.");
    expect(reusedKeyLine("HR-3333", "Ben Okafor", false)).toBe("HR-3333: reused, previously given to Ben Okafor.");
    expect(FREE_KEYS_RULE).toBe("Keys in use can't be added. Keys from testers who left or finished can be typed in again; you'll see if one was reported as broken.");
    expect(src("app/app/tests/TestForm.tsx")).toContain("keysAdd: fb.added, keysRemove: fb.removed");
  });

  it("every key a refusal calls 'in use' is listed under In use; a key of a tester who left shows greyed '(left)' and can be typed back, broken or not", async () => {
    const { dev, testId } = await setup({ spots: 3, accessKeys: "K1\nK2\nK3\nK4" });
    const a = await joined(testId, "Ana Silva"); // K1
    const b = await joined(testId, "Ben Okafor"); // K2
    await sact(b.sessionId, "key-broken", b.tester.cookie, { seenAt: seen() });
    let k = await keyBoxes(testId);
    expect(k.inUse.filter((x) => !x.gone).map((x) => x.value)).toEqual(["K1", "K2"]);
    const refused = await edit(testId, dev.cookie, { keysAdd: ["K1"] });
    expect(refused.body.error.errors[0]).toBe("K1 is in use by Ana Silva, so it can't be added.");
    await sact(a.sessionId, "leave", a.tester.cookie, { seenAt: seen() });
    await sact(b.sessionId, "leave", b.tester.cookie, { seenAt: seen() });
    k = await keyBoxes(testId);
    expect(k.inUse.map((x) => [x.value, x.gone])).toEqual([["K1", "left"], ["K2", "left"]]);
    expect((await edit(testId, dev.cookie, { keysAdd: ["K1", "K2"] })).status).toBe(200);
    k = await keyBoxes(testId);
    expect(k.free.filter((x) => x.reused).map((x) => [x.value, x.reused])).toEqual([["K1", { from: "Ana Silva", broken: false }], ["K2", { from: "Ben Okafor", broken: true }]]);
    expect(src("app/app/tests/[id]/KeysNotice.tsx")).toContain('`${k.value} · ${k.reused.broken ? "reported as broken" : "reused"} (${k.reused.from})`');
  });
});

describe("the broken-key warning (section 45)", () => {
  it("lists current working testers' broken keys; Dismiss hides one; Works now clears the mark, and the tester's next press stops once even with Alerts Off", async () => {
    const { dev, testId } = await setup({ spots: 3, accessKeys: "K1\nK2\nK3" });
    const a = await joined(testId, "Ana Silva");
    const b = await joined(testId, "Ben Okafor");
    await sact(a.sessionId, "key-broken", a.tester.cookie, { seenAt: seen() });
    await sact(b.sessionId, "key-broken", b.tester.cookie, { seenAt: seen() });
    let k = await keyBoxes(testId);
    expect(k.broken.map((x) => `${x.tester} · ${x.value}`)).toEqual(["Ana Silva · K1", "Ben Okafor · K2"]);
    const [ka, kb] = k.broken;
    await db.user.update({ where: { id: a.tester.user.id }, data: { testerAlertsOff: true } });
    const loaded = seen();
    await settle();
    expect((await act(testId, "keys-dismiss", dev.cookie, { keyIds: [ka.id, kb.id], worksNow: [ka.id] })).status).toBe(200);
    k = await keyBoxes(testId);
    expect(k.broken).toEqual([]);
    expect((await db.accessKey.findUniqueOrThrow({ where: { id: ka.id } })).status).toBe("inuse");
    expect((await db.accessKey.findUniqueOrThrow({ where: { id: kb.id } })).status).toBe("broken"); // only hidden
    // Ana's next press from her older page stops once, even with Alerts Off (it's her contract); no bell.
    const r = await sact(a.sessionId, "written", a.tester.cookie, { answers: ["x", "y"], seenAt: loaded });
    expect(r.body.error?.code).toBe("stop_once");
    expect(r.body.error.changes.map((c: { text: string }) => c.text)).toEqual(["The developer marked your key as working (K1)"]);
    expect(await db.notification.count({ where: { userId: a.tester.user.id, text: { contains: "marked your key" } } })).toBe(0);
    // She can report it again: the warning shows again.
    await sact(a.sessionId, "key-broken", a.tester.cookie, { seenAt: seen() });
    expect((await keyBoxes(testId)).broken.map((x) => x.value)).toEqual(["K1"]);
  });
});
