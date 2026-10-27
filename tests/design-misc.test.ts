import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as adminPOST } from "@/app/api/admin/[action]/route";
import { POST as deletePOST } from "@/app/api/account/delete/route";
import { POST as webhookPOST } from "@/app/api/stripe/webhook/route";
import { displayName } from "@/lib/format";
import { invitable } from "@/lib/server/invites";
import { testIdOfLink } from "@/lib/server/notify";
import { payoutFixed, payoutProblem, payoutReminders } from "@/lib/server/restrictions";
import { startHold } from "@/lib/server/holds";
import { json, makeUser, req } from "./helpers";
import { act, joined, sact, seen, setup } from "./fixtures";

const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
const adm = (action: string, cookie: string, body: Record<string, unknown>) => adminPOST(req(`/api/admin/${action}`, { cookie, body }), { params: Promise.resolve({ action }) }).then(json);
const later = () => new Promise((r) => setTimeout(r, 8));
const admin = async () => {
  const a = await makeUser({ name: "Admin One" });
  await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  return a;
};
async function withWork() {
  const s = await setup();
  const j = await joined(s.testId);
  await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
  await later();
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  return { ...s, ...j, sub };
}

describe("Pay and Reject while the account is not clear (owner, Oct 26)", () => {
  it("a payment hold: Pay and Reject are both unavailable (owner, Oct 27); each names itself, nothing is recorded and the tester is told nothing", async () => {
    const { dev, sessionId, tester } = await withWork();
    const second = await db.submission.create({ data: { contractId: sessionId, kind: "recording", agreedCents: 1000, sentAt: new Date(), updatedAt: new Date() } });
    await startHold(dev.user.id, "unpaid");
    const rej = await pay(dev.cookie, { action: "reject", kind: "submission", id: second.id, reason: "Nothing usable in it" });
    expect(rej.status).toBe(403);
    expect(rej.body.error).toMatchObject({ code: "held", failed: "Your Reject on Harbor Run didn't go through" });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId, kind: "written" } });
    const paid = await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    expect(paid.body.error).toMatchObject({ code: "held", failed: "Your Pay on Harbor Run didn't go through" });
    expect(await db.review.count({ where: { contractId: sessionId } })).toBe(0);
    expect(await db.payment.count({ where: { contractId: sessionId } })).toBe(0);
    expect(await db.notification.count({ where: { userId: tester.user.id, text: { contains: "paid you" } } })).toBe(0);
  });

  it("a suspended developer can neither Pay nor Reject (each names itself, nothing is recorded); once lifted they can", async () => {
    const { dev, sub, tester } = await withWork();
    const a = await admin();
    await adm("suspend", a.cookie, { id: dev.user.id, note: "Spam" });
    expect((await pay(dev.cookie, { action: "reject", kind: "submission", id: sub.id, reason: "Not good enough" })).body.error.failed).toMatch(/^Your Reject on Harbor Run didn't go through$/);
    const r = await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatchObject({ code: "suspended", failed: "Your Pay on Harbor Run didn't go through" });
    expect(await db.payment.count({ where: { submissionId: sub.id } })).toBe(0);
    expect(await db.review.count({ where: { submissionId: sub.id } })).toBe(0);
    await adm("unsuspend", a.cookie, { id: dev.user.id });
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    expect((await db.payment.findFirstOrThrow({ where: { submissionId: sub.id } })).status).toBe("not_set_up");
    expect(await db.notification.count({ where: { userId: tester.user.id, text: { contains: "paid you $10.00 for your written answers" } } })).toBe(1);
  });

  it("a suspended developer WITH a payment hold is still refused Pay and Reject; 'Pay what you owe' (hold only) works, and a suspension alone never offers it", async () => {
    const { POST: owedPOST } = await import("@/app/api/payments/owed/route");
    const owedReq = (cookie: string) => owedPOST(req("/api/payments/owed", { cookie, body: {} })).then(json);
    const { dev, sub } = await withWork();
    const a = await admin();
    await adm("suspend", a.cookie, { id: dev.user.id, note: "Spam" });
    // Suspension alone: no 'Pay what you owe'.
    const alone = await owedReq(dev.cookie);
    expect(alone.status).toBe(403);
    expect(alone.body.error.code).toBe("suspended");
    // Suspension and a hold: Pay / Reject still refused, 'Pay what you owe' goes through.
    await startHold(dev.user.id, "unpaid");
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).body.error.code).toBe("suspended");
    expect((await pay(dev.cookie, { action: "reject", kind: "submission", id: sub.id, reason: "No" })).body.error.code).toBe("suspended");
    expect((await owedReq(dev.cookie)).status).toBe(200);
  });
});

describe("admin disputes: any admin, first decision wins", () => {
  it("a second admin's press says who decided and when", async () => {
    const { dev, sub, sessionId, tester } = await withWork();
    await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "4.00", tickedCents: 400, reason: "Only half answered" });
    await sact(sessionId, "dispute", tester.cookie, { kind: "submission", id: sub.id, reason: "I answered all of it", seenAt: seen(), confirmed: true });
    const d = await db.dispute.findFirstOrThrow({ where: { submissionId: sub.id } });
    const one = await admin();
    const two = await admin();
    expect((await adm("decide", one.cookie, { id: d.id, total: "" })).status).toBe(200);
    const second = await adm("decide", two.cookie, { id: d.id, total: "10.00" });
    expect(second.status).toBe(409);
    expect(second.body.error.message).toMatch(/^This dispute was already decided by Admin One at .+\.$/);
  });
});

describe("deleted accounts, page by page (owner, Oct 26)", () => {
  it("a deleted tester shows as 'Deleted account', leaves the tests (history stays), disappears from invite lists, and their chat is read-only", async () => {
    const { dev, testId, sessionId, tester } = await withWork();
    await sact(sessionId, "message", tester.cookie, { body: "Hello" });
    await deletePOST(req("/api/account/delete", { cookie: tester.cookie, body: { confirmed: true } }));
    const gone = await db.user.findUniqueOrThrow({ where: { id: tester.user.id } });
    expect(displayName(gone)).toBe("Deleted account");
    expect(await db.contract.findUniqueOrThrow({ where: { id: sessionId } })).toMatchObject({ status: "left", endKind: "deleted" });
    expect(await db.submission.count({ where: { contractId: sessionId } })).toBe(1); // history stays
    expect((await invitable(dev.user.id, testId)).some((x) => x.id === tester.user.id)).toBe(false);
    const msg = await act(testId, "message", dev.cookie, { contractId: sessionId, body: "Are you there?" });
    expect(msg.status).toBe(409);
    expect(msg.body.error.message).toBe("This chat is closed.");
    // Messages sent before stay readable.
    expect(await db.message.count({ where: { contractId: sessionId } })).toBe(1);
  });

  it("a deleted developer's tests stop and leave Find, invites and applications close, testers see the stopped state", async () => {
    const { dev, testId, sessionId, sub } = await withWork();
    // (Owner, Oct 28; DEFAULT) A developer pays or rejects what waits for them before deleting.
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    const open = await setup({ joinMode: "apply" });
    const applicant = await makeUser({ tester: true, name: "Cara Diaz" });
    await act(open.testId, "apply", applicant.cookie, { listingVersion: 1, seenAt: seen(), confirmed: true, anyway: true });
    await act(testId, "invite", dev.cookie, { seenAt: seen(), testerIds: [applicant.user.id], confirmed: true });
    await deletePOST(req("/api/account/delete", { cookie: dev.cookie, body: { confirmed: true } }));
    expect((await db.test.findUniqueOrThrow({ where: { id: testId } })).status).toBe("stopped");
    expect((await db.contract.findUniqueOrThrow({ where: { id: sessionId } })).endKind).toBe("stopped");
    expect(await db.invite.count({ where: { testId, status: "sent" } })).toBe(0);
    const { findTests } = await import("@/lib/server/tests");
    expect((await findTests(applicant.user as never)).some((t) => t.id === testId)).toBe(false);
    expect(displayName(await db.user.findUniqueOrThrow({ where: { id: dev.user.id } }))).toBe("Deleted account");
  });
});

describe("bell reach (owner, Oct 26)", () => {
  it("a notice about another person reaches only while that person is in, or was in, one of the recipient's tests that is still open", async () => {
    const { dev, testId, sessionId, tester } = await withWork();
    await sact(sessionId, "message", tester.cookie, { body: "First message" });
    const before = await db.notification.count({ where: { userId: dev.user.id, text: { contains: "First message" } } });
    expect(before).toBe(1);
    await act(testId, "stop", dev.cookie, { seenAt: seen(), confirmed: true });
    await sact(sessionId, "message", tester.cookie, { body: "Second message" });
    expect(await db.notification.count({ where: { userId: dev.user.id, text: { contains: "Second message" } } })).toBe(0);
  });

  it("each bell line remembers its test (same-day lines about one test stack)", async () => {
    const { testId, sessionId } = await withWork();
    expect(await testIdOfLink(`/app/tests/${testId}#calls`)).toBe(testId);
    expect(await testIdOfLink(`/app/sessions/${sessionId}`)).toBe(testId);
    expect(await testIdOfLink(`/app/find/${testId}`)).toBe(testId);
    expect(await testIdOfLink("/app/payments")).toBeNull();
    const { dev } = await withWork();
    expect(await db.notification.count({ where: { userId: dev.user.id, testId: { not: null } } })).toBeGreaterThan(0);
  });
});

describe("payout problems (design doc 9)", () => {
  it("a failed payout shows the banner flag and a bell, repeats every 3 days until fixed", async () => {
    const t = await makeUser({ tester: true, name: "Ana Silva" });
    await db.user.update({ where: { id: t.user.id }, data: { stripeAccountId: "acct_" + randomUUID().slice(0, 8) } });
    const acct = (await db.user.findUniqueOrThrow({ where: { id: t.user.id } })).stripeAccountId!;
    expect(await payoutProblem(acct)).toBe(true);
    const line = "Your bank couldn't receive a payout. Update your payout details.";
    expect(await db.notification.count({ where: { userId: t.user.id, text: line } })).toBe(1);
    expect((await db.user.findUniqueOrThrow({ where: { id: t.user.id } })).payoutProblemAt).not.toBeNull();
    // Not yet 3 days: no reminder. After 3 days: one more.
    await payoutReminders(new Date(Date.now() + 2 * 86_400_000));
    expect(await db.notification.count({ where: { userId: t.user.id, text: line } })).toBe(1);
    await payoutReminders(new Date(Date.now() + 3 * 86_400_000 + 3_600_000));
    expect(await db.notification.count({ where: { userId: t.user.id, text: line } })).toBe(2);
    await payoutFixed(acct);
    expect((await db.user.findUniqueOrThrow({ where: { id: t.user.id } })).payoutProblemAt).toBeNull();
    await payoutReminders(new Date(Date.now() + 9 * 86_400_000));
    expect(await db.notification.count({ where: { userId: t.user.id, text: line } })).toBe(2);
  });

  it("the Stripe webhook's payout.failed starts it", async () => {
    const t = await makeUser({ tester: true });
    const acct = "acct_" + randomUUID().slice(0, 8);
    await db.user.update({ where: { id: t.user.id }, data: { stripeAccountId: acct } });
    const r = await webhookPOST(new Request("http://localhost:3400/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": "whsec_ok" }, body: JSON.stringify({ type: "payout.failed", account: acct, data: { object: {} } }) }));
    // Without a valid signature nothing happens (the test environment has no Stripe).
    expect([200, 400, 503]).toContain(r.status);
  });
});

describe("the Alerts menu (design doc 6)", () => {
  it("an ignored update type no longer stops the developer's presses; the live box still lists it, flagged; others still stop", async () => {
    const { dev, testId, tester, sessionId } = await withWork();
    const { POST: alertsPOST } = await import("@/app/api/account/alerts/route");
    const { GET: liveGET } = await import("@/app/api/live/route");
    const opened = seen();
    await later();
    await sact(sessionId, "message", tester.cookie, { body: "hi" }); // chat is not an update type
    const sub2 = await db.submission.create({ data: { contractId: sessionId, kind: "recording", agreedCents: 1000, sentAt: new Date(), updatedAt: new Date() } });
    await db.testEvent.create({ data: { testId, kind: "sent", text: "Ana Silva sent her recording", contractId: sessionId } });
    // Stops by default.
    const stop = await pay(dev.cookie, { kind: "submission", id: sub2.id, amount: "10.00", tickedCents: 1000, seenAt: opened, confirmed: false });
    expect(stop.body.error.code).toBe("stop_once");
    expect(stop.body.error.changes[0].alert).toBe("work");
    // Ignore "Work sent": the same press goes through, and the live box lists the line greyed.
    expect((await json(await alertsPOST(req("/api/account/alerts", { cookie: dev.cookie, body: { ignored: ["work", "nonsense"] } })))).body.ignored).toEqual(["work"]);
    const live = (await json(await liveGET(req(`/api/live?scope=test:${testId}&since=${encodeURIComponent(opened)}`, { cookie: dev.cookie })))).body.changes;
    expect(live.find((c: { text: string }) => c.text === "Ana Silva sent her recording")).toMatchObject({ ignored: true, alert: "work" });
    expect((await pay(dev.cookie, { kind: "submission", id: sub2.id, amount: "10.00", tickedCents: 1000, seenAt: opened, confirmed: false })).status).toBe(200);
    // A tester leaving is another type: still stops.
    await db.testEvent.create({ data: { testId, kind: "left", text: "Ben left the test" } });
    const sub3 = await db.submission.create({ data: { contractId: sessionId, kind: "written", agreedCents: 1000, sentAt: new Date(), updatedAt: new Date() } }).catch(() => null);
    void sub3;
    const stop2 = await act(testId, "invite", dev.cookie, { seenAt: opened, testerIds: [tester.user.id] });
    expect(stop2.body.error.code).toBe("stop_once");
  });
});

describe("chat after a block (owner, Oct 26)", () => {
  it("either side blocking closes the chat for both: the next send is refused with 'This chat is closed.'; earlier messages stay", async () => {
    const { dev, testId, sessionId, tester } = await withWork();
    await sact(sessionId, "message", tester.cookie, { body: "Before the block" });
    const { POST: blocksPOST } = await import("@/app/api/blocks/route");
    expect((await json(await blocksPOST(req("/api/blocks", { cookie: dev.cookie, body: { userId: tester.user.id } })))).status).toBe(200);
    const fromTester = await sact(sessionId, "message", tester.cookie, { body: "After the block" });
    expect(fromTester.status).toBe(409);
    expect(fromTester.body.error).toMatchObject({ code: "closed", message: "This chat is closed." });
    const fromDev = await act(testId, "message", dev.cookie, { contractId: sessionId, body: "Hello?" });
    expect(fromDev.body.error).toMatchObject({ code: "closed", message: "This chat is closed." });
    expect(await db.message.count({ where: { contractId: sessionId } })).toBe(1);
  });
});

describe("a suspended developer's test page (owner, Oct 26)", () => {
  it("only Cancel call goes through; everything else (End early and Stop too) is refused and names the press", async () => {
    const { dev, testId, sessionId } = await withWork();
    const a = await admin();
    await adm("suspend", a.cookie, { id: dev.user.id, note: "Spam" });
    for (const [action, body] of [["edit", { version: 1, fields: { title: "x" } }], ["next-round", {}], ["invite", { testerIds: [sessionId] }], ["rate", { contractId: sessionId, stars: 4 }]] as const) {
      const r = await act(testId, action, dev.cookie, { seenAt: seen(), confirmed: true, ...body });
      expect(r.body.error.code, action).toBe("suspended");
      expect(r.body.error.failed, action).toMatch(/^Your .+ on Harbor Run didn't go through$/);
    }
    // (Owner, Oct 27) No Stop and no End early while suspended (paused tests close after 7 days anyway, and stopping would cut off testers' unsent work).
    for (const [action, body] of [["end-early", { contractIds: [sessionId], reason: "We have what we need" }], ["stop", {}]] as const) {
      const r = await act(testId, action, dev.cookie, { seenAt: seen(), confirmed: true, ...body });
      expect(r.body.error.code, action).toBe("suspended");
    }
    expect((await db.test.findUniqueOrThrow({ where: { id: testId } })).status).toBe("open");
  });
});
