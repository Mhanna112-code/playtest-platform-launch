import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { GET as liveGET } from "@/app/api/live/route";
import { LISTING_SAVED, parseSaved } from "@/lib/listingPanel";
import { hasSaveLine } from "@/lib/server/live";
import { json, req } from "./helpers";
import { act, seen, setup } from "./fixtures";

// Batch 35 §17 (seen once on video, Oct 31): a rename saved in another tab showed twice on the developer's test page, in "You saved the listing in another tab:
// title (now “Harbor Run: night harbors”), …" AND as "You renamed the test to Harbor Run: night harbors". The Save's own line goes to the action log only after
// the Save's transaction (and its response); a live poll in that moment (the other tab's redraw asks at once) found the rename alone, and the live box keeps
// every line it got, so the next poll's Save line made two. The rename is now dropped from the Save's own record, which exists at once.

const later = () => new Promise((r) => setTimeout(r, 30));
const src = (p: string) => fs.readFileSync(path.resolve(__dirname, "../src", p), "utf8");
const edit = async (testId: string, cookie: string, fields: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
  const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
  return act(testId, "edit", cookie, { version: v, fields, confirmed: true, ...extra });
};
const live = async (cookie: string, testId: string, since: string, tab: string) => {
  await later();
  const r = await json(await liveGET(req(`/api/live?scope=${encodeURIComponent(`test:${testId}`)}&since=${encodeURIComponent(since)}`, { cookie, headers: { "x-tab": tab } })));
  return (r.body.changes as { text: string; at: string }[]).filter((c) => /renamed|saved the listing/.test(c.text));
};
/** What the developer's live box shows after these polls (LiveTop keeps every line it got, by time and text). */
const kept = (...polls: { text: string; at: string }[][]) => [...new Map(polls.flat().map((c) => [`${c.at}|${c.text}`, c.text])).values()];

/** The moment between the Save's transaction and its action log line: the line taken away, then put back as it was. */
async function withoutSaveLine(testId: string, tab: string, during: () => Promise<void>) {
  const row = await db.actionLog.findFirstOrThrow({ where: { testId, tab }, orderBy: { createdAt: "desc" } });
  await db.actionLog.delete({ where: { id: row.id } });
  await during();
  await db.actionLog.create({ data: row });
}

describe("batch 35 §17: one save, one line (a rename saved with other fields in another tab)", () => {
  it("a poll before the Save's line is written doesn't show the rename alone; the box ends with ONE line", async () => {
    const { dev, testId } = await setup();
    await later();
    const pageLoaded = seen();
    await later();
    expect((await edit(testId, dev.cookie, { title: "Harbor Run: night harbors", description: "Sail at night" }, { tab: "tab-a" })).status).toBe(200);
    let early: { text: string; at: string }[] = [];
    await withoutSaveLine(testId, "tab-a", async () => {
      early = await live(dev.cookie, testId, pageLoaded, "tab-b");
      expect(early.map((c) => c.text)).not.toContain("You renamed the test to Harbor Run: night harbors");
    });
    const after = await live(dev.cookie, testId, pageLoaded, "tab-b");
    expect(after.map((c) => c.text)).toEqual(["You saved the listing in another tab: title (now “Harbor Run: night harbors”), description"]);
    expect(kept(early, after)).toEqual(["You saved the listing in another tab: title (now “Harbor Run: night harbors”), description"]);
    // A press in that moment: one stop line too.
    await withoutSaveLine(testId, "tab-a", async () => {
      const r = await act(testId, "next-round", dev.cookie, { seenAt: pageLoaded, tab: "tab-b" });
      expect((r.body.error?.changes ?? []).map((c: { text: string }) => c.text)).not.toContain("You renamed the test to Harbor Run: night harbors");
    });
  });

  it("a rename with the access keys: the same; the Save's record says the keys changed", async () => {
    const { dev, testId } = await setup({ spots: 3, accessKeys: ["K1", "K2", "K3"].join("\n") });
    await later();
    const pageLoaded = seen();
    await later();
    expect((await edit(testId, dev.cookie, { title: "Harbor Run: keys" }, { tab: "tab-a", keysAdd: ["K4"] })).status).toBe(200);
    const rec = await db.testEvent.findFirstOrThrow({ where: { testId, kind: LISTING_SAVED }, orderBy: { createdAt: "desc" } });
    expect(parseSaved(rec.text)).toMatchObject({ fields: ["title"], keys: true });
    expect(rec.tab).toBe("tab-a");
    let early: { text: string; at: string }[] = [];
    await withoutSaveLine(testId, "tab-a", async () => { early = await live(dev.cookie, testId, pageLoaded, "tab-b"); });
    const after = await live(dev.cookie, testId, pageLoaded, "tab-b");
    expect(kept(early, after)).toEqual(["You saved the listing in another tab: title (now “Harbor Run: keys”), access keys"]);
  });

  it("a rename alone is still its own line (the Save has no other line); the tab that saved never gets a second one", async () => {
    const { dev, testId } = await setup();
    await later();
    const pageLoaded = seen();
    await later();
    expect((await edit(testId, dev.cookie, { title: "Harbor Run 7" }, { tab: "tab-a" })).status).toBe(200);
    expect((await live(dev.cookie, testId, pageLoaded, "tab-b")).map((c) => c.text)).toEqual(["You renamed the test to Harbor Run 7"]);
    await later();
    const second = seen();
    await later();
    expect((await edit(testId, dev.cookie, { title: "Harbor Run 8", description: "Sail on" }, { tab: "tab-a" })).status).toBe(200);
    // The saving tab: its own Save is never a line there; the rename reads as before (one line).
    expect((await live(dev.cookie, testId, second, "tab-a")).map((c) => c.text)).toEqual(["You renamed the test to Harbor Run 8"]);
  });

  it("hasSaveLine: more than the title or the keys, from another tab", () => {
    const rec = (v: object, tab = "tab-a") => ({ text: JSON.stringify({ before: {}, after: {}, ...v }), tab });
    expect(hasSaveLine(rec({ fields: ["title", "description"] }), "tab-b")).toBe(true);
    expect(hasSaveLine(rec({ fields: ["title"], keys: true }), "tab-b")).toBe(true);
    expect(hasSaveLine(rec({ fields: ["title"] }), "tab-b")).toBe(false); // a rename alone: its own line
    expect(hasSaveLine(rec({ fields: ["title", "description"] }), "tab-a")).toBe(false); // the tab that saved
    expect(hasSaveLine(rec({ fields: ["title", "description"] }, ""), "")).toBe(false); // a page without a tab sees only rows with one
    expect(hasSaveLine(rec({ fields: ["title", "description"] }), "")).toBe(true);
    expect(hasSaveLine(undefined, "tab-b")).toBe(false);
    expect(src("lib/server/live.ts")).toContain("if (hasSaveLine(saves.find((x) => x.createdAt.getTime() <= e.createdAt.getTime()), tab)) return [];");
  });
});
