import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { startHold } from "@/lib/server/holds";
import { closeJoiningAfterOpenUntil } from "@/lib/server/tests";
import { requirementsChangedLine, testerNeedsChangedLines } from "@/lib/server/invites";
import { POST as invitePOST } from "@/app/api/invites/[id]/route";
import { GET as liveGET } from "@/app/api/live/route";
import { GET as pulseGET } from "@/app/api/pulse/route";
import { json, makeUser, req } from "./helpers";
import { act, seen, settle, setup } from "./fixtures";

// Batch 16 sections 31 and 32: the invite panel follows requirement and profile changes (and Invite stops once for them); tester invitations follow every close.
const later = () => new Promise((r) => setTimeout(r, 30));
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const texts = (r: { body: { error?: { code?: string; changes?: { text: string }[] } } }) => (r.body.error?.code === "stop_once" ? r.body.error.changes!.map((c) => c.text) : []);
const again = () => ({ confirmed: true, boxAt: new Date().toISOString() });
async function fay(devices: string[], languages: string[]) {
  const f = await makeUser({ tester: true, name: "Fay Ito" });
  await db.testerProfile.upsert({ where: { userId: f.user.id }, create: { userId: f.user.id, devices, languages, categories: [] }, update: { devices, languages } });
  return f;
}
const pulse = async (cookie: string, q: string) => (await json(await pulseGET(req(`/api/pulse?${q}`, { cookie, method: "GET" })))).body.v as string;
const live = async (cookie: string, scope: string, since: string) => {
  await later();
  return (await json(await liveGET(req(`/api/live?scope=${scope}&since=${encodeURIComponent(since)}`, { cookie, method: "GET" })))).body.changes.map((c: { text: string }) => c.text) as string[];
};

describe("invite: requirement and profile changes stop Invite once (section 31)", () => {
  it("the lines", () => {
    expect(requirementsChangedLine({ devices: ["Windows PC"], languages: ["Russian", "Turkish"] }, { devices: ["iPad"], languages: ["English"] })).toBe("The test's requirements changed: Devices: Windows PC → iPad · Languages: Russian, Turkish → English");
    expect(requirementsChangedLine({ devices: ["Windows PC"], languages: [] }, { devices: ["Windows PC"], languages: [] })).toBe("");
    const test = { devices: [], languages: ["Russian"] };
    // (Batch 20 section 4) Only what the test requires, one net line.
    expect(testerNeedsChangedLines("Fay Ito", { devices: [], languages: ["Russian"] }, { devices: [], languages: [] }, test)).toEqual(["Fay Ito no longer lists Russian, which this test needs."]);
    expect(testerNeedsChangedLines("Fay Ito", { devices: [], languages: [] }, { devices: ["iPad"], languages: [] }, { devices: [], languages: [] })).toEqual([]);
  });

  it("the owner's case: the test's requirements AND the tester's profile changed; one stop with both lines; then Invite anyway with the CURRENT needs", async () => {
    const { dev, testId } = await setup();
    await db.test.update({ where: { id: testId }, data: { devices: ["Windows PC"], languages: ["Russian", "Turkish"] } });
    const f = await fay([], []);
    await later();
    const loaded = seen();
    await later();
    const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    expect((await act(testId, "edit", dev.cookie, { version: v, fields: { devices: ["iPad"], languages: ["English"] }, seenAt: seen(), confirmed: true, tab: "A" })).status).toBe(200);
    await db.testerProfile.update({ where: { userId: f.user.id }, data: { devices: ["iPad"] } });
    const body = { testerIds: [f.user.id], seenAt: loaded, tab: "B", seenNeeds: { devices: ["Windows PC"], languages: ["Russian", "Turkish"] }, seenTesters: { [f.user.id]: { devices: [], languages: [] } } };
    const r = await act(testId, "invite", dev.cookie, body);
    expect(texts(r)).toEqual(expect.arrayContaining(["The test's requirements changed: Devices: Windows PC → iPad · Languages: Russian, Turkish → English", "Fay Ito now lists iPad, which this test needs."]));
    // The second press: Fay still lacks English: the usual confirm, with the current needs.
    const r2 = await act(testId, "invite", dev.cookie, { ...body, ...again() });
    expect(r2.body.error.message).toBe("CONFIRM:Fay Ito doesn't list a language this test needs (English).");
    // Invite anyway with gap lines the box showed earlier (stale): stops once with the current ones.
    const stale = await act(testId, "invite", dev.cookie, { ...body, anyway: true, seenGaps: ["Fay Ito doesn't list a language this test needs (Russian or Turkish) or a device it needs (Windows PC)."], ...again() });
    expect(stale.body.error.message).toMatch(/^CONFIRM:What's missing changed since you looked/);
    const ok = await act(testId, "invite", dev.cookie, { ...body, anyway: true, seenGaps: ["Fay Ito doesn't list a language this test needs (English)."], ...again() });
    expect(ok.body.message).toBe("Invited Fay Ito.");
  });

  it("only the test's requirements changed / only the tester's profile changed (added, removed)", async () => {
    const { dev, testId } = await setup();
    await db.test.update({ where: { id: testId }, data: { devices: ["iPad"], languages: [] } });
    const f = await fay(["iPad"], []);
    const r = await act(testId, "invite", dev.cookie, { testerIds: [f.user.id], seenAt: seen(), seenNeeds: { devices: ["Windows PC"], languages: [] }, seenTesters: { [f.user.id]: { devices: ["iPad"], languages: [] } } });
    expect(texts(r)).toEqual(["The test's requirements changed: Devices: Windows PC → iPad"]);
    const g = await fay(["iPad", "Android phone"], []);
    // (Batch 20 section 4) Android phone isn't required: no stop.
    expect(texts(await act(testId, "invite", dev.cookie, { testerIds: [g.user.id], seenAt: seen(), seenNeeds: { devices: ["iPad"], languages: [] }, seenTesters: { [g.user.id]: { devices: ["iPad"], languages: [] } } })))
      .toEqual([]);
    const h = await fay([], []);
    expect(texts(await act(testId, "invite", dev.cookie, { testerIds: [h.user.id], seenAt: seen(), seenNeeds: { devices: ["iPad"], languages: [] }, seenTesters: { [h.user.id]: { devices: ["iPad"], languages: [] } } })))
      .toEqual(["Fay Ito no longer lists iPad, which this test needs."]);
  });

  it("the panel follows live: a tester's profile change changes the test page's fingerprint; the page sends what it showed", async () => {
    const { dev, testId } = await setup();
    const f = await fay([], []);
    const v1 = await pulse(dev.cookie, `test=${testId}`);
    await settle();
    await db.testerProfile.update({ where: { userId: f.user.id }, data: { languages: ["English"] } });
    expect(await pulse(dev.cookie, `test=${testId}`)).not.toBe(v1);
    const panel = src("app/app/tests/[id]/InvitePanel.tsx");
    expect(panel).toContain("seenNeeds: p.options, seenTesters:");
    expect(panel).toContain("if (grey.size) setTicked(");
  });
});

describe("tester invitations follow every close (section 32)", () => {
  async function invited() {
    const s = await setup();
    const ana = await makeUser({ tester: true, name: "Ana Silva" });
    expect((await act(s.testId, "invite", s.dev.cookie, { testerIds: [ana.user.id], seenAt: seen(), confirmed: true })).body.message).toBe("Invited Ana Silva.");
    const inv = await db.invite.findFirstOrThrow({ where: { testId: s.testId, testerId: ana.user.id, status: "sent" } });
    await later();
    return { ...s, ana, inv, loaded: seen() };
  }
  const join = (testId: string, cookie: string, inviteId: string) => act(testId, "join", cookie, { inviteId, listingVersion: 1, seenAt: seen(), confirmed: true, ndaAccepted: true });

  it("cancelled by the developer: a live line on the dashboard and the join page; No thanks and Join are refused; the card is gone", async () => {
    const x = await invited();
    expect((await act(x.testId, "cancel-invite", x.dev.cookie, { inviteId: x.inv.id, seenAt: seen(), confirmed: true })).status).toBe(200);
    expect(await live(x.ana.cookie, "invites:me", x.loaded)).toEqual(["Your invite to “Harbor Run” was closed."]);
    expect(await live(x.ana.cookie, `listing:${x.testId}`, x.loaded)).toContain("Your invite to “Harbor Run” was closed.");
    const nt = await json(await invitePOST(req(`/api/invites/${x.inv.id}`, { cookie: x.ana.cookie, body: {} }), { params: Promise.resolve({ id: x.inv.id }) }));
    expect(nt.body.error).toMatchObject({ code: "invite_closed", message: "This invite is no longer open." });
    expect((await join(x.testId, x.ana.cookie, x.inv.id)).body.error).toMatchObject({ code: "invite_closed", message: "This invite is no longer open." });
    expect(await db.invite.count({ where: { testerId: x.ana.user.id, status: "sent" } })).toBe(0);
  });

  it("a pause or hold closes it (never says why); after it lifts nothing reopens", async () => {
    const x = await invited();
    const v1 = await pulse(x.ana.cookie, "invites=1");
    await startHold(x.dev.user.id, "unpaid");
    expect(await pulse(x.ana.cookie, "invites=1")).not.toBe(v1);
    expect((await join(x.testId, x.ana.cookie, x.inv.id)).body.error.message).toBe("“Harbor Run” isn't taking new testers right now, so this invite was closed.");
    await db.user.update({ where: { id: x.dev.user.id }, data: { holdStartedAt: null, holdReason: "" } });
    expect((await db.invite.findUniqueOrThrow({ where: { id: x.inv.id } })).status).toBe("cancelled");
  });

  it("stopped, and Open until passed", async () => {
    const x = await invited();
    expect((await act(x.testId, "stop", x.dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await join(x.testId, x.ana.cookie, x.inv.id)).body.error.message).toBe("This test was stopped.");
    const y = await invited();
    const ou = new Date(Date.now() - 60_000);
    await db.test.update({ where: { id: y.testId }, data: { openUntil: ou } });
    await closeJoiningAfterOpenUntil();
    expect((await join(y.testId, y.ana.cookie, y.inv.id)).body.error.message).toBe(`“Harbor Run” closed to new testers on ${fmtDate(ou)}.`);
  });

  it("the card says when it was sent again on a new listing, and when the test is full", () => {
    const page = src("app/app/page.tsx");
    expect(page).toContain("Sent again on the new listing · {fmtDate(i.createdAt)}");
    expect(page).toContain("Full right now: your invite stays open");
    expect(page).toContain('<AutoRefresh query="invites=1" v={invitesFp} />'); // (batch 30 §8: seeded from the render)
    expect(page).toContain('<LiveTop scope="invites:me" seenAt={now.toISOString()} />');
    expect(src("app/app/find/[id]/page.tsx")).toContain('{invite && <AutoRefresh query="invites=1" v={invitesFp} />}');
    expect(randomUUID()).toBeTruthy();
  });
});
