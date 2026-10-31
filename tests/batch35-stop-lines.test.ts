import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { devChanges, testerPaymentChanges } from "@/lib/server/live";
import { sameFiles, withoutTags } from "@/lib/answerAttachments";
import { joined, setup } from "./fixtures";

// Batch 35 §76-§78 (owner, Oct 31).
const src = (f: string) => fs.readFileSync(path.join(process.cwd(), "src", f), "utf8");
const ago = (min: number) => new Date(Date.now() - min * 60_000);

async function owedThenPaid() {
  const { dev, testId } = await setup();
  const { tester, sessionId } = await joined(testId);
  const row = await db.payment.create({ data: { kind: "review", contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 1000, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date(), createdAt: ago(8) } });
  return { dev, tester, testId, sessionId, row };
}

describe("batch 35 §76 one line per payment, its latest state", () => {
  it("a delayed payment that went through shows only the paid line (same key both ways)", async () => {
    const { tester, sessionId, row } = await owedThenPaid();
    const before = await testerPaymentChanges(tester.user.id, sessionId, ago(10));
    expect(before.map((e) => e.kind)).toEqual(["payment"]);
    expect(before[0].text).toContain("is delayed");
    await db.payment.update({ where: { id: row.id }, data: { status: "charged", settledAt: new Date() } });
    const after = await testerPaymentChanges(tester.user.id, sessionId, ago(10));
    expect(after.map((e) => e.kind)).toEqual(["paid"]);
    expect(after[0].text).toContain("paid $10.00 for your");
    // The live box's paid line replaces the delayed one it already lists.
    expect(after[0].key).toBe(before[0].key);
  });
});

describe("batch 35 §78 your own hold lifting doesn't stop you", () => {
  it("an owed payment going through shows in the live box but never stops the developer's press", async () => {
    const { dev, testId, row } = await owedThenPaid();
    await db.payment.update({ where: { id: row.id }, data: { status: "charged", settledAt: new Date() } });
    const live = await devChanges(dev.user.id, testId, ago(1), "", db, { all: true });
    expect(live.some((e) => e.text.startsWith("Payment went through on") && e.quiet)).toBe(true);
    const press = await devChanges(dev.user.id, testId, ago(1), "", db, { press: { acts: ["pay"], keys: ["*"] } } as never);
    expect(press.some((e) => e.text.startsWith("Payment went through on"))).toBe(false);
  });
  it("a failed payment still stops", async () => {
    const { dev, testId, sessionId, tester } = await owedThenPaid();
    await db.payment.create({ data: { kind: "review", contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 500, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date() } });
    const press = await devChanges(dev.user.id, testId, ago(1), "", db, { press: { acts: ["pay"], keys: ["*"] } } as never);
    expect(press.some((e) => e.text.startsWith("Payment failed on"))).toBe(true);
  });
});

describe("batch 35 §77 a re-send with nothing new isn't 'updated'", () => {
  it("compares by content: the same files, the answers' markers by file name", () => {
    expect(sameFiles([{ filename: "a.webm", sizeBytes: 5 }], [{ filename: "a.webm", sizeBytes: 5 }])).toBe(true);
    expect(sameFiles([{ filename: "a.webm", sizeBytes: 5 }], [{ filename: "a.webm", sizeBytes: 6 }])).toBe(false);
    expect(sameFiles([{ filename: "a.webm", sizeBytes: 5 }], [])).toBe(false);
    expect(withoutTags("see [📎 map.png #k3f9]")).toBe(withoutTags("see [📎 map.png #z81c]"));
    expect(withoutTags("see [📎 map.png #k3f9]")).not.toBe(withoutTags("see [📎 other.png #k3f9]"));
  });
  it("both Sends refuse an unchanged re-send with the nothing-changed line", () => {
    expect(src("lib/server/recordings.ts")).toMatch(/sameFiles\(recs, .*NOTHING_CHANGED_LINE/);
    expect(src("lib/server/tests.ts")).toMatch(/withoutTags\(x\.answer\)[\s\S]{0,400}NOTHING_CHANGED_LINE/);
  });
});
