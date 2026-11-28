import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as claimPOST } from "@/app/api/page-claim/route";
import { POST as handoverPOST } from "@/app/api/page-handover/route";
import { POST as testAction } from "@/app/api/tests/[id]/[action]/route";
import { BUSY_STALE_MS, testScope } from "@/lib/pageClaim";
import { PREV_TAB_FOR_MS, PREV_TAB_KEY, notePageLeft, prevTab, resetSameTab } from "@/lib/sameTab";
import { json, req } from "./helpers";
import { seen, setup } from "./fixtures";

// (Owner, Nov 28) Edit's Save showed "Saving changes in other tab…" with "Open now", no other tab open: the Save marked the page busy (x-press), then loaded the
// page again (a full load: a new tab id), and the new load waited for the old one's "done", which never came. The same tab moving on never waits for itself;
// another tab still waits for a press on its way (§380 J).

const claim = (cookie: string, scope: string, tab: string, extra: Record<string, unknown> = {}) =>
  claimPOST(req("/api/page-claim", { cookie, body: { scope, ...extra }, headers: { "x-tab": tab } })).then(json);
const handover = (cookie: string, scope: string, tab: string, release = false) =>
  handoverPOST(req("/api/page-handover", { cookie, body: { scope, ...(release ? { release: true } : {}) }, headers: { "x-tab": tab } })).then(json);
/** Edit's Save from the copy holding the page: a press that locks it (x-press), so the holder is busy until it says "done". */
const save = async (testId: string, cookie: string, scope: string, tab: string) => {
  const version = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
  return testAction(
    req(`/api/tests/${testId}/edit`, { cookie, body: { version, fields: { title: "Harbor Run 2" }, seenAt: seen(), confirmed: true, payRulesOk: true }, headers: { "x-tab": tab, "x-page": scope, "x-press": "1" } }),
    { params: Promise.resolve({ id: testId, action: "edit" }) },
  ).then(json);
};
const busy = async (userId: string, scope: string) => (await db.pageClaim.findUniqueOrThrow({ where: { userId_scope: { userId, scope } } })).busy;

describe("(owner, Nov 28) the same tab never waits for itself after a press that loads the page again", () => {
  it("Edit's Save, then the page loads again in the same tab (a new tab id naming the old one): claimed at once, no waiting", async () => {
    const { dev, testId } = await setup();
    const scope = testScope(testId);
    expect((await claim(dev.cookie, scope, "load1")).body).toEqual({ claimed: true });
    expect((await save(testId, dev.cookie, scope, "load1")).status).toBe(200);
    expect(await busy(dev.user.id, scope)).toBe(true); // the old load never says "done": it's gone
    // The bug: without `prev`, the new load waited for the old one ("Saving changes in other tab…").
    expect((await claim(dev.cookie, scope, "load2")).body.waiting).toBe(true);
    // The fix: the new load names the load this tab showed before, which still holds the page.
    expect((await claim(dev.cookie, scope, "load2", { prev: "load1" })).body).toEqual({ claimed: true });
    expect(await busy(dev.user.id, scope)).toBe(false);
    // The old load no longer holds it.
    expect((await handover(dev.cookie, scope, "load1")).body).toEqual({ moved: true });
  });

  it("the guard: a different tab (or device) while the holder's press is on its way still waits, whatever `prev` it names that isn't the holder", async () => {
    const { dev, testId } = await setup();
    const scope = testScope(testId);
    await claim(dev.cookie, scope, "holder");
    expect((await save(testId, dev.cookie, scope, "holder")).status).toBe(200);
    expect((await claim(dev.cookie, scope, "other")).body.waiting).toBe(true);
    expect((await claim(dev.cookie, scope, "other", { prev: "someone-else" })).body.waiting).toBe(true);
    expect((await claim(dev.cookie, scope, "other", { prev: "" })).body.waiting).toBe(true);
    // The holder's press over: it hands over as before (§380 J).
    expect((await handover(dev.cookie, scope, "holder")).body).toEqual({ wanted: true });
    expect((await handover(dev.cookie, scope, "holder", true)).status).toBe(200);
    expect((await claim(dev.cookie, scope, "other")).body).toEqual({ claimed: true });
  });

  it("a copy going away after its press answered lets go of its busy mark (release): another tab then opens at once", async () => {
    const { dev, testId } = await setup();
    const scope = testScope(testId);
    await claim(dev.cookie, scope, "old");
    await save(testId, dev.cookie, scope, "old");
    expect((await handover(dev.cookie, scope, "old", true)).status).toBe(200); // OnePage's pagehide
    expect(await busy(dev.user.id, scope)).toBe(false);
    expect((await claim(dev.cookie, scope, "other")).body).toEqual({ claimed: true });
  });
});

describe("(owner, Nov 28) lib/sameTab: the load this tab showed before", () => {
  const storage = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
  };

  it("named as the old load goes (pagehide), read once by the next load, then gone (a tab duplicated later finds nothing)", () => {
    resetSameTab();
    const s = storage();
    notePageLeft(s, "old", 1_000);
    expect(JSON.parse(s.m.get(PREV_TAB_KEY)!)).toEqual({ tab: "old", at: 1_000 });
    resetSameTab(); // the next load
    expect(prevTab(s, "new", 2_000)).toBe("old");
    expect(s.m.has(PREV_TAB_KEY)).toBe(false);
    expect(prevTab(s, "new", 3_000)).toBe("old"); // the same page asking again (a second claim, Open now)
    const dup = storage(); // Chrome's Duplicate tab copies sessionStorage: the note is already gone
    resetSameTab();
    expect(prevTab(dup, "dup", 3_000)).toBe("");
  });

  it("never this load itself (Back to it from the browser's memory), never an old note", () => {
    const s = storage();
    notePageLeft(s, "same", 1_000);
    expect(prevTab(s, "same", 1_500)).toBe("");
    resetSameTab();
    notePageLeft(s, "old", 1_000);
    resetSameTab();
    expect(prevTab(s, "new", 1_000 + PREV_TAB_FOR_MS)).toBe("");
    expect(PREV_TAB_FOR_MS).toBe(BUSY_STALE_MS);
    resetSameTab();
    expect(prevTab(null, "new", 1_000)).toBe(""); // storage blocked
    s.setItem(PREV_TAB_KEY, "not json");
    resetSameTab();
    expect(prevTab(s, "new", 1_000)).toBe("");
  });
});
