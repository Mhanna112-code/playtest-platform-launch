import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { GET as pulseGET } from "@/app/api/pulse/route";
import { GET as cronGET } from "@/app/api/cron/daily/route";
import * as R from "@/lib/rules";
import { paidLines } from "@/lib/server/paid";
import { json, makeUser, req } from "./helpers";
import { act, joined, sact, seen, settle, setup } from "./fixtures";

const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), ...body } })).then(json);
const pulse = (cookie: string, q: string) => pulseGET(req(`/api/pulse?${q}`, { cookie })).then(json);
const cron = () => cronGET(new Request("http://localhost:3400/api/cron/daily", { headers: { authorization: "Bearer cron-test" } }));

async function sent() {
  const s = await setup();
  const j = await joined(s.testId);
  await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  await settle(); // let the send settle before a press measures "since the page loaded"
  return { ...s, ...j, sub };
}

describe("newest addition", () => {
  it("paid so far per kind (written / recording / live calls with minutes)", async () => {
    expect(R.paidByKind([{ kind: "written", amountCents: 1000 }, { kind: "call", amountCents: 1250, minutes: 25 }])).toBe("Paid so far: written answers $10.00 · recording $0.00 · live calls $12.50 (25 min)");
    const { dev, sub, sessionId } = await sent();
    await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    expect((await paidLines([sessionId])).get(sessionId)).toBe("Paid so far: written answers $10.00 · recording $0.00 · live calls $0.00 (0 min)");
  });

  it("every payment that goes through sends the developer a receipt line (bell; the email follows the setting: Off means no email)", async () => {
    const { dev, sub } = await sent();
    await db.user.update({ where: { id: dev.user.id }, data: { emailPref: "off" } });
    await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    const line = "Receipt: you paid $10.00 for Ana Silva's written answers";
    expect(await db.outboxEmail.count({ where: { to: dev.user.email, text: { contains: line } } })).toBe(0);
    expect(await db.notification.count({ where: { userId: dev.user.id, text: line } })).toBe(1);
  });

  it("reminders for parts outside the contract come every 3 days", async () => {
    expect(R.REMIND_DAYS).toBe(3);
    const s = await setup({ writtenCents: null, questions: [] });
    const j = await joined(s.testId);
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["more"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    await db.submission.update({ where: { id: sub.id }, data: { payBy: new Date(Date.now() - 1000), updatedAt: new Date(Date.now() - 4 * 86_400_000), remindedAt: new Date(Date.now() - 3 * 86_400_000) } });
    await cron();
    expect(await db.notification.count({ where: { userId: s.dev.user.id, text: { contains: "still waits for you to pay or reject" } } })).toBe(1);
  });

  it("the developer adds their side to a dispute once; it's kept for the admin", async () => {
    const { dev, sub, sessionId, tester, testId } = await sent();
    await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "4.00", tickedCents: 400, reason: "Half the answers" });
    await sact(sessionId, "dispute", tester.cookie, { kind: "submission", id: sub.id, reason: "I answered every question fully" });
    expect(await db.notification.count({ where: { userId: dev.user.id, text: { contains: "disputed a payment" } } })).toBe(1);
    const d = await db.dispute.findFirstOrThrow({ where: { submissionId: sub.id } });
    expect((await act(testId, "dispute-side", dev.cookie, { disputeId: d.id, text: "Answers 2 and 3 were one word each" })).status).toBe(200);
    expect((await act(testId, "dispute-side", dev.cookie, { disputeId: d.id, text: "Again" })).body.error.message).toBe("You already added your side to this dispute.");
    const other = await makeUser({ dev: true });
    expect((await act(testId, "dispute-side", other.cookie, { disputeId: d.id, text: "Not mine at all" })).status).toBe(404);
    expect((await db.dispute.findUniqueOrThrow({ where: { id: d.id } })).devSide).toBe("Answers 2 and 3 were one word each");
  });

  it("open pages update by themselves: the pulse changes when work is paid, a hold starts or a dispute moves", async () => {
    const { dev, sub, sessionId, tester, testId } = await sent();
    const a = (await pulse(dev.cookie, `test=${testId}`)).body.v;
    const t1 = (await pulse(tester.cookie, `session=${sessionId}`)).body.v;
    await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "4.00", tickedCents: 400, reason: "Half the answers" });
    const b = (await pulse(dev.cookie, `test=${testId}`)).body.v;
    expect(b).not.toBe(a);
    expect((await pulse(tester.cookie, `session=${sessionId}`)).body.v).not.toBe(t1);
    await db.user.update({ where: { id: dev.user.id }, data: { holdStartedAt: new Date() } });
    expect((await pulse(dev.cookie, `test=${testId}`)).body.v).not.toBe(b);
    // Only the developer and that tester can read it.
    expect((await pulse((await makeUser()).cookie, `test=${testId}`)).status).toBe(404);
    expect((await pulse((await makeUser()).cookie, `session=${sessionId}`)).status).toBe(404);
  });
});
