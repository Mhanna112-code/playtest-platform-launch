import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { PAUSES_GROUP, bellKeyIn, groupTitle } from "@/lib/bell";
import { ANYTHING_ELSE_KEY, questionKeys, youAddedLine } from "@/lib/additions";
import { itemsFor } from "@/lib/answerSets";
import * as R from "@/lib/rules";
import { SUMMARY_HEADING, sendSummaries, summaryHeading } from "@/lib/server/notify";
import { htmlOf } from "@/lib/server/email";
import { chargebackOpened, disputeAmountChanged, liftHoldIfClear, runDaily, startHold, testerPausedLine } from "@/lib/server/holds";
import { pauseTest, reinstateAccount, suspendAccount, unpauseTest } from "@/lib/server/restrictions";
import { setStripeForTests } from "@/lib/server/stripe";
import { joined, sact, seen, settle, setup } from "./fixtures";
import { makeUser } from "./helpers";

// (Owner, Nov 6, §295) Emails and bells: testers are told when a test pauses (one "Pauses" stack with "running again"), an addition reads as one, summary emails
// open with a heading that follows their period, a tester whose deadline is within the heads-up window gets her one reminder, and a chargeback's amount changing
// (before or after the repayment) goes in the end-of-day email, not immediately. (Point 2, stale reminders, was dropped by the owner: reminders stay as a log.)

const DAY = 86_400_000;
const lines = (userId: string) => db.notification.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
const mails = (to: string) => db.outboxEmail.findMany({ where: { to }, orderBy: { createdAt: "asc" } });
const pausedLines = async (userId: string) => (await lines(userId)).filter((n) => n.groupKey === PAUSES_GROUP);
async function admin() {
  const a = await makeUser({ email: `admin-${randomUUID()}@playtest.test` });
  return db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
}
/** A test with Ana working on it. */
async function world() {
  const s = await setup();
  const j = await joined(s.testId, "Ana Silva");
  return { ...s, ...j, devId: s.dev.user.id, anaId: j.tester.user.id };
}

describe("§295 point 1: testers are told when a test pauses", () => {
  it("the team's pause: Ana reads “Harbor Run” is paused (never why), then running again; one Pauses stack in the bell and in her summary", async () => {
    const w = await world();
    const a = await admin();
    await pauseTest(a.id, w.testId, "Checking the build");
    let mine = await pausedLines(w.anaId);
    expect(mine.map((n) => n.text)).toEqual(["“Harbor Run” is paused"]);
    expect(mine[0]).toMatchObject({ text: testerPausedLine("Harbor Run"), link: `/app/sessions/${w.sessionId}`, side: "tester", mustEmail: true, own: false }); // (§298) always: it reaches her with email Off too
    await unpauseTest(w.testId, a.id);
    mine = await pausedLines(w.anaId);
    expect(mine.map((n) => n.text)).toEqual(["“Harbor Run” is paused", "“Harbor Run” is running again"]);
    // One bell entry: "Pauses · 2".
    expect(new Set(mine.map((n) => bellKeyIn(n))).size).toBe(1);
    expect(groupTitle(PAUSES_GROUP, 1, 2)).toBe("Pauses · 2");
    // Her daily summary stacks them under the same title; nothing in it says why.
    await sendSummaries(new Date(), [w.anaId]);
    const m = (await mails(w.tester.user.email)).at(-1)!;
    const body = m.text.split("\n");
    const at = body.indexOf("• Pauses · 2");
    expect(at).toBeGreaterThan(-1);
    expect(body[at + 1]).toMatch(/^ {2}• “Harbor Run” is paused http/);
    expect(body[at + 2]).toMatch(/^ {2}• “Harbor Run” is running again http/);
    expect(m.text).not.toMatch(/hold|suspend|team|Checking the build/i);
  });

  it("a hold: every working tester is told at once; a second cause (the team's pause) says nothing more, and its lift says nothing while the hold still pauses it", async () => {
    const w = await world();
    const ben = await joined(w.testId, "Ben Okafor", "he");
    await startHold(w.devId, "unpaid");
    expect((await pausedLines(w.anaId)).map((n) => n.text)).toEqual(["“Harbor Run” is paused"]);
    expect((await pausedLines(ben.tester.user.id)).map((n) => n.text)).toEqual(["“Harbor Run” is paused"]);
    expect((await pausedLines(w.devId))).toHaveLength(0); // the developer's own lines are unchanged
    const a = await admin();
    await pauseTest(a.id, w.testId, "x");
    await unpauseTest(w.testId, a.id);
    expect((await pausedLines(w.anaId)).map((n) => n.text)).toEqual(["“Harbor Run” is paused"]);
    // The hold paid off (nothing owed): running again, once.
    expect(await liftHoldIfClear(w.devId)).toBe(true);
    expect((await pausedLines(w.anaId)).map((n) => n.text)).toEqual(["“Harbor Run” is paused", "“Harbor Run” is running again"]);
  });

  it("a suspension: told at once; (§298) with email Off it still goes in her end-of-day email; a test already paused by the team says nothing", async () => {
    const w = await world();
    await db.user.update({ where: { id: w.anaId }, data: { emailPref: "off" } });
    const a = await admin();
    await suspendAccount(a.id, w.devId, "Checking", "developer");
    const mine = await pausedLines(w.anaId);
    expect(mine.map((n) => n.text)).toEqual(["“Harbor Run” is paused"]);
    expect(mine[0].mustEmail).toBe(true);
    await sendSummaries(new Date(), [w.anaId]);
    // (Owner, Nov 6, §298, was §295's "follows her email setting") The pause reaches her with email Off, never saying why.
    const m = (await mails(w.tester.user.email)).find((x) => x.text.includes("is paused"));
    expect(m).toBeTruthy();
    expect(m!.text).not.toMatch(/hold|suspend|team|Checking/i);
    await reinstateAccount(w.devId, undefined, a.id);
    expect((await pausedLines(w.anaId)).map((n) => n.text)).toEqual(["“Harbor Run” is paused", "“Harbor Run” is running again"]);
    // The team paused it first, then the developer is suspended: only the team's pause told her.
    const w2 = await world();
    await pauseTest(a.id, w2.testId, "x");
    await suspendAccount(a.id, w2.devId, "Checking", "developer");
    expect((await pausedLines(w2.anaId)).map((n) => n.text)).toEqual(["“Harbor Run” is paused"]);
  });
});

describe("§295 point 3: an addition doesn't read as a second send", () => {
  it("Ana gets no line for her own addition (Owner, Nov 11); the developer's line is unchanged", async () => {
    const w = await world();
    await sact(w.sessionId, "written", w.tester.cookie, { answers: ["a", "b"] });
    await settle();
    const c = await db.contract.findUniqueOrThrow({ where: { id: w.sessionId } });
    const keys = questionKeys(itemsFor(c.questions as string[]));
    expect((await sact(w.sessionId, "written-add", w.tester.cookie, { text: "One more thing", question: keys[0], seenAt: seen(), confirmed: true })).status).toBe(200);
    await settle();
    expect((await sact(w.sessionId, "written-add", w.tester.cookie, { text: "And a note", question: ANYTHING_ELSE_KEY, seenAt: seen(), confirmed: true })).status).toBe(200);
    const ana = (await lines(w.anaId)).map((n) => n.text);
    expect(ana.filter((t) => t.startsWith("Work sent:"))).toEqual([]); // (Owner, Nov 6, §312d) no line for a first send any more
    expect(ana.filter((t) => t.startsWith("You added"))).toEqual([]); // (Owner, Nov 11) no line for her own addition either
    const dev = (await lines(w.devId)).map((n) => n.text);
    expect(dev).toContain("Ana Silva added to her answer to “What did you like?” for “Harbor Run”");
    expect(dev).toContain("Ana Silva added to “Anything else” in her written answers for “Harbor Run”");
    // In her summary too.
    await sendSummaries(new Date(), [w.anaId]);
    expect((await mails(w.tester.user.email)).map((m) => m.text).join(" | ")).not.toContain("You added to your");
  });

  it("the line's other shapes: a long question is cut; recordings; an addition with no question", () => {
    const long = "Q".repeat(120);
    expect(youAddedLine("Harbor Run", "written answers", 1, long)).toBe(`You added to your answer to “${"Q".repeat(79)}…” on “Harbor Run”`);
    expect(youAddedLine("Harbor Run", "recording")).toBe("You added a recording on “Harbor Run”");
    expect(youAddedLine("Harbor Run", "recording", 2)).toBe("You added 2 recordings on “Harbor Run”");
    expect(youAddedLine("Harbor Run", "written answers")).toBe("You added to your written answers on “Harbor Run”");
  });
});

describe("§295 point 4: summary emails open with a heading that follows their period", () => {
  const at = (s: string) => new Date(s);
  it("daily (and end-of-day): the day; weekly: its days; monthly: the month when it covers one, else its days; in the account's zone", () => {
    expect(summaryHeading("daily", at("2026-11-05T09:00:00Z"), at("2026-11-06T09:00:00Z"), "UTC")).toBe("Your Playtest updates for Fri, Nov 6");
    // 2 AM UTC on Nov 6 is still Thursday evening in New York.
    expect(summaryHeading("daily", at("2026-11-05T02:00:00Z"), at("2026-11-06T02:00:00Z"), "America/New_York")).toBe("Your Playtest updates for Thu, Nov 5");
    expect(summaryHeading("weekly", at("2026-11-01T09:00:00Z"), at("2026-11-07T09:00:00Z"), "UTC")).toBe("Your Playtest updates for Nov 1 – Nov 7");
    expect(summaryHeading("weekly", at("2026-12-28T09:00:00Z"), at("2027-01-04T09:00:00Z"), "UTC")).toBe("Your Playtest updates for Dec 28, 2026 – Jan 4, 2027");
    expect(summaryHeading("monthly", at("2026-10-01T09:00:00Z"), at("2026-10-31T09:00:00Z"), "UTC")).toBe("Your Playtest updates for October");
    expect(summaryHeading("monthly", at("2026-10-01T09:00:00Z"), at("2026-11-01T09:00:00Z"), "UTC")).toBe("Your Playtest updates for October");
    expect(summaryHeading("monthly", at("2026-12-01T09:00:00Z"), at("2027-01-01T09:00:00Z"), "UTC")).toBe("Your Playtest updates for December");
    expect(summaryHeading("monthly", at("2026-10-02T09:00:00Z"), at("2026-11-01T09:00:00Z"), "UTC")).toBe("Your Playtest updates for Oct 2 – Nov 1");
    expect(summaryHeading("monthly", at("2026-10-01T02:00:00Z"), at("2026-10-31T09:00:00Z"), "America/New_York")).toBe("Your Playtest updates for Sep 30 – Oct 31");
  });

  it("the summary's body opens with it, above the side sections; the HTML shows it as the heading; an Off account's end-of-day email has the day's", async () => {
    const w = await world();
    // Ana tests and develops: her summary has sections.
    await db.user.update({ where: { id: w.anaId }, data: { isDeveloper: true, timeZone: "America/New_York" } });
    const a = await admin();
    await pauseTest(a.id, w.testId, "x");
    await db.notification.create({ data: { userId: w.anaId, side: null, text: "An account line", link: "/app" } });
    const now = new Date();
    await sendSummaries(now, [w.anaId]);
    const m = (await mails(w.tester.user.email)).at(-1)!;
    const want = summaryHeading("daily", now, now, "America/New_York");
    expect(want.startsWith(`${SUMMARY_HEADING} `)).toBe(true);
    const body = m.text.split("\n");
    expect(body[0]).toBe(want);
    expect(body[1]).toBe("");
    expect(body.indexOf("Your account")).toBe(2);
    expect(body.indexOf("As a tester")).toBeGreaterThan(2);
    const html = m.html || htmlOf({ to: m.to, subject: m.subject, text: m.text, heading: want });
    expect(html).toContain(`font-weight:700;color:#141829;">${want}</p>`);
    expect(html.indexOf(want)).toBeLessThan(html.indexOf("Your account"));
    // Weekly: the period from the last summary (since §297, the day after it).
    await db.user.update({ where: { id: w.anaId }, data: { emailPref: "weekly", lastSummaryAt: new Date(now.getTime() - 7 * DAY) } });
    await db.notification.create({ data: { userId: w.anaId, side: null, text: "Another account line", link: "/app" } });
    await sendSummaries(now, [w.anaId]);
    expect((await mails(w.tester.user.email)).at(-1)!.text.split("\n")[0]).toBe(summaryHeading("weekly", new Date(now.getTime() - 7 * DAY), now, "America/New_York", true)); // (§297) from the day after it
    // Email Off: the end-of-day email (a must-send line) has the day's heading.
    const off = await makeUser({ dev: true, name: "Omar Reyes" });
    await db.user.update({ where: { id: off.user.id }, data: { emailPref: "off", timeZone: "UTC" } });
    await db.notification.create({ data: { userId: off.user.id, text: "Your tests are paused", link: "/app/payments#owed", mustEmail: true, payment: true } });
    await sendSummaries(now, [off.user.id]);
    expect((await mails(off.user.email)).at(-1)!.text.split("\n")[0]).toBe(summaryHeading("daily", now, now, "UTC"));
  });
});

describe("§295 point 5: a tester whose deadline is within the heads-up window gets one reminder", () => {
  it("(fake clock) Ana joined minutes ago and her deadline is 20 hours away: exactly one deadline line, in the bell and in her summary", async () => {
    const w = await world();
    const now = new Date(Date.now() + 60_000);
    await db.contract.update({ where: { id: w.sessionId }, data: { dueAt: new Date(now.getTime() + 20 * 3_600_000) } });
    await runDaily(now);
    await runDaily(new Date(now.getTime() + 60_000)); // never twice
    const due = (await lines(w.anaId)).filter((n) => n.text.startsWith("Your deadline on"));
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ groupKey: "deadlines", mustEmail: true, link: `/app/sessions/${w.sessionId}`, reminderKey: `headsup:${w.testId}` });
    expect(due[0].text).toMatch(/^Your deadline on “Harbor Run” is [A-Z][a-z]{2} \d{1,2}: send your work before then\.$/);
    // The daily job's summary carried it, once.
    const sent = (await mails(w.tester.user.email)).filter((m) => m.text.includes(due[0].text));
    expect(sent).toHaveLength(1);
    expect(sent[0].text.split(due[0].text).length - 1).toBe(1);
  }, 120_000);

  it("the rules: the 1-day mark is kept within 24 hours of joining; a mark that came due after a deadline moved is sent once, unless sent for the earlier deadline", () => {
    const joinedAt = new Date("2026-11-06T15:00:00Z");
    expect(R.deadlineMarksFor(joinedAt, new Date(joinedAt.getTime() + 20 * 3_600_000)).map((m) => m.mark)).toEqual(["1d"]);
    expect(R.deadlineMarksFor(joinedAt, R.dueFromJoin(joinedAt, 1)).map((m) => m.mark)).toEqual(["1d"]);
    expect(R.ownDeadlineMarkDue({ id: "c1", joinedAt, dueAt: new Date(joinedAt.getTime() + 20 * 3_600_000) }, [], new Date(joinedAt.getTime() + 60_000)).send?.mark).toBe("1d");
    // Seen once at the old deadline (nothing due), then a pause moved it; the next run is within a day of the new one: sent.
    const D = new Date(joinedAt.getTime() + 10 * DAY), D2 = new Date(D.getTime() + DAY);
    const seenOld = [`${R.deadlineMarkKey("c1", D)}seen`, `${R.deadlineMarkKey("c1", D)}1w`, `${R.deadlineMarkKey("c1", D)}3d`];
    expect(R.ownDeadlineMarkDue({ id: "c1", joinedAt, dueAt: D2 }, seenOld, new Date(D2.getTime() - 20 * 3_600_000)).send?.mark).toBe("1d");
    // Already told "1 day" for the earlier deadline: not again.
    expect(R.ownDeadlineMarkDue({ id: "c1", joinedAt, dueAt: D2 }, [...seenOld, `${R.deadlineMarkKey("c1", D)}1d`], new Date(D2.getTime() - 20 * 3_600_000)).send).toBeNull();
  });
});

describe("§295 point 6: a chargeback's amount changing goes in the end-of-day email", () => {
  beforeEach(() => { process.env.DISPUTE_WAIT_MS = "0"; });
  afterEach(() => { setStripeForTests(null); delete process.env.DISPUTE_WAIT_MS; });

  it("the chargeback that starts the hold is still immediate; the amount changing before the repayment waits for the end-of-day email", async () => {
    const w = await world();
    await sact(w.sessionId, "written", w.tester.cookie, { answers: ["a", "b"] });
    await settle();
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: w.sessionId } });
    await db.user.update({ where: { id: w.devId }, data: { emailPref: "off" } });
    const pi = "pi_" + randomUUID();
    await db.payment.create({ data: { kind: "review", submissionId: sub.id, contractId: w.sessionId, developerId: w.devId, testerId: w.anaId, amountCents: 4000, feeCents: 0, testerCents: 0, status: "charged", stripePaymentIntentId: pi } });
    expect(await chargebackOpened(pi)).toBe(true);
    expect((await mails(w.dev.user.email)).map((m) => m.subject)).toEqual([expect.stringMatching(/^Your tests are paused after a chargeback: .+ unless you finish the steps$/)]); // (§313a)
    expect(await disputeAmountChanged(pi, 2500, "under_review")).toBe("followed");
    const changed = (await lines(w.devId)).find((n) => n.text.startsWith("Your bank changed the amount"))!;
    expect(changed).toMatchObject({ mustEmail: true, payment: true, groupKey: "payhold", summarizedAt: null });
    expect((await mails(w.dev.user.email)).some((m) => m.text.includes(changed.text))).toBe(false);
    await sendSummaries(new Date(), [w.devId]);
    const eod = (await mails(w.dev.user.email)).filter((m) => m.text.includes(changed.text));
    expect(eod).toHaveLength(1);
    expect(eod[0].text).not.toContain("after a chargeback"); // the immediate one is never repeated
  });
});
