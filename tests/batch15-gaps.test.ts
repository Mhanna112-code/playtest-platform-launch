import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { adminStopTest } from "@/lib/server/restrictions";
import { renderTimes } from "@/lib/tz";
import { act, atHours, joined, sact, seen, setup } from "./fixtures";
import { pay } from "./b15";

// Batch 15 sections 32, 35 and 38: the rule checklist's gaps and the recorder's findings.
const src = (p: string) => fs.readFileSync(path.resolve(__dirname, "../src", p), "utf8");

describe("rule checklist gaps (section 35)", () => {
  it("a tester's call request is a bell line for the developer, stacked with the day's request lines", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const at = atHours(50);
    expect((await sact(sessionId, "request-time", tester.cookie, { startsAt: at, seenAt: seen(), confirmed: true })).status).toBe(200);
    const n = await db.notification.findFirstOrThrow({ where: { userId: dev.user.id, groupKey: "callrequests" } });
    expect(n.text).toBe(`Ana Silva asked for a call: ${renderTimes(`⟦t:${new Date(at).toISOString()}:datetime⟧`, null)}`);
  });

  it("the admin's Stop takes the same lock as the developer's: the second is refused", async () => {
    const { dev, testId } = await setup();
    expect((await act(testId, "stop", dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true })).status).toBe(200);
    await expect(adminStopTest(testId, "Spam", null)).rejects.toMatchObject({ message: expect.stringMatching(new RegExp(`^That test was already stopped \\(by ${dev.user.email.replace(/[.+]/g, "\\$&")} at .+\\)\\.$`)) }); // (batch 34 §1) who and when
  });

  it("a new dispute's live line opens its Needs you row; the dashboard's Needs you has excerpt requests and links applications to their own rows", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "0", reason: "Nothing usable" })).status).toBe(200);
    expect((await sact(sessionId, "dispute", tester.cookie, { kind: "submission", id: sub.id, reason: "I answered every question in full.", seenAt: seen(), confirmed: true })).status).toBe(200);
    const d = await db.dispute.findFirstOrThrow({ where: { submissionId: sub.id } });
    expect((await db.testEvent.findFirstOrThrow({ where: { testId, kind: "dispute" } })).link).toBe(`item-dispute-${d.id}`);
    const dash = src("app/app/page.tsx");
    expect(dash).toContain("href: `/app/tests/${x.testId}#excerpt-${x.id}`");
    expect(dash).toContain("#item-app-${a.id}");
    expect(src("app/app/tests/[id]/Applications.tsx")).toContain("id={`item-app-${a.id}`}");
    expect(src("components/LiveTop.tsx")).toContain("jumpTo(l.link!)");
  });
});

describe("reasons never ride in bell lines (section 20)", () => {
  it("a Pay note, a dispute, a call cancellation and an End early reason are in the emails and on the pages, never in a bell line", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    const NOTE = "Zebra-note-1", WHY = "Zebra-dispute-2", END = "Zebra-end-3";
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "0", reason: NOTE })).status).toBe(200);
    expect((await sact(sessionId, "dispute", tester.cookie, { kind: "submission", id: sub.id, reason: `${WHY} I answered all of it.`, seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await act(testId, "end-early", dev.cookie, { contractIds: [sessionId], reason: END, seenAt: seen(), confirmed: true })).status).toBe(200);
    const bells = await db.notification.findMany({ where: { OR: [{ userId: dev.user.id }, { userId: tester.user.id }] } });
    expect(bells.length).toBeGreaterThan(2);
    for (const b of bells) expect(b.text).not.toMatch(/Zebra-/);
    // The reason stays with the contract, shown on the tester's page in italics.
    expect((await db.contract.findUniqueOrThrow({ where: { id: sessionId } })).endReason).toBe(END);
    expect(src("app/app/sessions/[id]/page.tsx")).toContain("<ReasonQuote text={c.endReason} />");
  });
});

describe("the recorder's findings and the owner's answers (sections 32 and 38)", () => {
  it("a part whose developer deleted their account reads 'Can't be paid', not 'Under review'; a test that became invite only stays on the tester's dashboard, marked", () => {
    expect(src("app/app/sessions/[id]/page.tsx")).toContain("developerDeleted={devGone && !(x.rateCents != null && c.test.developer.stripePaymentMethodId) ? devRealName : null}");
    expect(src("app/app/page.tsx")).toContain("Closed to new testers (invite only)");
  });
});
