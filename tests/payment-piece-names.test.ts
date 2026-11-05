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
import { OWED_BANK_WAIT_TAIL, owedLines, startHold } from "@/lib/server/holds";
import { partPaymentLines, partPayStatus } from "@/lib/server/partPayments";
import { joined, sact, setup } from "./fixtures";

// (Owner, Nov 2, §131) Every developer-facing payment line names WHICH tester, WHICH part and WHICH test, with one helper (pieceName): the tester's and the test's names
// cut at 12 characters with "…" (owner, Nov 5, §203: 20). On a page, the line carries its uncut version (`full`) as its hover (`title`); emails and bells use the
// full names (§202: the bell line itself is cut at 30 characters and opens whole).
(globalThis as unknown as { React: typeof React }).React = React;
vi.mock("next/navigation", () => ({ usePathname: () => "/app", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams() }));

const DAY = 86_400_000;
const LONG_TEST = "chargechargeback run deluxe";
const LONG_NAME = "Alexandria Montgomery";
/** React's markup escapes the apostrophe. */
const html = (s: string) => s.replace(/'/g, "&#x27;");

describe("§131 pieceName", () => {
  it("names the tester, the part and the test, each name cut at 20 characters with … (§203: was 12)", () => {
    expect(pieceName({ tester: "Marc Hanna", part: "written answers", test: "chargechargebackchargeback" })).toBe("Marc Hanna's written answers on “chargechargebackchar…”");
    expect(pieceName({ tester: LONG_NAME, part: "recording", test: "Run" })).toBe("Alexandria Montgomer…'s recording on “Run”");
    expect(pieceName({ tester: "Ana Silva", part: "live call", test: "Harbor Run", when: "Oct 30" })).toBe("Ana Silva's live call on “Harbor Run” (Oct 30)");
    // `full`: the hover's uncut names.
    expect(pieceName({ tester: LONG_NAME, part: "recording", test: LONG_TEST, full: true })).toBe("Alexandria Montgomery's recording on “chargechargeback run deluxe”");
    expect(cut10("chargechargebackchargeback")).toBe("chargechargebackchar…");
    expect(cut10("Harbor Run")).toBe("Harbor Run");
    expect(disputeDecisionName(pieceName({ tester: "Marc Hanna", part: "recording", test: "chargechargebackchargeback" }))).toBe("the team's dispute decision on Marc Hanna's recording on “chargechargebackchar…”");
    expect([partOf("c1", null), partOf(null, "recording"), partOf(null, "written"), partOf(null, null)]).toEqual(["live call", "recording", "written answers", "work"]);
  });

  it("the reversed-payment line uses it, and has an uncut version", () => {
    const paidFor = { name: "Marc Hanna", part: "written answers", test: "delaytestdelaytestdelay", date: "Nov 2" };
    expect(chargebackOwedLine(1000, paidFor)).toBe("Your bank reversed $10 you paid for Marc Hanna's written answers on “delaytestdelaytestde…” (Nov 2): $10 + $15 chargeback fee");
    expect(chargebackOwedLine(1000, paidFor, true)).toBe("Your bank reversed $10 you paid for Marc Hanna's written answers on “delaytestdelaytestdelay” (Nov 2): $10 + $15 chargeback fee");
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
  it("a dispute decision waiting for the bank names its piece on Payments, the dashboard and the test page; the full names open with the arrow (§230)", async () => {
    const w = await world();
    const p = await db.payment.create({ data: { ...w.base, kind: "dispute", submissionId: w.written.id, amountCents: 32000, ...bankWait() } });
    const [item] = await confirmItems(w.dev.user.id);
    expect(item.text).toMatch(/^The team's dispute decision on Alexandria Montgomer…'s written answers on “chargechargeback run…” \$320\.00 · confirm by /);
    expect(item.full).toMatch(/^The team's dispute decision on Alexandria Montgomery's written answers on “chargechargeback run deluxe” \$320\.00 · confirm by /);
    // (§230) The cut line opens with the arrow (and each "…" its name), never a hover.
    const listHtml = renderToStaticMarkup(createElement(ConfirmList, { items: [item] }));
    expect(listHtml).toContain(`title="${html(item.full)}"`); // (§244) a hover shows the whole line too
    expect(listHtml).toContain('data-whole-toggle=""');
    const [row] = await bankToConfirm(w.dev.user.id);
    expect(row).toMatchObject({ id: p.id, lead: "$320.00 · the team's dispute decision on Alexandria Montgomer…'s written answers on “chargechargeback run…”", full: "$320.00 · the team's dispute decision on Alexandria Montgomery's written answers on “chargechargeback run deluxe”" });
    const boxHtml = renderToStaticMarkup(createElement(BankToConfirmBox, { rows: [row] }));
    expect(boxHtml).toContain(`title="${html(row.full)}"`); // (§244) a hover shows the whole line too
    expect(boxHtml).toContain('data-whole-toggle=""');
    const [onTest] = await bankWaitingOnTest(w.dev.user.id, w.testId);
    expect(onTest.line).toMatch(/^Your bank wants you to confirm a \$320\.00 payment for the team's dispute decision on her written answers, made while you were away\./); // (Owner, Nov 4, §175) under the tester's name; (§180) no test name on its own page
    expect(onTest.full).toContain("for the team's dispute decision on her written answers, made while you were away.");
    expect(onTest.full).not.toContain("chargecharge");
  });

  it("the owner's example: one payment for charges made while away lists each item in the new form", async () => {
    const w = await world();
    const one = await db.payment.create({ data: { kind: "owed", developerId: w.dev.user.id, testerId: w.dev.user.id, amountCents: 41600, feeCents: 41600, testerCents: 0, transferStatus: "none", note: "away:charges", ...bankWait() } });
    await db.payment.create({ data: { ...w.base, kind: "dispute", submissionId: w.written.id, amountCents: 32000, status: "deferred", coveredById: one.id, createdAt: new Date(Date.now() - 2000) } });
    await db.payment.create({ data: { ...w.base, kind: "dispute", submissionId: w.recording.id, amountCents: 9600, status: "deferred", coveredById: one.id, createdAt: new Date(Date.now() - 1000) } });
    const [item] = await confirmItems(w.dev.user.id);
    expect(item.text).toMatch(/^Charges made while you were away \$416\.00 \(the team's dispute decision on Alexandria Montgomer…'s written answers on “chargechargeback run…” \$320\.00, the team's dispute decision on Alexandria Montgomer…'s recording on “chargechargeback run…” \$96\.00\) · confirm by /);
    expect(item.full).toContain("(the team's dispute decision on Alexandria Montgomery's written answers on “chargechargeback run deluxe” $320.00, the team's dispute decision on Alexandria Montgomery's recording on “chargechargeback run deluxe” $96.00)");
    expect((await bankToConfirm(w.dev.user.id))[0].lead).toBe("$416.00 · charges made while you were away (the team's dispute decision on Alexandria Montgomer…'s written answers on “chargechargeback run…” $320.00, the team's dispute decision on Alexandria Montgomer…'s recording on “chargechargeback run…” $96.00)");
  });
});

describe("§131 the owed box", () => {
  it("each line names the tester, the part and the test; (§216) a cut line opens its full names with the arrow, not a hover", async () => {
    const w = await world();
    await db.payment.create({ data: { ...w.base, kind: "review", submissionId: w.written.id, amountCents: 800, status: "failed", owedUntil: new Date(), createdAt: new Date(Date.now() - 2000) } });
    await db.payment.create({ data: { ...w.base, kind: "dispute", submissionId: w.recording.id, amountCents: 9600, status: "owed", createdAt: new Date(Date.now() - 1000) } });
    await startHold(w.dev.user.id, "unpaid");
    const lines = await owedLines(w.dev.user.id);
    expect(lines.map((l) => l.text)).toEqual([
      expect.stringMatching(/^Alexandria Montgomer…'s written answers on “chargechargeback run…” \$8\.00 · card declined /),
      "The team's dispute decision on Alexandria Montgomer…'s recording on “chargechargeback run…” $96.00 · decided while your tests were paused",
    ]);
    expect(lines.map((l) => l.full)).toEqual([
      expect.stringMatching(/^Alexandria Montgomery's written answers on “chargechargeback run deluxe” \$8\.00 · card declined /),
      "The team's dispute decision on Alexandria Montgomery's recording on “chargechargeback run deluxe” $96.00 · decided while your tests were paused",
    ]);
    const box = renderToStaticMarkup(createElement(OwedBox, { onHold: true, owed: lines }));
    for (const l of lines.filter((x) => x.full !== x.text)) expect(box).toContain(`title="${html(l.full)}"`); // (§244) a hover shows the whole line too
    expect(box.match(/data-whole-toggle=""/g)?.length).toBe(lines.filter((l) => l.full !== l.text).length);
    // (§202) The bell for a later decline names them in full (the bell cuts the line itself at 30 characters, and opens it whole).
    const failed = await db.payment.create({ data: { ...w.base, kind: "review", submissionId: w.recording.id, amountCents: 500, status: "pending" } });
    await (await import("@/lib/server/holds")).declinedPayment(w.dev.user.id, failed.id, 500, pieceName({ tester: LONG_NAME, part: "recording", test: LONG_TEST, full: true }));
    expect(await db.notification.count({ where: { userId: w.dev.user.id, text: "Another payment was declined: $5.00 for Alexandria Montgomery's recording on “chargechargeback run deluxe” was added to what you owe" } })).toBe(1);
  });
});

describe("a charge paused by a hold that started after it (owner, Nov 2)", () => {
  it("reads 'waiting until your tests resume', not '… while your tests were paused'", async () => {
    const w = await world();
    await db.payment.create({ data: { ...w.base, kind: "review", submissionId: w.written.id, amountCents: 800, status: "failed", owedUntil: new Date(), createdAt: new Date(Date.now() - 3000) } });
    await db.payment.create({ data: { ...w.base, kind: "dispute", submissionId: w.recording.id, amountCents: 9600, status: "deferred", createdAt: new Date(Date.now() - 2000) } });
    await startHold(w.dev.user.id, "unpaid");
    const lines = await owedLines(w.dev.user.id);
    expect(lines.map((l) => l.text)).toContain("The team's dispute decision on Alexandria Montgomer…'s recording on “chargechargeback run…” $96.00 · waiting until your tests resume");
  });
});

describe("§240 a charge made before the hold that's waiting for the bank (owner, Nov 5)", () => {
  it("reads 'waiting for your bank (Confirm with your bank)' when its check is open (Pay what you owe's one payment covering it); one waiting for the lift keeps its line", async () => {
    const w = await world();
    await db.payment.create({ data: { ...w.base, kind: "review", submissionId: w.written.id, amountCents: 800, status: "failed", owedUntil: new Date(), createdAt: new Date(Date.now() - 3000) } });
    const waits = await db.payment.create({ data: { ...w.base, kind: "dispute", submissionId: w.recording.id, amountCents: 9600, status: "deferred", createdAt: new Date(Date.now() - 2000) } });
    await startHold(w.dev.user.id, "unpaid");
    const tail = (lines: { id: string; text: string }[]) => lines.find((l) => l.id === waits.id)!.text.split(" · ").pop();
    expect(tail(await owedLines(w.dev.user.id))).toBe("waiting until your tests resume");
    // Pay what you owe pressed: its one payment covers the charge and its bank check is open.
    const one = await db.payment.create({ data: { kind: "owed", developerId: w.dev.user.id, testerId: w.dev.user.id, amountCents: 10400, feeCents: 10400, testerCents: 0, transferStatus: "none", note: "press", ...bankWait() } });
    await db.payment.update({ where: { id: waits.id }, data: { coveredById: one.id } });
    const lines = await owedLines(w.dev.user.id);
    expect(tail(lines)).toBe(OWED_BANK_WAIT_TAIL);
    expect(OWED_BANK_WAIT_TAIL).toBe("waiting for your bank (Confirm with your bank)");
    expect(lines.find((l) => l.id === waits.id)!.text).toBe("The team's dispute decision on Alexandria Montgomer…'s recording on “chargechargeback run…” $96.00 · waiting for your bank (Confirm with your bank)");
    // The check ended (cancelled, nothing charged): it waits for the lift again.
    await db.payment.update({ where: { id: one.id }, data: { status: "cancelled", actionPi: null } });
    expect(tail(await owedLines(w.dev.user.id))).toBe("waiting until your tests resume");
    // Its own check open (a check made before §117): the bank too.
    await db.payment.update({ where: { id: waits.id }, data: { coveredById: null, actionPi: "pi_" + randomUUID() } });
    expect(tail(await owedLines(w.dev.user.id))).toBe(OWED_BANK_WAIT_TAIL);
  });

  it("a part's payments (the developer's test page) use the same rule: the bank wording only while its check is open, else the lift's line", async () => {
    const w = await world();
    const waits = await db.payment.create({ data: { ...w.base, kind: "dispute", submissionId: w.recording.id, amountCents: 9600, status: "deferred" } });
    const status = async () => (await partPaymentLines(await db.payment.findMany({ where: { contractId: w.sessionId } }), (d) => d.toISOString())).get(w.recording.id)!.find((l) => l.id === waits.id)!.status;
    expect(await status()).toBe("waiting until your tests resume");
    const one = await db.payment.create({ data: { kind: "owed", developerId: w.dev.user.id, testerId: w.dev.user.id, amountCents: 9600, feeCents: 9600, testerCents: 0, transferStatus: "none", note: "press", ...bankWait() } });
    await db.payment.update({ where: { id: waits.id }, data: { coveredById: one.id } });
    expect(await status()).toBe(OWED_BANK_WAIT_TAIL);
    await db.payment.update({ where: { id: one.id }, data: { status: "cancelled", actionPi: null } });
    expect(await status()).toBe("waiting until your tests resume");
    expect(partPayStatus({ status: "deferred" }, null, true)).toBe(OWED_BANK_WAIT_TAIL);
  });
});
