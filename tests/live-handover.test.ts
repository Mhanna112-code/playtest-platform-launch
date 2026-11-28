import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { json, req } from "./helpers";
import { act, bookCall, joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 28) The end of her work, a call the developer cancelled and his payment, picked up in the same live check: the page redraws with the part ended
// (a new render time), but the seen marker a press sends moves past those lines only once the live notice has shown them (tests/live-handover-ui.test.ts).
// Until then a press stops once for both, like every other change; once they showed, they never stop it.
const texts = (r: { body: { error?: { changes?: { text: string }[] } } }) => (r.body.error?.changes ?? []).map((c) => c.text);
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);

describe("the end of her work with a call change and a payment in the same live check (owner, Nov 28)", () => {
  it("a press with the marker from before them stops for both; with the marker after the notice showed them it goes ahead", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    expect((await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"], seenAt: seen(), confirmed: true })).status).toBe(200);
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId, kind: "written" } });
    const call = await bookCall(testId, dev.cookie, sessionId, tester.cookie, 96);
    await settle();
    const shownUpTo = seen(); // what the live notice had shown before the check that picked the three up
    await settle();
    expect((await act(testId, "cancel-call", dev.cookie, { seenAt: seen(), confirmed: true, callId: call.id })).status).toBe(200);
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "4.00", tickedCents: 400, reason: "Short answers" })).status).toBe(200);
    expect((await act(testId, "end-early", dev.cookie, { contractIds: [sessionId], reason: "We have enough", seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await db.contract.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe("ended");
    await settle();
    const redrawn = seen(); // the page drawn again with the part ended
    await settle();

    const dispute = (seenAt: string, extra: Record<string, unknown> = {}) =>
      sact(sessionId, "dispute", tester.cookie, { kind: "submission", id: sub.id, reason: "I answered every question in full.", seenAt, pageSeenAt: redrawn, loadedAt: shownUpTo, ...extra });
    const first = await dispute(shownUpTo);
    expect(first.body.error?.code, JSON.stringify(first.body)).toBe("stop_once");
    const lines = texts(first);
    expect(lines.some((t) => /^Your call with Nora Lane on .+ was cancelled$/.test(t)), lines.join(" | ")).toBe(true);
    expect(lines.some((t) => /paid \$4\.00 for your written answers/.test(t)), lines.join(" | ")).toBe(true);
    // The payment is on the part Dispute is about: it stops whatever her Alerts.
    expect(first.body.error.changes.find((c: { text: string; forced?: boolean }) => /paid \$4\.00/.test(c.text)).forced).toBe(true);

    // The notice showed them (its check's time is the marker now): nothing stops the press for them, the page's first load notwithstanding.
    await settle();
    const shown = await dispute(seen());
    expect(shown.status, JSON.stringify(shown.body)).toBe(200);
  }, 60_000);
});
