import React from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import { randomUUID } from "node:crypto";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { GET as cronGET } from "@/app/api/cron/daily/route";
import * as R from "@/lib/rules";
import { fmtDateIn } from "@/lib/format";
import { pieceCloseOut, testerRatingClosesAt } from "@/lib/server/closeOut";
import { json, req } from "./helpers";
import { joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 11, §387 4; replaces batch 17 §19's "the last 7 days") Each money button always shows its closing date next to it, in the reader's zone: the
// tester's "Charge or let go by …", "Dispute until …" (the part's own date, as Charge) and "Rate until …" (testerRatingClosesAt); the developer's "Pay by …" and
// "Pay more until …" (pieceCloseOut). While the money is frozen the line reads "Waits while the test is paused" (the tester's Rate keeps its own line).

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requireOpenPage: async () => auth.user, requirePageUser: async () => auth.user, adminAway() {}, leaveIfClosed() {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;

const DAY = 86_400_000;
const ZONE = "America/Chicago";
const cron = () => cronGET(new Request("http://localhost:3400/api/cron/daily", { headers: { authorization: "Bearer cron-test" } })).then((r) => r.json());
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

/** Ana's written answers ($10.00 listing), the test closed a day ago: Charge opens on the next daily job; the close-out is about two weeks away. */
async function closedWork() {
  const s = await setup();
  const j = await joined(s.testId);
  await sact(j.sessionId, "written", j.tester.cookie, { answers: ["The harbour level was clear and the boats handled well on the first try.", "Nowhere, it was smooth."], seenAt: seen(), confirmed: true });
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  await db.submission.update({ where: { id: sub.id }, data: { payBy: new Date(Date.now() - 1000) } });
  await db.test.update({ where: { id: s.testId }, data: { openUntil: new Date(Date.now() - DAY) } });
  await db.contract.updateMany({ where: { testId: s.testId }, data: { dueAt: new Date(Date.now() - DAY) } });
  await db.user.updateMany({ where: { id: { in: [s.dev.user.id, j.tester.user.id] } }, data: { timeZone: ZONE } });
  await settle();
  return { ...s, ...j, sub };
}
const testerPage = async (w: Awaited<ReturnType<typeof closedWork>>) => {
  auth.user = await db.user.findUniqueOrThrow({ where: { id: w.tester.user.id } });
  const { default: SessionPage } = await import("@/app/app/sessions/[id]/page");
  return text(render(await SessionPage({ params: Promise.resolve({ id: w.sessionId }) })));
};
const devPage = async (w: Awaited<ReturnType<typeof closedWork>>) => {
  auth.user = await db.user.findUniqueOrThrow({ where: { id: w.dev.user.id } });
  const { default: TestPage } = await import("@/app/app/tests/[id]/page");
  return text(render(await TestPage({ params: Promise.resolve({ id: w.testId }), searchParams: Promise.resolve({}) })));
};
const pause = (testId: string) => db.test.update({ where: { id: testId }, data: { adminPausedAt: new Date(), adminNote: "Checking a report." } });

describe("§387 4: the closing date always shows next to its button", () => {
  it("the lines", () => {
    expect(R.chargeByLine("Nov 20, 2026")).toBe("Charge or let go by Nov 20, 2026");
    expect(R.disputeUntilLine("Nov 20, 2026")).toBe("Dispute until Nov 20, 2026");
    expect(R.rateUntilLine("Nov 25, 2026")).toBe("Rate until Nov 25, 2026");
    expect(R.payByLine("Nov 20, 2026")).toBe("Pay by Nov 20, 2026");
    expect(R.payByLine("Nov 20, 2026", true)).toBe("Pay more until Nov 20, 2026");
    expect(R.FROZEN_WAITS_LINE).toBe("Waits while the test is paused");
    expect("CLOSE_OUT_WARN_DAYS" in R || "closeOutSoon" in R).toBe(false);
  });

  it("unpaid: the tester's \"Charge or let go by\" and the developer's \"Pay by\" two weeks ahead (no 7-day wait); paused: \"Waits while the test is paused\"", async () => {
    const w = await closedWork();
    await cron();
    const at = await pieceCloseOut({ submissionId: w.sub.id }, new Date());
    expect(at!.getTime() - Date.now()).toBeGreaterThan(7 * DAY); // outside the old 7 days
    const date = fmtDateIn(at!, ZONE);
    expect(await testerPage(w)).toContain(`Charge or let go by ${date}`);
    expect(await devPage(w)).toContain(`Pay by ${date}`);
    await pause(w.testId);
    const tester = await testerPage(w);
    expect(tester).toContain(R.FROZEN_WAITS_LINE);
    expect(tester).not.toContain("Charge or let go by");
    const dev = await devPage(w);
    expect(dev).toContain(R.FROZEN_WAITS_LINE); // the restricted view keeps Pay (§368), its line waits
    expect(dev).not.toContain(`Pay by ${date}`);
  });

  it("paid in part: \"Dispute until\" (the part's date) and \"Rate until\" for the tester, \"Pay more until\" for the developer; paused: the waits line, Rate's own line", async () => {
    const w = await closedWork();
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "6.00", tickedCents: 600, reason: "Only part of it was useful" })).status).toBe(200);
    await settle();
    const piece = fmtDateIn((await pieceCloseOut({ submissionId: w.sub.id }, new Date()))!, ZONE);
    const rate = fmtDateIn((await testerRatingClosesAt(w.sessionId, new Date()))!, ZONE);
    const tester = await testerPage(w);
    expect(tester).toContain(`Dispute until ${piece}`);
    expect(tester).toContain(`Rate until ${rate}`);
    expect(await devPage(w)).toContain(`Pay more until ${piece}`);
    await pause(w.testId);
    const paused = await testerPage(w);
    expect(paused).toContain(R.FROZEN_WAITS_LINE);
    expect(paused).not.toContain("Dispute until");
    expect(paused).not.toContain("Rate until");
    expect(paused).toContain(R.RATE_TEST_PAUSED);
    // The restricted view draws no Pay more box (§368): no date for it either.
    expect(await devPage(w)).not.toContain("Pay more until");
  });
});
