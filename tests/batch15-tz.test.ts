import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as tzPOST } from "@/app/api/account/timezone/route";
import { T, fmtFor, fmtIn, hasTimeTokens, renderTimes } from "@/lib/tz";
import { bell, notify } from "@/lib/server/notify";
import { recordOutage } from "@/lib/server/outages";
import { cancelLine } from "@/lib/rules";
import { json, makeUser, req } from "./helpers";
import { act, bookCall, joined, seen, setup } from "./fixtures";

// Batch 15 section 11: every time in a bell line or email is written in the RECIPIENT's own time zone and names it.
const AT = new Date("2026-11-05T19:00:00Z"); // 2:00 PM in New York, 8:00 PM in Berlin

describe("time zones (section 11)", () => {
  it("fmtFor names the zone; unknown is UTC", () => {
    expect(fmtFor({ timeZone: "America/New_York" }, AT, "time")).toBe("2:00 PM EST");
    expect(fmtFor({ timeZone: "Europe/Berlin" }, AT, "time")).toMatch(/^8:00 PM GMT\+1$/);
    expect(fmtFor({ timeZone: "" }, AT, "time")).toBe("7:00 PM UTC");
    expect(fmtFor({ timeZone: "Not/AZone" }, AT, "datetime")).toBe("Thu, Nov 5, 7:00 PM UTC");
    expect(fmtIn("America/New_York", AT, "dayTime")).toBe("Thu, Nov 5 at 2:00 PM EST");
    expect(fmtIn("America/New_York", AT, "date")).toBe("Nov 5");
  });

  it("one line, two readers: each reads their own zone (bell and the email it goes in)", async () => {
    const ny = await makeUser({ name: "Nora" });
    const be = await makeUser({ name: "Ben" });
    await db.user.update({ where: { id: ny.user.id }, data: { timeZone: "America/New_York" } });
    await db.user.update({ where: { id: be.user.id }, data: { timeZone: "Europe/Berlin" } });
    const line = cancelLine("Ana", AT, "");
    expect(hasTimeTokens(line)).toBe(true);
    await notify(ny.user.email, line, [line], "/app");
    await bell(be.user.id, line, "/app");
    const a = await db.notification.findFirstOrThrow({ where: { userId: ny.user.id } });
    const b = await db.notification.findFirstOrThrow({ where: { userId: be.user.id } });
    expect(a.text).toBe("Ana cancelled the call on Thu, Nov 5 at 2:00 PM EST.");
    expect(b.text).toMatch(/^Ana cancelled the call on Thu, Nov 5 at 8:00 PM GMT\+1\.$/);
    expect(renderTimes(`x ${T(AT, "time")} y`, "America/New_York")).toBe("x 2:00 PM EST y");
  });

  it("an outage's bell line is written in each person's zone", async () => {
    await db.outage.deleteMany({});
    const { dev, testId } = await setup();
    const { tester } = await joined(testId);
    await db.user.update({ where: { id: dev.user.id }, data: { timeZone: "America/New_York" } });
    await db.user.update({ where: { id: tester.user.id }, data: { timeZone: "Europe/Berlin" } });
    const start = new Date(Date.now() - 2 * 3_600_000);
    await recordOutage(start, new Date(start.getTime() + 20 * 60_000));
    const d = await db.notification.findFirstOrThrow({ where: { userId: dev.user.id, text: { startsWith: "The site was down" } } });
    const t = await db.notification.findFirstOrThrow({ where: { userId: tester.user.id, text: { startsWith: "The site was down" } } });
    expect(d.text).toMatch(/E[SD]T/);
    expect(t.text).toMatch(/GMT\+[12]/);
    expect(hasTimeTokens(d.text) || hasTimeTokens(t.text)).toBe(false);
  });

  it("a developer in New York and a tester in Berlin: the same call in each one's bell", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await db.user.update({ where: { id: dev.user.id }, data: { timeZone: "America/New_York" } });
    await db.user.update({ where: { id: tester.user.id }, data: { timeZone: "Europe/Berlin" } });
    const call = await bookCall(testId, dev.cookie, sessionId, tester.cookie, 72);
    expect((await act(testId, "cancel-call", dev.cookie, { callId: call.id, seenAt: seen(), confirmed: true, reason: "" })).status).toBe(200);
    const line = (await db.notification.findFirstOrThrow({ where: { userId: tester.user.id, text: { startsWith: "Nora Lane cancelled the call" } } })).text;
    expect(line).toContain(fmtIn("Europe/Berlin", call.startsAt, "dayTime"));
  });

  it("the browser's zone is stored (sign-in, and the layout's one call when it differs)", async () => {
    const u = await makeUser();
    expect((await tzPOST(req("/api/account/timezone", { cookie: u.cookie, body: { timeZone: "Europe/Berlin" } })).then(json)).status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: u.user.id } })).timeZone).toBe("Europe/Berlin");
    expect((await tzPOST(req("/api/account/timezone", { cookie: u.cookie, body: { timeZone: "Mars/Olympus" } })).then(json)).status).toBe(400);
  });
});
