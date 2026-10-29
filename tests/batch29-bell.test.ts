import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { GET as cronGET } from "@/app/api/cron/daily/route";
import { POST as testsPOST } from "@/app/api/tests/route";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as readPOST } from "@/app/api/notifications/read/route";
import { GET as statusGET } from "@/app/api/account/status/route";
import { bellKey, groupTitle } from "@/lib/bell";
import { renderTimes } from "@/lib/tz";
import { bell, notify, sendSummaries, unreadEntryCount } from "@/lib/server/notify";
import { closeSoonMarkDue, closingSoonLine, chargeDayLine, payNowLine, startHold } from "@/lib/server/holds";
import { ratingReminders } from "@/lib/server/ratings";
import { tellFull } from "@/lib/server/tests";
import { tellBankWaiting } from "@/lib/server/confirm";
import { pauseTest } from "@/lib/server/restrictions";
import * as R from "@/lib/rules";
import { json, makeUser, req } from "./helpers";
import { act, joined, listingBody, sact, seen, settle, setup } from "./fixtures";

// Batch 29 (owner, Oct 29): the bell's stacks (§21-27, §29, §31-33), its number and reading (§28) and the email rules (§34).

const DAY = 86_400_000;
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const cron = () => cronGET(new Request("http://localhost:3400/api/cron/daily", { headers: { authorization: "Bearer cron-test" } })).then((r) => r.json());
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
const lines = (userId: string) => db.notification.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
const keys = (ls: { id: string; testId: string | null; own: boolean; groupKey: string | null; createdAt: Date }[]) => new Set(ls.map(bellKey));
const ago = (days: number) => new Date(Date.now() - days * DAY);
// (Outages are site-wide: an earlier test file's outage would move the closing dates.)
beforeEach(async () => {
  await db.outage.deleteMany({});
});

/** A second test by the same developer. */
async function anotherTest(devCookie: string, title: string) {
  const r = await json(await testsPOST(req("/api/tests", { cookie: devCookie, body: listingBody({ title, productName: title }) })));
  expect(r.status).toBe(200);
  await settle();
  return r.body.id as string;
}
/** Written answers sent by this tester (a new one unless given) on a test. */
async function sent(testId: string, name = "Ana Silva") {
  const j = await joined(testId, name);
  await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
  await settle();
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  return { ...j, sub };
}
/** Every deadline of the test `daysAgo` days ago (its close-out is 14 days after), and the piece past its review date: the daily job opens Charge. */
async function chargeable(testId: string, subId: string, daysAgo = 3) {
  await db.test.update({ where: { id: testId }, data: { openUntil: ago(daysAgo) } });
  await db.contract.updateMany({ where: { testId }, data: { dueAt: ago(daysAgo) } });
  await db.submission.update({ where: { id: subId }, data: { payBy: ago(20) } });
}

describe("§28 the bell's number and reading", () => {
  it("counts entries, not lines; read only when opened; a new line in a read stack counts again; the status check carries it", async () => {
    const u = await makeUser({ tester: true });
    for (const t of ["A", "B", "C"]) await bell(u.user.id, `Deadline on ${t}`, "/app", undefined, { group: "deadlines" });
    expect(await unreadEntryCount(u.user.id)).toBe(1); // three lines in one stack
    await bell(u.user.id, "A line of its own", "/app", undefined, { own: true });
    expect(await unreadEntryCount(u.user.id)).toBe(2);
    // The status check every page makes (~20 s, and on focus) carries the number.
    const st = await json(await statusGET(req("/api/account/status", { cookie: u.cookie })));
    expect(st.body.bell).toBe(2);
    // Expanding the stack marks all its lines read.
    const stack = (await lines(u.user.id)).filter((l) => l.groupKey === "deadlines").map((l) => l.id);
    expect((await json(await readPOST(req("/api/notifications/read", { cookie: u.cookie, body: { ids: stack } })))).status).toBe(200);
    expect(await unreadEntryCount(u.user.id)).toBe(1);
    // A new line in the read stack: unread again, it counts again.
    await bell(u.user.id, "Deadline on D", "/app", undefined, { group: "deadlines" });
    expect(await unreadEntryCount(u.user.id)).toBe(2);
    // Visiting the page marks nothing (no read on load); a click on a single line marks it (BellList).
    const page = src("app/app/notifications/page.tsx");
    expect(page).not.toContain("updateMany");
    const list = src("app/app/notifications/BellList.tsx");
    expect(list).toContain("onClick={() => markRead([l])}");
    expect(list).toContain("if (now) markRead(e.lines)");
    expect(list).not.toMatch(/mark all/i);
  });

  it("the header's number is live on every page: the layout's BellLink follows SessionWatch's 20-second check and the tab's focus; 9+ above 9", () => {
    expect(src("app/app/layout.tsx")).toContain("<BellLink unread={unread} />");
    expect(src("app/app/layout.tsx")).toContain("unreadEntryCount(u.id)");
    const watch = src("components/SessionWatch.tsx");
    expect(watch).toContain("publishBell(s.bell)");
    expect(watch).toContain('document.addEventListener("visibilitychange", onVisible)');
    const link = src("components/BellLink.tsx");
    expect(link).toContain('unread > 9 ? "9+" : String(unread)');
    expect(link).toContain("aria-label={`Notifications, ${shown} unread`}");
  });
});

describe("§21 rating reminders on running tests, in one 'Ratings to give' stack", () => {
  it("the developer's and the tester's reminders come while the test runs; every rating line stacks across tests", async () => {
    const { dev, testId } = await setup();
    const a = await sent(testId);
    expect((await pay(dev.cookie, { kind: "submission", id: a.sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    const prompt = (await lines(a.tester.user.id)).find((l) => /^Rate Nora Lane on/.test(l.text))!;
    expect(prompt).toMatchObject({ groupKey: "ratings", own: false, link: "/app#ratings-to-give" });
    // The tester's reminder on a running test, 3+ days after their Rate opened.
    await db.contract.update({ where: { id: a.sessionId }, data: { ratePromptedAt: ago(4) } });
    await ratingReminders();
    const rem = (await lines(a.tester.user.id)).filter((l) => /^Reminder: rate Nora Lane on “Harbor Run”$/.test(l.text));
    expect(rem).toHaveLength(1);
    expect(rem[0]).toMatchObject({ groupKey: "ratings", link: "/app#ratings-to-give" });
    expect((await db.test.findUniqueOrThrow({ where: { id: testId } })).status).toBe("open");
    // The tester rates: the developer's Rate opens ("… finished …"), then their reminder every 3 days while the test still runs.
    expect((await sact(a.sessionId, "rate", a.tester.cookie, { stars: 4 })).status).toBe(200);
    expect((await lines(dev.user.id)).find((l) => /You can rate/.test(l.text))).toMatchObject({ groupKey: "ratings" });
    await db.rating.updateMany({ where: { contractId: a.sessionId, side: "tester" }, data: { createdAt: ago(4) } });
    await db.review.updateMany({ where: { contractId: a.sessionId }, data: { createdAt: ago(5) } });
    await ratingReminders();
    const devRem = (await lines(dev.user.id)).filter((l) => /^Reminder: rate Ana Silva for “Harbor Run”/.test(l.text));
    expect(devRem).toHaveLength(1);
    expect(devRem[0].groupKey).toBe("ratings");
    // Across tests: the same tester's prompts on two tests the same day form one entry.
    const t2 = await setup({ title: "Sky Lab", productName: "Sky Lab" });
    const t3 = await setup({ title: "Reef Dash", productName: "Reef Dash" });
    const tester = await makeUser({ tester: true, name: "Ben Ward" });
    for (const s of [t2, t3]) {
      const test = await db.test.findUniqueOrThrow({ where: { id: s.testId } });
      const r = await act(s.testId, "join", tester.cookie, { listingVersion: test.listingVersion });
      await sact(r.body.sessionId, "written", tester.cookie, { answers: ["a", "b"] });
      await settle();
      const sub = await db.submission.findFirstOrThrow({ where: { contractId: r.body.sessionId } });
      expect((await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    }
    const ratingLines = (await lines(tester.user.id)).filter((l) => l.groupKey === "ratings");
    expect(ratingLines).toHaveLength(2);
    expect(keys(ratingLines).size).toBe(1);
    expect(groupTitle("ratings", 2, 2)).toBe("Ratings to give");
  });
});

describe("§22 closing soon (developer) and the tester's one daily Charge line", () => {
  it("the countdown: a piece closing in 40 days gets all four; one closing in 5 days gets 3 days and 1 day; never twice", () => {
    const from = new Date("2026-11-01T10:00:00Z");
    const run = (closesInDays: number) => {
      const at = new Date(from.getTime() + closesInDays * DAY);
      const sent: string[] = [];
      for (let d = 0; d <= closesInDays + 1; d++) {
        for (const h of [0, 6, 12, 18]) {
          const m = closeSoonMarkDue(at, from, new Date(from.getTime() + d * DAY + h * 3_600_000), sent);
          if (m) sent.push(`co:${m}`);
        }
      }
      return sent;
    };
    expect(run(40)).toEqual(["co:30", "co:7", "co:3", "co:1"]);
    expect(run(5)).toEqual(["co:3", "co:1"]);
    expect(run(25)).toEqual(["co:7", "co:3", "co:1"]); // the month only when it was more than a month away
  });

  it("the lines", () => {
    const at = new Date("2026-11-18T15:00:00Z");
    expect(renderTimes(closingSoonLine([{ who: "Ana", part: "written answers", title: "Harbor Run", at }]), "UTC")).toBe("Closing soon: Ana's written answers on “Harbor Run” close on Nov 18");
    expect(renderTimes(closingSoonLine([{ who: "Ana", part: "written answers", title: "Harbor Run", at: new Date(at.getTime() - DAY) }, { who: "Ben", part: "recording", title: "Sky Lab", at }]), "UTC")).toBe(
      "Closing soon: 2 pieces close by Nov 18 (Ana's written answers on “Harbor Run”, Ben's recording on “Sky Lab”)",
    );
    const p = (title: string, testId: string, closes: Date | null = at) => ({ id: randomUUID(), who: "Ana", part: "written answers", title, testId, cents: 1000, closes });
    expect(renderTimes(chargeDayLine([p("Harbor Run", "t1")]), "UTC")).toBe("Charge or let go: your written answers on “Harbor Run” ($10.00, by Nov 18)");
    expect(renderTimes(chargeDayLine([p("Harbor Run", "t1"), p("Harbor Run", "t1"), p("Sky Lab", "t2")]), "UTC")).toBe("Charge or let go: 3 pieces on 2 tests (the first closes Nov 18)");
    expect(renderTimes(payNowLine([p("Harbor Run", "t1")]), "UTC")).toBe("Pay now: Ana's written answers on “Harbor Run” ($10.00): Ana can charge or let it go (until Nov 18)");
    expect(renderTimes(payNowLine([p("Harbor Run", "t1"), p("Harbor Run", "t1"), p("Sky Lab", "t2")]), "UTC")).toBe("Pay now: 3 pieces on 2 tests: their testers can charge or let them go (the first closes Nov 18)");
  });

  it("two pieces of one developer reaching the 3-day mark on two tests: ONE closing-soon line, opening Needs you, emailed whatever the setting", async () => {
    const { dev, testId } = await setup();
    const t2 = await anotherTest(dev.cookie, "Sky Lab");
    await db.user.update({ where: { id: dev.user.id }, data: { emailPref: "off" } });
    const a = await sent(testId, "Ana Silva");
    const b = await sent(t2, "Ben Ward");
    // Close-out (14 days after the deadlines) 3 days and a minute from now.
    await chargeable(testId, a.sub.id, 11 - 1 / 1440);
    await chargeable(t2, b.sub.id, 11 - 1 / 1440);
    await cron();
    await cron(); // the same day: not again
    const soon = (await lines(dev.user.id)).filter((l) => l.text.startsWith("Closing soon:"));
    expect(soon).toHaveLength(1);
    expect(soon[0].text).toMatch(/^Closing soon: 2 pieces close by [A-Z][a-z]{2} \d{1,2} \(/);
    expect(soon[0].text).toContain("Ana's written answers on “Harbor Run”");
    expect(soon[0].text).toContain("Ben's written answers on “Sky Lab”");
    expect(soon[0]).toMatchObject({ link: "/app#needs-you", mustEmail: true, payment: true, groupKey: "closeout" });
    expect((await db.submission.findUniqueOrThrow({ where: { id: a.sub.id } })).devMarks).toContain("co:3");
    // The old per-piece lines are gone.
    expect((await lines(dev.user.id)).some((l) => /^Pay Ana Silva's work on/.test(l.text))).toBe(false);
    // "Pay now" is kept alongside it: one line for both.
    const now = (await lines(dev.user.id)).filter((l) => l.text.startsWith("Pay now:"));
    expect(now).toHaveLength(1);
    expect(now[0].text).toMatch(/^Pay now: 2 pieces on 2 tests: their testers can charge or let them go \(the first closes [A-Z][a-z]{2} \d{1,2}\)$/);
    expect(now[0]).toMatchObject({ link: "/app#needs-you", mustEmail: true, payment: true });
    expect((await lines(dev.user.id)).some((l) => /reviewed by/.test(l.text))).toBe(false);
    // Email Off: the money lines went out in the end-of-day email.
    const mail = await db.outboxEmail.findFirstOrThrow({ where: { to: dev.user.email } });
    expect(mail.text).toContain("Closing soon: 2 pieces");
    expect(mail.text).toContain("Pay now: 2 pieces");
  });

  it("the tester: one piece gives its line daily until settled; two tests give one line; nothing open gives none", async () => {
    const one = await setup();
    const a = await sent(one.testId);
    await chargeable(one.testId, a.sub.id);
    await cron();
    await cron();
    const mine = () => db.notification.findMany({ where: { userId: a.tester.user.id, text: { startsWith: "Charge or let go:" } } });
    expect(await mine()).toHaveLength(1);
    expect((await mine())[0]).toMatchObject({ link: "/app#charge-or-cancel", mustEmail: true, groupKey: "charge" });
    expect((await mine())[0].text).toMatch(/^Charge or let go: your written answers on “Harbor Run” \(\$10\.00, by [A-Z][a-z]{2} \d{1,2}\)$/);
    expect((await lines(a.tester.user.id)).some((l) => /didn't review your/.test(l.text))).toBe(false);
    // The next day: again. Settled (let go): none after that.
    await db.notification.updateMany({ where: { userId: a.tester.user.id, reminderKey: "chargeday" }, data: { createdAt: ago(1) } });
    await cron();
    expect(await mine()).toHaveLength(2);
    expect((await sact(a.sessionId, "choose", a.tester.cookie, { submissionId: a.sub.id, choice: "letgo", seenAt: seen(), confirmed: true })).status).toBe(200);
    await db.notification.updateMany({ where: { userId: a.tester.user.id, reminderKey: "chargeday" }, data: { createdAt: ago(1) } });
    await cron();
    expect(await mine()).toHaveLength(2);
    // Two tests (two developers), one tester: ONE line.
    const tester = await makeUser({ tester: true, name: "Cara Diaz" });
    for (const title of ["Harbor Run", "Sky Lab"]) {
      const s = await setup({ title, productName: title });
      const test = await db.test.findUniqueOrThrow({ where: { id: s.testId } });
      const r = await act(s.testId, "join", tester.cookie, { listingVersion: test.listingVersion });
      await sact(r.body.sessionId, "written", tester.cookie, { answers: ["a", "b"] });
      await settle();
      const sub = await db.submission.findFirstOrThrow({ where: { contractId: r.body.sessionId } });
      await chargeable(s.testId, sub.id);
    }
    await cron();
    const both = await db.notification.findMany({ where: { userId: tester.user.id, text: { startsWith: "Charge or let go:" } } });
    expect(both).toHaveLength(1);
    expect(both[0].text).toMatch(/^Charge or let go: 2 pieces on 2 tests \(the first closes [A-Z][a-z]{2} \d{1,2}\)$/);
    // Nothing open: none.
    const idle = await sent((await setup()).testId);
    await cron();
    expect(await db.notification.count({ where: { userId: idle.tester.user.id, text: { startsWith: "Charge or let go" } } })).toBe(0);
  });
});

describe("§31 the developer's Pay now line", () => {
  it("one piece: its line daily; nothing past its review date: none", async () => {
    const { dev, testId } = await setup();
    const a = await sent(testId);
    await cron();
    expect(await db.notification.count({ where: { userId: dev.user.id, text: { startsWith: "Pay now" } } })).toBe(0);
    await chargeable(testId, a.sub.id);
    await cron();
    const n = await db.notification.findFirstOrThrow({ where: { userId: dev.user.id, text: { startsWith: "Pay now" } } });
    expect(n.text).toMatch(/^Pay now: Ana's written answers on “Harbor Run” \(\$10\.00\): Ana can charge or let it go \(until [A-Z][a-z]{2} \d{1,2}\)$/);
    expect(n.groupKey).toBe("unreviewed");
    // Paid: it stops.
    expect((await pay(dev.cookie, { kind: "submission", id: a.sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    await db.notification.updateMany({ where: { userId: dev.user.id, reminderKey: "paynow" }, data: { createdAt: ago(1) } });
    await cron();
    expect(await db.notification.count({ where: { userId: dev.user.id, text: { startsWith: "Pay now" } } })).toBe(1);
  });
});

describe("§32 bank confirmations: one line across all tests", () => {
  it("two charges the same day: one line; a third the next day: one new line with 3", async () => {
    const { dev, testId } = await setup();
    const a = await sent(testId);
    const mk = (cents: number, contractId: string | null, byDays: number) =>
      db.payment.create({ data: { kind: contractId ? "review" : "subscription", contractId, developerId: dev.user.id, testerId: contractId ? a.tester.user.id : dev.user.id, amountCents: cents, feeCents: 0, testerCents: 0, status: "needs_confirmation", actionPi: "pi_" + randomUUID(), actionBy: new Date(Date.now() + byDays * DAY) } });
    await mk(1000, a.sessionId, 3);
    await tellBankWaiting(dev.user.id);
    await mk(700, null, 2);
    await tellBankWaiting(dev.user.id);
    const bank = () => db.notification.findMany({ where: { userId: dev.user.id, text: { startsWith: "Your bank wants you to confirm" } }, orderBy: { createdAt: "asc" } });
    expect(await bank()).toHaveLength(1);
    expect((await bank())[0].text).toMatch(/^Your bank wants you to confirm 2 payments \(\$17\.00 in all\): the first by [A-Z][a-z]{2} \d{1,2}$/);
    expect((await bank())[0]).toMatchObject({ link: "/app#bank-to-confirm", groupKey: "payhold", mustEmail: true, payment: true });
    await mk(750, a.sessionId, 3);
    await tellBankWaiting(dev.user.id, new Date(Date.now() + DAY));
    expect(await bank()).toHaveLength(2);
    expect((await bank())[1].text).toMatch(/^Your bank wants you to confirm 3 payments \(\$24\.50 in all\): the first by /);
    expect(renderTimes(R.bankWaitingAllLine([{ cents: 1000, title: "Harbor Run", by: new Date("2026-11-02T15:00:00Z") }]), "UTC")).toBe("Your bank wants you to confirm a $10.00 payment on “Harbor Run” by Nov 2");
  });
});

describe("§23-27 the tester's stacks across tests", () => {
  it("§23 application and invite lines from two tests on one day form one 'Applications and invites' entry", async () => {
    const t = await makeUser({ tester: true });
    for (const title of ["Harbor Run", "Sky Lab"]) {
      const { testId } = await setup({ title, productName: title });
      await tellFull({ title, testId, dev: "Nora Lane", apps: [t.user.email], invites: [] });
    }
    await tellFull({ title: "Reef Dash", testId: (await setup({ title: "Reef Dash" })).testId, dev: "Nora Lane", apps: [], invites: [t.user.email] });
    const ls = await lines(t.user.id);
    expect(ls).toHaveLength(3);
    expect(ls.every((l) => l.groupKey === "apps" && l.link.startsWith("/app/find/"))).toBe(true);
    expect(keys(ls).size).toBe(1);
    expect(groupTitle("apps", 3, 3)).toBe("Applications and invites"); // "Applications and invites · 3 updates today"
    expect(src("lib/server/invites.ts")).toContain('{ group: "apps", testId }); // (batch 29 §23)');
    expect(src("lib/server/joining.ts")).not.toContain('"appclosed"');
  });

  it("§24 joins on two tests the same day form one 'Joined' entry", async () => {
    const t = await makeUser({ tester: true, name: "Dee Moss" });
    for (const title of ["Harbor Run", "Sky Lab"]) {
      const { dev, testId } = await setup({ title, productName: title, joinMode: "apply" });
      expect((await act(testId, "apply", t.cookie, { note: "Hi" })).status).toBe(200);
      const a = await db.application.findFirstOrThrow({ where: { testId, testerId: t.user.id } });
      expect((await act(testId, "application", dev.cookie, { applicationId: a.id, action: "accept", seenAt: seen(), confirmed: true })).status).toBe(200);
    }
    const ins = (await lines(t.user.id)).filter((l) => /^You're in: /.test(l.text));
    expect(ins).toHaveLength(2);
    expect(ins.every((l) => l.groupKey === "joined" && l.link.startsWith("/app/sessions/"))).toBe(true);
    expect(keys(ins).size).toBe(1);
  });

  it("§25 new terms offers on two tests form one 'New terms to answer' entry, each opening the Switch / Keep box", async () => {
    const t = await makeUser({ tester: true });
    for (const title of ["Harbor Run", "Sky Lab"]) {
      const { dev, testId } = await setup({ title, productName: title });
      const test = await db.test.findUniqueOrThrow({ where: { id: testId } });
      expect((await act(testId, "join", t.cookie, { listingVersion: test.listingVersion })).status).toBe(200);
      await settle();
      const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
      expect((await act(testId, "edit", dev.cookie, { version: v, fields: { writtenCents: "12.00" }, confirmed: true })).status).toBe(200);
    }
    const offers = (await lines(t.user.id)).filter((l) => /^Nora Lane updated the listing: /.test(l.text));
    expect(offers).toHaveLength(2);
    expect(offers.every((l) => l.groupKey === "newterms" && l.link.endsWith("#terms-offer"))).toBe(true);
    expect(keys(offers).size).toBe(1);
    expect(groupTitle("newterms", 2, 2)).toBe("New terms to answer · 2 tests");
  });

  it("§25 a Pay and a Pay more on one day form one 'You were paid' entry", async () => {
    const { dev, testId } = await setup();
    const a = await sent(testId);
    expect((await pay(dev.cookie, { kind: "submission", id: a.sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    expect((await act(testId, "pay-extra", dev.cookie, { seenAt: seen(), payKey: randomUUID(), contractId: a.sessionId, submissionId: a.sub.id, amount: "2.00", tickedCents: 200 })).status).toBe(200);
    const paid = (await lines(a.tester.user.id)).filter((l) => /^Nora Lane paid you /.test(l.text));
    expect(paid).toHaveLength(2);
    expect(paid.every((l) => l.groupKey === "tpaid")).toBe(true);
    expect(keys(paid).size).toBe(1);
  });

  it("§26 excerpt answers stack in 'Excerpts' across tests", () => {
    expect(src("lib/server/excerpts.ts")).toContain('{ testId: x.testId, group: "excerpts" }); // (batch 29 §26)');
    const at = new Date();
    expect(bellKey({ id: "a", testId: "t1", own: false, groupKey: "excerpts", createdAt: at })).toBe(bellKey({ id: "b", testId: "t2", own: false, groupKey: "excerpts", createdAt: at }));
  });

  it("§27 + §34 two deadline reminders on one day form one 'Deadlines' entry; with email Off they're still emailed at the end of the day, stacked", async () => {
    const t = await makeUser({ tester: true });
    await db.user.update({ where: { id: t.user.id }, data: { emailPref: "off" } });
    for (const title of ["Harbor Run", "Sky Lab"]) {
      const { testId } = await setup({ title, productName: title });
      const test = await db.test.findUniqueOrThrow({ where: { id: testId } });
      expect((await act(testId, "join", t.cookie, { listingVersion: test.listingVersion })).status).toBe(200);
      // Their own deadline in 2 days, joined 5 days ago: the 3-day mark is due.
      await db.contract.updateMany({ where: { testId }, data: { dueAt: new Date(Date.now() + 2 * DAY), joinedAt: ago(5) } });
    }
    await cron();
    const dl = (await lines(t.user.id)).filter((l) => /^Your deadline on /.test(l.text));
    expect(dl).toHaveLength(2);
    expect(dl.every((l) => l.groupKey === "deadlines" && l.mustEmail && l.link.startsWith("/app/sessions/"))).toBe(true);
    expect(keys(dl).size).toBe(1);
    expect(groupTitle("deadlines", 2, 2)).toBe("Deadlines · 2 tests");
    const mail = await db.outboxEmail.findFirstOrThrow({ where: { to: t.user.email } });
    expect(mail.subject).toMatch(/^Your Playtest account updates: /);
    expect(mail.text).toContain("• Deadlines · 2 tests");
    expect(mail.text).toMatch(/\n {2}• Your deadline on “Harbor Run” is /);
    expect(mail.text).toMatch(/\n {2}• Your deadline on “Sky Lab” is /);
  });
});

describe("§29 admin bell lines: one stack per kind, across tests", () => {
  it("two disputes and a report on one day are two entries, titled by kind; each line opens its own row", async () => {
    const a = await makeUser({ email: `admin-${randomUUID()}@playtest.test` });
    await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
    await bell(a.user.id, "Dispute on “Harbor Run”: Ana Silva says the pay should be higher (Nora Lane)", "/admin#dispute-d1", undefined, { group: "admindisputes" });
    await bell(a.user.id, "Dispute on “Sky Lab”: Ben Ward says the pay should be higher (Nora Lane)", "/admin#dispute-d2", undefined, { group: "admindisputes" });
    await notify(a.user.email, "New report: Ana Silva reported Nora Lane", ["x"], "/admin#report-r1", { group: "adminreports" });
    expect(keys(await lines(a.user.id)).size).toBe(2);
    expect(await unreadEntryCount(a.user.id)).toBe(2);
    expect(groupTitle("admindisputes", 2, 3)).toBe("Disputes · 3 new");
    expect(groupTitle("adminreports", 1, 2)).toBe("Reports · 2 new");
    expect(groupTitle("adminlifts", 1, 1)).toBe("Hold lifts waiting · 1");
    expect(src("lib/server/payments.ts")).toContain("`/admin#dispute-${d.id}`, undefined, { group: \"admindisputes\" }");
    expect(src("lib/server/reports.ts")).toContain("`/admin#report-${r.id}`, { group: \"adminreports\" }");
    expect(src("lib/server/holds.ts")).toContain("`/admin#lift-${dev.id}`, undefined, { group: \"adminlifts\" }");
    expect(src("app/admin/PagedList.tsx")).toContain("id={`report-${r.id}`}");
    expect(src("app/admin/page.tsx")).toContain("<HashJump />");
  });
});

describe("§33 the team's pause / stop / close lines stack with the hold lines", () => {
  it("a team pause and a hold on one day: one entry", async () => {
    const { dev, testId } = await setup();
    const adm = await makeUser({ email: `admin-${randomUUID()}@playtest.test` });
    await db.user.update({ where: { id: adm.user.id }, data: { isAdmin: true } });
    await pauseTest(adm.user.id, testId, "Checking the build");
    await startHold(dev.user.id, "unpaid");
    const mine = (await lines(dev.user.id)).filter((l) => /^The team paused|^Your tests are paused/.test(l.text));
    expect(mine).toHaveLength(2);
    expect(mine.every((l) => l.groupKey === "payhold" && l.mustEmail)).toBe(true);
    expect(keys(mine).size).toBe(1);
    // The team's note stays in the email, never in the bell.
    expect(mine.find((l) => /^The team paused/.test(l.text))!.text).toBe("The team paused “Harbor Run”");
  });
});

describe("§34 email rules for admins", () => {
  it("an admin with email Off gets no end-of-day summary but does get the chargeback email at once", async () => {
    const off = await makeUser({ email: `admin-${randomUUID()}@playtest.test` });
    await db.user.update({ where: { id: off.user.id }, data: { isAdmin: true, emailPref: "off" } });
    const on = await makeUser({ email: `admin-${randomUUID()}@playtest.test` });
    await db.user.update({ where: { id: on.user.id }, data: { isAdmin: true, emailPref: "daily" } });
    // Something for the summary: a dispute.
    const { dev, testId } = await setup();
    const a = await sent(testId);
    expect((await pay(dev.cookie, { kind: "submission", id: a.sub.id, amount: "4.00", tickedCents: 400, reason: "Only half answered" })).status).toBe(200);
    expect((await sact(a.sessionId, "dispute", a.tester.cookie, { kind: "submission", id: a.sub.id, reason: "I answered everything properly", seenAt: seen(), confirmed: true })).status).toBe(200);
    await cron();
    const summary = (to: string) => db.outboxEmail.count({ where: { to, subject: { startsWith: "Playtest admin:" } } });
    expect(await summary(off.user.email)).toBe(0);
    expect(await summary(on.user.email)).toBe(1);
    // A chargeback: right away, to every admin, whatever the setting.
    const p = await db.payment.findFirstOrThrow({ where: { submissionId: a.sub.id } });
    const pi = "pi_" + randomUUID();
    await db.payment.update({ where: { id: p.id }, data: { stripePaymentIntentId: pi, status: "charged" } });
    const { chargebackOpened } = await import("@/lib/server/holds");
    await chargebackOpened(pi);
    for (const to of [off.user.email, on.user.email]) expect(await db.outboxEmail.count({ where: { to, subject: { startsWith: "Playtest: new chargeback of" } } })).toBe(1);
    void sendSummaries;
  });
});
