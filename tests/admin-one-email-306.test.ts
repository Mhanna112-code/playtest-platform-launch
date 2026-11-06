import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { GET as cronGET } from "@/app/api/cron/daily/route";
import { bell, notify, sendSummaries } from "@/lib/server/notify";
import { TEAM_HEADING } from "@/lib/server/adminDaily";
import { makeUser } from "./helpers";
import { joined, sact, settle, setup } from "./fixtures";

// (Owner, Nov 6, §306) ONE end-of-day email per admin: their own updates (stacked as the bell), then "For the team" holding what the team's admin email held; a
// dispute or hold lift listed there is not repeated among their own lines (it stays in the bell). It follows the admin's email setting as the admin email did.
// Non-admins are unchanged.

const DAY = 86_400_000;
const cron = () => cronGET(new Request("http://localhost:3400/api/cron/daily", { headers: { authorization: "Bearer cron-test" } }));
const mails = (to: string) => db.outboxEmail.findMany({ where: { to }, orderBy: { createdAt: "asc" } });
const count = (text: string, part: string) => text.split(part).length - 1;

async function admin(emailPref: string) {
  const a = await makeUser({ email: `admin-${randomUUID()}@playtest.test`, name: "Team Admin" });
  await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true, emailPref } });
  return a;
}
/** A new dispute (Ana Silva on Nora Lane's test) and a hold lift waiting (a developer on their 4th hold who owes nothing), with the admin's bell lines for both. */
async function teamWork(adminId: string) {
  const title = `Harbor Run ${randomUUID().slice(0, 6)}`;
  const s = await setup({ title });
  const j = await joined(s.testId);
  await sact(j.sessionId, "written", j.tester.cookie, { answers: ["answer", "answer"] });
  await settle();
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  const reason = `Too low ${randomUUID().slice(0, 8)}`;
  const d = await db.dispute.create({ data: { contractId: j.sessionId, testerId: j.tester.user.id, submissionId: sub.id, reason } });
  const held = await makeUser({ dev: true, name: `Liftme ${randomUUID().slice(0, 6)}` });
  await db.user.update({ where: { id: held.user.id }, data: { holdStartedAt: new Date(Date.now() - 60_000), holdReason: "unpaid", holdCount: 4 } });
  // The bell lines, as payments.ts and holds.ts write them.
  const disputeBell = `Dispute on “${title}”: Ana Silva says the pay should be higher (Nora Lane)`;
  const liftBell = `Hold lift waiting: ${held.user.name} paid what they owe (Many holds)`;
  await bell(adminId, disputeBell, `/admin#dispute-${d.id}`, undefined, { group: "admindisputes" });
  await bell(adminId, liftBell, `/admin#lift-${held.user.id}`, undefined, { group: "adminlifts" });
  return { d, title, reason, held, disputeBell, liftBell };
}

describe("§306 one end-of-day email per admin", () => {
  it("an admin on Daily with a new dispute and a hold lift waiting gets ONE email: their own updates, then For the team, each item once", async () => {
    const a = await admin("daily");
    const w = await teamWork(a.user.id);
    // One of their own updates that the team section doesn't hold: a new report.
    const reportLine = `New report: Ben Okafor reported Nora Lane ${randomUUID().slice(0, 6)}`;
    await notify(a.user.email, reportLine, [reportLine], `/admin#report-${randomUUID()}`, { group: "adminreports" });
    await cron();
    const got = await mails(a.user.email);
    expect(got).toHaveLength(1); // no separate "Playtest admin:" email
    const m = got[0];
    expect(m.subject).toMatch(/^Your Playtest summary: \d+ updates?, \d+ items? for the team$/);
    expect(count(m.text, `\n${TEAM_HEADING}\n`)).toBe(1);
    const [own, team] = m.text.split(`\n${TEAM_HEADING}\n`);
    // Their own updates, above the section.
    expect(own).toContain(reportLine);
    // The dispute: once, in For the team (the team's line with its reason); its bell line is not repeated.
    expect(count(m.text, w.reason)).toBe(1);
    expect(team).toContain(`New dispute: Ana Silva vs Nora Lane on “${w.title}”: “${w.reason}”`);
    expect(m.text).not.toContain(w.disputeBell);
    // The hold lift: once, in For the team; its bell line is not repeated.
    expect(count(m.text, `${w.held.user.name} (${w.held.user.email})`)).toBe(1);
    expect(team).toContain(`Hold lift waiting for your Approve: ${w.held.user.name} (${w.held.user.email})`);
    expect(m.text).not.toContain(w.liftBell);
    // Both stay in the bell (unread), marked as emailed so no later email repeats them.
    const lines = await db.notification.findMany({ where: { userId: a.user.id, text: { in: [w.disputeBell, w.liftBell] } } });
    expect(lines).toHaveLength(2);
    expect(lines.every((n) => n.readAt === null && n.summarizedAt !== null)).toBe(true);
    expect(m.html).toContain("Open the admin console");
    // The next day's job: no second email about the dispute.
    await cron();
    expect((await mails(a.user.email)).filter((x) => x.text.includes(w.reason))).toHaveLength(1);
    await db.user.update({ where: { id: w.held.user.id }, data: { holdStartedAt: null } });
  });

  it("an admin with email Off gets no For the team section (as the admin email: none with Off); the lines stay in the bell", async () => {
    const a = await admin("off");
    const w = await teamWork(a.user.id);
    await cron();
    expect(await mails(a.user.email)).toHaveLength(0); // nothing forced: no end-of-day email at all
    expect(await db.notification.count({ where: { userId: a.user.id, text: { in: [w.disputeBell, w.liftBell] } } })).toBe(2);
    await db.user.update({ where: { id: w.held.user.id }, data: { holdStartedAt: null } });
  });
});

describe("§306 non-admins are unchanged; one end-of-day email, forced lines never twice", () => {
  it("a developer on Daily: one summary, her lines in it, no For the team section", async () => {
    const dev = await makeUser({ dev: true, name: "Nora Lane" });
    await notify(dev.user.email, "Ana Silva joined “Harbor Run”", ["Ana Silva joined."], "/app/tests/x1");
    await notify(dev.user.email, "You paid $5.00 for Ana Silva's written answers", ["Paid."], "/app/payments", { payment: true, side: "developer" });
    await sendSummaries(new Date(), [dev.user.id]);
    const got = await mails(dev.user.email);
    expect(got).toHaveLength(1);
    expect(got[0].subject).toBe("Your Playtest summary: 2 updates");
    expect(got[0].text).toContain("Ana Silva joined “Harbor Run”");
    expect(got[0].text).toContain("You paid $5.00 for Ana Silva's written answers");
    expect(got[0].text).not.toContain(TEAM_HEADING);
    expect(got[0].html).toContain("Open Playtest");
    await sendSummaries(new Date(), [dev.user.id]);
    expect(await mails(dev.user.email)).toHaveLength(1);
  });

  it("Weekly: a short end-of-day email with only the forced lines; the weekly doesn't repeat them", async () => {
    const t = await makeUser({ tester: true, name: "Ana Silva" });
    const now = Date.now();
    await db.user.update({ where: { id: t.user.id }, data: { emailPref: "weekly", lastSummaryAt: new Date(now - 2 * DAY) } });
    await notify(t.user.email, "You were paid $5.00 for “Harbor Run”", ["Paid."], "/app/payments", { payment: true, side: "tester" });
    await notify(t.user.email, "Nora Lane rated you", ["Rated."], "/app/profile", { side: "tester" });
    await sendSummaries(new Date(now), [t.user.id]);
    let got = await mails(t.user.email);
    expect(got).toHaveLength(1);
    expect(got[0].text).toContain("You were paid $5.00");
    expect(got[0].text).not.toContain("Nora Lane rated you");
    await sendSummaries(new Date(now + 6 * DAY), [t.user.id]); // the weekly is due
    got = await mails(t.user.email);
    expect(got).toHaveLength(2);
    expect(got[1].subject).toBe("Your Playtest summary: 1 update");
    expect(got[1].text).toContain("Nora Lane rated you");
    expect(got[1].text).not.toContain("You were paid $5.00");
  });
});
