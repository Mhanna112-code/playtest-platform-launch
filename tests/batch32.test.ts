import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ANSWER_ONE, answersMissing } from "@/lib/questions";
import { makeUser } from "./helpers";
import { act, seen, settle, setup } from "./fixtures";

describe("batch 32 §2: Apply twice", () => {
  it("a second Apply (another tab) is refused, keeps the first note, and doesn't tell the developer again", async () => {
    const { dev, testId } = await setup({ joinMode: "apply" });
    const kit = await makeUser({ tester: true, name: "Kit Moss" });
    const page = seen();
    await settle();
    expect((await act(testId, "apply", kit.cookie, { note: "I love boat games", seenAt: page })).status).toBe(200);
    const bells = await db.notification.count({ where: { userId: dev.user.id } });
    const again = await act(testId, "apply", kit.cookie, { note: "", seenAt: page });
    expect(again.status).toBe(409);
    expect(again.body.code ?? again.body.error).toBeDefined();
    expect(JSON.stringify(again.body)).toContain("You already applied to join this test in another tab.");
    const a = await db.application.findFirstOrThrow({ where: { testId, testerId: kit.user.id } });
    expect(a.note).toBe("I love boat games");
    expect(a.status).toBe("pending");
    expect(await db.notification.count({ where: { userId: dev.user.id } })).toBe(bells);
    expect(await db.testEvent.count({ where: { testId, kind: "applied" } })).toBe(1);
  });
});

describe("batch 32 §3 and §4: the tester's pages", () => {
  const src = (f: string) => fs.readFileSync(path.join(process.cwd(), "src", f), "utf8");
  it("Everything you sent shows a part's total, Pay more and extra pay included", () => {
    expect(src("app/app/payments/page.tsx")).toContain("Paid ${money(partPaid.get(r.id) ?? r.review.amountCents)} · you get");
  });
  it("no answer at all: the line above the questions (no box red), any one answer will do", () => {
    expect(answersMissing(["aaaa", "dddd", "aa"], ["", "", ""])?.message).toBe(ANSWER_ONE);
    expect(ANSWER_ONE).toBe("Answer at least one question before sending (any one; none is required).");
    expect(answersMissing(["aaaa", "dddd", "aa"], ["", "f", ""])).toMatchObject({ at: 1, chars: 1 });
    expect(src("app/app/sessions/[id]/SessionActions.tsx")).toContain("needOne && !answers.some((a) => a.trim())");
  });
});
