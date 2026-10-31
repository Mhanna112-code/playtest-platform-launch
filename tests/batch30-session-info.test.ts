import fs from "node:fs";
import path from "node:path";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { LISTING_VALUES, historyRows, infoAtJoin, infoLines, parseValues, type InfoValues } from "@/lib/listingInfo";
import { UpdatedTag } from "@/components/ListingInfo";
import { decideTerms } from "@/lib/server/terms";
import { act, joined, seen, settle, setup } from "./fixtures";

// Batch 30 §15 (owner, Oct 29): the session page shows the CURRENT listing information inside the contract box ("Your agreed scope"); the contract stays fixed
// until Switch.

// The components are compiled with the classic JSX runtime here (as in batch 26).
(globalThis as unknown as { React: typeof React }).React = React;
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const page = () => src("app/app/sessions/[id]/page.tsx");
const edit = async (testId: string, cookie: string, fields: Record<string, unknown>) => {
  const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
  const r = await act(testId, "edit", cookie, { version: v, fields, seenAt: seen(), confirmed: true });
  await settle();
  return r;
};
const base: InfoValues = { title: "Harbor Run", productName: "Harbor Run", description: "Sail", buildUrl: "https://example.com/b", devices: [], languages: [], categories: ["Game"], mature: false, matureWhy: "" };

describe("batch 30 §15: the listing information lines", () => {
  it("a changed line reads the current value, what it read at joining, and when it last changed; the others carry no tag", () => {
    const t1 = new Date("2026-10-29T19:00:00Z"), t2 = new Date("2026-10-29T19:21:00Z");
    const now = { ...base, description: "Sail to the second island", devices: ["Windows PC", "Mac"] };
    const changes = [
      { fields: ["description"], before: { description: "Sail" }, after: { description: "Sail to the island" }, createdAt: t1 },
      { fields: ["description", "devices"], before: { description: "Sail to the island", devices: [] }, after: { description: "Sail to the second island", devices: ["Windows PC", "Mac"] }, createdAt: t2 },
    ];
    const lines = infoLines(now, changes, { title: "Harbor Run", description: "Sail", buildUrl: "https://example.com/b" });
    const d = lines.find((l) => l.key === "description")!;
    expect(d).toMatchObject({ now: "Sail to the second island", before: "Sail", updatedAt: t2 });
    expect(lines.find((l) => l.key === "devices")).toMatchObject({ now: "Windows PC, Mac", before: "Any device", updatedAt: t2 });
    expect(lines.find((l) => l.key === "title")).toMatchObject({ now: "Harbor Run", before: null, updatedAt: null });
    expect(lines.find((l) => l.key === "languages")).toMatchObject({ now: "Any language", before: null });
  });

  it("a field changed and changed back reads as not changed", () => {
    const changes = [
      { fields: ["buildUrl"], before: { buildUrl: "https://example.com/b" }, after: { buildUrl: "https://example.com/c" }, createdAt: new Date(1) },
      { fields: ["buildUrl"], before: { buildUrl: "https://example.com/c" }, after: { buildUrl: "https://example.com/b" }, createdAt: new Date(2) },
    ];
    expect(infoLines(base, changes, null).find((l) => l.key === "buildUrl")!.before).toBeNull();
  });

  it("a change older than the records still shows: the contract's own copy of the title, description and build link is the before", () => {
    const at = new Date("2026-10-28T10:00:00Z");
    const lines = infoLines({ ...base, title: "Harbor Run 2" }, [], { title: "Harbor Run", description: "Sail", buildUrl: "https://example.com/b" }, at);
    expect(lines.find((l) => l.key === "title")).toMatchObject({ now: "Harbor Run 2", before: "Harbor Run", updatedAt: at });
    expect(infoAtJoin(base, [], null)).toEqual(base);
  });

  it("Mature reads Yes with its note; Terms history rows leave the names to their Renamed line", () => {
    const lines = infoLines({ ...base, mature: true, matureWhy: "Blood" }, [{ fields: ["mature", "matureWhy"], before: { mature: false, matureWhy: "" }, after: { mature: true, matureWhy: "Blood" }, createdAt: new Date(5) }], null);
    expect(lines.find((l) => l.key === "mature")).toMatchObject({ now: "Yes: Blood", before: "No" });
    expect(historyRows({ fields: ["title"], before: { title: "A" }, after: { title: "B" }, createdAt: new Date() })).toBeNull();
    expect(historyRows({ fields: ["title", "categories"], before: { title: "A", categories: ["Game"] }, after: { title: "B", categories: ["Game", "Education"] }, createdAt: new Date() }))
      .toEqual([{ name: "categories", before: "Game", after: "Game, Education" }]);
  });

  it("the Updated tag shows its time, and before → now once tapped (closed at first)", () => {
    const html = renderToStaticMarkup(createElement(UpdatedTag, { when: "Thu, Oct 29, 7:21 PM", before: "Sail", now: "Sail to the island" }));
    expect(html).toContain("Updated Thu, Oct 29, 7:21 PM");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("data-info-before-now");
  });
});

describe("batch 30 §15: an Edit save and the tester's session", () => {
  it("an information change is kept before and after; the contract's own copy stays as it was", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    expect((await edit(s.testId, s.dev.cookie, { description: "Sail to the second island", buildUrl: "https://example.com/v2", devices: ["Windows PC"], categories: ["Game", "Education"] })).status).toBe(200);
    const rows = (await db.testEvent.findMany({ where: { testId: s.testId, kind: LISTING_VALUES } })).map((e) => parseValues(e)!);
    expect(rows).toHaveLength(1);
    expect(rows[0].fields.sort()).toEqual(["buildUrl", "categories", "description", "devices"]);
    expect(rows[0].before).toMatchObject({ description: "Sail", buildUrl: "https://example.com/b", devices: [], categories: ["Game"] });
    expect(rows[0].after).toMatchObject({ description: "Sail to the second island", buildUrl: "https://example.com/v2", devices: ["Windows PC"] });
    const c = await db.contract.findUniqueOrThrow({ where: { id: j.sessionId }, include: { test: true } });
    expect(c.description).toBe("Sail"); // the contract's copy
    const lines = infoLines(c.test, rows, { title: c.title, description: c.description, buildUrl: c.buildUrl });
    expect(lines.find((l) => l.key === "description")).toMatchObject({ now: "Sail to the second island", before: "Sail", updatedAt: rows[0].createdAt });
    expect(lines.find((l) => l.key === "buildUrl")).toMatchObject({ now: "https://example.com/v2", before: "https://example.com/b" });
    // The stored values are never a line: not in the admin timeline, and not a kind any live box or bell lists.
    expect(src("lib/server/adminLists.ts")).toContain('kind: { notIn: [LISTING_VALUES, LISTING_SAVED, "listing_save"] }'); // (batch 34 §14) the Listing panel's record too
    expect(parseValues({ text: "not json", createdAt: new Date() })).toBeNull();
    // No new terms for an information change: nothing to Switch or Keep.
    expect(await db.termsOffer.count({ where: { contractId: j.sessionId } })).toBe(0);
  });

  it("a contract change still comes as Switch / Keep, and the contract part doesn't change until Switch", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    expect((await edit(s.testId, s.dev.cookie, { writtenCents: "12.00" })).status).toBe(200);
    expect(await db.testEvent.count({ where: { testId: s.testId, kind: LISTING_VALUES } })).toBe(0); // a price isn't listing information
    const offer = await db.termsOffer.findFirstOrThrow({ where: { contractId: j.sessionId, status: "open" } });
    expect((await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } })).writtenCents).toBe(1000);
    await decideTerms({ id: j.tester.user.id }, j.sessionId, { offerId: offer.id, choice: "switch", seenAt: seen(), confirmed: true });
    expect((await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } })).writtenCents).toBe(1200);
  });

  it("the page: current listing in the header and the contract box, the badge row, Updated tags, See it to the contract box, and no fold", () => {
    const p = page();
    expect(p).not.toContain("updated the listing since you joined");
    expect(p).not.toContain("Your contract&apos;s terms stay as they are.");
    expect(p).toContain('<h1 className="text-2xl font-bold tracking-tight text-white">{title}</h1>');
    expect(p).toContain("const title = c.test.title;");
    expect(p).toContain("<ScrollText text={c.test.description}");
    expect(p).toContain("<a href={c.test.buildUrl}");
    expect(p).toContain("<CategoryBadges categories={c.test.categories} />");
    expect(p).toContain("<PartBadges written={c.test.writtenCents != null}");
    expect(p).toContain('data-badge="devices"');
    expect(p).toContain('data-badge="languages"');
    expect(p).toContain('seeIt="#scope"');
    expect(p).toContain('<ListingSeeIt box="scope" />');
    expect(p).toContain('id="scope"');
    expect(p).toContain("<UpdatedTag");
    expect(p).toContain("data-history-info");
    // The contract part (fixed) is the contract's own fields.
    expect(p).toContain('{ name: "Written answers", cents: c.writtenCents, required: c.writtenRequired, perHour: false }');
    // (Batch 34 §14) The See it press is shared (LiveTop, the stop boxes, the join page's pop-up): it still tells the page the line's time.
    expect(src("components/LiveTop.tsx")).toContain("onClick={(e) => seeItClick(e, seeIt, l.at, l.saveAt)}");
    // (Batch 35 §3) ... and the save the line is about.
    expect(src("components/ListingInfo.tsx")).toContain("new CustomEvent(SEE_IT_EVENT, { detail: { at: at ? new Date(at).toISOString() : undefined, saveAt: saveAt ? new Date(saveAt).toISOString() : undefined } })");
    // Access keys aren't part of either: the key box is unchanged.
    expect(p).toContain("<KeyBox canReport={!meOff}");
  });
});
