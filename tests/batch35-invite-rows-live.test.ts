import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { inviteAvailability, inviteDetails } from "@/lib/server/inviteAvailability";
import { inviteAvailabilityV } from "@/lib/inviteAvailability";
import { invitePanel } from "@/lib/server/invites";
import { blockedV, dashboardV, discoveryV, messagesV, notificationsV, paymentsV, publicProfileV, stateV } from "@/lib/server/pageFreshness";
import { joinPageV, testV } from "@/lib/server/pulseV";
import { GET as pulse } from "@/app/api/pulse/route";
import { makeUser, req, json } from "./helpers";
import { setup } from "./fixtures";

async function fixture() {
  const f = await setup();
  const candidate = await makeUser({ tester: true, name: "Alex Morgan", pronoun: "they" });
  return { ...f, candidate };
}
const makeTest = (dev: string) => db.test.create({ data: { developerId: dev, title: "Other test", status: "open", devices: [], languages: [], spots: 20, deadlineDays: 7, questions: [], categories: ["Game"] } });
async function working(dev: string, tester: string, testId?: string) {
  const t = testId ?? (await makeTest(dev)).id;
  return db.contract.create({ data: { testId: t, testerId: tester, listingVersion: 1, title: "Other test", buildUrl: "", description: "", questions: [], deadlineDays: 7, dueAt: new Date(Date.now() + 7 * 86_400_000) } });
}

describe("batch 35 §109: shown invite rows follow eligibility elsewhere", () => {
  it("crossing ten changes the version; falling below ten changes it back; counts below ten do not", async () => {
    const f = await fixture();
    const other = await makeUser({ dev: true, pronoun: "they" });
    const read = () => inviteAvailability(f.dev.user.id, f.testId, [f.candidate.user.id]);
    const before = await read();
    const rows = [];
    for (let n = 0; n < 9; n++) rows.push(await working(other.user.id, f.candidate.user.id));
    expect((await read()).v).toBe(before.v);
    const tenth = await working(other.user.id, f.candidate.user.id);
    const full = await read();
    expect(full.v).not.toBe(before.v);
    expect(full.unavailable).toEqual([f.candidate.user.id]);
    await db.contract.update({ where: { id: tenth.id }, data: { status: "left" } });
    expect((await read()).v).toBe(before.v);
    expect((await read()).unavailable).toEqual([]);
  });

  it.each(["outgoing", "incoming", "suspended", "deleted"])("follows a shown person's %s change", async (change) => {
    const f = await fixture();
    const before = await inviteAvailability(f.dev.user.id, f.testId, [f.candidate.user.id]);
    if (change === "outgoing" || change === "incoming") await db.block.create({ data: { blockerId: change === "outgoing" ? f.dev.user.id : f.candidate.user.id, blockedId: change === "outgoing" ? f.candidate.user.id : f.dev.user.id } });
    else await db.user.update({ where: { id: f.candidate.user.id }, data: change === "suspended" ? { testerSuspendedAt: new Date() } : { deletedAt: new Date(), isTester: false } });
    const after = await inviteAvailability(f.dev.user.id, f.testId, [f.candidate.user.id]);
    expect(after.v).not.toBe(before.v);
    expect(after.unavailable).toEqual([f.candidate.user.id]);
  });

  it("doesn't change for another person's suspension, capacity or block", async () => {
    const f = await fixture();
    const other = await makeUser({ tester: true, pronoun: "they" });
    const before = await inviteAvailability(f.dev.user.id, f.testId, [f.candidate.user.id]);
    await db.user.update({ where: { id: other.user.id }, data: { testerSuspendedAt: new Date() } });
    await db.block.create({ data: { blockerId: f.dev.user.id, blockedId: other.user.id } });
    await working(f.dev.user.id, other.user.id);
    expect((await inviteAvailability(f.dev.user.id, f.testId, [f.candidate.user.id])).v).toBe(before.v);
  });

  it("follows invited, in this test and finished/rated states", async () => {
    const f = await fixture();
    const read = () => inviteAvailability(f.dev.user.id, f.testId, [f.candidate.user.id]);
    const before = await read();
    const invite = await db.invite.create({ data: { testId: f.testId, testerId: f.candidate.user.id } });
    expect((await read()).v).not.toBe(before.v);
    await db.invite.update({ where: { id: invite.id }, data: { status: "joined" } });
    const c = await working(f.dev.user.id, f.candidate.user.id, f.testId);
    const inTest = await read();
    expect(inTest.unavailable).toContain(f.candidate.user.id);
    await db.contract.update({ where: { id: c.id }, data: { status: "left", endKind: "rated" } });
    const rated = await read();
    expect(rated.v).not.toBe(inTest.v);
    expect(rated.unavailable).toContain(f.candidate.user.id);
  });

  it("the rendered row keys match the very first poll, including row details", async () => {
    const f = await fixture();
    const data = await invitePanel(f.dev.user.id, f.testId, { q: f.candidate.user.name });
    const row = [...data.worked, ...data.suggested, ...data.found].find((r) => r.id === f.candidate.user.id)!;
    expect(row).toBeTruthy();
    expect((await inviteAvailability(f.dev.user.id, f.testId, [row.id])).v).toBe(inviteAvailabilityV([row]));
    expect(await inviteDetails(f.dev.user.id, [row.id])).toBe(inviteAvailabilityV([{ id: row.id, availability: row.details }]));
    const other = await makeUser({ tester: true, pronoun: "they" });
    const before = await inviteDetails(f.dev.user.id, [row.id]);
    await working(f.dev.user.id, other.user.id);
    expect(await inviteDetails(f.dev.user.id, [row.id])).toBe(before);
    await working(f.dev.user.id, row.id);
    expect(await inviteDetails(f.dev.user.id, [row.id])).not.toBe(before);
  });

  it("the poll carries updated keys for a selection kept from an earlier search", async () => {
    const f = await fixture();
    const initial = await json(await pulse(req(`/api/pulse?inviteState=${f.testId}&testers=${f.candidate.user.id}`, { cookie: f.dev.cookie })));
    const before = initial.body.detailsV;
    await db.testerProfile.update({ where: { userId: f.candidate.user.id }, data: { bio: "Changed elsewhere" } });
    const changed = await json(await pulse(req(`/api/pulse?inviteState=${f.testId}&testers=${f.candidate.user.id}`, { cookie: f.dev.cookie })));
    expect(changed.body.detailsV).not.toBe(before);
    expect(changed.body.details).toEqual([{ id: f.candidate.user.id, availability: expect.any(String) }]);
    expect(inviteAvailabilityV(changed.body.details)).toBe(changed.body.detailsV);
    expect(inviteAvailabilityV(changed.body.rows)).toBe(changed.body.v);
    expect(changed.body.unavailable).toEqual([]);
  });

  it("the poll refuses another developer's test", async () => {
    const f = await fixture();
    const stranger = await makeUser({ dev: true, pronoun: "they" });
    expect((await json(await pulse(req(`/api/pulse?inviteState=${f.testId}&testers=${f.candidate.user.id}`, { cookie: stranger.cookie })))).status).toBe(404);
  });

  it("shares the beat, preserves search state and only removes unavailable selections", () => {
    const src = fs.readFileSync("src/app/app/tests/[id]/InvitePanel.tsx", "utf8");
    expect(src).toContain("rideLiveClock()");
    expect(src).not.toContain("setInterval(");
    expect(src).toContain("old.filter((id) => !unavailable.has(id))");
    expect(src).toContain("setAgain((n) => n + 1)");
    expect(src).toContain("router.refresh()");
  });
});

describe("§109: the other missing dependencies from the blue-notice catalog", () => {
  it("Find tests and recommendations change for a new test; Join follows capacity elsewhere", async () => {
    const f = await fixture();
    const before = await discoveryV(f.candidate.user);
    await makeTest(f.dev.user.id);
    expect(await discoveryV(f.candidate.user)).not.toBe(before);
    for (let n = 0; n < 9; n++) await working(f.dev.user.id, f.candidate.user.id);
    const joinBefore = await joinPageV(f.candidate.user.id, f.testId);
    await working(f.dev.user.id, f.candidate.user.id);
    expect(await joinPageV(f.candidate.user.id, f.testId)).not.toBe(joinBefore);
  });

  it("call clash versions follow booking and cancellation on another test", async () => {
    const f = await fixture();
    const c = await working(f.dev.user.id, f.candidate.user.id);
    const before = await testV(f.dev.user.id, f.testId);
    const slot = await db.callSlot.create({ data: { testId: c.testId, startsAt: new Date(Date.now() + 3_600_000), minutes: 30, allowedTesterIds: [] } });
    const call = await db.call.create({ data: { slotId: slot.id, contractId: c.id, startsAt: slot.startsAt, minutes: 30 } });
    const booked = await testV(f.dev.user.id, f.testId);
    expect(booked).not.toBe(before);
    await db.call.update({ where: { id: call.id }, data: { status: "cancelled", cancelledAt: new Date() } });
    expect(await testV(f.dev.user.id, f.testId)).toBe(before);
  });

  it("the dashboard follows a terms offer and Messages follows a new message and read marker", async () => {
    const f = await fixture();
    const c = await working(f.dev.user.id, f.candidate.user.id, f.testId);
    const before = await dashboardV(f.candidate.user);
    await db.termsOffer.create({ data: { contractId: c.id, testId: f.testId, listingVersion: 2, deadlineDays: 7, questions: [], diff: "New terms" } });
    expect(await dashboardV(f.candidate.user)).not.toBe(before);
    const chatBefore = await messagesV(f.candidate.user);
    await db.message.create({ data: { testId: f.testId, testerId: f.candidate.user.id, senderId: f.dev.user.id, body: "Hello" } });
    const arrived = await messagesV(f.candidate.user);
    expect(arrived).not.toBe(chatBefore);
    await db.chatRead.create({ data: { userId: f.candidate.user.id, testId: f.testId, testerId: f.candidate.user.id } });
    expect(await messagesV(f.candidate.user)).not.toBe(arrived);
  });

  it("an existing payment settling changes the tester's Payments version", async () => {
    const f = await fixture();
    const p = await db.payment.create({ data: { kind: "review", developerId: f.dev.user.id, testerId: f.candidate.user.id, amountCents: 1000, feeCents: 200, testerCents: 800, status: "needs_confirmation" } });
    const before = await paymentsV(f.candidate.user);
    await db.payment.update({ where: { id: p.id }, data: { status: "charged" } });
    expect(await paymentsV(f.candidate.user)).not.toBe(before);
  });

  it("Notifications follows a new line and its read state; Blocked people follows another tab", async () => {
    const f = await fixture();
    const before = await notificationsV(f.candidate.user);
    const n = await db.notification.create({ data: { userId: f.candidate.user.id, text: "New update", side: "tester" } });
    const arrived = await notificationsV(f.candidate.user);
    expect(arrived).not.toBe(before);
    await db.notification.update({ where: { id: n.id }, data: { readAt: new Date() } });
    expect(await notificationsV(f.candidate.user)).not.toBe(arrived);
    const blockBefore = await blockedV(f.candidate.user);
    await db.block.create({ data: { blockerId: f.candidate.user.id, blockedId: f.dev.user.id } });
    expect(await blockedV(f.candidate.user)).not.toBe(blockBefore);
  });

  it("public profile edits change the version, but a blocked viewer gets one neutral version", async () => {
    const f = await fixture();
    const before = await publicProfileV(f.dev.user, f.candidate.user.id);
    await db.testerProfile.update({ where: { userId: f.candidate.user.id }, data: { bio: "Updated bio" } });
    expect(await publicProfileV(f.dev.user, f.candidate.user.id)).not.toBe(before);
    await db.block.create({ data: { blockerId: f.candidate.user.id, blockedId: f.dev.user.id } });
    const blocked = await publicProfileV(f.dev.user, f.candidate.user.id);
    await db.testerProfile.update({ where: { userId: f.candidate.user.id }, data: { bio: "A private change" } });
    expect(await publicProfileV(f.dev.user, f.candidate.user.id)).toBe(blocked);
  });

  it("clock phases change only at a boundary", () => {
    const date = new Date("2026-11-02T12:00:00Z");
    expect(stateV(date, date.getTime() - 120_000)).toBe(stateV(date, date.getTime() - 119_000));
    expect(stateV(date, date.getTime() - 120_000)).not.toBe(stateV(date, date.getTime() + 1));
  });
});
