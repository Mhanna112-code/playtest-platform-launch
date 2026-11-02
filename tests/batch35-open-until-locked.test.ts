import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { OPEN_UNTIL_PASSED, endOfDayIn, openUntilHasPassed } from "@/lib/rules";
import { countsOf } from "@/lib/limits";
import { asListing } from "@/lib/server/tests";
import { shiftAfterPause } from "@/lib/server/holds";
import { TestForm } from "@/app/app/tests/TestForm";
import { act, joined, seen, setup } from "./fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }), usePathname: () => "/app/tests/example/edit" }));
(globalThis as unknown as { React: typeof React }).React = React;
const ZONE = "America/Chicago";
const DAY = 86_400_000;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-01T18:00:00Z"));
});
afterEach(() => vi.useRealTimers());

async function fixture() {
  const f = await setup({ openUntil: "2026-11-06", timeZone: ZONE });
  await db.user.update({ where: { id: f.dev.user.id }, data: { timeZone: ZONE } });
  const j = await joined(f.testId);
  const test = await db.test.findUniqueOrThrow({ where: { id: f.testId } });
  const c = await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } });
  return { ...f, ...j, test, c };
}

describe("§112: Open until locks after its calendar day", () => {
  it("changing a passed date refuses the whole save and moves no deadline", async () => {
    const f = await fixture();
    vi.setSystemTime(new Date("2026-11-07T18:00:00Z"));
    const r = await act(f.testId, "edit", f.dev.cookie, { version: f.test.version, fields: { openUntil: "2026-11-09", description: "Changed description" }, timeZone: ZONE, confirmed: true, seenAt: seen() });
    expect(r).toMatchObject({ status: 409, body: { error: { code: "open_until_passed", message: OPEN_UNTIL_PASSED } } });
    expect((await db.test.findUniqueOrThrow({ where: { id: f.testId } })).openUntil).toEqual(f.test.openUntil);
    expect((await db.test.findUniqueOrThrow({ where: { id: f.testId } })).description).toBe(f.test.description);
    expect((await db.contract.findUniqueOrThrow({ where: { id: f.sessionId } })).dueAt).toEqual(f.c.dueAt);
  });

  it("an unchanged passed date permits saving other fields", async () => {
    const f = await fixture();
    vi.setSystemTime(new Date("2026-11-07T18:00:00Z"));
    const r = await act(f.testId, "edit", f.dev.cookie, { version: f.test.version, fields: { openUntil: "2026-11-06", description: "Changed description" }, timeZone: ZONE, confirmed: true, seenAt: seen() });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await db.test.findUniqueOrThrow({ where: { id: f.testId } })).description).toBe("Changed description");
    expect((await db.contract.findUniqueOrThrow({ where: { id: f.sessionId } })).dueAt).toEqual(f.c.dueAt);
  });

  it("an unchanged day preserves a pause-shifted timestamp instead of resetting its time", async () => {
    const f = await fixture();
    const shifted = new Date("2026-11-06T20:35:12Z");
    await db.test.update({ where: { id: f.testId }, data: { openUntil: shifted } });
    vi.setSystemTime(new Date("2026-11-07T18:00:00Z"));
    const r = await act(f.testId, "edit", f.dev.cookie, { version: f.test.version, fields: { openUntil: "2026-11-06", description: "Changed description" }, timeZone: ZONE, confirmed: true, seenAt: seen() });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await db.test.findUniqueOrThrow({ where: { id: f.testId } })).openUntil).toEqual(shifted);
  });

  it("a future date still extends working deadlines by the added days", async () => {
    const f = await fixture();
    const r = await act(f.testId, "edit", f.dev.cookie, { version: f.test.version, fields: { openUntil: "2026-11-08" }, timeZone: ZONE, confirmed: true, seenAt: seen() });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await db.contract.findUniqueOrThrow({ where: { id: f.sessionId } })).dueAt.getTime()).toBe(f.c.dueAt.getTime() + 2 * DAY);
  });

  it("today stays editable until the developer's day ends, including after UTC midnight", () => {
    const now = new Date("2026-11-07T03:00:00Z"); // Nov 6, 9 PM in Chicago.
    expect(openUntilHasPassed("2026-11-06", now, ZONE)).toBe(false);
    expect(openUntilHasPassed("2026-11-06", now, "UTC")).toBe(true);
    expect(openUntilHasPassed(endOfDayIn("2026-11-06", ZONE), new Date("2026-11-07T06:00:00Z"), ZONE)).toBe(true);
  });

  it("the Edit field is disabled and greyed with the exact shared hint only after passing", async () => {
    const f = await fixture();
    const render = () => renderToStaticMarkup(createElement(TestForm, { init: asListing(f.test), tz: ZONE, edit: { id: f.testId, version: f.test.version, testersIn: 1, draft: false, keys: { free: [], inUse: [], open: 2, uses: false }, criticalCounts: countsOf({}), everJoined: true, openedAt: f.test.createdAt.toISOString(), seenAt: seen(), capDay: "2026-12-01" } }));
    const future = render().match(/<input[^>]*id="openUntil"[^>]*>/)![0];
    expect(future).not.toContain('disabled=""');
    vi.setSystemTime(new Date("2026-11-07T18:00:00Z"));
    const html = render();
    expect(html.match(/<input[^>]*id="openUntil"[^>]*>/)![0]).toContain('disabled=""');
    expect(html).toContain("disabled:opacity-50");
    expect(html).toContain("Open until has passed, so it can&#x27;t be changed.");
  });

  it("automatic pause shifts can still move a passed date", async () => {
    const f = await fixture();
    vi.setSystemTime(new Date("2026-11-09T18:00:00Z"));
    await db.$transaction((tx) => shiftAfterPause(tx, f.test, new Date("2026-11-07T18:00:00Z"), new Date(), []));
    expect((await db.test.findUniqueOrThrow({ where: { id: f.testId } })).openUntil!.getTime()).toBe(f.test.openUntil!.getTime() + 2 * DAY);
  });
});
