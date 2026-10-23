import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { json, req } from "./helpers";
import { joined, sact, seen, setup } from "./fixtures";
import { CHARGED_BY_TESTER } from "@/lib/rules";
import { developerStats, ratingTile, testerStats } from "@/lib/server/profileStats";

// (Owner, NEWEST+9) The profile tiles, from lean data.
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
const DAY = 86_400_000;

describe("profile tiles", () => {
  it("developer: reports reviewed (with testers' charges), pays on average, typical review; tester: accepted parts", async () => {
    const { dev, testId } = await setup({ spots: 5 });
    const send = async (name: string, daysAgo: number) => {
      const j = await joined(testId, name);
      await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
      const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
      await db.submission.update({ where: { id: sub.id }, data: { sentAt: new Date(Date.now() - daysAgo * DAY) } });
      return { ...j, sub };
    };
    const full = await send("Ana Silva", 2);
    const part = await send("Ben Ito", 4);
    const rej = await send("Cara Diaz", 6);
    const charged = await send("Dee Moss", 20);
    expect((await pay(dev.cookie, { kind: "submission", id: full.sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    expect((await pay(dev.cookie, { kind: "submission", id: part.sub.id, amount: "4.00", tickedCents: 400, reason: "Short answers" })).status).toBe(200);
    expect((await pay(dev.cookie, { kind: "submission", id: rej.sub.id, action: "reject", reason: "Not what we asked" })).status).toBe(200);
    await db.review.create({ data: { submissionId: charged.sub.id, contractId: charged.sessionId, amountCents: 1000, agreedCents: 1000, reason: CHARGED_BY_TESTER, payKey: randomUUID() } });

    const s = await developerStats(dev.user.id);
    expect("reviewed" in s).toBe(false);
    // (1 + 0.4 + 0 + 1) / 4 = 60%; 2 of 4 in full, 1 partly, 1 rejected.
    expect(s.pays).toEqual({ value: "60%", hint: "50% accepted in full, 25% partly, 25% rejected" });
    // By hand: 2, 4 and 6 days -> the median is 4 days; the tester's charge doesn't count toward it.
    expect(s.review).toEqual({ value: "4 days", hint: "1 charged by testers after the review window · 0 disputes decided for testers" });

    expect((await testerStats(full.tester.user.id)).accepted).toEqual({ value: "1", hint: "of 1 sent · 1 session with accepted work" });
    expect((await testerStats(rej.tester.user.id)).accepted).toEqual({ value: "0", hint: "of 1 sent · 0 sessions with accepted work" });
    expect(await ratingTile(dev.user.id)).toEqual({ value: "-", hint: "no ratings yet" });
  });

  it("a dispute decided for the tester raises the share and is counted", async () => {
    const { dev, testId } = await setup();
    const j = await joined(testId);
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "4.00", tickedCents: 400, reason: "Short answers" });
    await db.dispute.create({ data: { submissionId: sub.id, contractId: j.sessionId, testerId: j.tester.user.id, reason: "I answered all", status: "decided", decidedCents: 1000, decidedAt: new Date() } });
    const s = await developerStats(dev.user.id);
    expect(s.pays.value).toBe("100%");
    expect(s.review.hint).toBe("0 charged by testers after the review window · 1 dispute decided for testers");
  });
});
