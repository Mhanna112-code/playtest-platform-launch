import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { EMAIL_INCIDENT_KEY, setEmailTransportForTests } from "@/lib/server/email";
import { sendSummaries } from "@/lib/server/notify";
import { NEWEST_ONLY_EVERYWHERE, newestOnlyEverywhere } from "@/lib/reminderPolicy";
import { makeUser } from "./helpers";

// (Owner, Nov 2026: one copy of an invite or applications reminder per email, whatever the setting) In EVERY morning email (Daily too, not only Weekly /
// Monthly), several waiting copies of the same invite reminder ("invite:<inviteId>") or applications-waiting reminder ("applications:<testId>") show as one
// line, the newest; the older copies are marked emailed with it. Other reminder keys on Daily still list every copy. The bell keeps every copy.

const H = 3_600_000, DAY = 86_400_000;
function resend(ok: () => boolean) {
  setEmailTransportForTests(async () => (ok() ? { ok: true } : { ok: false, status: 503, body: "Service unavailable" }));
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

const copy = (userId: string, text: string, reminderKey: string, createdAt: Date) => db.notification.create({ data: { userId, text, link: "/app", reminderKey, createdAt } });
const daily = async () => {
  const u = await makeUser({ tester: true });
  await db.user.update({ where: { id: u.user.id }, data: { emailPref: "daily" } });
  return u;
};
const sent = (userId: string) => db.emailQueue.findMany({ where: { recipientId: userId, status: "sent" }, orderBy: { createdAt: "asc" } });
const count = (text: string, s: string) => text.split(s).length - 1;

describe("newest copy only, in every morning email, for invite and applications reminders", () => {
  it("the constant names the invite and applications keys", () => {
    expect(NEWEST_ONLY_EVERYWHERE).toEqual(["invite:", "applications:"]);
    expect(newestOnlyEverywhere("invite:abc")).toBe(true);
    expect(newestOnlyEverywhere("applications:t1")).toBe(true);
    expect(newestOnlyEverywhere("chargeday:t1")).toBe(false);
    expect(newestOnlyEverywhere(null)).toBe(false);
  });

  it("Daily: three copies of one invite reminder (one carried from a replaced failed email) are one line; all three are marked emailed", async () => {
    let up = false;
    resend(() => up);
    const u = await daily();
    const key = `invite:${randomUUID()}`;
    const day1 = new Date();
    const c1 = await copy(u.user.id, "Reminder: Bo invited you (copy one)", key, new Date(day1.getTime() - H));
    await sendSummaries(day1, [u.user.id]); // Resend is down: the morning email waits
    const first = await db.emailQueue.findFirstOrThrow({ where: { recipientId: u.user.id } });
    expect(first.status).toBe("pending");
    expect(first.notificationIds).toEqual([c1.id]);
    const c2 = await copy(u.user.id, "Reminder: Bo invited you (copy two)", key, new Date(day1.getTime() + 12 * H));
    const c3 = await copy(u.user.id, "Reminder: Bo invited you (copy three)", key, new Date(day1.getTime() + 20 * H));
    await db.notification.create({ data: { userId: u.user.id, text: "Another update", link: "/app", createdAt: new Date(day1.getTime() + 21 * H) } });
    up = true;
    const day2 = new Date(day1.getTime() + DAY);
    await sendSummaries(day2, [u.user.id]);
    expect((await db.emailQueue.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("replaced");
    const [mail] = await sent(u.user.id);
    expect(count(mail.text, "Reminder: Bo invited you")).toBe(1);
    expect(mail.text).toContain("(copy three)");
    expect(mail.text).toContain("Another update");
    expect(mail.subject).toBe("Your Playtest summary: 2 updates"); // counts only what's listed
    expect(mail.notificationIds).toContain(c3.id);
    expect(mail.notificationIds).not.toContain(c1.id);
    expect(mail.notificationIds).not.toContain(c2.id);
    const rows = await db.notification.findMany({ where: { id: { in: [c1.id, c2.id, c3.id] } } });
    expect(rows.every((r) => r.summarizedAt?.getTime() === day2.getTime())).toBe(true);
    expect(rows.every((r) => r.readAt === null)).toBe(true); // the bell keeps every copy
    // Nothing waits: no later email repeats them.
    await sendSummaries(new Date(day2.getTime() + DAY), [u.user.id]);
    expect(await sent(u.user.id)).toHaveLength(1);
  });

  it("Daily: two different invites keep one line each", async () => {
    resend(() => true);
    const u = await daily();
    const now = new Date();
    const a = `invite:${randomUUID()}`, b = `invite:${randomUUID()}`;
    await copy(u.user.id, "Reminder: Bo invited you to Alpha (old)", a, new Date(now.getTime() - 3 * H));
    await copy(u.user.id, "Reminder: Cy invited you to Beta (old)", b, new Date(now.getTime() - 3 * H));
    await copy(u.user.id, "Reminder: Bo invited you to Alpha (new)", a, new Date(now.getTime() - H));
    await copy(u.user.id, "Reminder: Cy invited you to Beta (new)", b, new Date(now.getTime() - H));
    await sendSummaries(now, [u.user.id]);
    const [mail] = await sent(u.user.id);
    expect(count(mail.text, "invited you to Alpha")).toBe(1);
    expect(count(mail.text, "invited you to Beta")).toBe(1);
    expect(mail.text).toContain("Alpha (new)");
    expect(mail.text).toContain("Beta (new)");
    expect(mail.subject).toBe("Your Playtest summary: 2 updates");
    expect(await db.notification.count({ where: { userId: u.user.id, summarizedAt: null } })).toBe(0);
  });

  it("Daily: copies of one applications reminder are one line, the newest; all are marked emailed", async () => {
    resend(() => true);
    const u = await makeUser({ dev: true });
    await db.user.update({ where: { id: u.user.id }, data: { emailPref: "daily" } });
    const now = new Date();
    const key = `applications:${randomUUID()}`;
    for (const [i, h] of [[1, 30], [2, 20], [3, 2]] as const) await copy(u.user.id, `“Harbor Run”: 2 applications wait for your answer (copy ${i})`, key, new Date(now.getTime() - h * H));
    await sendSummaries(now, [u.user.id]);
    const [mail] = await sent(u.user.id);
    expect(count(mail.text, "applications wait for your answer")).toBe(1);
    expect(mail.text).toContain("(copy 3)");
    expect(mail.subject).toBe("Your Playtest summary: 1 update");
    expect(await db.notification.count({ where: { userId: u.user.id, reminderKey: key, summarizedAt: null } })).toBe(0);
    expect(await db.notification.count({ where: { userId: u.user.id, reminderKey: key } })).toBe(3); // the bell keeps every copy
  });

  it("Daily: a reminder key not on the list (chargeday) still lists every copy", async () => {
    resend(() => true);
    const u = await daily();
    const now = new Date();
    const key = `chargeday:${randomUUID()}`;
    await copy(u.user.id, "Charge day is near (copy one)", key, new Date(now.getTime() - 3 * H));
    await copy(u.user.id, "Charge day is near (copy two)", key, new Date(now.getTime() - H));
    await sendSummaries(now, [u.user.id]);
    const [mail] = await sent(u.user.id);
    expect(count(mail.text, "Charge day is near")).toBe(2);
    expect(mail.subject).toBe("Your Playtest summary: 2 updates");
  });

  it("a short email (Off) applies the rule too if such copies ever ride in it", async () => {
    resend(() => true);
    const u = await makeUser({ tester: true });
    await db.user.update({ where: { id: u.user.id }, data: { emailPref: "off" } });
    const now = new Date();
    const key = `invite:${randomUUID()}`;
    for (const [i, h] of [[1, 3], [2, 1]] as const) await db.notification.create({ data: { userId: u.user.id, text: `Reminder: must-send invite (copy ${i})`, link: "/app", reminderKey: key, mustEmail: true, createdAt: new Date(now.getTime() - h * H) } });
    await sendSummaries(now, [u.user.id]);
    const [mail] = await sent(u.user.id);
    expect(mail.kind).toBe("morning-short");
    expect(count(mail.text, "must-send invite")).toBe(1);
    expect(mail.text).toContain("(copy 2)");
    expect(mail.subject).toBe("Your Playtest account updates: 1");
    expect(await db.notification.count({ where: { userId: u.user.id, summarizedAt: null } })).toBe(0);
  });
});
