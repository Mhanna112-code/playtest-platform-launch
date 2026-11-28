import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { act, atHours, joined, sact, seen, settle, setup } from "./fixtures";
import { GET as liveGET } from "@/app/api/live/route";
import { boxKeeps, liveRuleOf } from "@/lib/live";
import type { Change } from "@/components/ChangesBox";
import { json, req } from "./helpers";

// (Owner, Nov 28) Leave behaves like every other button on its second press: the press made while its stop box is open sends the box's latest time (boxAt), and
// the server stops it again only for something new since then that the box's rule would stop for (Alerts On: any ordinary change, a new offer too, since Leave
// follows the ordinary rule for terms; Alerts Off: only the lines that always stop, never a payment on a part or an offer). Nothing new: it leaves.
const texts = (r: { body: { error?: { changes?: { text: string }[] } } }) => (r.body.error?.changes ?? []).map((c) => c.text);
const status = async (id: string) => (await db.contract.findUniqueOrThrow({ where: { id } })).status;
const payRecording = async (sessionId: string) => {
  const rec = await db.submission.create({ data: { contractId: sessionId, kind: "recording", agreedCents: 500, sentAt: new Date(), updatedAt: new Date() } });
  await db.review.create({ data: { submissionId: rec.id, contractId: sessionId, amountCents: 500, agreedCents: 500, reason: "", payKey: "k-" + rec.id } });
};
const edit = async (testId: string, cookie: string, fields: Record<string, unknown>) => {
  const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
  return act(testId, "edit", cookie, { version: v, fields, seenAt: seen(), confirmed: true });
};
const alertsOff = (userId: string) => db.user.update({ where: { id: userId }, data: { testerAlertsOff: true } });

describe("Leave's second press (owner, Nov 28)", () => {
  it("Alerts On: a change after the box stops the second press again with only that line; the next press with that box's time leaves", async () => {
    const { dev, testId } = await setup({ recordingCents: "5.00" });
    const { tester, sessionId } = await joined(testId);
    await settle();
    const loaded = seen();
    await settle();
    await payRecording(sessionId);
    await settle();
    const first = await sact(sessionId, "leave", tester.cookie, { seenAt: loaded });
    expect(first.body.error?.code, JSON.stringify(first.body)).toBe("stop_once");
    expect(texts(first)).toEqual([expect.stringMatching(/paid \$5\.00 for your recording/)]);
    await settle();
    expect((await edit(testId, dev.cookie, { description: "A new sailing route" })).status).toBe(200);
    await settle();
    const second = await sact(sessionId, "leave", tester.cookie, { seenAt: loaded, confirmed: true, boxAt: first.body.error.now });
    expect(second.body.error?.code, JSON.stringify(second.body)).toBe("stop_once");
    expect(texts(second)).toEqual([expect.stringMatching(/edited the listing/)]);
    expect(await status(sessionId)).toBe("working");
    const third = await sact(sessionId, "leave", tester.cookie, { seenAt: loaded, confirmed: true, boxAt: second.body.error.now });
    expect(third.status, JSON.stringify(third.body)).toBe(200);
    expect(await status(sessionId)).toBe("left");
  });

  it("nothing new since the box: the second press leaves", async () => {
    const { testId } = await setup({ recordingCents: "5.00" });
    const { tester, sessionId } = await joined(testId);
    await settle();
    const loaded = seen();
    await settle();
    await payRecording(sessionId);
    await settle();
    const first = await sact(sessionId, "leave", tester.cookie, { seenAt: loaded });
    expect(first.body.error?.code, JSON.stringify(first.body)).toBe("stop_once");
    const second = await sact(sessionId, "leave", tester.cookie, { seenAt: loaded, confirmed: true, boxAt: first.body.error.now });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(await status(sessionId)).toBe("left");
  });

  it("Alerts Off: a developer payment on one of her parts after the box never stops the second press; it leaves", async () => {
    const { testId } = await setup({ recordingCents: "5.00", spots: 5 });
    const { tester, sessionId } = await joined(testId);
    await alertsOff(tester.user.id);
    await settle();
    const loaded = seen();
    await settle();
    // What she did in another tab always stops (the first box).
    expect((await sact(sessionId, "request-time", tester.cookie, { startsAt: atHours(50), seenAt: seen(), confirmed: true, tab: "A" })).status).toBe(200);
    await settle();
    const first = await sact(sessionId, "leave", tester.cookie, { seenAt: loaded, tab: "B" });
    expect(first.body.error?.code, JSON.stringify(first.body)).toBe("stop_once");
    expect(texts(first)).toEqual([expect.stringMatching(/in another tab$/)]);
    expect(first.body.error.alertsOff).toBe(true);
    await settle();
    await payRecording(sessionId);
    await settle();
    const second = await sact(sessionId, "leave", tester.cookie, { seenAt: loaded, tab: "B", confirmed: true, boxAt: first.body.error.now });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(await status(sessionId)).toBe("left");
  });

  it("a new offer after the box: Alerts On stops the second press again (the offer line, the page goes up to the offer); Alerts Off leaves", async () => {
    const { dev, testId } = await setup({ recordingCents: "5.00", spots: 5 });
    const on = await joined(testId, "Ana Silva");
    const off = await joined(testId, "Ben Okafor", "he");
    await alertsOff(off.tester.user.id);
    await settle();
    const loaded = seen();
    await settle();
    await payRecording(on.sessionId);
    expect((await sact(off.sessionId, "request-time", off.tester.cookie, { startsAt: atHours(50), seenAt: seen(), confirmed: true, tab: "A" })).status).toBe(200);
    await settle();
    const onFirst = await sact(on.sessionId, "leave", on.tester.cookie, { seenAt: loaded });
    const offFirst = await sact(off.sessionId, "leave", off.tester.cookie, { seenAt: loaded, tab: "B" });
    for (const r of [onFirst, offFirst]) expect(r.body.error?.code, JSON.stringify(r.body)).toBe("stop_once");
    // (Owner, Nov 28) Leave's box carries `ordinaryTerms`: with Alerts Off an offer the page picks up live never joins it (lib/live.ts boxKeeps).
    expect(onFirst.body.error.liveRule).toEqual({ off: false, ordinaryTerms: true });
    expect(offFirst.body.error.liveRule).toEqual({ off: true, ordinaryTerms: true });
    await settle();
    expect((await edit(testId, dev.cookie, { writtenCents: "12.00" })).status).toBe(200);
    expect(await db.termsOffer.count({ where: { contractId: { in: [on.sessionId, off.sessionId] }, status: "open" } })).toBe(2);
    await settle();
    // The session page's live feed leaves the offer out (it has its own box), so it never reaches an open box from there; were one to come, Ben's box
    // (Alerts Off, Leave) would leave it out and Ana's (Alerts On) would take it in.
    const feed = async (j: { sessionId: string; tester: { cookie: string } }) =>
      (await json(await liveGET(req(`/api/live?scope=session:${j.sessionId}&since=${encodeURIComponent(loaded)}`, { cookie: j.tester.cookie, method: "GET", headers: { "x-tab": "t-page" } })))).body.changes as Change[];
    for (const j of [on, off]) expect((await feed(j)).some((c) => /offered you new terms/.test(c.text))).toBe(false);
    const offer = { text: "Nora Lane offered you new terms: Switch or Keep them", at: new Date().toISOString(), link: "terms-offer", forced: true };
    expect(boxKeeps(offer, liveRuleOf(onFirst.body.error))).toBe(true);
    expect(boxKeeps(offer, liveRuleOf(offFirst.body.error))).toBe(false);
    const onSecond = await sact(on.sessionId, "leave", on.tester.cookie, { seenAt: loaded, confirmed: true, boxAt: onFirst.body.error.now });
    expect(onSecond.body.error?.code, JSON.stringify(onSecond.body)).toBe("stop_once");
    expect(texts(onSecond)).toEqual([expect.stringMatching(/offered you new terms: Switch or Keep them/)]);
    expect(onSecond.body.error.top).toBe(true);
    expect(await status(on.sessionId)).toBe("working");
    const offSecond = await sact(off.sessionId, "leave", off.tester.cookie, { seenAt: loaded, tab: "B", confirmed: true, boxAt: offFirst.body.error.now });
    expect(offSecond.status, JSON.stringify(offSecond.body)).toBe(200);
    expect(await status(off.sessionId)).toBe("left");
  });
});
