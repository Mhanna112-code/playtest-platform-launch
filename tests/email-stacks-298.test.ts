import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { PAUSES_GROUP, bellStacks, stackHeading } from "@/lib/bell";
import { SIDE_HEADINGS, emailLines, notificationScopeFor, sendSummaries, testTitlesOf } from "@/lib/server/notify";
import { pauseTest, unpauseTest } from "@/lib/server/restrictions";
import { joined, setup } from "./fixtures";
import { makeUser } from "./helpers";

// (Owner, Nov 6, §298) Every bell stack also stacks in the email, the same way (one grouping function, bellStacks, drives the Notifications page and the
// summary / end-of-day emails): a heading line, the bell's stack title, with its lines under it; a line alone in the bell stays a single line. Testers' "“X” is
// paused" / "“X” is running again" go out even with email Off (end-of-day), still in the "Pauses · N" stack, still never saying why.

const DAY = 86_400_000;
const mails = (to: string) => db.outboxEmail.findMany({ where: { to }, orderBy: { createdAt: "asc" } });
type Line = { text: string; groupKey?: string | null; testId?: string | null; own?: boolean; side?: string | null; at?: Date };
async function lines(userId: string, ls: Line[]) {
  for (const l of ls) await db.notification.create({ data: { userId, text: l.text, link: "", groupKey: l.groupKey ?? null, testId: l.testId ?? null, own: !!l.own, side: l.side === undefined ? "tester" : l.side, ...(l.at ? { createdAt: l.at } : {}) } });
}
/** The email body's lines under its heading (§325: no "Playtest" sign-off any more). */
const bodyOf = (text: string) => text.split("\n").slice(2);
/** The email body as stacks: each heading with its lines ("" heading for a single line). */
function emailStacks(body: string[]) {
  const out: { heading: string; lines: string[] }[] = [];
  for (const l of body) {
    if (l.startsWith("  • ")) out.at(-1)!.lines.push(l.slice(4));
    else if (l.startsWith("• ")) out.push({ heading: l.slice(2), lines: [] });
  }
  return out.map((s) => (s.lines.length ? s : { heading: "", lines: [s.heading] }));
}
/** What the Notifications page computes for this account: the same query, order, zone and titles. */
async function bellPageStacks(userId: string) {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const items = await db.notification.findMany({ where: { userId, ...(await notificationScopeFor(userId)) }, orderBy: { createdAt: "desc" }, take: 200 });
  const titles = await testTitlesOf(items);
  return bellStacks(items, u.timeZone, (id) => titles.get(id)).map((s) => ({ heading: s.lines.length > 1 ? stackHeading(s) : "", lines: s.lines.map((n) => n.text) }));
}
const norm = (ss: { heading: string; lines: string[] }[]) => ss.map((s) => `${s.heading}|${[...s.lines].sort().join("|")}`).sort();

describe("§298: the email stacks exactly as the bell does", () => {
  it("a summary with disputes, ratings, excerpts, tester payments, applications and a per-test stack: the same stacks and titles as the bell page", async () => {
    const s = await setup({ title: "Harbor Run" });
    const t = await makeUser({ tester: true, name: "Ana Silva" });
    await db.user.update({ where: { id: t.user.id }, data: { emailPref: "daily", timeZone: "America/Chicago" } });
    const now = new Date();
    const yesterday = new Date(now.getTime() - DAY);
    await lines(t.user.id, [
      { text: "Nora Lane filed a dispute on “Harbor Run”", groupKey: "disputefiled", testId: s.testId },
      { text: "Your dispute on “Sky Lab” was filed", groupKey: "disputefiled" },
      { text: "Rate Nora Lane for “Harbor Run”", groupKey: "ratings", testId: s.testId },
      { text: "Rate Ben Okafor for “Sky Lab”", groupKey: "ratings" },
      { text: "Excerpt 1 yesterday", groupKey: "excerpts", at: yesterday },
      { text: "Excerpt 2 yesterday", groupKey: "excerpts", at: new Date(yesterday.getTime() + 1000) },
      { text: "Excerpt 3 today", groupKey: "excerpts" },
      { text: "Excerpt 4 today", groupKey: "excerpts" },
      { text: "You were paid $10.00 for “Harbor Run”", groupKey: "tpaid", testId: s.testId },
      { text: "You were paid $6.00 for “Sky Lab”", groupKey: "tpaid" },
      { text: "Your application to “Sky Lab” was accepted", groupKey: "apps" },
      { text: "Your application to “Moon Base” was declined", groupKey: "apps" },
      { text: "Nora Lane reviewed your work on “Harbor Run”", testId: s.testId },
      { text: "Nora Lane asked for more on “Harbor Run”", testId: s.testId },
      { text: "Your direct message", groupKey: "dms" }, // one line: stays single
    ]);
    await sendSummaries(now, [t.user.id]);
    const m = (await mails(t.user.email)).at(-1)!;
    const got = emailStacks(bodyOf(m.text));
    expect(norm(got)).toEqual(norm(await bellPageStacks(t.user.id)));
    // The titles, as the bell shows them (without its "today").
    const headings = got.map((x) => x.heading).filter(Boolean);
    expect(headings).toEqual(expect.arrayContaining(["Disputes filed · 2 updates", "Ratings to give · 2 updates", "You were paid · 2 updates", "Applications and invites · 2 updates", "Harbor Run · 2 updates"]));
    // One stack a day, as in the bell (the reader's zone).
    expect(headings.filter((h) => h === "Excerpts · 2 updates")).toHaveLength(2);
    expect(got.find((x) => x.heading === "Harbor Run · 2 updates")!.lines).toEqual(["Nora Lane reviewed your work on “Harbor Run”", "Nora Lane asked for more on “Harbor Run”"]);
    expect(got.find((x) => !x.heading && x.lines[0] === "Your direct message")).toBeTruthy();
  });

  it("an own line stays a single line, as in the bell; a counted title keeps its own count", async () => {
    const at = new Date("2026-11-05T15:00:00Z");
    const n = (id: string, text: string, o: { groupKey?: string | null; testId?: string | null; own?: boolean } = {}) => ({ id, text, link: "", groupKey: o.groupKey ?? null, testId: o.testId ?? null, own: !!o.own, createdAt: at });
    const line = (x: { text: string }) => `• ${x.text}`;
    const titles = new Map([["t1", "Harbor Run"]]);
    // The own line about the test and one more line about it: two single lines (the own one never stacks; the other is alone in its stack).
    expect(emailLines([n("1", "The team stopped “Harbor Run”", { testId: "t1", own: true }), n("2", "Nora Lane reviewed your work", { testId: "t1" })], line, "UTC", titles)).toEqual(["• The team stopped “Harbor Run”", "• Nora Lane reviewed your work"]);
    // Two own lines of one group: still single.
    expect(emailLines([n("1", "A", { groupKey: "payhold", own: true }), n("2", "B", { groupKey: "payhold", own: true })], line, "UTC")).toEqual(["• A", "• B"]);
    // A second per-test line stacks under the test's name, the own line stays apart.
    expect(emailLines([n("1", "Stopped", { testId: "t1", own: true }), n("2", "X", { testId: "t1" }), n("3", "Y", { testId: "t1" })], line, "UTC", titles)).toEqual(["• Stopped", "• Harbor Run · 2 updates", "  • X", "  • Y"]);
    // The admin's counted titles: "Disputes · 3 new".
    expect(emailLines([n("1", "D1", { groupKey: "admindisputes" }), n("2", "D2", { groupKey: "admindisputes" }), n("3", "D3", { groupKey: "admindisputes" })], line, "UTC")[0]).toBe("• Disputes · 3 new");
  });

  it("an account with both sides keeps its sections, each stacked as the bell", async () => {
    const s = await setup({ title: "Harbor Run" });
    const both = await makeUser({ dev: true, tester: true, name: "Nora Lane" });
    await db.user.update({ where: { id: both.user.id }, data: { emailPref: "daily" } });
    await lines(both.user.id, [
      { text: "Your password changed", side: null },
      { text: "Ana sent work on “Harbor Run”", groupKey: "unreviewed", testId: s.testId, side: "developer" },
      { text: "Ben sent work on “Harbor Run”", groupKey: "unreviewed", testId: s.testId, side: "developer" },
      { text: "Rate Ben for “Sky Lab”", groupKey: "ratings", side: "tester" },
      { text: "Rate Cy for “Moon Base”", groupKey: "ratings", side: "tester" },
    ]);
    await sendSummaries(new Date(), [both.user.id]);
    const body = bodyOf((await mails(both.user.email)).at(-1)!.text);
    expect(body).toEqual([
      SIDE_HEADINGS.account, "• Your password changed",
      "", SIDE_HEADINGS.developer, "• Work waiting for your review · 2 updates", "  • Ana sent work on “Harbor Run”", "  • Ben sent work on “Harbor Run”",
      "", SIDE_HEADINGS.tester, "• Ratings to give · 2 updates", "  • Rate Ben for “Sky Lab”", "  • Rate Cy for “Moon Base”",
    ]);
  });
});

describe("§298 point 2: testers' pause lines reach them with email Off", () => {
  it("Off: the paused and running-again lines go in her end-of-day email, stacked under Pauses · 2, never saying why", async () => {
    const s = await setup();
    const j = await joined(s.testId, "Ana Silva");
    await db.user.update({ where: { id: j.tester.user.id }, data: { emailPref: "off" } });
    const a = await db.user.update({ where: { id: (await makeUser({ email: `admin-${randomUUID()}@playtest.test` })).user.id }, data: { isAdmin: true } });
    await pauseTest(a.id, s.testId, "Checking the build");
    await unpauseTest(s.testId, a.id);
    const mine = await db.notification.findMany({ where: { userId: j.tester.user.id, groupKey: PAUSES_GROUP }, orderBy: { createdAt: "asc" } });
    expect(mine.map((n) => [n.text, n.mustEmail])).toEqual([["“Harbor Run” is paused", true], ["“Harbor Run” is running again", true]]);
    await sendSummaries(new Date(), [j.tester.user.id]);
    const m = (await mails(j.tester.user.email)).at(-1)!;
    expect(m.subject).toMatch(/^Your Playtest account updates/);
    const body = m.text.split("\n");
    const at = body.indexOf("• Pauses · 2");
    expect(at).toBeGreaterThan(-1);
    expect(body[at + 1]).toMatch(/^ {2}• “Harbor Run” is paused http/);
    expect(body[at + 2]).toMatch(/^ {2}• “Harbor Run” is running again http/);
    expect(m.text).not.toMatch(/hold|suspend|team|Checking the build/i);
  });
});
