import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { SUMMARY_MAX, olderLine, sendSummaries } from "@/lib/server/notify";
import { makeUser } from "./helpers";

// (Owner, Nov 7, §328) A summary or end-of-day email takes the NEWEST 200 unsent lines; when more were waiting it ends with "And N older updates — see your bell"
// (linking to the bell page), and the older ones are marked emailed too (never a flood in the next emails).

describe("§328 the newest 200, then \"And N older updates\"", () => {
  it("205 waiting: the newest 200 in the email, the 5 oldest counted in its last line and marked emailed", async () => {
    const u = await makeUser({ dev: true });
    await db.user.update({ where: { id: u.user.id }, data: { emailPref: "daily", lastSummaryAt: new Date(Date.now() - 2 * 86_400_000) } });
    const t0 = Date.now() - 3_600_000;
    await db.notification.createMany({ data: Array.from({ length: SUMMARY_MAX + 5 }, (_, i) => ({ userId: u.user.id, text: `Line ${String(i).padStart(3, "0")}`, link: "", createdAt: new Date(t0 + i * 1000) })) });
    await sendSummaries(new Date(), [u.user.id]);
    const mails = await db.outboxEmail.findMany({ where: { to: u.user.email } });
    expect(mails).toHaveLength(1);
    const text = mails[0].text;
    expect(text).toContain("Line 204");
    expect(text).toContain("Line 005");
    expect(text).not.toContain("Line 004");
    expect(text).not.toContain("Line 000");
    expect(olderLine(5)).toBe("And 5 older updates — see your bell");
    expect(text.trimEnd().split("\n").at(-1)).toMatch(/^• And 5 older updates — see your bell \S+\/app\/notifications$/);
    expect(await db.notification.count({ where: { userId: u.user.id, summarizedAt: null } })).toBe(0);
    // The next summary has nothing left from them.
    await db.user.update({ where: { id: u.user.id }, data: { lastSummaryAt: new Date(Date.now() - 2 * 86_400_000) } });
    await sendSummaries(new Date(), [u.user.id]);
    expect(await db.outboxEmail.count({ where: { to: u.user.email } })).toBe(1);
  });

  it("200 or fewer: no extra line", async () => {
    const u = await makeUser({ dev: true });
    await db.user.update({ where: { id: u.user.id }, data: { emailPref: "daily", lastSummaryAt: new Date(Date.now() - 2 * 86_400_000) } });
    await db.notification.createMany({ data: Array.from({ length: 3 }, (_, i) => ({ userId: u.user.id, text: `Only ${i}`, link: "" })) });
    await sendSummaries(new Date(), [u.user.id]);
    const [m] = await db.outboxEmail.findMany({ where: { to: u.user.email } });
    expect(m.text).not.toContain("older update");
  });
});
