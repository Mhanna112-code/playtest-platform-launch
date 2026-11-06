import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { renderTimes } from "@/lib/tz";
import { declinedLead, declinedPayment, startHold } from "@/lib/server/holds";
import { joined, setup } from "./fixtures";

// (Owner, Nov 6, §315) The declined payment that STARTS a payment hold names itself in the hold's one line (no extra line): "A $10.00 payment for Ana Silva's
// written answers on “Harbor Run” was declined, so your tests are paused until you pay what you owe: “Harbor Run” closes on <date>". A hold started any other way
// keeps its line; a decline during a hold keeps "Another payment was declined: …".

const DAY = 86_400_000;
const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const texts = async (userId: string) => (await db.notification.findMany({ where: { userId, groupKey: "payhold" }, orderBy: { createdAt: "asc" } })).map((n) => renderTimes(n.text, "UTC"));

describe("§315 the decline that starts the hold names itself", () => {
  it("the words", () => {
    expect(declinedLead(1000, "Ana Silva's written answers on “Harbor Run”")).toBe("A $10.00 payment for Ana Silva's written answers on “Harbor Run” was declined");
    expect(declinedLead(1000, "a payment of $10.00 (not confirmed with your bank)")).toBe("A $10.00 payment (not confirmed with your bank) was declined");
  });

  it("one line naming the payment, then the dates; a later decline adds its own line; a hold started otherwise reads as before", async () => {
    const s = await setup();
    const j = await joined(s.testId, "Ana Silva");
    const row = () => db.payment.create({ data: { kind: "review", contractId: j.sessionId, developerId: s.dev.user.id, testerId: j.tester.user.id, amountCents: 1000, feeCents: 0, testerCents: 0, status: "pending" } });
    expect(await declinedPayment(s.dev.user.id, (await row()).id, 1000, "Ana Silva's written answers on “Harbor Run”")).toBe(true);
    const at = fmt(new Date(Date.now() + 7 * DAY));
    let mine = await texts(s.dev.user.id);
    expect(mine).toEqual([`A $10.00 payment for Ana Silva's written answers on “Harbor Run” was declined, so your tests are paused until you pay what you owe: “Harbor Run” closes on ${at}`]);
    const line = await db.notification.findFirstOrThrow({ where: { userId: s.dev.user.id, groupKey: "payhold" } });
    expect(line).toMatchObject({ groupKey: "payhold", mustEmail: true, payment: true, link: "/app/payments#owed" });
    expect(await declinedPayment(s.dev.user.id, (await row()).id, 500, "Ana Silva's recording on “Harbor Run”")).toBe(false);
    mine = await texts(s.dev.user.id);
    expect(mine[1]).toBe("Another payment was declined: $5.00 for Ana Silva's recording on “Harbor Run” was added to what you owe");
    // No paused tests: it ends after "…until you pay what you owe".
    const b = await setup();
    const jb = await joined(b.testId, "Ben Ward");
    await db.test.update({ where: { id: b.testId }, data: { status: "stopped" } });
    const p = await db.payment.create({ data: { kind: "review", contractId: jb.sessionId, developerId: b.dev.user.id, testerId: jb.tester.user.id, amountCents: 800, feeCents: 0, testerCents: 0, status: "pending" } });
    await declinedPayment(b.dev.user.id, p.id, 800, "a payment of $8.00 (not confirmed with your bank)");
    expect(await texts(b.dev.user.id)).toContain("A $8.00 payment (not confirmed with your bank) was declined, so your tests are paused until you pay what you owe");
    // Started otherwise (no payment named): as before.
    const c = await setup();
    await startHold(c.dev.user.id, "unpaid");
    expect((await texts(c.dev.user.id))[0]).toMatch(/^Your tests are paused until you pay what you owe: “Harbor Run” closes on /);
  });
});
