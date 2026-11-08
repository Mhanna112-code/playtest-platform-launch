import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { keyBoxes } from "@/lib/server/accessKeys";
import { FREE_KEYS_RULE, keyRefusal, reusedKeyLine } from "@/lib/keys";
import { freeBoxCheck, type KeysData } from "@/app/app/tests/KeyBoxes";
import { act, joined, sact, seen, setup } from "./fixtures";

// Batch 15 sections 19 and 44: Edit's Free keys as one text box, keys typed back from testers who left or finished. (Owner, Nov 6, §304) Section 45's
// broken-key warning and "This key doesn't work" are gone (tests/no-key-report-304.test.ts); a key stored as "broken" before then is an ordinary key.
const src = (p: string) => fs.readFileSync(path.resolve(__dirname, "../src", p), "utf8");
const edit = async (testId: string, cookie: string, extra: Record<string, unknown>) =>
  act(testId, "edit", cookie, { version: (await db.test.findUniqueOrThrow({ where: { id: testId } })).version, fields: {}, seenAt: seen(), confirmed: true, ...extra });

describe("the Free box (section 19)", () => {
  it("works out added and deleted lines against the keys the page LOADED; red lines and warning-only lines", () => {
    const data: KeysData = {
      free: [], open: 2, uses: true,
      inUse: [
        { id: "1", value: "HR-1111", tester: "Ana Silva", contractId: "a" },
        { id: "2", value: "HR-2222", tester: "Ben Okafor", contractId: "b", gone: "left" },
        { id: "3", value: "HR-3333", tester: "Cam Lee", contractId: "c", gone: "finished" },
        { id: "4", value: "HR-4444", tester: "Dee Marsh", contractId: "d" },
      ],
    };
    // Loaded with HR-4444 and HR-5555 free; HR-4444 was given to Dee since; the developer deleted it and typed three keys.
    const r = freeBoxCheck("HR-5555\nHR-1111\nHR-2222\nHR-3333\nHR-6666", ["HR-4444", "HR-5555"], data);
    expect(r.added).toEqual(["HR-1111", "HR-2222", "HR-3333", "HR-6666"]);
    expect(r.removed).toEqual(["HR-4444"]);
    // (Batch 16 section 20) HR-4444, deleted here and given to Dee meanwhile, is no red mistake (the page shows a blue warning instead).
    expect(r.errors).toEqual(["HR-1111 is in use by Ana Silva, so it can't be added."]);
    expect(r.warnings).toEqual(["HR-2222: reused, previously given to Ben Okafor.", "HR-3333: reused, previously given to Cam Lee."]);
    expect(freeBoxCheck("A\nA", [], data).errors[0]).toMatch(/typed more than once/);
    expect(keyRefusal("HR-9", "held", { working: false, name: "Ben" })).toBe("");
    expect(keyRefusal("HR-9", "broken", { working: true, name: "Ben Okafor" })).toBe("HR-9 is in use by Ben Okafor, so it can't be added.");
    expect(reusedKeyLine("HR-3333", "Ben Okafor")).toBe("HR-3333: reused, previously given to Ben Okafor.");
    expect(FREE_KEYS_RULE).toBe("Keys in use can't be added. When a tester leaves or their work ends, their key is unassigned, not returned to Free. Add it to Free yourself to reuse it. Assigned keys stay in Terms history.");
    expect(src("app/app/tests/TestForm.tsx")).toContain("keysAdd: fb.added, keysRemove: fb.removed");
  });

  it("every key a refusal calls 'in use' is listed under In use; a key of a tester who left returns to Free (one stored as \"broken\" too)", async () => {
    const { dev, testId } = await setup({ spots: 3, accessKeys: "K1\nK2\nK3\nK4" });
    const a = await joined(testId, "Ana Silva"); // K1
    const b = await joined(testId, "Ben Okafor"); // K2
    await db.accessKey.updateMany({ where: { testId, value: "K2" }, data: { status: "broken", brokenAt: new Date() } }); // reported before §304
    let k = await keyBoxes(testId);
    expect(k.inUse.filter((x) => !x.gone).map((x) => x.value)).toEqual(["K1", "K2"]);
    const refused = await edit(testId, dev.cookie, { keysAdd: ["K1"] });
    expect(refused.body.error.errors[0]).toBe("K1 is in use by Ana Silva, so it can't be added.");
    await sact(a.sessionId, "leave", a.tester.cookie, { seenAt: seen() });
    await sact(b.sessionId, "leave", b.tester.cookie, { seenAt: seen() });
    k = await keyBoxes(testId);
    expect(k.inUse).toEqual([]);
    expect(k.free.map((x) => x.value)).toEqual(["K3", "K4"]);
    expect((await edit(testId, dev.cookie, { keysAdd: ["K1", "K2"] })).status).toBe(200);
    k = await keyBoxes(testId);
    expect(k.free.filter((x) => x.reused).map((x) => [x.value, x.reused])).toEqual([["K1", { from: "Ana Silva" }], ["K2", { from: "Ben Okafor" }]]);
    expect(src("app/app/tests/[id]/KeysNotice.tsx")).toContain("`${k.value} · reused (${k.reused.from})`");
  });
});
