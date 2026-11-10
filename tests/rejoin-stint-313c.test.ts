import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import * as R from "@/lib/rules";
import { runDaily } from "@/lib/server/holds";
import { pieceCloseOut } from "@/lib/server/closeOut";
import { getKept, setKept } from "@/lib/server/kept";
import { act, joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 6, §313c) A rejoin doesn't move the dates of work sent before leaving: it keeps the deadline in effect when the tester left (Submission/Call
// stintDueAt, stamped at the rejoin), so its Charge stays open and its closing date doesn't move; work sent after rejoining uses the new deadline. Also the
// owner's scenario: unsent text (a draft in a question box, an unsent addition) left behind comes back on the rejoined page (§269).

const DAY = 86_400_000;

describe("§313c work from an earlier stint keeps its deadline", () => {
  it("left 5 days before the deadline, rejoined after it: the old piece's Charge stays open from that deadline; a new piece counts to the new one", async () => {
    const s = await setup({ joinMode: "anyone" });
    const j = await joined(s.testId, "Ana Silva");
    const n = ((await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } })).questions as string[]).length || 1;
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: Array(n).fill("answer") })).status).toBe(200);
    await settle();
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    // Unsent text left behind: a draft in the form and an addition typed under a question (the owner's scenario).
    await setKept(j.tester.user.id, `written:${j.sessionId}`, { answers: ["half-typed"], notes: "" });
    await setKept(j.tester.user.id, `add:${j.sessionId}:else`, { text: "one more thing" });
    expect((await sact(j.sessionId, "leave", j.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    await settle();
    // As if: sent 10 days ago, left 7 days ago with 5 days to go (deadline D, 2 days ago), rejoining now.
    const D = new Date(Date.now() - 2 * DAY);
    await db.submission.update({ where: { id: sub.id }, data: { updatedAt: new Date(Date.now() - 10 * DAY), payBy: new Date(Date.now() - 3 * DAY) } });
    await db.contract.update({ where: { id: j.sessionId }, data: { dueAt: D, endedAt: new Date(Date.now() - 7 * DAY) } });
    const t = await db.test.findUniqueOrThrow({ where: { id: s.testId } });
    expect(R.chargeOpensAt(await db.submission.findUniqueOrThrow({ where: { id: sub.id } }), t, await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } }))!.getTime()).toBe(D.getTime());
    // Rejoin (asked, accepted).
    await db.test.update({ where: { id: s.testId }, data: { joinMode: "apply" } });
    const lv = (await db.test.findUniqueOrThrow({ where: { id: s.testId } })).listingVersion;
    expect((await act(s.testId, "rejoin-ask", j.tester.cookie, { listingVersion: lv, seenAt: seen(), confirmed: true, anyway: true })).status).toBe(200);
    await settle();
    const app = await db.application.findFirstOrThrow({ where: { testId: s.testId, testerId: j.tester.user.id } });
    expect((await act(s.testId, "application", s.dev.cookie, { applicationId: app.id, decision: "accept", seenAt: seen(), confirmed: true })).status).toBe(200);
    const c = await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } });
    expect(c.status).toBe("working");
    expect(c.dueAt.getTime()).toBeGreaterThan(Date.now() + 4 * DAY); // the new deadline: about 5 days from now
    // The old piece: stamped with the deadline she left under; its Charge opened then and stays open.
    const old = await db.submission.findUniqueOrThrow({ where: { id: sub.id } });
    expect(old.stintDueAt?.getTime()).toBe(D.getTime());
    expect(R.chargeOpensAt(old, t, c)!.getTime()).toBe(D.getTime());
    expect(R.chargeIsOpen(old, t, c)).toBe(true);
    expect(R.chargeIsOpen({ ...old, stintDueAt: null }, t, c)).toBe(false); // (it closed again before §313c)
    await runDaily();
    expect((await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).choiceOfferedAt).not.toBeNull();
    // Its closing date counts from that deadline too (here the test's work ended now: the test's own close-out, not 14 days after the new deadline).
    await db.test.update({ where: { id: s.testId }, data: { workEndedAt: new Date() } });
    const closes = (await pieceCloseOut({ submissionId: sub.id }))!;
    await db.submission.update({ where: { id: sub.id }, data: { stintDueAt: null } });
    const unstamped = (await pieceCloseOut({ submissionId: sub.id }))!;
    expect(closes.getTime()).toBeLessThan(unstamped.getTime());
    await db.submission.update({ where: { id: sub.id }, data: { stintDueAt: D } });
    // A piece sent after rejoining counts to the new deadline.
    const fresh = await db.submission.create({ data: { contractId: c.id, kind: "recording", agreedCents: 1500, updatedAt: new Date(), payBy: new Date(Date.now() + DAY) } });
    expect(fresh.stintDueAt).toBeNull();
    expect(R.chargeOpensAt(fresh, t, c)!.getTime()).toBe(c.dueAt.getTime());
    // (Owner's scenario) The unsent text she left behind is still kept for this session: the form and the addition box bring it back (§269).
    expect((await getKept(j.tester.user.id, `written:${j.sessionId}`)).data).toEqual({ answers: ["half-typed"], notes: "" });
    expect((await getKept(j.tester.user.id, `add:${j.sessionId}:else`)).data).toEqual({ text: "one more thing" });
  }, 120_000);

  it("sent again (unpaid) after rejoining: the piece counts to the new deadline (its stamp goes)", () => {
    const due = new Date(Date.now() + 5 * DAY), was = new Date(Date.now() - 2 * DAY);
    expect(R.pieceDueAt({ stintDueAt: was }, { dueAt: due })).toBe(was);
    expect(R.pieceDueAt({ stintDueAt: null }, { dueAt: due })).toBe(due);
  });
});
