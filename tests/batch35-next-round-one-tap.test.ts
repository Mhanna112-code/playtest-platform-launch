import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { startHold } from "@/lib/server/holds";
import { nextRound } from "@/lib/server/tests";
import { testRow } from "@/lib/server/adminLists";
import { TEST_CLOSED_NO_EDIT, testTitleOf, untitledDraft } from "@/lib/rules";
import { act, joined, listingBody, seen, settle, setup } from "./fixtures";

// (Owner, Nov 3, batch 35 §168) "Round 2 to be a one tap button that opens a draft each time with no name (name field empty); shouldn't do any weird detection if
// previous drafts were open … but rest filled in with saved edit info — also closed tests to have no edit."

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }), usePathname: () => "/app/tests/example", useSearchParams: () => new URLSearchParams() }));
(globalThis as unknown as { React: typeof React }).React = React;
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const later = () => new Promise((r) => setTimeout(r, 30));
const DAY = 86_400_000;
afterEach(() => { delete process.env.FREE_UNTIL; });

describe("§168 Next round is one tap: a new draft every press, with no name", () => {
  it("one tap makes a draft with an empty title; the listing, questions, pay, devices, languages, join mode and capped spots are copied", async () => {
    const { dev, testId } = await setup({ spots: 10, devices: ["Windows PC"], languages: ["English"], recordingCents: "5.00", questions: ["What did you like?", "Where did you get stuck?", "Anything else?"], ndaText: "Keep it secret", mature: true, matureWhy: "Cartoon violence" });
    await db.test.update({ where: { id: testId }, data: { spots: 20, joinMode: "apply" } }); // (batch 31) an older test above today's 10
    const before = await db.test.findUniqueOrThrow({ where: { id: testId } });
    const r = await act(testId, "next-round", dev.cookie, { seenAt: seen() });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const d = await db.test.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(d).toMatchObject({
      status: "draft", title: "", round: 2, previousId: testId, developerId: dev.user.id, spots: 10,
      productName: before.productName, description: before.description, buildUrl: before.buildUrl, categories: before.categories, devices: ["Windows PC"], languages: ["English"],
      writtenCents: before.writtenCents, recordingCents: 500, liveRateCents: before.liveRateCents, liveMinutes: before.liveMinutes, deadlineDays: before.deadlineDays,
      joinMode: "apply", ndaText: "Keep it secret", mature: true, matureWhy: "Cartoon violence", openUntil: before.openUntil,
    });
    expect(d.questions).toEqual(before.questions);
    // This round is unchanged: still open, same version, one "Round 2 was started" event.
    const after = await db.test.findUniqueOrThrow({ where: { id: testId } });
    expect(after).toMatchObject({ status: "open", version: before.version, title: before.title });
    expect((await db.testEvent.findMany({ where: { testId, kind: "next_round" } })).map((e) => e.text)).toEqual(["Round 2 was started"]);
    // A round 2's own Next round is round 3, still with no name.
    const posted = await act(d.id, "post-draft", dev.cookie, listingBody({ title: "Harbor Run 2" }));
    expect(posted.status, JSON.stringify(posted.body)).toBe(200);
    const r3 = await act(d.id, "next-round", dev.cookie, { seenAt: seen() });
    expect(await db.test.findUniqueOrThrow({ where: { id: r3.body.id } })).toMatchObject({ title: "", round: 3, previousId: d.id });
  });

  it("two presses make two drafts: no stop, no refusal, one event per press", async () => {
    const { dev, testId } = await setup();
    const loaded = seen();
    await later();
    const a = await act(testId, "next-round", dev.cookie, { seenAt: loaded });
    const b = await act(testId, "next-round", dev.cookie, { seenAt: loaded });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(b.status, JSON.stringify(b.body)).toBe(200);
    expect(a.body.id).not.toBe(b.body.id);
    expect(await db.test.count({ where: { previousId: testId, status: "draft", title: "" } })).toBe(2);
    expect(await db.testEvent.count({ where: { testId, kind: "next_round" } })).toBe(2);
    // Both drafts can be posted, each with its own name; an empty name is refused with the form's line.
    expect((await act(a.body.id, "post-draft", dev.cookie, listingBody({ title: "" }))).body.error.message).toBe("Give the test a title.");
    expect((await act(a.body.id, "post-draft", dev.cookie, listingBody({ title: "Harbor Run 2a" }))).status).toBe(200);
    expect((await act(b.body.id, "post-draft", dev.cookie, listingBody({ title: "Harbor Run 2b" }))).status).toBe(200);
  });

  it("another tab's press is not detected: no stop-once, no 'already has a next round', no line in the live box or on other presses", async () => {
    const { dev, testId } = await setup();
    const { sessionId } = await joined(testId);
    await later();
    const loaded = seen();
    await later();
    const a = await act(testId, "next-round", dev.cookie, { seenAt: seen(), tab: "A" });
    expect(a.status).toBe(200);
    await settle();
    const b = await act(testId, "next-round", dev.cookie, { seenAt: loaded, tab: "B" });
    expect(b.status, JSON.stringify(b.body)).toBe(200);
    // Not an own-action line: End early from tab B (page loaded before both) goes straight through.
    expect(await db.actionLog.count({ where: { testId, text: { startsWith: "started the next round" } } })).toBe(0);
    const e = await act(testId, "end-early", dev.cookie, { contractIds: [sessionId], reason: "We have enough now", seenAt: loaded, tab: "B" });
    expect(e.status, JSON.stringify(e.body)).toBe(200);
  });

  it("the perk and the hold refusals stay; a suspended developer is refused as before", async () => {
    // The free plan: refused with the subscription line.
    const free = await setup();
    process.env.FREE_UNTIL = new Date(Date.now() - DAY).toISOString();
    expect((await act(free.testId, "next-round", free.dev.cookie, { seenAt: seen() })).body.error.message).toBe("Next round needs a subscription ($7/month).");
    delete process.env.FREE_UNTIL;
    expect(src("app/app/tests/[id]/TopPanel.tsx")).toContain("Next round{p.perks === false && <SubscribersTag />}");
    // A hold: the press is refused (route), and the draft step's own refusal names the pause.
    const held = await setup();
    await startHold(held.dev.user.id, "unpaid");
    expect((await act(held.testId, "next-round", held.dev.cookie, { seenAt: seen() })).body.error.code).toBe("held");
    const u = await db.user.findUniqueOrThrow({ where: { id: held.dev.user.id } });
    await expect(nextRound(u, held.testId)).rejects.toMatchObject({ code: "on_hold", message: expect.stringMatching(/ Your tests are paused until then\.$/) });
    expect(await db.test.count({ where: { previousId: held.testId } })).toBe(0);
    // Suspended: the suspended line, as before.
    const sus = await setup();
    await db.user.update({ where: { id: sus.dev.user.id }, data: { devSuspendedAt: new Date() } });
    expect((await act(sus.testId, "next-round", sus.dev.cookie, { seenAt: seen() })).body.error.code).toBe("suspended");
  });

  it("the old press and its code are gone", async () => {
    const { dev, testId } = await setup();
    expect((await act(testId, "go-next-round", dev.cookie, { seenAt: seen() })).status).toBe(404);
    const tests = src("lib/server/tests.ts");
    for (const gone of ["goNextRound", "NO_NEXT_ROUND", "This test already has a next round", "another tab already made the draft"]) expect(tests).not.toContain(gone);
    expect(src("lib/server/live.ts")).not.toContain('"next-round"');
    expect(src("lib/pressLabels.ts")).not.toContain("go-next-round");
    expect(src("app/api/tests/[id]/[action]/route.ts")).not.toContain("go-next-round");
    expect(src("app/app/tests/[id]/page.tsx")).not.toContain("nextRoundId");
  });

  it("the top panel: one Next round button that presses at once (no box, no Start the next round)", async () => {
    const { TopPanel } = await import("@/app/app/tests/[id]/TopPanel");
    const html = renderToStaticMarkup(React.createElement(TopPanel, { id: "t1", title: "Harbor Run", status: "open", terms: "", spotsLine: "0 of 3 spots used", seenAt: seen(), working: [], joinMode: "anyone" }));
    expect(html).toContain("data-next-round=\"\"");
    expect(html).toContain("Next round");
    expect(html).not.toContain("Go to the next round");
    expect(html).not.toContain("Start the next round");
    expect(html).not.toContain("A copy of this test for your next build");
  });
});

describe("§168 an empty draft name never shows blank", () => {
  it("the fallback: Untitled draft (round N); a named test keeps its name", () => {
    expect(untitledDraft(2)).toBe("Untitled draft (round 2)");
    expect(testTitleOf({ title: "", round: 2 })).toBe("Untitled draft (round 2)");
    expect(testTitleOf({ title: "  ", round: 3 })).toBe("Untitled draft (round 3)");
    expect(testTitleOf({ title: "Harbor Run", round: 2 })).toBe("Harbor Run");
  });

  it("where drafts are listed or named: the dashboard card, Post a test's note, the team's lists and find page, a refused press's line", async () => {
    expect(src("app/app/page.tsx")).toContain("<TestName text={testTitleOf(t)} />");
    expect(src("app/app/tests/new/page.tsx")).toContain("A draft: {testTitleOf(draft)}.");
    expect(src("app/app/find/[id]/page.tsx")).toContain("{testTitleOf(t)}</h1>");
    expect(src("lib/server/adminLinks.ts")).toContain("`“${testTitleOf(t)}”`");
    // The team's test list row for a draft with no name.
    const { dev, testId } = await setup();
    const r = await act(testId, "next-round", dev.cookie, { seenAt: seen() });
    const d = await db.test.findUniqueOrThrow({ where: { id: r.body.id }, include: { developer: true, _count: { select: { contracts: true } } } });
    const row = await testRow(d);
    expect(row.line).toContain("“Untitled draft (round 2)”");
    expect(row.parts).toContainEqual(expect.objectContaining({ t: "“Untitled draft (round 2)”" }));
    // A refused press on the draft names it with the fallback.
    await db.user.update({ where: { id: dev.user.id }, data: { devSuspendedAt: new Date() } });
    const p = await act(d.id, "post-draft", dev.cookie, listingBody({ title: "Harbor Run 2" }));
    expect(p.body.error.failed).toBe("Your Post the test on Untitled draft (round 2) didn't go through");
  });
});

describe("§168 a closed test has no Edit", () => {
  async function closedTest() {
    const s = await setup({ spots: 3, accessKeys: "K1\nK2\nK3" });
    await db.test.update({ where: { id: s.testId }, data: { status: "closed", workEndedAt: new Date(), openUntil: new Date(Date.now() - DAY) } });
    return s;
  }

  it("Save on a closed test (an older page's too) is refused with the plain line; nothing changes", async () => {
    const { dev, testId } = await closedTest();
    const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
    const r = await act(testId, "edit", dev.cookie, { version: t.version, fields: { description: "Sail on" }, seenAt: seen() });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: "closed", message: TEST_CLOSED_NO_EDIT });
    expect(TEST_CLOSED_NO_EDIT).toBe("This test is closed, so it can't be edited.");
    // Confirmed (a second press) and an old version: the same refusal, never a stop-once.
    const again = await act(testId, "edit", dev.cookie, { version: t.version - 1, fields: { description: "Sail on" }, seenAt: seen(), confirmed: true });
    expect(again.body.error).toMatchObject({ code: "closed", message: TEST_CLOSED_NO_EDIT });
    expect((await db.test.findUniqueOrThrow({ where: { id: testId } })).description).toBe(t.description);
    // Next round still works on it.
    expect((await act(testId, "next-round", dev.cookie, { seenAt: seen() })).status).toBe(200);
  });

  it("the Edit page says so instead of the form", () => {
    const page = src("app/app/tests/[id]/edit/page.tsx");
    expect(page).toContain(') : t.status === "closed" ? (');
    expect(page).toContain('<p className="err-field" role="alert" data-closed="">{TEST_CLOSED_NO_EDIT}</p>');
  });

  it("the test page: no Edit button and no links to Edit (join-mode badge, Change in Edit, the keys hint)", async () => {
    const { TopPanel } = await import("@/app/app/tests/[id]/TopPanel");
    const { TestersJoined } = await import("@/app/app/tests/[id]/TestersJoined");
    const { KeysNotice } = await import("@/app/app/tests/[id]/KeysNotice");
    const top = (status: string) => renderToStaticMarkup(React.createElement(TopPanel, { id: "t1", title: "Harbor Run", status, workEnded: status === "closed", terms: "", spotsLine: "1 of 3 spots used", seenAt: seen(), working: [], joinMode: "apply" }));
    for (const status of ["closed", "stopped"]) {
      const html = top(status);
      expect(html, status).not.toContain("/edit");
      expect(html, status).not.toContain("> Edit</a>");
      expect(html, status).toContain("You approve each tester"); // the badge stays, as plain text
      expect(html, status).toContain("Next round");
    }
    const open = top("open");
    expect(open).toContain('href="/app/tests/t1/edit"');
    expect(open).toContain("Change who can join in Edit");
    const joinedPanel = (status: string) => renderToStaticMarkup(React.createElement(TestersJoined, { testId: "t1", spots: 3, seats: [], gone: [], status }));
    expect(joinedPanel("closed")).not.toContain("Change in Edit");
    expect(joinedPanel("open")).toContain("Change in Edit");
    const keys = { free: [{ id: "k1", value: "K1" }], inUse: [], open: 2 };
    expect(renderToStaticMarkup(React.createElement(KeysNotice, { testId: "t1", keys, canEdit: false }))).not.toContain("/edit");
    expect(renderToStaticMarkup(React.createElement(KeysNotice, { testId: "t1", keys }))).toContain("/app/tests/t1/edit#keys");
    expect(src("app/app/tests/[id]/page.tsx")).toContain('canEdit={t.status !== "stopped" && t.status !== "closed"}');
    // The Invite panel (with its "Add spots in Edit") never shows once the work ended (a closed test).
    expect(src("app/app/tests/[id]/page.tsx")).toContain('{!t.workEndedAt && t.status !== "stopped" && !restricted && (\n        <InvitePanel');
  });
});
