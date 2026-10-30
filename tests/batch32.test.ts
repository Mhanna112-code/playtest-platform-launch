import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ANSWER_ONE, answersMissing } from "@/lib/questions";
import { makeUser } from "./helpers";
import { act, seen, settle, setup } from "./fixtures";

describe("batch 32 §2: Apply twice", () => {
  it("a second Apply (another tab) is refused, keeps the first note, and doesn't tell the developer again", async () => {
    const { dev, testId } = await setup({ joinMode: "apply" });
    const kit = await makeUser({ tester: true, name: "Kit Moss" });
    const page = seen();
    await settle();
    expect((await act(testId, "apply", kit.cookie, { note: "I love boat games", seenAt: page })).status).toBe(200);
    const bells = await db.notification.count({ where: { userId: dev.user.id } });
    const again = await act(testId, "apply", kit.cookie, { note: "", seenAt: page });
    expect(again.status).toBe(409);
    expect(again.body.code ?? again.body.error).toBeDefined();
    expect(JSON.stringify(again.body)).toContain("You already applied to join this test in another tab.");
    const a = await db.application.findFirstOrThrow({ where: { testId, testerId: kit.user.id } });
    expect(a.note).toBe("I love boat games");
    expect(a.status).toBe("pending");
    expect(await db.notification.count({ where: { userId: dev.user.id } })).toBe(bells);
    expect(await db.testEvent.count({ where: { testId, kind: "applied" } })).toBe(1);
    // (Batch 34 §10, owner) The join page just redraws to the waiting view: no grey "You already applied…" line under the blue one.
    const box = fs.readFileSync(path.join(process.cwd(), "src", "app/app/find/[id]/JoinBox.tsx"), "utf8");
    expect(box).not.toContain("data-already");
    expect(box).toContain('else if (e instanceof ApiError && e.code === "already_waiting") router.refresh();');
  });
});

describe("batch 32 §3 and §4: the tester's pages", () => {
  const src = (f: string) => fs.readFileSync(path.join(process.cwd(), "src", f), "utf8");
  it("Everything you sent shows a part's total, Pay more and extra pay included", () => {
    expect(src("app/app/payments/page.tsx")).toContain("Paid ${money(partPaid.get(r.id) ?? r.review.amountCents)} · you get");
  });
  it("no answer at all: the line above the questions (no box red), any one answer will do", () => {
    expect(answersMissing(["aaaa", "dddd", "aa"], ["", "", ""])?.message).toBe(ANSWER_ONE);
    expect(ANSWER_ONE).toBe("Answer at least one question before sending (any one; none is required).");
    expect(answersMissing(["aaaa", "dddd", "aa"], ["", "f", ""])).toMatchObject({ at: 1, chars: 1 });
    expect(src("app/app/sessions/[id]/SessionActions.tsx")).toContain("needOne && !answers.some((a) => a.trim())");
  });
});

describe("batch 32 §9: one change, one stop (Invite anyway)", () => {
  it("the stop carries what's missing now; with that list the next Invite anyway goes through", async () => {
    const { dev, testId } = await setup();
    await db.test.update({ where: { id: testId }, data: { devices: ["Switch"], languages: ["Chinese"] } });
    const f = await makeUser({ tester: true, name: "fbbb" });
    await db.testerProfile.update({ where: { userId: f.user.id }, data: { devices: ["PlayStation"], languages: ["Chinese"] } });
    await settle();
    const loaded = seen();
    await settle();
    const body = { testerIds: [f.user.id], seenAt: loaded, seenNeeds: { devices: ["Switch"], languages: ["Chinese"] }, seenTesters: { [f.user.id]: { devices: ["PlayStation"], languages: ["Chinese"] } } };
    // fbbb drops Chinese after the page loaded: the press stops once, naming it, with the full list of what's missing now.
    await db.testerProfile.update({ where: { userId: f.user.id }, data: { languages: [] } });
    const r = await act(testId, "invite", dev.cookie, { ...body, anyway: true, seenGaps: ["fbbb doesn't list a device this test needs (Switch)."] });
    expect(r.body.error.code).toBe("stop_once");
    const lines = r.body.error.lines as string[];
    expect(lines.join(" ")).toMatch(/Chinese/);
    expect(lines.join(" ")).toMatch(/Switch/);
    // The box redrew to those lines: the next Invite anyway goes through (no second "What's missing changed").
    const ok = await act(testId, "invite", dev.cookie, { ...body, anyway: true, seenGaps: lines, confirmed: true, boxAt: new Date().toISOString() });
    expect(ok.body.message).toBe("Invited fbbb.");
  });
});

describe("batch 34 §7: a developer's open tests and drafts have different names", () => {
  it("a second Post with the same name is refused naming the first; a rename into it is refused; another developer, or after a Stop, may use it", async () => {
    const { POST: testsPOST } = await import("@/app/api/tests/route");
    const { listingBody } = await import("./fixtures");
    const { json, req } = await import("./helpers");
    const { dev, testId } = await setup({ title: "Harbor Run" });
    const post = async (cookie: string, over: Record<string, unknown>) => json(await testsPOST(req("/api/tests", { cookie, body: listingBody(over) })));
    const again = await post(dev.cookie, { title: "harbor run " });
    expect(again.status).toBe(409);
    expect(again.body.error.message).toMatch(/^You already have a test called “Harbor Run” \(posted .+\): give this one a different name\.$/);
    expect(again.body.error.link).toBe(`/app/tests/${testId}`);
    // A different name posts; renaming it into the first one's name is refused.
    const reef = await post(dev.cookie, { title: "Reef Count" });
    expect(reef.status).toBe(200);
    const v = (await db.test.findUniqueOrThrow({ where: { id: reef.body.id } })).version;
    const rename = await act(reef.body.id, "edit", dev.cookie, { version: v, fields: { title: "Harbor Run" }, seenAt: seen(), confirmed: true });
    expect(rename.body.error?.code).toBe("same_title");
    // Another developer may use it; a stopped test frees it.
    expect((await setup({ title: "Harbor Run" })).testId).toBeTruthy();
    await db.test.update({ where: { id: testId }, data: { status: "stopped" } });
    expect((await post(dev.cookie, { title: "Harbor Run" })).status).toBe(200);
  });
});

describe("batch 34 §8: a save in another tab is one line naming its fields, also when it re-sent invites", () => {
  it("names the fields and what it did to invites", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/lib/server/actionText.ts"), "utf8");
    expect(src).toContain("`You saved the listing in another tab: ${names.join(\", \")}${closings.length ? `; this ${andList(closings)}` : \"\"}`");
  });
});
