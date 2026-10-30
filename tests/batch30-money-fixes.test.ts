import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { TX_OPTIONS } from "@/lib/db";
import { pieceDay } from "@/lib/moneyLines";
import { ANSWER_REQUEST_VERBS, pressLabelOf } from "@/lib/pressLabels";
import { keptRefusalLine } from "@/lib/keptRefusal";
import { notShownYet } from "@/components/FieldChecks";
import { chargeOpensNote, choiceNoteLine } from "@/lib/rules";

// (Owner, Oct 29) Batch 30 §20: four bugs from the screenshot run, and small ones.
const src = (p: string) => readFileSync(path.resolve(__dirname, "..", "src", p), "utf8");

describe("batch 30 §20 (1): a piece's review / charge date is the same on both sides", () => {
  it("one helper in the reader's zone, across a midnight boundary", () => {
    // 3:30 AM UTC on Oct 31 is still Oct 30 in Chicago (10:30 PM): both sides say Oct 30 there.
    const at = new Date("2026-10-31T03:30:00Z");
    expect(pieceDay(at, "America/Chicago")).toBe("Oct 30");
    expect(pieceDay(at, "Europe/Paris")).toBe("Oct 31");
    expect(pieceDay(at, null)).toBe("Oct 31"); // no saved zone: UTC, the same for everyone
    // Just after midnight in Chicago it's the next day there.
    expect(pieceDay(new Date("2026-10-31T05:10:00Z"), "America/Chicago")).toBe("Oct 31");
    const d = pieceDay(at, "America/Chicago");
    expect(choiceNoteLine(d, "Ana Silva", 1000, "her")).toBe("If you don't pay by Oct 30, Ana Silva can charge you $10.00, her contract price, or let it go.");
    expect(chargeOpensNote("Nora Lane", d)).toBe("If Nora Lane hasn't paid by Oct 30, you can charge or let it go then.");
  });

  it("the developer's and the tester's pages (and dashboard) use it for written answers, recordings and listed calls", () => {
    const dev = src("app/app/tests/[id]/page.tsx");
    expect(dev).toContain("choiceNoteLine(pieceDay(chargeOpensAt(x.s!, t, x.c, now)!, u.timeZone),");
    expect(dev).toContain("autoChargeLine(pieceDay(x.x!.payBy, u.timeZone),");
    expect(dev).not.toContain("choiceNoteLine(fmtDate(");
    const tester = src("app/app/sessions/[id]/page.tsx");
    expect(tester).toContain("chargeOpensNote(dev, pieceDay(opens, u.timeZone))");
    expect(tester).toContain("testerAutoChargeLine(dev, pieceDay(x.payBy, u.timeZone))");
    expect(src("app/app/page.tsx")).toContain("chargeOpensNote(displayName(c.test.developer), pieceDay(opens, user.timeZone))");
  });
});

describe("batch 30 §20 (2): the kept refusal names the call request's actual button", () => {
  it("Withdraw, Accept and Decline, not Answer", () => {
    const p = "/api/sessions/abc/answer-request";
    expect(pressLabelOf(p, { requestId: "r", action: "withdraw" })).toBe("Withdraw");
    expect(pressLabelOf(p, { requestId: "r", action: "accept" })).toBe("Accept");
    expect(pressLabelOf("/api/tests/t1/answer-request", { action: "decline" })).toBe("Decline");
    expect(pressLabelOf(p)).toBe("Answer");
    expect(ANSWER_REQUEST_VERBS.withdraw).toBe("Withdraw");
    expect(keptRefusalLine(pressLabelOf(p, { action: "withdraw" }), "Nora Lane declined this request at 3:10 PM.")).toBe("Your Withdraw didn't go through: Nora Lane declined this request at 3:10 PM.");
    expect(src("lib/client.ts")).toContain("pressLabelOf(path, body)");
  });
});

describe("batch 30 §20 (3): a line the form already shows red isn't shown or counted twice", () => {
  it("the server's copy of the calls cap is dropped; other lines stay", () => {
    const cap = "Calls with Ana Silva on this test can come to at most $1,000; $20.00 is left, so this call can't be booked.";
    expect(notShownYet([cap], [cap])).toEqual([]);
    expect(notShownYet([cap, "Enter a length in minutes."], [` ${cap} `])).toEqual(["Enter a length in minutes."]);
    expect(notShownYet([cap], [""])).toEqual([cap]);
    expect(src("components/FieldChecks.tsx")).toContain("for (const msg of notShownYet(messages, shown))");
  });
});

describe("batch 30 §20 (4): money transactions get more time, and a timeout is the plain payments line", () => {
  it("the client's transaction options", () => {
    expect(TX_OPTIONS).toEqual({ maxWait: 10_000, timeout: 20_000 });
    expect(src("lib/db.ts")).toContain("new PrismaClient({ transactionOptions: TX_OPTIONS })");
  });

  it("a timed-out reservation (P2028) becomes 503 with the payments line; other errors pass through", async () => {
    const { reserving, isTxTimeout } = await import("@/lib/server/payments");
    const timeout = new Prisma.PrismaClientKnownRequestError("Transaction already closed: ... timeout was 5000 ms, however 8777 ms passed", { code: "P2028", clientVersion: "6" });
    expect(isTxTimeout(timeout)).toBe(true);
    await expect(reserving(async () => { throw timeout; })).rejects.toMatchObject({ status: 503, code: "payments_problem", message: "Payments are having a problem right now. Nothing was charged; try again shortly." });
    await expect(reserving(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await reserving(async () => 7)).toBe(7);
    // Pay's and Pay more's reservations run through it (Prisma rolls the reservation back: no review, no payment row, nothing reached Stripe).
    const s = src("lib/server/payments.ts");
    expect(s.match(/await reserving\(\(\) => db\.\$transaction\(/g)).toHaveLength(2);
  });
});

describe("batch 30 §20: the small ones", () => {
  it("no full stop after the decision's quoted note; no '0 testers on this test'; the automatic call payment in 'You were paid'", () => {
    const session = src("app/app/sessions/[id]/page.tsx");
    expect(session).toContain('`The team decided: ${money(dispute.decidedCents)} in all${dispute.decisionNote ? ` · “${dispute.decisionNote}”` : "."}`');
    expect(session).toContain('{testersIn > 0 && <span className="badge"><Users className="h-3.5 w-3.5" /> {testersIn} tester');
    expect(src("lib/server/holds.ts")).toContain('`/app/sessions/${c.id}#call-${x.id}`, { payment: true, group: "tpaid" });');
  });
});
