import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { givenDeletedLine, keyGivenLine, keysAddedLine, keysRemovedLine } from "@/lib/keys";
import { act, joined, settle, setup } from "./fixtures";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FieldNote, shortLine } from "@/components/FieldNote";

// The components are compiled for the browser's JSX runtime; rendering them here needs React in scope.
(globalThis as unknown as { React: typeof React }).React = React;
// Batch 16 sections 17, 18 and 19: Edit and another tab's save. The same value is no note and no stop; keys are grouped; notes say what they replaced.
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const dollars = (c: number | null) => (c == null ? null : (c / 100).toFixed(2));

/** What a tab's form holds, as the API takes it (TestForm's toApi). */
async function formOf(testId: string, over: Record<string, unknown> = {}) {
  const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
  return {
    productName: t.productName, title: t.title, description: t.description, buildUrl: t.buildUrl, categories: t.categories, devices: t.devices, languages: t.languages,
    mature: t.mature, matureWhy: t.mature ? t.matureWhy : "", ndaText: t.ndaText, spots: String(t.spots), deadlineDays: String(t.deadlineDays),
    writtenCents: dollars(t.writtenCents), recordingCents: dollars(t.recordingCents), liveRateCents: dollars(t.liveRateCents), liveMinutes: null,
    writtenRequired: t.writtenCents != null && t.writtenRequired, recordingRequired: t.recordingCents != null && t.recordingRequired, liveRequired: t.liveRateCents != null && t.liveRequired,
    questions: t.questions as string[], openUntil: t.openUntil ? t.openUntil.toISOString().slice(0, 10) : "", joinMode: t.joinMode, ...over,
  };
}
const freeKeys = async (testId: string) => (await db.accessKey.findMany({ where: { testId, status: "free" }, orderBy: { createdAt: "asc" } })).map((k) => k.value);

/** Tab A opens Edit (what it loaded), tab B saves, then tab A presses Save. */
async function twoTabs(over: Record<string, unknown> = {}) {
  const { dev, testId } = await setup({ accessKeys: "K1\nK2\nK3", spots: 3, ...over });
  const t0 = await db.test.findUniqueOrThrow({ where: { id: testId } });
  const loaded = { version: t0.version, seenAt: new Date().toISOString(), base: await formOf(testId), keysLoaded: await freeKeys(testId) };
  await settle();
  const saveB = (fields: Record<string, unknown>, keys: { keysAdd?: string[]; keysRemove?: string[] } = {}) =>
    act(testId, "edit", dev.cookie, { version: t0.version, fields, seenAt: new Date().toISOString(), confirmed: true, tab: "tab-B", ...keys });
  const saveA = async (fields: Record<string, unknown>, has: Record<string, unknown>, keys: { keysAdd?: string[]; keysRemove?: string[]; confirmed?: boolean; boxAt?: string; keysLoaded?: string[] } = {}) =>
    act(testId, "edit", dev.cookie, { version: loaded.version, fields, seenAt: loaded.seenAt, tab: "tab-A", base: loaded.base, has: { ...loaded.base, ...has }, keysLoaded: keys.keysLoaded ?? loaded.keysLoaded, keysAdd: keys.keysAdd ?? [], keysRemove: keys.keysRemove ?? [], ...(keys.confirmed ? { confirmed: true, boxAt: keys.boxAt } : {}) });
  return { dev, testId, saveA, saveB };
}

describe("another tab saved the same value: no note, no stop (section 17)", () => {
  it("the same value typed in both tabs: Save goes straight through", async () => {
    const { testId, saveA, saveB } = await twoTabs();
    expect((await saveB({ description: "Sail through all three reefs." })).status).toBe(200);
    const r = await saveA({ description: "Sail through all three reefs.", spots: "3" }, { description: "Sail through all three reefs." });
    expect(r.status).toBe(200);
    expect((await db.test.findUniqueOrThrow({ where: { id: testId } })).description).toBe("Sail through all three reefs.");
  });

  it("a different value: a stop that names the field; (batch 23 section 5) one line per typed field, \"your version will replace the one saved in another tab\"", async () => {
    const { saveA, saveB } = await twoTabs();
    expect((await saveB({ description: "Sail through all three reefs." })).status).toBe(200);
    const r = await saveA({ description: "Only the first reef." }, { description: "Only the first reef." });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("changed");
    const lines = r.body.error.changes as { text: string; fields?: string[] }[];
    expect(lines.map((l) => l.text)).toEqual(["Instructions: your version will replace the one saved in another tab"]);
    expect(lines[0]).toMatchObject({ fields: ["description"], kind: "yours" });
    // (Batch 23 section 5) Untouched here: the field took the other tab's value silently, and this Save (which doesn't send it) never undoes it: no stop.
    const { testId: t2, saveA: a2, saveB: b2 } = await twoTabs();
    expect((await b2({ description: "Sail on." })).status).toBe(200);
    expect((await a2({ spots: "3" }, {})).status).toBe(200);
    expect((await db.test.findUniqueOrThrow({ where: { id: t2 } })).description).toBe("Sail on.");
  });

  it("mixed: only the field this tab doesn't have is listed", async () => {
    const { saveA, saveB } = await twoTabs();
    expect((await saveB({ description: "Sail through all three reefs.", spots: "2" })).status).toBe(200);
    const r = await saveA({ description: "Sail through all three reefs." }, { description: "Sail through all three reefs." });
    expect(r.status).toBe(409);
    expect((r.body.error.changes as { text: string }[]).map((l) => l.text)).toEqual(["You changed the spots in another tab"]);
  });

  it("keys are the exception: every change elsewhere is listed, even one this tab also made; typed keys another tab added merge, no red (sections 17 and 18)", async () => {
    const lines = (r: { body: { error: { changes: { text: string }[] } } }) => r.body.error.changes.map((l) => l.text);
    // Added in B and typed in A too: listed under "Added", no "already in your free keys" mistake; the second press saves and each key is there once.
    let x = await twoTabs();
    expect((await x.saveB({}, { keysAdd: ["K8", "K9"] })).status).toBe(200);
    let r = await x.saveA({}, {}, { keysAdd: ["K8", "K9"] });
    expect(r.status).toBe(409);
    expect(r.body.error.errors).toEqual([]);
    expect(lines(r)).toEqual([keysAddedLine(["K8", "K9"])]);
    // The page shows the newer keys with the box, so the second press counts from them.
    expect((await x.saveA({}, {}, { keysAdd: ["K8", "K9"], confirmed: true, boxAt: r.body.error.now ?? new Date().toISOString(), keysLoaded: r.body.error.keys.free })).status).toBe(200);
    expect(await freeKeys(x.testId)).toEqual(["K1", "K2", "K3", "K8", "K9"]);
    // Added in B only: "Added: K8, K9".
    x = await twoTabs();
    expect((await x.saveB({}, { keysAdd: ["K8", "K9"] })).status).toBe(200);
    r = await x.saveA({ description: "Sail on." }, { description: "Sail on." });
    expect(r.status).toBe(409);
    expect(lines(r)).toEqual([keysAddedLine(["K8", "K9"])]);
    // Removed in B: "Removed: K3", whether or not A removed it too.
    x = await twoTabs();
    expect((await x.saveB({ spots: "2" }, { keysRemove: ["K3"] })).status).toBe(200);
    r = await x.saveA({}, { spots: "2" });
    expect(lines(r)).toEqual([keysRemovedLine(["K3"])]);
    x = await twoTabs();
    expect((await x.saveB({ spots: "2" }, { keysRemove: ["K3"] })).status).toBe(200);
    r = await x.saveA({ spots: "2" }, { spots: "2" }, { keysRemove: ["K3"] });
    expect(lines(r)).toEqual([keysRemovedLine(["K3"])]);
  });

  it("(section 20) a key deleted here that a joining tester was given: one blue line, stacked for several; never red", async () => {
    expect(givenDeletedLine([{ name: "Ben Okafor", value: "K-2" }])).toBe("Ben Okafor joined and was given K-2, which you had deleted here.");
    expect(givenDeletedLine([{ name: "Ben Okafor", value: "K-2" }, { name: "Cam Lee", value: "K-3" }])).toBe("Ben Okafor and Cam Lee joined and were given K-2 and K-3, which you had deleted here.");
    const x = await twoTabs();
    await joined(x.testId, "Ben Okafor", "he");
    await joined(x.testId, "Cam Lee", "he");
    // Tab A had deleted the two keys the joining testers were given (unsaved).
    const given = await db.accessKey.findMany({ where: { testId: x.testId, status: "inuse" }, include: { contract: { include: { tester: true } } }, orderBy: { assignedAt: "asc" } });
    expect(given.length).toBe(2);
    const r = await x.saveA({}, {}, { keysRemove: given.map((k) => k.value) });
    expect(r.status).toBe(409);
    expect(r.body.error.errors).toEqual([]);
    const line = (r.body.error.changes as { text: string }[]).map((l) => l.text).find((t) => t.includes("which you had deleted here"));
    expect(line).toMatch(/^(Ben Okafor and Cam Lee|Cam Lee and Ben Okafor) joined and were given K\d and K\d, which you had deleted here\.$/);
    // Live: the page drops the key from its pending deletions with the line (no red); the Free box check no longer has that mistake.
    const form = src("app/app/tests/TestForm.tsx");
    expect(form).toContain("const deletedHere = joined.filter((v) => mine.removed.includes(v));");
    expect(form).toContain("givenDeletedLine(deletedHere.map((v) => ({ name: givenTo(v)!, value: v })))");
    expect(form).toContain("live.current.applyKeys({ free: r.keys.free.map((k) => k.value), inUse: r.keys.inUse }, r.at);");
    expect(src("app/app/tests/KeyBoxes.tsx")).not.toContain("was given to a tester since you opened this page");
  });

  it("a page that doesn't say what it loaded and holds keeps today's stop", async () => {
    const { dev, testId } = await setup();
    const t0 = await db.test.findUniqueOrThrow({ where: { id: testId } });
    const seenAt = new Date().toISOString();
    await settle();
    expect((await act(testId, "edit", dev.cookie, { version: t0.version, fields: { description: "B" }, seenAt: new Date().toISOString(), confirmed: true, tab: "tab-B" })).status).toBe(200);
    const r = await act(testId, "edit", dev.cookie, { version: t0.version, fields: { description: "B" }, seenAt, tab: "tab-A" });
    expect(r.status).toBe(409);
  });
});

describe("the notes under Edit's fields and in Save's stop box (sections 17-19)", () => {
  it("grouped key lines; joins their own line", () => {
    expect(keysAddedLine(["HR-8888", "HR-9999", "HR-7777"])).toBe("Added: HR-8888, HR-9999, HR-7777");
    expect(keysRemovedLine(["HR-5555"])).toBe("Removed: HR-5555");
    expect(keyGivenLine("Ana Silva", "HR-4444")).toBe("Ana Silva joined and was given HR-4444");
    const form = src("app/app/tests/TestForm.tsx");
    expect(form).not.toMatch(/added in another tab|is no longer free/);
    // Always listed (the owner's exception to section 17): no filtering by what this tab also did.
    expect(form).toContain("const addedElse = nowFree.filter((v) => !freeLoaded.includes(v));");
    expect(form).toContain("...(addedElse.length ? [keysAddedLine(addedElse)] : [])");
    expect(form).toContain("...(removed.length ? [keysRemovedLine(removed)] : [])");
    expect(form).toContain("joinedOnly.map((v) => keyGivenLine(givenTo(v)!, v))");
  });

  it("same value: the base moves with no note; (batch 23 section 5: spots and Open until) a different one names the field and what it replaced; What you typed (not saved) in full with Copy", () => {
    const form = src("app/app/tests/TestForm.tsx");
    expect(src("lib/editMerge.ts")).toContain("settled.push(k); // this tab already has it: not news");
    expect(form).toContain("const m = mergeElsewhere(f, base, now);");
    expect(form).toContain("before: valueText(k, base[k]), after: valueText(k, now[k]), ...(typed ? { typed: valueText(k, f[k]) } : {})");
    expect(form).not.toMatch(/slice\(0, 80\)|the newer value is kept|"now: |`now /);
    expect(form).toContain('spots: "Spots"');
    expect(form).toContain('writtenPrice: "Price for written answers"');
    expect(form).toContain('description: "Instructions"');
    expect(form).toContain("base: toApi(seenBase.current), has: toApi(holding()), keysLoaded: keysSeen.current");
    expect(form).toContain("<ChangesBox changes={changes} detail={stopDetail}");
    expect(src("components/ChangesBox.tsx")).toContain('data-stop-detail=""');
  });

  it("(section 19) a short field on one line: \"Spots: 4 → 5\"", () => {
    expect(shortLine({ name: "Spots", before: "4", after: "5" })).toBe("Spots: 4 → 5");
    expect(shortLine({ name: "Price for written answers", before: "$8.00", after: "$10.00" })).toBe("Price for written answers: $8.00 → $10.00");
    expect(shortLine({ name: "Devices", before: "Windows PC", after: "Windows PC, iPad" })).toBe("Devices: Windows PC → Windows PC, iPad");
    const html = renderToStaticMarkup(createElement(FieldNote, { label: "Changed in another tab or device at 7:16 AM", items: [{ name: "Spots", before: "4", after: "5" }] }));
    expect(html).toContain("Changed in another tab or device at 7:16 AM: Spots: 4 → 5");
    expect(html).not.toMatch(/now:|Before:/);
  });

  it("(section 19) a 20,000-character field: \"Instructions:\" and the text it replaced, folded (3 lines, Show more), kept whole; typed text in full with Copy", () => {
    const long = "Sail to the reef and back. ".repeat(800).slice(0, 20_000);
    const typed = "Only the first reef. ".repeat(500);
    const html = renderToStaticMarkup(createElement(FieldNote, { label: "Changed in another tab or device at 7:16 AM", items: [{ name: "Instructions", before: long, after: "Sail on.", typed }] }));
    expect(html).toContain("Changed in another tab or device at 7:16 AM:</p>");
    expect(html).toContain("<b>Instructions:</b>");
    expect(html).toContain('data-fold-text="closed"');
    expect(html).toContain("line-clamp-3");
    expect(html).toContain(">Show more</button>");
    expect(html).toContain(long); // never cut
    expect(html).toContain("<b>What you typed (not saved):</b>");
    expect(html).toContain('data-copy-typed=""');
    expect(html).toContain(typed.trim().slice(0, 200));
    // The questions: a list, 3 then "+N more".
    const qs = renderToStaticMarkup(createElement(FieldNote, { label: "Changed in another tab or device at 7:16 AM", items: [{ name: "Questions", before: ["A?", "B?", "C?", "D?", "E?"], after: ["A?"] }] }));
    expect(qs).toContain("<b>Questions:</b>");
    expect(qs).toContain("+2 more");
    expect(src("components/FieldNote.tsx")).toContain("max-h-48 overflow-y-auto");
  });
});
