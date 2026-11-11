import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { EMAIL_INCIDENT_KEY, emailsDegraded, retryEmails, sendEmail, setEmailTransportForTests } from "@/lib/server/email";
import { notify, sendSummaries } from "@/lib/server/notify";
import { makeUser } from "./helpers";

// (Owner, Nov 11, §383 7) Out-of-date emails expire instead of arriving late: a sent-at-once reminder (the call reminder) is never delivered after its moment,
// and a morning email still waiting is replaced by the next morning's. Neither is a failure (no incident, no "degraded: emails"). The bell always has the line.
const H = 3_600_000, DAY = 86_400_000;
type Post = { id: string; to: string; text: string };
function resend(ok: () => boolean) {
  const posts: Post[] = [];
  setEmailTransportForTests(async (row) => {
    posts.push(row);
    return ok() ? { ok: true } : { ok: false, status: 503, body: "Service unavailable" };
  });
  return posts;
}
const clean = async () => {
  await db.emailQueue.deleteMany({});
  await db.appState.deleteMany({ where: { key: { in: [EMAIL_INCIDENT_KEY, "email-cap-until"] } } });
};
beforeEach(async () => {
  await clean();
  vi.stubEnv("RESEND_API_KEY", "re_test_only");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  setEmailTransportForTests(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await clean();
});

describe("§383 7a: a sent-at-once reminder expires at its own moment", () => {
  it("an email past its expiry is marked expired, never sent, and raises no incident", async () => {
    const posts = resend(() => true);
    const u = await makeUser({ tester: true });
    const now = new Date();
    const row = await db.emailQueue.create({ data: { to: u.user.email, subject: "Your call starts at 3:00 PM", text: "x", recipientId: u.user.id, giveUpAt: new Date(now.getTime() + 48 * H), nextTryAt: now, expiresAt: new Date(now.getTime() - 60_000) } });
    expect(await retryEmails(now)).toBe(0);
    expect(posts).toHaveLength(0);
    expect(await db.emailQueue.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: "expired", failedAt: null });
    expect(await db.appState.findUnique({ where: { key: EMAIL_INCIDENT_KEY } })).toBeNull();
    expect(await emailsDegraded(new Date(now.getTime() + H))).toBe(false);
    // Made already past its moment: kept as expired, never sent.
    const late = await sendEmail({ to: u.user.email, subject: "Late", text: "y", recipientId: u.user.id, expiresAt: new Date(now.getTime() - 1000) }, now);
    expect(late.via).toBe("expired");
    expect(posts).toHaveLength(0);
  });

  it("a reminder that failed (a real incident) and then passes its moment expires: the incident ends, nothing is degraded", async () => {
    let up = false;
    const posts = resend(() => up);
    const u = await makeUser({ tester: true });
    const t0 = new Date();
    // The call reminder's way: notify with `now` (sent at once), expiring at the call's start.
    await notify(u.user.email, "Your call with Nora Lane on “Harbor Run” starts at 3:00 PM.", ["Your call starts soon."], "/app", { recipientId: u.user.id, now: true, always: true, expiresAt: new Date(t0.getTime() + H) });
    const row = await db.emailQueue.findFirstOrThrow({ where: { recipientId: u.user.id } });
    expect(row.status).toBe("pending");
    expect(row.expiresAt?.getTime()).toBe(t0.getTime() + H);
    expect(await db.appState.findUnique({ where: { key: EMAIL_INCIDENT_KEY } })).not.toBeNull(); // the failed try is a real incident
    up = true;
    await retryEmails(new Date(t0.getTime() + 2 * H)); // Resend is back, but the call has started
    expect(posts).toHaveLength(1); // only the failed first try
    expect((await db.emailQueue.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("expired");
    expect(await db.appState.findUnique({ where: { key: EMAIL_INCIDENT_KEY } })).toBeNull();
    expect(await emailsDegraded(new Date(t0.getTime() + 3 * H))).toBe(false);
    // The bell kept the line.
    expect(await db.notification.count({ where: { userId: u.user.id, text: { startsWith: "Your call with Nora Lane" } } })).toBe(1);
  });

  it("the call reminder expires at the call's start", () => {
    const calls = fs.readFileSync(path.resolve(__dirname, "../src/lib/server/calls.ts"), "utf8");
    expect(calls.match(/now: true, always: true, expiresAt: call\.startsAt/g)).toHaveLength(2);
  });
});

describe("§383 7b: a morning email never delivered is replaced by the next one", () => {
  const line = (userId: string, text: string) => db.notification.create({ data: { userId, text, link: "/app" } });

  it("the pending one is replaced (not a failure) and its lines appear once in the new one; a delivered one is untouched", async () => {
    let up = false;
    const posts = resend(() => up);
    const u = await makeUser({ tester: true });
    await db.user.update({ where: { id: u.user.id }, data: { emailPref: "daily" } });
    const day1 = new Date();
    await line(u.user.id, "Line one");
    await line(u.user.id, "Line two");
    await sendSummaries(day1, [u.user.id]);
    const first = await db.emailQueue.findFirstOrThrow({ where: { recipientId: u.user.id } });
    expect(first.status).toBe("pending"); // Resend is down
    await line(u.user.id, "Line three");
    up = true;
    await sendSummaries(new Date(day1.getTime() + DAY), [u.user.id]);
    expect((await db.emailQueue.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("replaced");
    const rows = await db.emailQueue.findMany({ where: { recipientId: u.user.id }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.status)).toEqual(["replaced", "sent"]);
    const text = rows[1].text;
    for (const l of ["Line one", "Line two", "Line three"]) expect(text.split(l).length - 1).toBe(1);
    expect(posts.filter((p) => p.id === rows[1].id)).toHaveLength(1);
    expect(await db.appState.findUnique({ where: { key: EMAIL_INCIDENT_KEY } })).toBeNull();
    // The delivered one is untouched by the next morning: no new email for lines it carried.
    await sendSummaries(new Date(day1.getTime() + 2 * DAY), [u.user.id]);
    expect((await db.emailQueue.findUniqueOrThrow({ where: { id: rows[1].id } })).status).toBe("sent");
    expect(await db.emailQueue.count({ where: { recipientId: u.user.id } })).toBe(2);
  });
});

describe("§383 8: a replaced FULL summary makes the person due again (Weekly / Monthly lose nothing)", () => {
  const line = (userId: string, text: string, payment = false) => db.notification.create({ data: { userId, text, link: "/app", payment } });

  it("Weekly: the never-delivered weekly summary is replaced next morning by a full summary carrying its ordinary lines; a replaced short email stays short", async () => {
    let up = false;
    const posts = resend(() => up);
    const u = await makeUser({ tester: true });
    await db.user.update({ where: { id: u.user.id }, data: { emailPref: "weekly" } });
    const day1 = new Date();
    await line(u.user.id, "Ordinary one");
    await sendSummaries(day1, [u.user.id]); // the weekly summary is due (none before): Resend is down
    const first = await db.emailQueue.findFirstOrThrow({ where: { recipientId: u.user.id } });
    expect(first).toMatchObject({ status: "pending", kind: "morning-full" });
    await line(u.user.id, "Ordinary two");
    up = true;
    const day2 = new Date(day1.getTime() + DAY);
    await sendSummaries(day2, [u.user.id]);
    const rows = await db.emailQueue.findMany({ where: { recipientId: u.user.id }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => [r.status, r.kind])).toEqual([["replaced", "morning-full"], ["sent", "morning-full"]]);
    expect(rows[1].subject).toMatch(/^Your Playtest summary/);
    for (const l of ["Ordinary one", "Ordinary two"]) expect(rows[1].text.split(l).length - 1).toBe(1);
    expect((await db.user.findUniqueOrThrow({ where: { id: u.user.id } })).lastSummaryAt?.getTime()).toBe(day2.getTime());
    expect(posts.filter((p) => p.id === rows[1].id)).toHaveLength(1);

    // A short email (payment lines only, the weekly summary not due) still waiting: replaced by the next short one, which carries its payment line; the
    // ordinary line keeps waiting for the weekly summary.
    up = false;
    await line(u.user.id, "You were paid $8.00", true);
    await line(u.user.id, "Ordinary three");
    await sendSummaries(new Date(day2.getTime() + DAY), [u.user.id]);
    const short = await db.emailQueue.findFirstOrThrow({ where: { recipientId: u.user.id, status: "pending" } });
    expect(short.kind).toBe("morning-short");
    up = true;
    await sendSummaries(new Date(day2.getTime() + 2 * DAY), [u.user.id]);
    expect((await db.emailQueue.findUniqueOrThrow({ where: { id: short.id } })).status).toBe("replaced");
    const next = await db.emailQueue.findFirstOrThrow({ where: { recipientId: u.user.id, status: "sent", createdAt: { gt: short.createdAt } } });
    expect(next.kind).toBe("morning-short");
    expect(next.text.split("You were paid $8.00").length - 1).toBe(1);
    expect(next.text).not.toContain("Ordinary three");
    expect((await db.user.findUniqueOrThrow({ where: { id: u.user.id } })).lastSummaryAt?.getTime()).toBe(day2.getTime());
  });
});
