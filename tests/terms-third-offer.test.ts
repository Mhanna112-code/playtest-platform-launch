import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { act, joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Dec 10 2026) Switch / Keep's second press (from the "changed the terms again" box) never takes terms the page never showed: terms that arrived after
// the box stop it once again, naming them.

const editPrice = async (testId: string, cookie: string, price: string) =>
  act(testId, "edit", cookie, { version: (await db.test.findUniqueOrThrow({ where: { id: testId } })).version, fields: { writtenCents: price }, seenAt: seen(), confirmed: true });
const openOffer = (contractId: string) => db.termsOffer.findFirstOrThrow({ where: { contractId, status: "open" } });
const texts = (e: { changes: { text: string }[] }) => e.changes.map((c) => c.text).join(" ");

describe("Switch / Keep: a third offer between the box and the second press", () => {
  it("offer 1 shown, offer 2 arrives → stop; offer 3 arrives before the second press → stopped again (not switched); then the third press switches to offer 3", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    expect((await editPrice(testId, dev.cookie, "12.00")).status).toBe(200);
    const o1 = await openOffer(sessionId);
    const opened = seen();
    await settle();
    expect((await editPrice(testId, dev.cookie, "14.00")).status).toBe(200);
    const o2 = await openOffer(sessionId);
    const stop = await sact(sessionId, "terms", tester.cookie, { offerId: o1.id, choice: "switch", seenAt: opened });
    expect(stop.body.error.code).toBe("stop_once");
    expect(stop.body.error.offerId).toBe(o2.id);
    expect(texts(stop.body.error)).toMatch(/changed the terms again: written \$10 → \$14/);
    await settle();
    expect((await editPrice(testId, dev.cookie, "16.00")).status).toBe(200);
    const o3 = await openOffer(sessionId);
    expect(o3.id).not.toBe(o2.id);
    // The second press (the page now names offer 2, from the box): offer 3 came after the box, so it stops once again, naming offer 3.
    const again = await sact(sessionId, "terms", tester.cookie, { offerId: o2.id, choice: "switch", seenAt: opened, confirmed: true, boxAt: stop.body.error.now });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("stop_once");
    expect(again.body.error.offerId).toBe(o3.id);
    expect(texts(again.body.error)).toMatch(/changed the terms again: written \$10 → \$16/);
    expect((await db.contract.findUniqueOrThrow({ where: { id: sessionId } })).writtenCents).toBe(1000); // not switched
    expect((await db.termsOffer.findUniqueOrThrow({ where: { id: o3.id } })).status).toBe("open");
    // Pressed again from that box: offer 3 existed at its time, so it goes ahead.
    const third = await sact(sessionId, "terms", tester.cookie, { offerId: o3.id, choice: "switch", seenAt: opened, confirmed: true, boxAt: again.body.error.now });
    expect(third.status, JSON.stringify(third.body)).toBe(200);
    expect((await db.contract.findUniqueOrThrow({ where: { id: sessionId } })).writtenCents).toBe(1600);
  });

  it("with no third offer the second press switches to offer 2 (and Keep keeps it)", async () => {
    for (const choice of ["switch", "keep"] as const) {
      const { dev, testId } = await setup();
      const { tester, sessionId } = await joined(testId);
      await editPrice(testId, dev.cookie, "12.00");
      const o1 = await openOffer(sessionId);
      const opened = seen();
      await settle();
      await editPrice(testId, dev.cookie, "14.00");
      const o2 = await openOffer(sessionId);
      const stop = await sact(sessionId, "terms", tester.cookie, { offerId: o1.id, choice, seenAt: opened });
      expect(stop.body.error.code).toBe("stop_once");
      // Even naming the offer the page first showed (an old page that didn't move to offer 2): offer 2 existed at the box's time.
      const r = await sact(sessionId, "terms", tester.cookie, { offerId: o1.id, choice, seenAt: opened, confirmed: true, boxAt: stop.body.error.now });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect((await db.termsOffer.findUniqueOrThrow({ where: { id: o2.id } })).status).toBe(choice === "switch" ? "switched" : "kept");
      expect((await db.contract.findUniqueOrThrow({ where: { id: sessionId } })).writtenCents).toBe(choice === "switch" ? 1400 : 1000);
    }
  });
});
