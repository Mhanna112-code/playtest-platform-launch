import fs from "node:fs";
import path from "node:path";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { asListing, devLine } from "@/lib/server/tests";
import { asLines, devChanges } from "@/lib/server/live";
import { lastListingSave } from "@/lib/server/listingPanel";
import { LISTING_SAVED, PANEL_ROWS, panelRows } from "@/lib/listingPanel";
import { ListingPanel } from "@/app/app/tests/[id]/ListingPanel";
import { ChangesBox, type Change } from "@/components/ChangesBox";
import { SeeItTarget } from "@/components/ListingInfo";
import { PopupStop } from "@/components/GapDialog";
import { act, joined, seen, settle, setup } from "./fixtures";

// Batch 34 §14 (owner, Oct 30; Codex task 10 done by Claude): the developer's test page Listing panel replaces Contract changes; every listing line in its blue boxes
// has See it to the panel; the join page's needs pop-up names the press and its listing lines have See it.

(globalThis as unknown as { React: typeof React }).React = React;

const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");

async function save(testId: string, cookie: string, fields: Record<string, unknown>, tab = "tab-edit") {
  const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
  const r = await act(testId, "edit", cookie, { version: t.version, fields, tab });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  await settle();
}
const rowsOf = async (testId: string) => panelRows(asListing(await db.test.findUniqueOrThrow({ where: { id: testId } })), await lastListingSave(testId));
const tagged = (rows: Awaited<ReturnType<typeof rowsOf>>) => rows.filter((r) => r.before != null).map((r) => r.key);

describe("batch 34 §14: the Listing panel", () => {
  it("shows every listing field; only the fields the MOST RECENT save changed carry Updated (Before / Now)", async () => {
    const { dev, testId } = await setup();
    // No save yet: every field, none tagged.
    const fresh = await rowsOf(testId);
    expect(fresh.map((r) => r.label)).toEqual(["Product", "Name", "What to do", "Questions", "Build link", "NDA", "Devices", "Languages", "Categories", "Mature (18+)", "Parts and prices", "Call rate", "Tester deadline", "Open until", "Who can join", "Spots"]);
    expect(tagged(fresh)).toEqual([]);

    await save(testId, dev.cookie, { description: "Sail to the second reef.", spots: "4", writtenCents: "12.00" });
    const ev = await db.testEvent.findFirstOrThrow({ where: { testId, kind: LISTING_SAVED }, orderBy: { createdAt: "desc" } });
    expect(JSON.parse(ev.text).fields.sort()).toEqual(["description", "spots", "writtenCents"]);
    const first = await rowsOf(testId);
    expect(tagged(first)).toEqual(["description", "parts", "spots"]);
    const d = first.find((r) => r.key === "description")!;
    expect([d.before, d.now]).toEqual(["Sail", "Sail to the second reef."]);
    expect(first.find((r) => r.key === "parts")!.before).toBe("Written answers: $10.00 · Not required\nScreen recording: Not listed");
    expect(first.find((r) => r.key === "parts")!.now).toBe("Written answers: $12.00 · Not required\nScreen recording: Not listed");
    expect([first.find((r) => r.key === "spots")!.before, first.find((r) => r.key === "spots")!.now]).toEqual(["3", "4"]);

    // A newer save: only ITS fields are tagged (the description's tag goes).
    await save(testId, dev.cookie, { buildUrl: "https://example.com/b2", ndaText: "Keep it quiet." });
    const second = await rowsOf(testId);
    expect(tagged(second)).toEqual(["buildUrl", "ndaText"]);
    expect(second.find((r) => r.key === "ndaText")!.before).toBe("None");

    // The panel as the page draws it: id "listing" (See it's target), every field, the Updated tags, and the lines marked with their save's time.
    const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
    const html = renderToStaticMarkup(createElement(ListingPanel, { rows: second, listing: asListing(t), when: () => "Fri, Oct 30, 11:16 AM" }));
    expect(html).toContain('id="listing"');
    for (const r of PANEL_ROWS) expect(html).toContain(`data-info-line="${r.key}"`);
    expect(html.match(/data-info-updated=""/g)?.length).toBe(2);
    expect(html).toContain("Updated Fri, Oct 30, 11:16 AM");
    expect(html).toMatch(/data-info-line="buildUrl" data-updated-at="[^"]+"/);
    expect(html).not.toMatch(/data-info-line="description" data-updated-at=/);

    // A save of only the access keys is the most recent save too: nothing in the panel is tagged.
    await db.testEvent.create({ data: { testId, kind: LISTING_SAVED, text: JSON.stringify({ fields: [], before: {}, after: {} }) } });
    expect(tagged(await rowsOf(testId))).toEqual([]);
  });

  it("the test page draws the panel below the overview, in place of the Contract changes fold; its record never shows as a line", () => {
    const page = src("app/app/tests/[id]/page.tsx");
    expect(page).not.toContain("ContractChanges");
    expect(fs.existsSync(path.resolve(__dirname, "../src/app/app/tests/[id]/ContractChanges.tsx"))).toBe(false);
    const top = page.lastIndexOf("<TopPanel"), panel = page.indexOf("<ListingPanel rows={listingRows}"), needs = page.indexOf("<NeedsYou count=");
    expect(top).toBeGreaterThan(0);
    expect(panel).toBeGreaterThan(top);
    expect(panel).toBeLessThan(needs);
    expect(src("lib/server/adminLists.ts")).toContain("kind: { notIn: [LISTING_VALUES, LISTING_SAVED, \"listing_save\"] }");
    // UpdatedTag's Before / Now: each a scroll box about 8 lines tall.
    expect(src("components/ListingInfo.tsx")).toContain('max-h-32 overflow-y-auto whitespace-pre-wrap');
  });
});

describe("batch 34 §14: listing lines in the test page's blue boxes have See it", () => {
  it("another tab's Save is a listing line in the top box and in a stop box; See it goes to #listing", async () => {
    const { dev, testId } = await setup();
    await joined(testId);
    const since = new Date(seen());
    await settle();
    await save(testId, dev.cookie, { description: "New steps." }, "tab-other");
    // The top box (LiveTop scope test:…).
    const live = asLines(await devChanges(dev.user.id, testId, since, "tab-page", db, { all: true }));
    const line = live.find((l) => l.text.startsWith("You saved the listing in another tab"));
    expect(line).toMatchObject({ listing: true });
    // A stop box under a button (any press: another tab's Save stops every press once).
    const stop = (await devChanges(dev.user.id, testId, since, "tab-page", db, { press: { acts: ["pay"], keys: ["c:x"] } })).map((c) => devLine(c));
    expect(stop.find((l) => l.text.startsWith("You saved the listing in another tab"))).toMatchObject({ listing: true });
    // Every stop box on the test page takes See it from the page (SeeItTarget "#listing").
    const shown: Change = { text: line!.text, at: new Date().toISOString(), listing: true };
    const box = renderToStaticMarkup(createElement(SeeItTarget, { target: "#listing" }, createElement(ChangesBox, { changes: [shown, { text: "Ana Silva sent the written answers", at: new Date().toISOString() }], press: "Pay" })));
    expect(box.match(/data-see-it=""/g)?.length).toBe(1);
    expect(box).toContain('href="#listing"');
    // Outside the test page (Edit) the same line has no See it.
    expect(renderToStaticMarkup(createElement(ChangesBox, { changes: [shown], press: "Save" }))).not.toContain("data-see-it");
    const page = src("app/app/tests/[id]/page.tsx");
    expect(page).toContain('<LiveTop scope={`test:${t.id}`} seenAt={seenAt} contractLink="scroll" seeIt="#listing" />');
    expect(page).toContain('<SeeItTarget target="#listing">');
    expect(page).toContain('<ListingSeeIt box="listing" />');
    expect(src("components/LiveTop.tsx")).toContain('(l.kind === "info" || l.listing) && seeIt');
  });
});

describe("batch 34 §14: the join page's needs pop-up", () => {
  const at = new Date().toISOString();
  const lines = [
    { text: "Nora Lane edited the listing at 12:23 PM: product name, title (now “Harbor Run 2”), categories", at, kind: "info", timed: true },
    { text: "Nora Lane added Spanish to the languages this test needs", at, listing: true },
  ];
  it("names the press (Join / Apply / Ask to rejoin), never \"Your press\"; each listing line has See it to the listing", () => {
    for (const press of ["Join", "Apply", "Ask to rejoin"]) {
      const html = renderToStaticMarkup(createElement(PopupStop, { lines, press, seeIt: "#listing" }));
      expect(html).toContain(`Your ${press} didn&#x27;t go through.`);
      expect(html).not.toContain("Your press");
      expect(html.match(/data-see-it=""/g)?.length).toBe(2);
      expect(html).toContain('href="#listing"');
    }
    const join = src("app/app/find/[id]/JoinBox.tsx");
    expect(join).toContain('press={rejoining ? "Ask to rejoin" : applying ? "Apply" : "Join"}\n          seeIt="#listing"');
    expect(join).toContain("return { stop: (e.data.changes as Change[]) ?? [] };");
    // See it inside the pop-up closes it first, then scrolls to the listing.
    const see = src("components/ListingInfo.tsx");
    expect(see).toContain('const dialog = e.currentTarget.closest("dialog");');
    expect(see).toContain("dialog.close();");
    expect(see).toContain("if (dialog && el) el.scrollIntoView(");
  });
});
