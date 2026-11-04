import { randomUUID } from "node:crypto";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { BankToConfirmBox } from "@/app/app/BankToConfirm";
import { ConfirmList } from "@/app/app/payments/ConfirmList";
import { OwedBox } from "@/components/OwedBox";
import { chargebackOwedLine, cut10, disputeDecisionName, partOf, pieceName } from "@/lib/rules";
import { bankToConfirm, bankWaitingOnTest, confirmItems } from "@/lib/server/confirm";
import { owedLines, startHold } from "@/lib/server/holds";
import { joined, sact, setup } from "./fixtures";

// (Owner, Nov 2, §131) Every developer-facing payment line names WHICH tester, WHICH part and WHICH test, with one helper (pieceName): the tester's and the test's names
// cut at 12 characters with "…". On a page, the line carries its uncut version (`full`) as its hover (`title`); emails and bells stay cut.
(globalThis as unknown as { React: typeof React }).React = React;
vi.mock("next/navigation", () => ({ usePathname: () => "/app", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams() }));

const DAY = 86_400_000;
const LONG_TEST = "chargechargeback run";
const LONG_NAME = "Alexandria Montgomery";
/** React's markup escapes the apostrophe. */
const html = (s: string) => s.replace(/'/g, "&#x27;");

describe("§131 pieceName", () => {
  it("names the tester, the part and the test, each name cut at 12 characters with …", () => {
    expect(pieceName({ tester: "Marc Hanna", part: "written answers", test: "chargechargeback" })).toBe("Marc Hanna's written answers on “chargecharge…”");
    expect(pieceName({ tester: LONG_NAME, part: "recording", test: "Run" })).toBe("Alexandria M…'s recording on “Run”");
    expect(pieceName({ tester: "Ana Silva", part: "live call", test: "Harbor Run", when: "Oct 30" })).toBe("Ana Silva's live call on “Harbor Run” (Oct 30)");
    // `full`: the hover's uncut names.
    expect(pieceName({ tester: LONG_NAME, part: "recording", test: LONG_TEST, full: true })).toBe("Alexandria Montgomery's recording on “chargechargeback run”");
    expect(cut10("chargechargeback")).toBe("chargecharge…");
    expect(cut10("Harbor Run")).toBe("Harbor Run");
    expect(disputeDecisionName(pieceName({ tester: "Marc Hanna", part: "recording", test: "chargechargeback" }))).toBe("the team's dispute decision on Marc Hanna's recording on “chargecharge…”");
    expect([partOf("c1", null), partOf(null, "recording"), partOf(null, "written"), partOf(null, null)]).toEqual(["live call", "recording", "written answers", "work"]);
  });

  it("the reversed-payment line uses it, and has an uncut version", () => {
    const paidFor = { name: "Marc Hanna", part: "written answers", test: "delaytestdelaytest", date: "Nov 2" };
    expect(chargebackOwedLine(1000, paidFor)).toBe("Your bank reversed $10 you paid for Marc Hanna's written answers on “delaytestdel…” (Nov 2): $10 + $15 chargeback fee");
    expect(chargebackOwedLine(1000, paidFor, true)).toBe("Your bank reversed $10 you paid for Marc Hanna's written answers on “delaytestdelaytest” (Nov 2): $10 + $15 chargeback fee");
  });
});

/** A developer with Alexandria Montgomery on "chargechargeback run": her written answers and a recording sent. */
async function world() {
  const { dev, testId } = await setup();
  const { tester, sessionId } = await joined(testId, LONG_NAME);
  await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
  const written = await db.submission.findFirstOrThrow({ where: { contractId: sessionId, kind: "written" } });
  const recording = await db.submission.create({ data: { contractId: sessionId, kind: "recording" } });
  await db.test.update({ where: { id: testId }, data: { title: LONG_TEST } });
  await db.contract.update({ where: { id: sessionId }, data: { title: LONG_TEST } });
  const base = { contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, feeCents: 0, testerCents: 0 };
  return { dev, testId, tester, sessionId, written, recording, base };
}
const bankWait = () => ({ status: "needs_confirmation", actionPi: "pi_" + randomUUID(), actionBy: new Date(Date.now() + 2 * DAY) });

describe("§131 the bank-confirm items", () => {
  it("a dispute decision waiting for the bank names its piece on Payments, the dashboard and the test page; the full names are the hover", async () => {
    const w = await world();
    const p = await db.payment.create({ data: { ...w.base, kind: "dispute", submissionId: w.written.id, amountCents: 32000, ...bankWait() } });
    const [item] = await confirmItems(w.dev.user.id);
    expect(item.text).toMatch(/^The team's dispute decision on Alexandria M…'s written answers on “chargecharge…” \$320\.00 · confirm by /);
    expect(item.full).toMatch(/^The team's dispute decision on Alexandria Montgomery's written answers on “chargechargeback run” \$320\.00 · confirm by /);
    expect(renderToStaticMarkup(createElement(ConfirmList, { items: [item] }))).toContain(`title="${html(item.full)}"`);
    const [row] = await bankToConfirm(w.dev.user.id);
    expect(row).toMatchObject({ id: p.id, lead: "$320.00 · the team's dispute decision on Alexandria M…'s written answers on “chargecharge…”", full: "$320.00 · the team's dispute decision on Alexandria Montgomery's written answers on “chargechargeback run”" });
    expect(renderToStaticMarkup(createElement(BankToConfirmBox, { rows: [row] }))).toContain(`title="${html(`${row.full} · ${row.by}`)}"`);
    const [onTest] = await bankWaitingOnTest(w.dev.user.id, w.testId);
    expect(onTest.line).toMatch(/^Your bank wants you to confirm a \$320\.00 payment for the team's dispute decision on her written answers on “chargecharge…”, made while you were away\./); // (Owner, Nov 4, §175) under the tester's name
    expect(onTest.full).toContain("for the team's dispute decision on her written answers on “chargechargeback run”, made while you were away.");
  });

  it("the owner's example: one payment for charges made while away lists each item in the new form", async () => {
    const w = await world();
    const one = await db.payment.create({ data: { kind: "owed", developerId: w.dev.user.id, testerId: w.dev.user.id, amountCents: 41600, feeCents: 41600, testerCents: 0, transferStatus: "none", note: "away:charges", ...bankWait() } });
    await db.payment.create({ data: { ...w.base, kind: "dispute", submissionId: w.written.id, amountCents: 32000, status: "deferred", coveredById: one.id, createdAt: new Date(Date.now() - 2000) } });
    await db.payment.create({ data: { ...w.base, kind: "dispute", submissionId: w.recording.id, amountCents: 9600, status: "deferred", coveredById: one.id, createdAt: new Date(Date.now() - 1000) } });
    const [item] = await confirmItems(w.dev.user.id);
    expect(item.text).toMatch(/^Charges made while you were away \$416\.00 \(the team's dispute decision on Alexandria M…'s written answers on “chargecharge…” \$320\.00, the team's dispute decision on Alexandria M…'s recording on “chargecharge…” \$96\.00\) · confirm by /);
    expect(item.full).toContain("(the team's dispute decision on Alexandria Montgomery's written answers on “chargechargeback run” $320.00, the team's dispute decision on Alexandria Montgomery's recording on “chargechargeback run” $96.00)");
    expect((await bankToConfirm(w.dev.user.id))[0].lead).toBe("$416.00 · charges made while you were away (the team's dispute decision on Alexandria M…'s written answers on “chargecharge…” $320.00, the team's dispute decision on Alexandria M…'s recording on “chargecharge…” $96.00)");
  });
});

describe("§131 the owed box", () => {
  it("each line names the tester, the part and the test; the line's hover has the full names", async () => {
    const w = await world();
    await db.payment.create({ data: { ...w.base, kind: "review", submissionId: w.written.id, amountCents: 800, status: "failed", owedUntil: new Date(), createdAt: new Date(Date.now() - 2000) } });
    await db.payment.create({ data: { ...w.base, kind: "dispute", submissionId: w.recording.id, amountCents: 9600, status: "owed", createdAt: new Date(Date.now() - 1000) } });
    await startHold(w.dev.user.id, "unpaid");
    const lines = await owedLines(w.dev.user.id);
    expect(lines.map((l) => l.text)).toEqual([
      expect.stringMatching(/^Alexandria M…'s written answers on “chargecharge…” \$8\.00 · card declined /),
      "The team's dispute decision on Alexandria M…'s recording on “chargecharge…” $96.00 · decided while your tests were paused",
    ]);
    expect(lines.map((l) => l.full)).toEqual([
      expect.stringMatching(/^Alexandria Montgomery's written answers on “chargechargeback run” \$8\.00 · card declined /),
      "The team's dispute decision on Alexandria Montgomery's recording on “chargechargeback run” $96.00 · decided while your tests were paused",
    ]);
    const box = renderToStaticMarkup(createElement(OwedBox, { onHold: true, owed: lines }));
    for (const l of lines) expect(box).toContain(`title="${html(l.full)}"`);
    // The bell for a later decline stays cut (no hover in a bell or an email).
    const failed = await db.payment.create({ data: { ...w.base, kind: "review", submissionId: w.recording.id, amountCents: 500, status: "pending" } });
    await (await import("@/lib/server/holds")).declinedPayment(w.dev.user.id, failed.id, 500, pieceName({ tester: LONG_NAME, part: "recording", test: LONG_TEST }));
    expect(await db.notification.count({ where: { userId: w.dev.user.id, text: "Another payment was declined: $5.00 for Alexandria M…'s recording on “chargecharge…” was added to what you owe" } })).toBe(1);
  });
});

describe("a charge paused by a hold that started after it (owner, Nov 2)", () => {
  it("reads 'waiting until your tests resume', not '… while your tests were paused'", async () => {
    const w = await world();
    await db.payment.create({ data: { ...w.base, kind: "review", submissionId: w.written.id, amountCents: 800, status: "failed", owedUntil: new Date(), createdAt: new Date(Date.now() - 3000) } });
    await db.payment.create({ data: { ...w.base, kind: "dispute", submissionId: w.recording.id, amountCents: 9600, status: "deferred", createdAt: new Date(Date.now() - 2000) } });
    await startHold(w.dev.user.id, "unpaid");
    const lines = await owedLines(w.dev.user.id);
    expect(lines.map((l) => l.text)).toContain("The team's dispute decision on Alexandria M…'s recording on “chargecharge…” $96.00 · waiting until your tests resume");
  });
});
