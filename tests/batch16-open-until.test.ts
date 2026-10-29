import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import * as R from "@/lib/rules";
import { shiftAfterPause } from "@/lib/server/holds";
import { fieldOfMistake } from "@/lib/listingFields";
import { act, seen, setup } from "./fixtures";

// Batch 16 section 16: Open until is at most 30 days after the test (or its current Next round) opened; Edit's hint says what each tester gets.
const DAY = 86_400_000;
const day = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const editOU = async (testId: string, cookie: string, ou: string) =>
  act(testId, "edit", cookie, { version: (await db.test.findUniqueOrThrow({ where: { id: testId } })).version, fields: { openUntil: ou }, seenAt: seen(), confirmed: true });

describe("Open until: at most 30 days from when the test opened (section 16)", () => {
  it("the rule: Edit counts from the opening, Post from today", () => {
    const now = new Date("2026-11-21T12:00:00Z");
    const openedAt = new Date("2026-11-01T12:00:00Z");
    expect(R.openUntilCapDay(openedAt)).toBe("2026-12-01");
    const l = (ou: string) => ({ productName: "Harbor Run", title: "Harbor Run", description: "x", buildUrl: "", categories: ["Game"], devices: [], languages: [], spots: 3, writtenCents: 1000, recordingCents: null, liveRateCents: null, liveMinutes: null, deadlineDays: 7, questions: ["Q?"], mature: false, matureWhy: "", ndaText: "", joinMode: "anyone", openUntil: `${ou}T23:59:59.000Z` }) as unknown as R.Listing;
    const ctx = { edit: true, openedAt, changed: new Set(["openUntil"]) };
    expect(R.checkListing(l("2026-12-01"), 0, now, ctx)).toEqual([]);
    expect(R.checkListing(l("2026-12-02"), 0, now, ctx)).toEqual(["Open until can be at most 30 days after the test opened (Dec 1)."]);
    // Post: 30 days from today, as before.
    expect(R.checkListing(l("2026-12-21"), 0, now, { openedAt: now })).toEqual([]);
    expect(R.checkListing(l("2026-12-22"), 0, now, { openedAt: now })).toEqual([R.OPEN_UNTIL_MAX_LINE]);
    // A Next round opens a fresh 30 days (the opening moves to now).
    expect(R.openUntilCapDay(now)).toBe("2026-12-21");
    expect(R.openUntilCapHint("2026-12-01")).toBe("only later, up to Dec 1 (30 days after the test opened)");
  });

  it("(server) extend within the cap; past the cap refused with the cap date; a pause shift may pass the cap, after which it can't move later", async () => {
    const { dev, testId } = await setup({ openUntil: day(10) });
    // The test opened 20 days ago: the cap is 10 days from now.
    const openedAt = new Date(Date.now() - 20 * DAY);
    await db.test.update({ where: { id: testId }, data: { createdAt: openedAt, testerDays: 30 - 20 + 10 } });
    const cap = R.openUntilCapDay(openedAt);
    expect((await editOU(testId, dev.cookie, day(12))).body.error.message).toBe(R.openUntilCapLine(cap));
    expect(fieldOfMistake(R.openUntilCapLine(cap))).toBe("openUntil");
    expect((await editOU(testId, dev.cookie, cap)).status).toBe(200);
    // A pause of 5 days lifted: Open until moves 5 days later, past the cap (the developer couldn't use that time).
    const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
    const nowMs = Date.now(); // one clock reading, so the two ends are exactly 5 days apart (the test flaked by 1 ms)
    await db.$transaction((tx) => shiftAfterPause(tx, t, new Date(nowMs - 5 * DAY), new Date(nowMs)));
    const shifted = await db.test.findUniqueOrThrow({ where: { id: testId } });
    expect(shifted.openUntil!.getTime() - t.openUntil!.getTime()).toBe(5 * DAY);
    expect(shifted.openUntil!.toISOString().slice(0, 10) > cap).toBe(true);
    // It keeps that date (other edits still save) but can't move later.
    const later = new Date(shifted.openUntil!.getTime() + DAY).toISOString().slice(0, 10);
    expect((await editOU(testId, dev.cookie, later)).body.error.message).toBe(R.openUntilCapLine(cap));
    const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    expect((await act(testId, "edit", dev.cookie, { version: v, fields: { description: "Sail further." }, seenAt: seen(), confirmed: true })).status).toBe(200);
  });

  it("Edit's hint: each tester's days now + the extension; the field's own cap and red line", () => {
    // (Batch 19 section 8) The line now says when the last work can arrive: the days now + the extension.
    expect(R.openUntilLine("2026-11-25", 14 + 5)).toContain("Each gets 19 days from when they join, so someone joining on Nov 25 has until Dec 14 to send work.");
    const form = src("app/app/tests/TestForm.tsx");
    expect(form).toContain("openUntilLine(f.openUntil, edit.testerDays + Math.max(0, daysBetween(base.openUntil.slice(0, 10), f.openUntil)))");
    expect(form).toContain('"data-max-msg": edit?.capDay ? openUntilCapLine(edit.capDay) : OPEN_UNTIL_MAX_LINE');
    expect(form).toContain("hint: edit?.capDay ? openUntilCapHint(edit.capDay)");
    expect(src("app/app/tests/[id]/edit/page.tsx")).toContain("capDay: openUntilCapDay(t.createdAt, u.timeZone)");
  });
});
