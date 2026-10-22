import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as blocksPOST } from "@/app/api/blocks/route";
import { invitable } from "@/lib/server/invites";
import { makeUser, req } from "./helpers";
import { act, joined, seen, setup } from "./fixtures";

const later = () => new Promise((r) => setTimeout(r, 5));

describe("invite list: greyed vs removed", () => {
  it("greys in-test, invited, suspended and 10-test testers; removes blocked and non-testers", async () => {
    const { dev, testId } = await setup();
    const inTest = await joined(testId, "Ana Silva");
    const invited = await makeUser({ tester: true, name: "Ben Carter" });
    const suspended = await makeUser({ tester: true, name: "Cara Diaz" });
    const blocked = await makeUser({ tester: true, name: "Dee Moss" });
    const gone = await makeUser({ tester: true, name: "Eve Ray" });
    await act(testId, "invite", dev.cookie, { seenAt: seen(), testerIds: [invited.user.id] });
    await db.user.update({ where: { id: suspended.user.id }, data: { suspendedAt: new Date() } });
    await blocksPOST(req("/api/blocks", { cookie: blocked.cookie, body: { userId: dev.user.id } }));
    await db.user.update({ where: { id: gone.user.id }, data: { isTester: false } });
    const list = await invitable(dev.user.id, testId);
    const of = (id: string) => list.find((x) => x.id === id);
    expect(of(inTest.tester.user.id)?.grey).toBe("Already in this test");
    expect(of(invited.user.id)?.grey).toMatch(/^Invited /);
    expect(of(invited.user.id)?.inviteId).toBeTruthy();
    expect(of(suspended.user.id)?.grey).toBe("Can't be invited right now");
    expect(of(blocked.user.id)).toBeUndefined();
    expect(of(gone.user.id)).toBeUndefined();
  });

  it("Invite stops once when a ticked tester became greyed or removed since the page loaded", async () => {
    const { dev, testId } = await setup();
    const ben = await makeUser({ tester: true, name: "Ben Carter" });
    const pageLoaded = seen();
    await later();
    await db.user.update({ where: { id: ben.user.id }, data: { suspendedAt: new Date() } });
    const r = await act(testId, "invite", dev.cookie, { seenAt: pageLoaded, testerIds: [ben.user.id] });
    expect(r.body.error.changes.map((c: { text: string }) => c.text)).toContain("Ben Carter can't be invited right now");
    const r2 = await act(testId, "invite", dev.cookie, { seenAt: pageLoaded, testerIds: [ben.user.id], confirmed: true });
    expect(r2.body.message).toBe("Ben Carter can't be invited right now.");
  });

  it("sections: worked-with and suggested; a missing need asks in place (Invite anyway)", async () => {
    const { dev, testId } = await setup({ languages: ["English"] });
    const past = await joined(testId, "Ana Silva");
    const fits = await makeUser({ tester: true, name: "Ben Carter" });
    const spanish = await makeUser({ tester: true, name: "Cara Diaz" });
    await db.testerProfile.update({ where: { userId: spanish.user.id }, data: { languages: ["Spanish"] } });
    const list = await invitable(dev.user.id, testId);
    expect(list.find((x) => x.id === past.tester.user.id)?.section).toBe("worked");
    expect(list.find((x) => x.id === fits.user.id)?.section).toBe("suggested");
    expect(list.find((x) => x.id === spanish.user.id)?.gap).toBe("English");
    const first = await act(testId, "invite", dev.cookie, { seenAt: seen(), testerIds: [spanish.user.id] });
    expect(first.body.error.code).toBe("needs_confirm");
    expect(first.body.error.lines).toEqual(["Cara Diaz doesn't list English, which this test needs."]);
    const ok = await act(testId, "invite", dev.cookie, { seenAt: seen(), testerIds: [spanish.user.id], anyway: true, seenGaps: first.body.error.lines });
    expect(ok.body.message).toBe("Invited Cara Diaz.");
  });
});
