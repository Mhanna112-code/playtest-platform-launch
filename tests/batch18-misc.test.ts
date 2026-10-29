import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as excerptsPOST } from "@/app/api/excerpts/route";
import { bellKey } from "@/lib/bell";
import { seatsOverflow } from "@/app/app/tests/[id]/TestersJoined";
import { json, req } from "./helpers";
import * as M from "@/lib/callMeasure";
import { switchQuestionsLine } from "@/lib/rules";
import * as X from "@/lib/server/excerpts";
import { act, bookCall, joined, sact, seen, settle, setup } from "./fixtures";

// Batch 18 sections 3 (the call page), 4, 5, 6, 7 and 8 (owner, Oct 28).
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
const ex = (cookie: string, body: Record<string, unknown>) => excerptsPOST(req("/api/excerpts", { cookie, body })).then(json);
const ANSWER = "The harbour level felt great, but the second boss was far too hard for me.";

describe("batch 18 section 3: the call page", () => {
  it("shows the end line above the room, and the ended line in place of the room (for both sides, live)", () => {
    const room = src("app/app/calls/[id]/CallRoom.tsx");
    expect(room).toContain("setCapLine(typeof r.capLine === \"string\" ? r.capLine : \"\");");
    expect(room).toContain("{capLine && <p className=\"info\" role=\"status\" data-call-cap=\"\">{capLine}</p>}");
    expect(room).toContain("if (line) return <p className=\"info\" data-call-line=\"\">{line}</p>;");
    expect(src("app/app/calls/[id]/page.tsx")).toContain("initialCapLine={s.capLine}");
    expect(src("components/JoinCall.tsx")).toContain("r.cancelled || r.capped");
  });
});

describe("batch 18 section 4: the Testers avatar row's overflow", () => {
  it("\"+N more joined · M open\": joined testers beyond the shown avatars, and spots still open", () => {
    expect(seatsOverflow(20, 50, 12)).toBe("+8 more joined · 30 open");
    expect(seatsOverflow(5, 40, 12)).toBe("35 open"); // every joined tester is shown
    expect(seatsOverflow(50, 50, 12)).toBe("+38 more joined"); // full
    expect(src("app/app/tests/[id]/TestersJoined.tsx")).toContain("{spots > shown && <span className=\"text-sm text-slate-400\" data-seats-more=\"\">{seatsOverflow(joined, spots, shown)}</span>}");
  });
});

describe("batch 18 section 5 (confirmed as built): excerpt requests in the bell", () => {
  it("one line per request, stacked in that test's day", async () => {
    const s = await setup();
    const asks: string[] = [];
    for (const name of ["Ana Silva", "Ben Okafor"]) {
      const j = await joined(s.testId, name);
      await sact(j.sessionId, "written", j.tester.cookie, { answers: [ANSWER, "Smooth."] });
      await settle();
      const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
      expect((await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
      const r = await ex(j.tester.cookie, { action: "request", submissionId: sub.id, index: 0, text: "the second boss was far too hard" });
      expect(r.status).toBe(200);
      asks.push(`${name} asked to show an excerpt from “Harbor Run” on their profile`);
    }
    const lines = await db.notification.findMany({ where: { userId: s.dev.user.id, text: { in: asks } }, orderBy: { createdAt: "asc" } });
    expect(lines.map((l) => l.text)).toEqual(asks);
    expect(new Set(lines.map((l) => bellKey(l))).size).toBe(1);
  });
});

// ---------- Sections 6-8 (owner, Oct 28) ----------

/** Another booked call on this contract reserving `cents` of the $1,000 at `rateCents`. */
async function reserve(contractId: string, slotId: string, rateCents: number, cents: number) {
  return db.call.create({ data: { slotId, contractId, startsAt: new Date(Date.now() + 9 * 86_400_000), minutes: Math.round((cents * 60) / rateCents), rateCents } });
}
const startAt = (h: number) => { const d = new Date(Date.now() + h * 3_600_000); d.setSeconds(0, 0); return d.toISOString(); };
const once = (h: number) => [{ startsAt: startAt(h), repeat: "once", count: 1 }];

describe("batch 18 section 6: the Length is capped by what's left of the $1,000", () => {
  it("the cap, its hint and its line; the smallest of the ticked testers applies, named", () => {
    expect(M.bookableMinutes(15_000, 23_750)).toBe(95);
    expect(M.bookableMinutes(null, 100_000)).toBe(180);
    expect(M.lengthCap([{ name: "Ana", leftCents: 23_750, rateCents: 15_000 }])).toEqual({ max: 95, hint: "10–95 min (the $1,000 for calls with Ana)", line: "At most 95 minutes: the $1,000 for calls with Ana on this test." });
    expect(M.lengthCap([{ name: "Ana", leftCents: 23_750, rateCents: 15_000 }, { name: "Ben", leftCents: 10_000, rateCents: null }])?.line).toBe("At most 30 minutes: the $1,000 for calls with Ben on this test.");
    expect(M.lengthCap([{ name: "Ana", leftCents: 100_000, rateCents: 3000 }])).toBeNull();
    // Under 10 minutes left: nothing can be booked (the existing line).
    expect(M.lengthCap([{ name: "Ana", leftCents: 400, rateCents: 3000 }])?.line).toBe("Calls with Ana on this test can come to at most $1,000; $4.00 is left, so this call can't be booked.");
    for (const f of ["app/app/tests/[id]/DevCallPanel.tsx", "components/CallRequests.tsx"]) {
      const s = src(f);
      expect(s).toContain("data-max={lenCap ? lenCap.max : 180} data-max-msg={lenCap?.line}");
      expect(s).toContain("{lenCap ? lenCap.hint : \"10–180\"}");
    }
    expect(src("app/app/tests/[id]/DevCallPanel.tsx")).toContain("const lenCap = lengthCap(tickedTesters);");
  });

  it("refused on the server: Request a time (both sides, the smallest ticked tester named) and Accept", async () => {
    const s = await setup({ liveRateCents: "150.00" });
    const ana = await joined(s.testId, "Ana Silva");
    const ben = await joined(s.testId, "Ben Okafor", "he");
    const c1 = await bookCall(s.testId, s.dev.cookie, ana.sessionId, ana.tester.cookie, 30); // 30 min at $150/h: $75
    await reserve(ana.sessionId, c1.slotId, 15_000, 100_000 - 7_500 - 23_750); // $237.50 left for Ana: 95 minutes
    const c2 = await bookCall(s.testId, s.dev.cookie, ben.sessionId, ben.tester.cookie, 32);
    const benOther = await reserve(ben.sessionId, c2.slotId, 15_000, 100_000 - 7_500 - 50_000); // $500 left for Ben: 200 minutes (180 applies)
    const dev = (minutes: number) => act(s.testId, "request-time", s.dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [ana.sessionId, ben.sessionId], rows: once(96), minutes });
    const over = await dev(120);
    expect(over.status).toBe(400);
    expect(over.body.error.message).toBe("At most 95 minutes: the $1,000 for calls with Ana Silva on this test.");
    const fits = await dev(95);
    expect(fits.body.error?.message ?? "").toBe("");
    expect(fits.status).toBe(200);
    // The tester's own request names the developer.
    const t = await sact(ana.sessionId, "request-time", ana.tester.cookie, { seenAt: seen(), confirmed: true, rows: once(120), minutes: 100 });
    expect(t.status).toBe(400);
    expect(t.body.error.message).toBe("At most 95 minutes: the $1,000 for calls with Nora Lane on this test.");
    // Ben asks for 150 minutes (fits); more is booked with him meanwhile: Accept is refused with the cap.
    expect((await sact(ben.sessionId, "request-time", ben.tester.cookie, { seenAt: seen(), confirmed: true, rows: once(150), minutes: 150 })).status).toBe(200);
    await db.call.update({ where: { id: benOther.id }, data: { minutes: benOther.minutes + 100 } }); // $250 more reserved: $250 left, 100 minutes
    const q = await db.callRequest.findFirstOrThrow({ where: { contractId: ben.sessionId, fromSide: "tester", status: "pending" } });
    const acc = await act(s.testId, "answer-request", s.dev.cookie, { contractId: ben.sessionId, requestId: q.id, action: "accept", seenAt: seen(), confirmed: true });
    expect(acc.body.error.message).toBe("At most 100 minutes: the $1,000 for calls with Ben Okafor on this test.");
  });
});

describe("batch 18 section 7: excerpts always name the test; a pending one can be Allowed under an NDA", () => {
  it("no tick: a new request always reads \"From <test>\" (a hideProduct sent by an old page is ignored); older hidden ones keep their wording", async () => {
    const picker = src("components/Excerpts.tsx");
    expect(picker).not.toContain("Don&apos;t name the product");
    expect(picker).not.toContain("hideProduct");
    const s = await setup();
    const j = await joined(s.testId);
    await sact(j.sessionId, "written", j.tester.cookie, { answers: [ANSWER, "Smooth."] });
    await settle();
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    expect((await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    const r = await ex(j.tester.cookie, { action: "request", submissionId: sub.id, index: 0, text: "the second boss was far too hard", hideProduct: true });
    expect((await db.excerpt.findUniqueOrThrow({ where: { id: r.body.id } })).hideProduct).toBe(false);
    expect((await X.myExcerpts(j.tester.user.id))[0].source).toBe("Harbor Run");
    // An older excerpt whose tester chose to hide the product keeps "a game test".
    await db.excerpt.update({ where: { id: r.body.id }, data: { hideProduct: true } });
    expect((await X.myExcerpts(j.tester.user.id))[0].source).toBe("a game test");
    expect((await X.pendingForDeveloper(s.dev.user.id, s.testId))[0]).toMatchObject({ named: false, source: "a game test", ndaNote: "" });
    expect(src("app/app/tests/[id]/page.tsx")).toContain("{x.ndaNote && <p className=\"note\" data-excerpt-nda=\"\">{x.ndaNote}</p>}");
  });
});

describe("batch 18 section 8: switching to changed questions", () => {
  it("the Switch / Keep box says the new questions need answers and what was sent stays payable at its price", () => {
    expect(switchQuestionsLine({ agreedCents: 1000 })).toBe("Switching means answering the new questions: send your updated answers. Answers you already sent stay payable at $10.00.");
    expect(switchQuestionsLine(null)).toBe("Switching means answering the new questions: send your updated answers.");
    expect(src("app/app/sessions/[id]/page.tsx")).toContain("switchNote: switchQuestionsLine(written),");
    expect(src("app/app/sessions/[id]/TesterTop.tsx")).toContain("{offer.switchNote && <p className=\"mt-1\" data-switch-questions=\"\">{offer.switchNote}</p>}");
  });
});
