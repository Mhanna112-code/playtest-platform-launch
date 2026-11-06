import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { sendSummaries, summaryHeading } from "@/lib/server/notify";
import { makeUser } from "./helpers";

// (Owner, Nov 6, §297) The summary heading's range (§295) starts the day AFTER the last summary was sent: "Nov 1 – Nov 7", not "Oct 31 – Nov 7"; monthly "for
// October" when that's the window; daily keeps the day. With no earlier summary it starts at the oldest line's day, as before.
const at = (s: string) => new Date(s);
const DAY = 86_400_000;
const mails = (to: string) => db.outboxEmail.findMany({ where: { to }, orderBy: { createdAt: "asc" } });

describe("§297 the summary heading starts the day after the last summary", () => {
  it("weekly, monthly and daily headings after a last summary", () => {
    expect(summaryHeading("weekly", at("2026-10-31T09:00:00Z"), at("2026-11-07T09:00:00Z"), "UTC", true)).toBe("Your Playtest updates for Nov 1 – Nov 7");
    // The day after, in the account's zone: 2 AM UTC on Nov 1 is still Oct 31 in New York, so the range starts Nov 1.
    expect(summaryHeading("weekly", at("2026-11-01T02:00:00Z"), at("2026-11-07T15:00:00Z"), "America/New_York", true)).toBe("Your Playtest updates for Nov 1 – Nov 7");
    expect(summaryHeading("weekly", at("2026-12-27T09:00:00Z"), at("2027-01-03T09:00:00Z"), "UTC", true)).toBe("Your Playtest updates for Dec 28, 2026 – Jan 3, 2027");
    expect(summaryHeading("weekly", at("2026-12-31T09:00:00Z"), at("2027-01-07T09:00:00Z"), "UTC", true)).toBe("Your Playtest updates for Jan 1 – Jan 7");
    // Monthly: last sent Sep 30, the window is October.
    expect(summaryHeading("monthly", at("2026-09-30T09:00:00Z"), at("2026-10-31T09:00:00Z"), "UTC", true)).toBe("Your Playtest updates for October");
    expect(summaryHeading("monthly", at("2026-09-30T09:00:00Z"), at("2026-11-01T09:00:00Z"), "UTC", true)).toBe("Your Playtest updates for October");
    expect(summaryHeading("monthly", at("2026-11-30T09:00:00Z"), at("2027-01-01T09:00:00Z"), "UTC", true)).toBe("Your Playtest updates for December");
    // Last sent Oct 1: the window starts Oct 2, not a whole month.
    expect(summaryHeading("monthly", at("2026-10-01T09:00:00Z"), at("2026-11-01T09:00:00Z"), "UTC", true)).toBe("Your Playtest updates for Oct 2 – Nov 1");
    // Daily keeps the day.
    expect(summaryHeading("daily", at("2026-11-05T09:00:00Z"), at("2026-11-06T09:00:00Z"), "UTC", true)).toBe("Your Playtest updates for Fri, Nov 6");
    // No earlier summary: from the oldest line's day, as before.
    expect(summaryHeading("weekly", at("2026-10-31T09:00:00Z"), at("2026-11-07T09:00:00Z"), "UTC")).toBe("Your Playtest updates for Oct 31 – Nov 7");
  });

  it("the sent weekly email: from the day after its last summary; a first summary from its oldest line", async () => {
    const now = at("2026-11-07T15:00:00Z");
    const ana = await makeUser({ tester: true, name: "Ana Silva" });
    await db.user.update({ where: { id: ana.user.id }, data: { emailPref: "weekly", timeZone: "UTC", lastSummaryAt: new Date(now.getTime() - 7 * DAY) } });
    await db.notification.create({ data: { userId: ana.user.id, text: "A line", link: "/app", createdAt: at("2026-11-03T10:00:00Z") } });
    await sendSummaries(now, [ana.user.id]);
    expect((await mails(ana.user.email)).at(-1)!.text.split("\n")[0]).toBe("Your Playtest updates for Nov 1 – Nov 7");

    const bo = await makeUser({ tester: true, name: "Bo Reyes" });
    await db.user.update({ where: { id: bo.user.id }, data: { emailPref: "weekly", timeZone: "UTC", lastSummaryAt: null } });
    await db.notification.create({ data: { userId: bo.user.id, text: "A line", link: "/app", createdAt: at("2026-11-03T10:00:00Z") } });
    await sendSummaries(now, [bo.user.id]);
    expect((await mails(bo.user.email)).at(-1)!.text.split("\n")[0]).toBe("Your Playtest updates for Nov 3 – Nov 7");
  });
});
