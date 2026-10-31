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
import { LISTING_SAVED, panelRows } from "@/lib/listingPanel";
import { ListingPanel } from "@/app/app/tests/[id]/ListingPanel";
import { ChangesBox } from "@/components/ChangesBox";
import { seeItPlan } from "@/components/ListingInfo";
import { pressLabelOf } from "@/lib/pressLabels";
import { fileSize } from "@/lib/format";
import { hashTargets } from "@/lib/markJump";
import { act, seen, settle, setup } from "./fixtures";
import { makeUser } from "./helpers";

// Batch 35 §2-§5 (owner, Oct 30): Accept / Decline named in their stop box; See it never marks another save's fields; the short attachment marker
// (tests/codex3-paperclip.test.ts); file sizes in KB under 1 MB.

(globalThis as unknown as { React: typeof React }).React = React;
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");

describe("batch 35 §2: an application's Accept / Decline names its press", () => {
  it("the stop box reads “Your Accept didn't go through … Press Accept again to go ahead.” (Decline likewise); other presses keep their names", () => {
    const p = "/api/tests/t1/application";
    expect(pressLabelOf(p, { applicationId: "a", action: "accept" })).toBe("Accept");
    expect(pressLabelOf(p, { applicationId: "a", action: "decline" })).toBe("Decline");
    expect(pressLabelOf(p)).toBe("Answer");
    expect(pressLabelOf("/api/tests/t1/edit", { action: "accept" })).toBe("Save");
    expect(pressLabelOf("/api/sessions/s1/answer-request", { action: "withdraw" })).toBe("Withdraw");
    expect(pressLabelOf("/api/tests/t1/withdraw-application", { action: "decline" })).toBe("Withdraw");
    for (const action of ["accept", "decline"] as const) {
      const name = action === "accept" ? "Accept" : "Decline";
      const html = renderToStaticMarkup(createElement(ChangesBox, { changes: [{ text: "Ana Silva changed their devices", at: new Date().toISOString() }], press: pressLabelOf(p, { action }) }));
      expect(html).toContain(`Your ${name} didn&#x27;t go through.`);
      expect(html).toContain(`Press ${name} again to go ahead.`);
      expect(html).not.toContain("Answer");
    }
    expect(src("lib/client.ts")).toContain("pressLabelOf(path, body)");
  });

  it("the server's failed-press line names Accept / Decline too (a team pause)", async () => {
    const { dev, testId } = await setup({ joinMode: "apply" });
    const ana = await makeUser({ tester: true, name: "Ana Silva" });
    expect((await act(testId, "apply", ana.cookie, { note: "hi" })).status).toBe(200);
    const app = await db.application.findFirstOrThrow({ where: { testId, testerId: ana.user.id } });
    await db.test.update({ where: { id: testId }, data: { adminPausedAt: new Date() } });
    const acc = await act(testId, "application", dev.cookie, { applicationId: app.id, action: "accept", seenAt: seen() });
    expect(acc.body.error.code).toBe("admin_paused");
    expect(acc.body.error.failed).toBe("Your Accept on Harbor Run didn't go through");
    const dec = await act(testId, "application", dev.cookie, { applicationId: app.id, action: "decline", seenAt: seen() });
    expect(dec.body.error.failed).toBe("Your Decline on Harbor Run didn't go through");
    // Other presses keep their wording.
    const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
    expect((await act(testId, "edit", dev.cookie, { version: t.version, fields: { spots: 4 } })).body.error.failed).toBe("Your Save on Harbor Run didn't go through");
  });
});

async function save(testId: string, cookie: string, fields: Record<string, unknown>, tab = "tab-other") {
  const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
  const r = await act(testId, "edit", cookie, { version: t.version, fields, tab });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  await settle();
}
const panelHtml = async (testId: string) => {
  const last = await lastListingSave(testId);
  const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
  return { html: renderToStaticMarkup(createElement(ListingPanel, { rows: panelRows(asListing(t), last), listing: asListing(t), when: () => "Fri, Oct 30, 11:16 AM", savedAt: last?.at.toISOString() ?? "" })), savedAt: last?.at.toISOString() ?? "" };
};

describe("batch 35 §3: See it marks only the fields of the line's own save", () => {
  it("each listing line names its save; the panel says which save it shows; a newer line redraws first, an older one marks nothing", async () => {
    const { dev, testId } = await setup();
    const since = new Date(seen());
    await settle();
    await save(testId, dev.cookie, { description: "First steps." });
    // The panel as drawn after the first save (the page that hasn't redrawn yet).
    const first = await panelHtml(testId);
    expect(first.html).toContain(`data-saved-at="${first.savedAt}"`);
    await save(testId, dev.cookie, { buildUrl: "https://example.com/b2" });
    const second = await panelHtml(testId);
    const saves = await db.testEvent.findMany({ where: { testId, kind: LISTING_SAVED }, orderBy: { createdAt: "asc" } });
    expect(saves.map((s) => s.createdAt.toISOString())).toEqual([first.savedAt, second.savedAt]);

    // The top box's lines (and a stop box's) carry their save.
    const live = asLines(await devChanges(dev.user.id, testId, since, "tab-page", db, { all: true })).filter((l) => l.listing);
    // (Batch 35 §34) The two Saves are ONE line, naming the newest Save and covering both Saves' fields.
    expect(live.map((l) => l.text)).toEqual(["You saved the listing in another tab"]);
    expect(live.map((l) => (l.saveAt as Date).toISOString())).toEqual([second.savedAt]);
    expect(live[0].keys).toEqual(["description", "buildUrl"]);
    const stop = (await devChanges(dev.user.id, testId, since, "tab-page", db, { press: { acts: ["pay"], keys: ["c:x"] } })).map((c) => devLine(c)).filter((l) => l.listing);
    expect(stop.map((l) => (l.saveAt as Date).toISOString())).toEqual([second.savedAt]);

    const newest = { at: new Date(live[0].at).getTime(), saveAt: second.savedAt };
    // The panel still shows the previous save: redraw first (never mark the previous save's fields).
    expect(seeItPlan(first.savedAt, newest.saveAt, newest.at)).toBe("refresh");
    expect(seeItPlan("", newest.saveAt, newest.at)).toBe("refresh");
    // Once it shows that save (or it already did): mark its fields.
    expect(seeItPlan(second.savedAt, newest.saveAt, newest.at)).toBe("mark");
    expect(second.html).toMatch(/data-info-line="buildUrl" data-updated-at="[^"]+"/);
    expect(second.html).not.toMatch(/data-info-line="description" data-updated-at=/);
    // An older line while the panel shows a newer save: it only brings the panel into view.
    expect(seeItPlan(second.savedAt, first.savedAt, new Date(live[0].at).getTime())).toBe("none");
    // A line without its save (an older page's box): by its time; the session page's box (no data-saved-at) as before.
    expect(seeItPlan(first.savedAt, undefined, Date.parse(second.savedAt) + 60_000)).toBe("refresh");
    expect(seeItPlan(second.savedAt, undefined, Date.parse(second.savedAt) + 500)).toBe("mark");
    expect(seeItPlan(undefined, newest.saveAt, newest.at)).toBe("legacy");
  });

  it("the page passes the panel its save; See it redraws through router.refresh and waits for that save", () => {
    expect(src("app/app/tests/[id]/page.tsx")).toContain('savedAt={lastSave?.at.toISOString() ?? ""}');
    const info = src("components/ListingInfo.tsx");
    expect(info).toContain("router.refresh()");
    expect(info).toContain("seeItPlan(now.dataset.savedAt, d.saveAt, at)");
    for (const f of ["components/LiveTop.tsx", "components/ChangesBox.tsx"]) expect(src(f)).toMatch(/seeItClick\(e, \w+, \w\.at, \w\.saveAt, \w\.keys\)/);
  });
});

describe("batch 35 §5: file sizes", () => {
  it("KB under 1 MB, MB with one decimal from 1 MB, one helper everywhere", () => {
    expect(fileSize(15 * 1024)).toBe("15 KB");
    expect(fileSize(80)).toBe("1 KB");
    expect(fileSize(1024 * 1024 - 1)).toBe("1.0 MB");
    expect(fileSize(1024 * 1024)).toBe("1.0 MB");
    expect(fileSize(1.1 * 1024 * 1024)).toBe("1.1 MB");
    for (const f of ["app/app/sessions/[id]/WrittenAttachments.tsx", "components/AnswerSets.tsx", "components/AttachmentList.tsx", "app/app/sessions/[id]/RecordingUpload.tsx"]) {
      expect(src(f)).toContain("fileSize(");
      expect(src(f)).not.toContain("/ 1024 / 1024).toFixed(1)");
    }
  });
});

describe("batch 35 §7: a link to a piece that was paid since lands on its tester's row", () => {
  it("#piece-<id> falls back to that part's line on the tester's row; other links are unchanged", () => {
    expect(hashTargets("piece-sub1")).toEqual(["piece-sub1", "part-sub1"]);
    expect(hashTargets("call-c1")).toEqual(["call-c1"]);
    expect(hashTargets("tester-x")).toEqual(["tester-x"]);
    expect(src("components/HashJump.tsx")).toContain("jumpTo(hashTargets(id).find((t) => document.getElementById(t)) ?? id)");
    const page = src("app/app/tests/[id]/page.tsx");
    expect(page).toContain("id={x.kind === \"sub\" ? `piece-${x.id}` : `call-${x.id}`}"); // Needs you's anchor, as before
    expect(page).toContain("{...(r.sub ? { id: `part-${r.sub.id}` } : {})}");
    // The part's line sits inside its tester's row.
    expect(page.indexOf("id: `part-${r.sub.id}`")).toBeGreaterThan(page.indexOf("id={`tester-${c.id}`}"));
  });
});
