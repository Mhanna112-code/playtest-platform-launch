import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ALERT_TYPES, PAUSED_ALERTS, STOPPED_ALERTS, alertOf } from "@/lib/alerts";
import { POST as reviewPOST } from "@/app/api/review/route";
import { GET as liveGET } from "@/app/api/live/route";
import { deleteAccount, suspendAccount } from "@/lib/server/restrictions";
import { invitePanel } from "@/lib/server/invites";
import { json, makeUser, req } from "./helpers";
import { act, atHours, joined, sact, seen, setup } from "./fixtures";

// Batch 16 section 21: what the developer did in another tab. Big changes (End early, Stop, Pay / Pay more, call changes) stop every press on the test page
// once ("You … in another tab"); pays, call changes and invites also show live; the same press already made is a plain refusal; nothing else stops.
const later = () => new Promise((r) => setTimeout(r, 30));
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
const texts = (r: { body: { error?: { code?: string; changes?: { text: string }[] } } }) => (r.body.error?.code === "stop_once" ? r.body.error.changes!.map((c) => c.text) : []);
/** The developer's live box on a tab. */
const devLive = async (cookie: string, testId: string, since: string, tab: string) => {
  await later();
  return (await json(await liveGET(req(`/api/live?scope=test:${testId}&since=${encodeURIComponent(since)}`, { cookie, method: "GET", headers: { "x-tab": tab } })))).body.changes.map((c: { text: string }) => c.text) as string[];
};
/** A second press: confirmed, with the box's time (nothing new since). */
const again = () => ({ confirmed: true, boxAt: new Date().toISOString() });
const PAID = "You paid Ana Silva $10.00 for the written answers in another tab";

async function sent(testId: string, name = "Ana Silva") {
  const j = await joined(testId, name);
  await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
  return { ...j, sub: await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } }) };
}

describe("big changes from another tab stop every press once (section 21)", () => {
  it("Pay in tab A: a live line in B; Rate in B (about something else) stops once listing it, then goes ahead", async () => {
    const { dev, testId } = await setup();
    const a = await sent(testId);
    await db.rating.create({ data: { testId, contractId: a.sessionId, side: "tester", raterId: a.tester.user.id, rateeId: dev.user.id, stars: 5 } });
    await later();
    const loaded = seen();
    await later();
    expect((await pay(dev.cookie, { kind: "submission", id: a.sub.id, amount: "10.00", tickedCents: 1000, tab: "A" })).status).toBe(200);
    expect(await devLive(dev.cookie, testId, loaded, "B")).toContain(PAID);
    // (Batch 17 sections 14 and 16) The developer's Rate stops only for a dispute about that tester decided or a stop: a Pay in another tab goes straight through.
    const r = await act(testId, "rate", dev.cookie, { contractId: a.sessionId, stars: 4, seenAt: loaded, tab: "B" });
    expect(r.status).toBe(200);
    // Rating again (here or in another tab) is a plain refusal, no stop box.
    const twice = await act(testId, "rate", dev.cookie, { contractId: a.sessionId, stars: 4, seenAt: loaded, tab: "A" });
    expect(twice.body.error).toMatchObject({ message: "You already rated Ana Silva." });
    expect(twice.body.error.changes).toBeUndefined();
  });

  it("Pay on the same piece in both tabs: B's Pay stops once (the live line is there), then it's already paid", async () => {
    const { dev, testId } = await setup();
    const a = await sent(testId);
    await later();
    const loaded = seen();
    await later();
    expect((await pay(dev.cookie, { kind: "submission", id: a.sub.id, amount: "10.00", tickedCents: 1000, tab: "A" })).status).toBe(200);
    const b = await pay(dev.cookie, { kind: "submission", id: a.sub.id, amount: "10.00", tickedCents: 1000, seenAt: loaded, confirmed: false, tab: "B" });
    expect(texts(b)).toEqual([PAID]);
    const b2 = await pay(dev.cookie, { kind: "submission", id: a.sub.id, amount: "10.00", tickedCents: 1000, seenAt: loaded, tab: "B", ...again() });
    expect(b2.body.error.message).toBe("You already paid $10.00 for this.");
    // A box that stays (Pay more) keeps what was typed (its own state); the paid total and room come from the refreshed page.
    const box = src("app/app/tests/[id]/PayBox.tsx");
    expect(box).toContain("const [amount, setAmount] = useState(");
    expect(box).toContain("const room = p.room;");
  });

  it("an invite in tab A shows live in tab B and greys the row; Invite in B for the same tester stops once, then it's already done", async () => {
    const { dev, testId } = await setup();
    const ana = await makeUser({ tester: true, name: "Ana Silva" });
    await later();
    const loaded = seen();
    await later();
    const inv = await act(testId, "invite", dev.cookie, { testerIds: [ana.user.id], seenAt: seen(), confirmed: true, tab: "A" });
    expect(inv.body).toMatchObject({ message: "Invited Ana Silva." });
    expect(await devLive(dev.cookie, testId, loaded, "B")).toContain("You invited Ana Silva in another tab");
    // The panel the page refreshes to: Ana is no longer offered (she's under Invited, with the date and Cancel invite).
    expect(JSON.stringify(await invitePanel(dev.user.id, testId, {}))).not.toContain(ana.user.id);
    const b = await act(testId, "invite", dev.cookie, { testerIds: [ana.user.id], seenAt: loaded, tab: "B" });
    expect(texts(b)).toEqual(["You invited Ana Silva in another tab"]);
    const b2 = await act(testId, "invite", dev.cookie, { testerIds: [ana.user.id], seenAt: loaded, tab: "B", ...again() });
    expect(b2.body.message).toBe("Everyone you ticked was already invited or joined.");
  });

  it("the same call request in both tabs: live line, a stop once, then 'You already requested this time with Ana Silva.'", async () => {
    const { dev, testId } = await setup();
    const { sessionId } = await joined(testId);
    await later();
    const loaded = seen();
    await later();
    const startsAt = atHours(72);
    expect((await act(testId, "request-time", dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [sessionId], startsAt, tab: "A" })).status).toBe(200);
    const live = (await devLive(dev.cookie, testId, loaded, "B")).filter((t) => /another tab/.test(t));
    expect(live).toHaveLength(1);
    expect(live[0]).toMatch(/^You requested a call with Ana Silva for .+ in another tab$/);
    const b = await act(testId, "request-time", dev.cookie, { seenAt: loaded, contractIds: [sessionId], startsAt, tab: "B" });
    expect(texts(b)).toEqual(live);
    const b2 = await act(testId, "request-time", dev.cookie, { seenAt: loaded, contractIds: [sessionId], startsAt, tab: "B", ...again() });
    expect(b2.body.error.message).toBe("You already requested this time with Ana Silva.");
    expect(await db.callRequest.count({ where: { contractId: sessionId, fromSide: "developer", status: "pending" } })).toBe(1);
    // The request form marks what is already requested or booked; the rest of it stays.
    const panel = src("app/app/tests/[id]/DevCallPanel.tsx");
    expect(panel).toContain("`Already requested: ${t.name}, ${fmt(r.startsAt)}`");
    expect(panel).toContain("`Already booked: ${t.name}, ${fmt(r.startsAt)}`");
  });

  it("Stop in tab A: no live line in B; Stop in B stops once, then 'This test was stopped.'", async () => {
    const { dev, testId } = await setup();
    await joined(testId);
    await later();
    const loaded = seen();
    await later();
    expect((await act(testId, "stop", dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true, tab: "A" })).status).toBe(200);
    expect((await devLive(dev.cookie, testId, loaded, "B")).filter((t) => /another tab/.test(t))).toEqual([]);
    const b = await act(testId, "stop", dev.cookie, { reason: "We have what we need.", seenAt: loaded, tab: "B" });
    expect(texts(b)).toEqual(["You stopped the test in another tab"]);
    const b2 = await act(testId, "stop", dev.cookie, { reason: "We have what we need.", seenAt: loaded, tab: "B", ...again() });
    expect(b2.body.error.message).toMatch(/^This test was stopped\./);
  });

  it("End early: an End early elsewhere stops it once; testers already ended there are dropped on the second press", async () => {
    const { dev, testId } = await setup({ spots: 5 });
    const a = await joined(testId, "Ana Silva");
    const b = await joined(testId, "Ben Okafor");
    await later();
    const loaded = seen();
    await later();
    expect((await act(testId, "end-early", dev.cookie, { contractIds: [a.sessionId], reason: "Done", seenAt: seen(), confirmed: true, tab: "A" })).status).toBe(200);
    expect((await devLive(dev.cookie, testId, loaded, "B")).filter((t) => /another tab/.test(t))).toEqual([]);
    const r = await act(testId, "end-early", dev.cookie, { contractIds: [a.sessionId, b.sessionId], reason: "Done", seenAt: loaded, tab: "B" });
    expect(texts(r)).toEqual(["You ended Ana Silva's work early in another tab"]);
    const r2 = await act(testId, "end-early", dev.cookie, { contractIds: [a.sessionId, b.sessionId], reason: "Done", seenAt: loaded, tab: "B", ...again() });
    expect(r2.status).toBe(200);
    expect(r2.body.count).toBe(1);
    expect((await db.contract.findUniqueOrThrow({ where: { id: b.sessionId } })).status).toBe("ended");
    const log = await db.actionLog.findFirstOrThrow({ where: { testId, tab: "B", text: { startsWith: "ended Ben" } } });
    expect(log.text.split("\u001f")[0]).toBe("ended Ben Okafor's work early");
  });

  it("Next round when another tab already made the draft: stops once, the line links to the draft; then refused", async () => {
    const { dev, testId } = await setup();
    await later();
    const loaded = seen();
    await later();
    const made = await act(testId, "next-round", dev.cookie, { seenAt: seen(), confirmed: true, tab: "A" });
    expect(made.status).toBe(200);
    const r = await act(testId, "next-round", dev.cookie, { seenAt: loaded, tab: "B" });
    expect(r.body.error.code).toBe("stop_once");
    expect(r.body.error.changes).toEqual([expect.objectContaining({ text: "You started a new round in another tab", link: `/app/tests/new?draft=${made.body.id}` })]);
    await later(); // (Windows' clock can lag: the box's time must clearly follow the other tab's draft)
    expect((await act(testId, "next-round", dev.cookie, { seenAt: loaded, tab: "B", ...again() })).body.error.message).toMatch(/^This test already has a next round\./);
    expect(src("components/ChangesBox.tsx")).toContain('<a href={c.link} data-stop-link="">{c.text}</a>');
  });

  it("everything else from another tab: no line, no stop; the same press already made is a plain refusal", async () => {
    const { dev, testId } = await setup({ joinMode: "apply" });
    const ana = await makeUser({ tester: true, name: "Ana Silva" });
    const ap = await act(testId, "apply", ana.cookie, { note: "hi" });
    expect(ap.body).toEqual({ applied: true });
    const app = await db.application.findFirstOrThrow({ where: { testId, testerId: ana.user.id } });
    await later();
    const loaded = seen();
    await later();
    const ed = await act(testId, "edit", dev.cookie, { version: (await db.test.findUniqueOrThrow({ where: { id: testId } })).version, fields: { spots: 4 }, seenAt: seen(), confirmed: true, tab: "A" });
    expect(ed.status).toBe(200);
    expect((await act(testId, "application", dev.cookie, { applicationId: app.id, action: "decline", seenAt: seen(), confirmed: true, tab: "A" })).status).toBe(200);
    expect((await devLive(dev.cookie, testId, loaded, "B")).filter((t) => /another tab/.test(t))).toEqual([]);
    const d = await act(testId, "application", dev.cookie, { applicationId: app.id, action: "decline", seenAt: loaded, tab: "B" });
    expect(d.body.error).toMatchObject({ message: "You already declined this application." });
    expect(d.body.error.changes).toBeUndefined();
    expect((await act(testId, "stop", dev.cookie, { reason: "We have what we need.", seenAt: loaded, tab: "B" })).status).toBe(200); // an Edit Save and a Decline elsewhere never stop it
    expect(src("lib/server/excerpts.ts")).toContain('"You already allowed this excerpt."');
    expect(src("lib/rules.ts")).toContain('no("You already sent your side.")');
  });
});

describe("a closed tester account counts as leaving; the menu (section 21)", () => {
  it("a suspended tester and a deleted one give the developer the leave line, under Testers leaving", async () => {
    const { dev, testId } = await setup({ spots: 5 });
    const a = await joined(testId, "Ana Silva");
    const b = await joined(testId, "Ben Okafor");
    await later();
    const loaded = seen();
    await later();
    const admin = await makeUser({ email: `admin-${randomUUID()}@playtest.test` });
    await db.user.update({ where: { id: admin.user.id }, data: { isAdmin: true } });
    await suspendAccount(admin.user.id, a.tester.user.id, "Spam", "tester");
    await deleteAccount(b.tester.user.id, "self");
    const lines = await devLive(dev.cookie, testId, loaded, "B");
    expect(lines).toContain("Ana Silva left the test");
    expect(lines).toContain("Deleted account left the test");
    expect(await db.testEvent.count({ where: { testId, kind: "left" } })).toBe(2);
    expect(alertOf("left")).toBe("leaving");
    expect(lines.some((t) => /suspend|delet(ed|ion) their/i.test(t))).toBe(false);
  });

  it("no 'Your saves and presses in another tab' type; the menu's line; a stored tick for it is ignored", () => {
    expect(ALERT_TYPES.map((a) => a.key)).not.toContain("own");
    expect(ALERT_TYPES.map((a) => a.label)).not.toContain("Your saves and presses in another tab");
    expect([...PAUSED_ALERTS, ...STOPPED_ALERTS]).not.toContain("own");
    expect(alertOf("own")).toBeNull();
    const menu = src("components/AlertsMenu.tsx");
    expect(menu).toContain('"stop your buttons. A payment hold or pause, a stopped test and final refusals always stop."');
    expect(menu).toContain("Tick what should <b>not</b> {ALERTS_INTRO_REST}");
    expect(menu).not.toContain("closed tester account");
    expect(menu).toContain("start.filter((k) => ALERT_TYPES.some((a) => a.key === k))");
  });
});
