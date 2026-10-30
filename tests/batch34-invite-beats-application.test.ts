import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { answerable } from "@/lib/server/joining";
import { invitePanel } from "@/lib/server/invites";
import { joinPageV } from "@/lib/server/pulseV";
import { JoinBox } from "@/app/app/find/[id]/JoinBox";
import { makeUser, uniq } from "./helpers";
import { act, seen, settle, setup } from "./fixtures";

// Batch 34 §16 (owner's finding and decision, Oct 30): an invite plus a waiting application joins the tester, whichever came second; an old page that still
// shows both offers Join. The tester applied to an "apply" test and the developer invited them: the join page
// showed "Nora Lane invited you · Join below straight away, no need to apply" over the waiting view ("You applied to join… / Withdraw application"), with no Join.

(globalThis as unknown as { React: typeof React }).React = React;
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }) }));

const lv = async (testId: string) => (await db.test.findUniqueOrThrow({ where: { id: testId } })).listingVersion;
const invite = (testId: string, cookie: string, testerId: string) => act(testId, "invite", cookie, { seenAt: seen(), testerIds: [testerId], confirmed: true });
const apply = async (testId: string, cookie: string, extra: Record<string, unknown> = {}) =>
  act(testId, "apply", cookie, { listingVersion: await lv(testId), seenAt: seen(), confirmed: true, note: "I sail a lot", ...extra });
const app = (testId: string, testerId: string) => db.application.findUnique({ where: { testId_testerId: { testId, testerId } } });
const box = (over: { invited: boolean; application: { status: string; changed: boolean; kind?: string } | null; mode?: string }) =>
  renderToStaticMarkup(
    createElement(JoinBox, {
      testId: "t1", seenAt: new Date().toISOString(), mode: over.mode ?? "apply", invited: over.invited, inviteId: over.invited ? "inv1" : null, application: over.application,
      missing: { devices: [], languages: [] }, needs: { devices: [], languages: [] }, devName: "Nora Lane", spotsLeft: 3, dueIfNow: "Nov 6",
    }),
  );

describe("batch 34 §16: an invite beats a waiting application", () => {
  it("the join page: with a sent invite it's the invited join box (Join), never the waiting view; without one, the waiting view as before", () => {
    for (const changed of [false, true]) {
      const html = box({ invited: true, application: { status: "pending", changed, kind: "apply" } });
      expect(html).toContain("Join this test");
      expect(html).not.toContain("Withdraw application");
      expect(html).not.toContain("You applied to join");
      expect(html).not.toContain("Apply to join");
    }
    // A rejoin ask next to an invite: Join too (an invited tester just joins).
    expect(box({ invited: true, application: { status: "pending", changed: false, kind: "rejoin" } })).toContain("Join this test");
    // No invite: still the waiting view.
    const waiting = box({ invited: false, application: { status: "pending", changed: false, kind: "apply" } });
    expect(waiting).toContain("You applied to join. You&#x27;ll hear back when the developer answers.");
    expect(waiting).toContain("Withdraw application");
    expect(waiting).not.toContain("Join this test");
  });

  it("applied first, then invited (the developer's page loaded before the application): the Invite press is Accept — she joins at once, no stop", async () => {
    const { dev, testId } = await setup({ joinMode: "apply" });
    const ana = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she" });
    const ben = await makeUser({ tester: true, name: "Ben Cole", pronoun: "he" });
    const devPageAt = seen();
    await settle();
    expect((await apply(testId, ana.cookie)).body).toEqual({ applied: true });
    await settle();
    // The developer ticks Ana (and Ben, who didn't apply) on the page they had open and presses Invite once: no blue stop.
    const r = await act(testId, "invite", dev.cookie, { seenAt: devPageAt, testerIds: [ana.user.id, ben.user.id] });
    expect(r.status).toBe(200);
    expect(r.body.joined).toEqual([ana.user.id]);
    expect(r.body.message).toBe("Invited Ben Cole. Ana Silva had applied: she joined.");
    const c = await db.contract.findUniqueOrThrow({ where: { testId_testerId: { testId, testerId: ana.user.id } } });
    expect(c.status).toBe("working");
    // Exactly like Accept: the application accepted, the Needs you row gone, the invite used, the tester's usual line (with her contract).
    expect((await app(testId, ana.user.id))?.status).toBe("accepted");
    expect(await answerable(await db.application.findMany({ where: { testId, status: "pending" } }))).toEqual([]);
    expect((await db.invite.findFirstOrThrow({ where: { testId, testerId: ana.user.id } })).status).toBe("joined");
    const youreIn = await db.notification.findMany({ where: { userId: ana.user.id, text: { startsWith: "You're in: Harbor Run" } } });
    expect(youreIn).toHaveLength(1);
    expect(youreIn[0].link).toBe(`/app/sessions/${c.id}`);
    expect(await db.notification.count({ where: { userId: ana.user.id, text: { contains: "invited you" } } })).toBe(0);
    // One line for the developer (joinTest's own "joined" line is left out, as on Accept).
    expect(await db.notification.count({ where: { userId: dev.user.id, text: { contains: "Ana Silva joined" } } })).toBe(1);
    // Ben was invited as usual.
    expect(await db.notification.count({ where: { userId: ben.user.id, text: { contains: "Nora Lane invited you" } } })).toBe(1);
  });

  it("applied, and the developer's page shows it (greyed \"applied: answer them in Needs you →\"): Invite doesn't invite or join her; she's answered in Needs you", async () => {
    const { dev, testId } = await setup({ joinMode: "apply" });
    const name = `Ana Silva ${uniq()}`; // (a name the search finds among every tester in the shared test database)
    const ana = await makeUser({ tester: true, name, pronoun: "she" });
    expect((await apply(testId, ana.cookie)).body).toEqual({ applied: true });
    await settle();
    // The panel (as its live redraw shows it) greys her with the link to her application.
    const a = await db.application.findUniqueOrThrow({ where: { testId_testerId: { testId, testerId: ana.user.id } } });
    const row = (await invitePanel(dev.user.id, testId, { q: name })).found.find((x) => x.id === ana.user.id)!;
    expect(row).toMatchObject({ whyKind: "applied", why: "applied: answer them in Needs you →", appId: a.id });
    // A press from that page with her ticked anyway (an old client): no invite, the line says where she's answered.
    const r = await act(testId, "invite", dev.cookie, { seenAt: seen(), testerIds: [ana.user.id] });
    expect(r.status).toBe(200);
    expect(r.body.joined).toEqual([]);
    expect(r.body.message).toBe(`${name} applied: answer her in Needs you.`);
    expect(await db.invite.count({ where: { testId, testerId: ana.user.id } })).toBe(0);
    expect((await app(testId, ana.user.id))?.status).toBe("pending");
    expect((await answerable(await db.application.findMany({ where: { testId, status: "pending" } }))).map((x) => x.testerId)).toEqual([ana.user.id]);
    // Accept in Needs you as today.
    expect((await act(testId, "application", dev.cookie, { applicationId: a.id, action: "accept", seenAt: seen(), confirmed: true })).body.accepted).toBe(true);
  });

  it("asked to rejoin first, then invited from a page that didn't show the ask: the Invite press brings them back at once (\"Ben Cole had asked to rejoin: he's back in.\")", async () => {
    const { dev, testId } = await setup();
    const { joined, sact } = await import("./fixtures");
    const b = await joined(testId, "Ben Cole", "he");
    expect((await sact(b.sessionId, "leave", b.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    const devPageAt = seen();
    await settle();
    expect((await act(testId, "rejoin-ask", b.tester.cookie, { listingVersion: await lv(testId), seenAt: seen(), confirmed: true, anyway: true })).body).toEqual({ asked: true });
    await settle();
    const r = await act(testId, "invite", dev.cookie, { seenAt: devPageAt, testerIds: [b.tester.user.id] });
    expect(r.body.message).toBe("Ben Cole had asked to rejoin: he's back in.");
    expect((await db.contract.findUniqueOrThrow({ where: { id: b.sessionId } })).status).toBe("working");
    expect((await app(testId, b.tester.user.id))?.status).toBe("accepted");
    expect(await db.notification.count({ where: { userId: b.tester.user.id, text: { startsWith: "You're back in Harbor Run: your deadline is" } } })).toBe(1);
  });

  it("invited first, then Apply (a join page opened before the invite came): Apply joins straight away, no stop; no application is filed", async () => {
    const { dev, testId } = await setup({ joinMode: "apply" });
    const ana = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she" });
    const pageAt = seen();
    await settle();
    expect((await invite(testId, dev.cookie, ana.user.id)).status).toBe(200);
    await settle();
    // The old page's Apply to join (it never showed the invite), pressed once.
    const r = await apply(testId, ana.cookie, { seenAt: pageAt, confirmed: false, anyway: false });
    expect(r.status).toBe(200);
    expect(r.body.joined).toBe(true);
    const c = await db.contract.findUniqueOrThrow({ where: { testId_testerId: { testId, testerId: ana.user.id } } });
    expect(r.body.sessionId).toBe(c.id);
    expect(c.status).toBe("working");
    expect(await app(testId, ana.user.id)).toBeNull();
    expect((await db.invite.findFirstOrThrow({ where: { testId, testerId: ana.user.id } })).status).toBe("joined");
    // The developer is told she joined (no "applied to join" line).
    expect(await db.notification.count({ where: { userId: dev.user.id, text: { contains: "Ana Silva joined" } } })).toBe(1);
    expect(await db.notification.count({ where: { userId: dev.user.id, text: { contains: "applied to join" } } })).toBe(0);
  });

  it("invited, and the join page shows it (the card and Join, live): Apply / Ask to rejoin from a page that showed it are refused with the line; Join joins", async () => {
    const { dev, testId } = await setup({ joinMode: "apply" });
    const ana = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she" });
    const before = await joinPageV(ana.user.id, testId);
    expect((await invite(testId, dev.cookie, ana.user.id)).status).toBe(200);
    await settle();
    // The open join page redraws on its poll (the fingerprint changed): the invite card and Join show.
    expect(await joinPageV(ana.user.id, testId)).not.toBe(before);
    const r = await apply(testId, ana.cookie, { seenAt: seen() });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: "invited", message: "Nora Lane invited you: press Join to join." });
    expect(await app(testId, ana.user.id)).toBeNull();
    const inv = await db.invite.findFirstOrThrow({ where: { testId, testerId: ana.user.id, status: "sent" } });
    const j = await act(testId, "join", ana.cookie, { listingVersion: await lv(testId), seenAt: seen(), inviteId: inv.id });
    expect(j.status).toBe(200);
    // Ask to rejoin likewise: Ben left, was invited back, and his page shows the invite.
    const { joined, sact } = await import("./fixtures");
    const other = await setup();
    const ben = await joined(other.testId, "Ben Cole", "he");
    expect((await sact(ben.sessionId, "leave", ben.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await invite(other.testId, other.dev.cookie, ben.tester.user.id)).status).toBe(200);
    await settle();
    const ask = await act(other.testId, "rejoin-ask", ben.tester.cookie, { listingVersion: await lv(other.testId), seenAt: seen(), confirmed: true, anyway: true });
    expect(ask.body.error).toMatchObject({ code: "invited", message: "Nora Lane invited you: press Join to join." });
    expect(await app(other.testId, ben.tester.user.id)).toBeNull();
  });

  it("invited with an application already waiting (a tester stuck before this fix): Needs you drops it, Join joins at once, the application closes as joined", async () => {
    const { testId } = await setup({ joinMode: "apply" });
    const ana = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she" });
    const ben = await makeUser({ tester: true, name: "Ben Cole", pronoun: "he" });
    expect((await apply(testId, ben.cookie)).body).toEqual({ applied: true });
    // Ana's application and the developer's invite side by side (as a race between an old page's Apply and Invite, or data from before the fix, leaves them).
    await db.application.create({ data: { testId, testerId: ana.user.id, note: "", listing: {} } });
    await db.invite.create({ data: { testId, testerId: ana.user.id } });
    // Needs you (and Needs review, the daily reminder) answer only Ben: Ana is in the Invited list.
    const pending = await db.application.findMany({ where: { testId, status: "pending" } });
    expect(pending).toHaveLength(2);
    expect((await answerable(pending)).map((a) => a.testerId)).toEqual([ben.user.id]);
    // She presses the join page's Join (the invited join box).
    const inv = await db.invite.findFirstOrThrow({ where: { testId, testerId: ana.user.id, status: "sent" } });
    const j = await act(testId, "join", ana.cookie, { listingVersion: await lv(testId), seenAt: seen(), inviteId: inv.id });
    expect(j.status).toBe(200);
    expect((await db.contract.findUniqueOrThrow({ where: { id: j.body.sessionId } })).status).toBe("working");
    expect((await app(testId, ana.user.id))?.status).toBe("joined");
    expect((await answerable(await db.application.findMany({ where: { testId, status: "pending" } }))).map((a) => a.testerId)).toEqual([ben.user.id]);
  });

  it("the same stuck state: Apply from an old page joins her (not \"You already applied to join this test in another tab.\")", async () => {
    const { dev, testId } = await setup({ joinMode: "apply" });
    const ana = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she" });
    const oldTabAt = seen(); // another tab, opened before she applied and before the invite
    await settle();
    expect((await apply(testId, ana.cookie)).body).toEqual({ applied: true });
    await settle();
    await db.invite.create({ data: { testId, testerId: ana.user.id } });
    const r = await apply(testId, ana.cookie, { seenAt: oldTabAt });
    expect(r.status).toBe(200);
    expect(r.body.joined).toBe(true);
    expect((await app(testId, ana.user.id))?.status).toBe("joined");
    expect(await db.notification.count({ where: { userId: dev.user.id, text: { contains: "Ana Silva joined" } } })).toBe(1);
  });

  it("no invite: Apply files the application as before, and it waits in Needs you", async () => {
    const { testId } = await setup({ joinMode: "apply" });
    const ana = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she" });
    expect((await apply(testId, ana.cookie)).body).toEqual({ applied: true });
    expect((await answerable(await db.application.findMany({ where: { testId, status: "pending" } }))).map((a) => a.testerId)).toEqual([ana.user.id]);
  });
});
