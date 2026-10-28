import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { roundedMoneyText, toCents } from "@/lib/format";
import { checkPay } from "@/lib/rules";
import { json, req } from "./helpers";
import { joined, sact, seen, setup } from "./fixtures";

// Batch 16 section 36: money boxes round to cents (half up) instead of refusing; limits apply to the rounded value.
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);

describe("money rounds to the cent (section 36)", () => {
  it("toCents rounds half up from the digits; letters, negatives and empty stay refused", () => {
    expect(toCents("1.4545")).toBe(145);
    expect(toCents("2.005")).toBe(201);
    expect(toCents("0.495")).toBe(50);
    expect(toCents("0.494")).toBe(49);
    expect(toCents("0.004")).toBe(0);
    expect(toCents("$7.5")).toBe(750);
    expect(toCents(1.4545)).toBe(145);
    for (const bad of ["abc", "-1", "", "1.2.3", "1,50"]) expect(toCents(bad), bad).toBeNull();
    expect(toCents(-2)).toBeNull();
    expect(roundedMoneyText("1.4545")).toBe("1.45");
    expect(roundedMoneyText("0.495")).toBe("0.50");
    expect(roundedMoneyText("abc")).toBe("abc");
  });

  it("limits apply to the rounded value: 0.494 is under the smallest card charge; 0.004 is $0.00", () => {
    expect(checkPay(toCents("0.494"), 1000, "", 0).ok).toBe(false);
    expect(checkPay(toCents("0.495"), 1000, "Short answers", 50).ok).toBe(true);
  });

  it("(server) a Pay sent as 1.4545 is charged $1.45", async () => {
    const { dev, testId } = await setup();
    const j = await joined(testId);
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    const r = await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "1.4545", tickedCents: 145, reason: "Short answers, partly done." });
    expect(r.status).toBe(200);
    expect(r.body.amountCents).toBe(145);
  });

  it("(client) money boxes round when left", () => {
    expect(src("components/FieldChecks.tsx")).toContain("if (e.target instanceof HTMLInputElement && e.target.dataset.money != null) roundMoneyBox(e.target);");
    expect(src("app/app/tests/TestForm.tsx")).toContain('inputMode="decimal" data-money=""');
    expect(src("app/admin/DisputeDecision.tsx")).toContain('data-money=""');
    expect(src("app/app/tests/[id]/PayBox.tsx").match(/data-money=""/g)?.length).toBe(2); // the call's rate and the amount
    expect(src("app/app/sessions/[id]/ChoiceBox.tsx")).toContain('data-money=""');
  });
});
