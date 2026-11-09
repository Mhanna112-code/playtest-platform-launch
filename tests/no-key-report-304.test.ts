import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { assignKeyAtJoin, keyBoxes, keyOf } from "@/lib/server/accessKeys";
import { ALERTS_OFF_KINDS, CONTRACT_KINDS, testerChanges } from "@/lib/server/testerGate";
import { DEV_QUIET_KINDS, WORK_OVER_ACTIONS } from "@/lib/rules";
import { pressLabelOf } from "@/lib/pressLabels";
import { FREE_KEYS_HINT, reusedKeyLine } from "@/lib/keys";
import { act, joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 6, §304) The "This key doesn't work" feature is gone: a tester whose key fails tells the developer in chat, and the developer deletes a free key in
// Edit and sends it in a message. Keys given, free keys and Edit's key rules stay; the "broken" status and its columns stay in the database, unused.
const src = (p: string) => fs.readFileSync(path.resolve(__dirname, "../src", p), "utf8");
const exists = (p: string) => fs.existsSync(path.resolve(__dirname, "../src", p));

describe("§304: no report button or route", () => {
  it("the tester's key box has the key, Copy and the new-key line only", () => {
    const box = src("app/app/sessions/[id]/KeyBox.tsx");
    for (const gone of ["This key doesn&apos;t work", "key-broken", "Marked as not working", "line-through", "marked your key as working", "ChangesBox", "usePress"]) expect(box, gone).not.toContain(gone);
    for (const kept of ["Your access key:", 'data-key-copy=""', "The developer gave you a new access key."]) expect(box, kept).toContain(kept);
    expect(src("app/app/sessions/[id]/page.tsx")).toContain("<KeyBox value={key.value} fresh={!!freshKey} />");
  });

  it("the server has no key-broken or keys-dismiss action; the press names and the work-over list drop them", async () => {
    expect(src("app/api/sessions/[id]/[action]/route.ts")).not.toContain('"key-broken"');
    expect(src("app/api/tests/[id]/[action]/route.ts")).not.toContain('"keys-dismiss"');
    const keys = src("lib/server/accessKeys.ts");
    for (const gone of ["reportKeyBroken", "dismissBrokenKeys", "heldBrokenKey", "keyReportedLine", "keyFixedLine", "bell("]) expect(keys, gone).not.toContain(gone);
    expect(WORK_OVER_ACTIONS as readonly string[]).not.toContain("key-broken");
    expect(pressLabelOf("/api/sessions/s1/key-broken")).toBe("press");
    const { dev, testId } = await setup({ spots: 3, accessKeys: "K1\nK2\nK3" });
    const a = await joined(testId, "Ana Silva");
    const since = new Date();
    await settle();
    expect((await sact(a.sessionId, "key-broken", a.tester.cookie, { seenAt: seen() })).status).toBe(404);
    const k = (await keyOf(a.sessionId))!;
    expect(k.status).toBe("inuse");
    expect((await act(testId, "keys-dismiss", dev.cookie, { keyIds: [k.id], worksNow: [k.id] })).status).toBe(404);
    // No event, no bell for either side.
    expect(await db.testEvent.count({ where: { testId, kind: "key", createdAt: { gt: since } } })).toBe(0);
    expect(await db.notification.count({ where: { userId: { in: [dev.user.id, a.tester.user.id] }, OR: [{ text: { contains: "key doesn't work" } }, { text: { contains: "marked your key" } }] } })).toBe(0);
    // The developer's quiet kinds and the join page's "does your old key work again?" tick are gone too.
    expect(DEV_QUIET_KINDS as readonly string[]).not.toContain("key");
    expect(src("app/app/find/[id]/JoinBox.tsx")).not.toContain("keyStillWorks");
    expect(src("app/app/find/[id]/JoinBox.tsx")).not.toContain("works again");
  });
});

describe("§304: no keys-not-working box", () => {
  it("KeysWarning is gone; the Access keys notice and Edit's In use cross nothing out and count no broken keys", () => {
    expect(exists("app/app/tests/[id]/KeysWarning.tsx")).toBe(false);
    const notice = src("app/app/tests/[id]/KeysNotice.tsx");
    for (const gone of ["KeysWarning", "keys.broken", "line-through", "doesn't work (", "reported as broken", "not working"]) expect(notice, gone).not.toContain(gone);
    // The advice stays: delete a free key in Edit and send it in a message.
    expect(FREE_KEYS_HINT.join("")).toBe("If a tester's key doesn't work, delete a free key in Edit and send it to them in a message.");
    expect(notice).toContain("FREE_KEYS_HINT");
    const edit = src("app/app/tests/KeyBoxes.tsx");
    for (const gone of ["line-through", "not working", "k.broken"]) expect(edit, gone).not.toContain(gone);
  });
});

describe("§304: a key with the old broken status shows as normal", () => {
  it("in the developer's lists, the tester's page, a reuse and a rejoin", async () => {
    const { dev, testId } = await setup({ spots: 3, accessKeys: "K1\nK2\nK3" });
    const a = await joined(testId, "Ana Silva");
    const b = await joined(testId, "Ben Okafor", "he");
    // Reported before §304 (and once marked as working: fixedAt).
    await db.accessKey.updateMany({ where: { testId, value: "K1" }, data: { status: "broken", brokenAt: new Date() } });
    const loaded = new Date(Date.now() - 1000);
    await db.accessKey.updateMany({ where: { testId, value: "K2" }, data: { fixedAt: new Date() } });
    const boxes = await keyBoxes(testId);
    expect(boxes).not.toHaveProperty("broken");
    expect(boxes.inUse.filter((k) => !k.gone).map((k) => [k.value, k.tester])).toEqual([["K1", "Ana Silva"], ["K2", "Ben Okafor"]]);
    for (const k of boxes.inUse) expect(k).not.toHaveProperty("broken");
    // Her session page still shows it (with Copy), and still in use: it can't be typed into Free.
    expect((await keyOf(a.sessionId))?.value).toBe("K1");
    const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    const refused = await act(testId, "edit", dev.cookie, { version: v, fields: {}, seenAt: seen(), confirmed: true, keysAdd: ["K1"] });
    expect(refused.body.error.errors[0]).toBe("K1 is in use by Ana Silva, so it can't be added.");
    // An old "fixed" mark never makes a top-box line or a stop.
    expect((await testerChanges(b.tester.user.id, b.sessionId, testId, loaded)).some((e) => e.kind === "keyfixed")).toBe(false);
    // (Owner, Nov 9, §344) Coming back, she gets the next FREE key (K3): her old key was unassigned when she left (not returned to Free); no "does it work
    // again?" question, nothing retired.
    await db.contract.update({ where: { id: a.sessionId }, data: { status: "left" } });
    expect(await assignKeyAtJoin(db, testId, a.sessionId)).toBe("K3");
    expect((await db.accessKey.findFirstOrThrow({ where: { testId, value: "K3" } })).status).toBe("inuse");
    expect((await db.accessKey.findFirstOrThrow({ where: { testId, value: "K1" } })).status).toBe("unassigned");
    expect(await db.accessKey.count({ where: { testId, status: "retired" } })).toBe(0);
    // Typed back into Free after its tester left: a plain reuse warning.
    expect(reusedKeyLine("K1", "Ana Silva")).toBe("K1: reused, previously given to Ana Silva.");
  });
});

describe("§304: the Alerts-off hint without the key", () => {
  it("names only new terms and what you did in another tab", () => {
    expect(src("components/TesterAlertsToggle.tsx")).toContain('export const ALERTS_OFF_LINE = "Stops a press only for: new terms, and what you did in another tab.";');
    expect(src("components/QuickIgnore.tsx")).toContain("New terms from the developer and what you did in another tab still stop.");
    expect(src("components/QuickIgnore.tsx")).not.toContain("key marked as working");
  });
});

describe("§304: keyfixed is gone from the stop kinds", () => {
  it("CONTRACT_KINDS, ALERTS_OFF_KINDS and the gate's kinds", () => {
    expect([...CONTRACT_KINDS]).toEqual(["terms"]);
    expect([...ALERTS_OFF_KINDS].sort()).toEqual(["own", "terms"]);
    const gate = src("lib/server/testerGate.ts");
    expect(gate).not.toContain('"keyfixed"');
    expect(gate).toContain('[...KINDS, "renamed", "keygiven"]');
    expect(src("components/ChangesBox.tsx")).not.toContain('c.kind !== "keyfixed"');
  });
});
