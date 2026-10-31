import fs from "node:fs";
import path from "node:path";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { asListing } from "@/lib/server/tests";
import { asLines } from "@/lib/server/live";
import { joinPageChanges, joinStopList } from "@/lib/server/joining";
import { lastListingSave, needsSaveAt, testerListingPanel } from "@/lib/server/listingPanel";
import { BUILD_LINK_LATER, LISTING_SAVED, panelRows } from "@/lib/listingPanel";
import { ListingPanel } from "@/app/app/tests/[id]/ListingPanel";
import { PopupStop } from "@/components/GapDialog";
import { ChangesBox, type Change } from "@/components/ChangesBox";
import { SeeItTarget, seeItPlan } from "@/components/ListingInfo";
import { DEV_FOOTNOTE, DEV_FOOTNOTE_NO_PAYS } from "@/lib/server/profileStats";
import { act, settle, setup } from "./fixtures";
import { makeUser } from "./helpers";

// Batch 35 §14 (owner, Oct 30; batch 34 §14 "The join page too"): the tester's join page shows the Listing panel (the most recent Save's fields tagged "Updated",
// Before / Now), in the tester's words with nothing developer-only; every listing line on the join page carries See it with the save-aware marking.
// Also (owner, Oct 30): "Pays on average" only on the developer's own dashboard.

(globalThis as unknown as { React: typeof React }).React = React;
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");

async function save(testId: string, cookie: string, fields: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
  const r = await act(testId, "edit", cookie, { version: t.version, fields, tab: "tab-dev", ...extra });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  await settle();
}
const testerPanel = async (testId: string) => testerListingPanel(testId, asListing(await db.test.findUniqueOrThrow({ where: { id: testId } })));
const render = async (testId: string) => {
  const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
  const p = await testerPanel(testId);
  return { ...p, html: renderToStaticMarkup(createElement(ListingPanel, { side: "tester", rows: p.rows, listing: asListing(t), savedAt: p.savedAt, when: () => "Fri, Oct 30, 12:23 PM", intro: "The listing as it is now." })) };
};

describe("batch 35 §14: the join page's Listing panel", () => {
  it("carries every row, with Before / Now only on the most recent Save's fields, and says which Save it shows", async () => {
    const { dev, testId } = await setup();
    const first = await render(testId);
    expect(first.savedAt).toBe(""); // nothing saved yet: no tags
    expect(first.rows.every((r) => r.before == null)).toBe(true);
    expect(first.rows.map((r) => r.key)).toEqual(["productName", "title", "description", "questions", "buildUrl", "ndaText", "devices", "languages", "categories", "mature", "parts", "call", "deadlineDays", "openUntil", "joinMode", "spots"]);

    await save(testId, dev.cookie, { description: "Sail to the harbor." });
    await save(testId, dev.cookie, { title: "Harbor Run 2", writtenCents: "20.00", languages: ["Spanish"] });
    const now = await render(testId);
    const saves = await db.testEvent.findMany({ where: { testId, kind: LISTING_SAVED }, orderBy: { createdAt: "desc" } });
    expect(now.savedAt).toBe(saves[0].createdAt.toISOString());
    const row = (k: string) => now.rows.find((r) => r.key === k)!;
    // The latest Save's fields: Before / Now. The earlier Save's description: no tag.
    expect(row("title")).toMatchObject({ before: "Harbor Run", now: "Harbor Run 2" });
    expect(row("languages")).toMatchObject({ before: "Any language", now: "Spanish" });
    expect(row("parts").before).toContain("Written answers: $8.00 for you");
    expect(row("parts").now).toContain("Written answers: $16.00 for you");
    expect(row("description").before).toBeNull();
    expect(now.rows.filter((r) => r.before != null).map((r) => r.key)).toEqual(["title", "languages", "parts"]);
    expect(now.html).toContain(`data-saved-at="${now.savedAt}"`);
    expect(now.html).toContain('data-listing-panel="tester"');
    expect(now.html).toMatch(/data-info-line="title" data-updated-at="[^"]+"/);
    expect(now.html).not.toMatch(/data-info-line="description" data-updated-at=/);
    expect(now.html).toContain("Updated Fri, Oct 30, 12:23 PM");
  });

  it("shows nothing developer-only: the tester's share of each price, never the build link, the keys or a hold", async () => {
    const { dev, testId } = await setup({ joinMode: "apply" });
    await save(testId, dev.cookie, { buildUrl: "https://example.com/secret-build-2", liveRateCents: "40.00" });
    const p = await render(testId);
    const row = (k: string) => p.rows.find((r) => r.key === k)!;
    // The developer's prices ($10.00 written, $40.00/h) never show; the tester's 80% does.
    expect(row("parts").now).toContain("$8.00 for you");
    expect(row("call")).toMatchObject({ before: "$24.00/h for you · 30-minute calls · Not required", now: "$32.00/h for you · 30-minute calls · Not required" });
    expect(p.html).not.toContain("$10.00");
    expect(p.html).not.toContain("$40.00");
    // The build link: changed, said without either link (they get it when they join).
    expect(row("buildUrl")).toMatchObject({ now: BUILD_LINK_LATER, before: "An earlier link" });
    expect(p.html).not.toContain("example.com");
    expect(row("joinMode").now).toBe("Approved only (the developer accepts or declines)");
    expect(row("deadlineDays")).toMatchObject({ label: "Your deadline", now: "7 days from joining" });
    for (const w of [/\bhold\b/i, /suspend/i, /failed/i, /chargeback/i, /access key/i, /your last save/i]) expect(p.html).not.toMatch(w);
    // The developer's own panel keeps their words and their prices.
    const devRows = panelRows(asListing(await db.test.findUniqueOrThrow({ where: { id: testId } })), await lastListingSave(testId));
    expect(devRows.find((r) => r.key === "call")!.now).toBe("$40.00/h · 30-minute calls · Not required");
    expect(devRows.find((r) => r.key === "buildUrl")!.now).toBe("https://example.com/secret-build-2");
  });

  it("a Save of only the access keys isn't the tester's latest Save: the panel keeps the listing Save's tags", async () => {
    const { dev, testId } = await setup();
    await save(testId, dev.cookie, { description: "New steps." });
    const listingSave = await db.testEvent.findFirstOrThrow({ where: { testId, kind: LISTING_SAVED }, orderBy: { createdAt: "desc" } });
    await save(testId, dev.cookie, {}, { keysAdd: ["KEY-ONE", "KEY-TWO", "KEY-THREE"] });
    const latest = await db.testEvent.findFirstOrThrow({ where: { testId, kind: LISTING_SAVED }, orderBy: { createdAt: "desc" } });
    expect(latest.id).not.toBe(listingSave.id);
    expect((await lastListingSave(testId))!.fields).toEqual([]); // the developer's panel: the keys Save, nothing tagged
    const p = await render(testId);
    expect(p.savedAt).toBe(listingSave.createdAt.toISOString());
    expect(p.rows.find((r) => r.key === "description")!.before).toBe("Sail");
    expect(p.html).not.toContain("KEY-ONE");
  });

  it("every join-page listing line names its Save (top box and stop box), so See it marks that Save's fields only", async () => {
    const { dev, testId } = await setup();
    const ana = await makeUser({ tester: true, name: "Ana Silva" });
    const since = new Date().toISOString();
    await settle();
    await save(testId, dev.cookie, { description: "One." });
    const first = await render(testId);
    await save(testId, dev.cookie, { title: "Harbor Run 3" }); // a rename alone: a listing line too
    const second = await render(testId);
    const live = asLines(await joinPageChanges(ana.user.id, testId, since, "tab-ana"));
    expect(live.map((l) => l.text)).toEqual([expect.stringMatching(/^Nora Lane edited the listing at .+: description$/), expect.stringMatching(/^Nora Lane edited the listing at .+: title \(now “Harbor Run 3”\)$/)]);
    expect(live.every((l) => l.listing)).toBe(true);
    expect(live.map((l) => (l.saveAt as Date).toISOString())).toEqual([first.savedAt, second.savedAt]);
    const stop = await joinStopList(ana.user.id, testId, { seenAt: since }, "join");
    expect(stop!.changes.filter((c) => c.listing).map((c) => (c.saveAt as Date).toISOString())).toEqual([first.savedAt, second.savedAt]);
    // The panel shows the second Save: its line marks; the first's marks nothing; a line newer than the panel redraws first.
    expect(seeItPlan(second.savedAt, second.savedAt, Date.now())).toBe("mark");
    expect(seeItPlan(second.savedAt, first.savedAt, Date.now())).toBe("none");
    expect(seeItPlan(first.savedAt, second.savedAt, Date.now())).toBe("refresh");
    // The pop-up's own needs lines name the Save that last changed the needs.
    expect(await needsSaveAt(testId)).toBeUndefined();
    await save(testId, dev.cookie, { devices: ["Windows PC"] });
    const needs = await db.testEvent.findFirstOrThrow({ where: { testId, kind: LISTING_SAVED }, orderBy: { createdAt: "desc" } });
    expect(await needsSaveAt(testId)).toBe(needs.createdAt.toISOString());
    const gaps = await act(testId, "my-gaps", ana.cookie, {});
    expect(gaps.body.needsSaveAt).toBe(needs.createdAt.toISOString());
  });
});

describe("batch 35 §14: See it on every listing line of the join page", () => {
  const at = new Date().toISOString();
  const line: Change = { text: "Nora Lane edited the listing at 12:23 PM: title (now “Harbor Run 2”)", at, kind: "renamed", timed: true, listing: true, saveAt: at };
  it("the stop boxes, the pop-up and the Changed-since list carry See it to #listing with the line's Save", () => {
    const box = renderToStaticMarkup(createElement(SeeItTarget, { target: "#listing" }, createElement(ChangesBox, { side: "tester", changes: [line], press: "No thanks" })));
    expect(box).toContain('data-see-it=""');
    expect(box).toContain('href="#listing"');
    const pop = renderToStaticMarkup(createElement(PopupStop, { lines: [line], press: "Apply", seeIt: "#listing" }));
    expect(pop).toContain('data-see-it=""');
    expect(pop).toContain("Your Apply didn&#x27;t go through.");

    const page = src("app/app/find/[id]/page.tsx");
    expect(page).toContain('<LiveTop scope={`listing:${t.id}`} seenAt={seenAt} seeIt="#listing" />');
    expect(page).toContain('<SeeItTarget target="#listing">');
    expect(page).toContain('<ListingSeeIt box="listing" />');
    expect(page).toContain('<ListingPanel side="tester" rows={panel.rows} listing={l} savedAt={panel.savedAt}');
    expect(page).toContain("const panel = await testerListingPanel(t.id, { ...asListing(t), deadlineDays: days });");
    // The header card's badges and the developer's comments stay, inside the panel; one #listing on the page.
    expect(page).toContain("<CategoryBadges categories={t.categories} />");
    expect(page).toContain("<PartBadges written=");
    expect(page).toContain("What testers said");
    expect(page.match(/id="listing"/g)).toBeNull();
    expect(src("app/app/tests/[id]/ListingPanel.tsx").match(/id="listing"/g)?.length).toBe(1);

    const join = src("app/app/find/[id]/JoinBox.tsx");
    expect(join).toContain('{(c.listing || (c.timed && c.kind === "info")) && <> · <a href="#listing" data-see-it="" onClick={(e) => seeItClick(e, "#listing", c.at, c.saveAt)}>See it</a></>}');
    expect(join.match(/seeIt="#listing"/g)?.length).toBe(4); // the two waiting views' boxes, the pop-up, the box under the button
    expect(src("app/app/find/[id]/NoThanksButton.tsx")).toContain('<ChangesBox changes={changes} error={error} press="No thanks" side="tester" seeIt="#listing" alertsWhere="join" />');
    const gap = src("components/GapDialog.tsx");
    expect(gap).toContain("if (changed.length) needsSave.current = r.needsSaveAt;");
    expect(gap).toContain("listing: true, ...(needsSave.current ? { saveAt: needsSave.current } : {})");
    expect(src("components/LiveTop.tsx")).toContain("seeItClick(e, seeIt, l.at, l.saveAt)");
  });
});

describe("owner, Oct 30: Pays on average only on the developer's own dashboard", () => {
  it("the join page and the developer profile (as testers see it) don't show it; the dashboard does", () => {
    expect(src("app/app/find/[id]/page.tsx")).not.toContain("Pays on average:");
    expect(src("app/app/find/[id]/page.tsx")).toContain("<li>Typical review: {devStats.review.value}</li>");
    expect(src("app/app/developers/[id]/page.tsx")).toContain("<DeveloperTiles userId={p.id} />");
    expect(src("app/app/page.tsx")).toContain("<DeveloperTiles userId={userId} pays />");
    const tiles = src("components/ProfileTiles.tsx");
    expect(tiles).toContain('{pays && <StatTile icon={CheckCircle2} label="Pays on average"');
    expect(tiles).toContain("{pays ? DEV_FOOTNOTE : DEV_FOOTNOTE_NO_PAYS}");
    expect(DEV_FOOTNOTE_NO_PAYS.startsWith("Typical review:")).toBe(true);
    expect(DEV_FOOTNOTE_NO_PAYS).not.toContain("Pays on average");
    expect(DEV_FOOTNOTE).toContain("Pays on average");
  });
});
