import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { makeUser } from "./helpers";
import { joined, act, sact, setup } from "./fixtures";

// (Owner, NEXT-UI 12) The second press goes ahead only if nothing new happened since the box last updated; otherwise it
// stops again with just the new lines. The tester's Leave and Block still stop once.
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("stop again when something new happened since the box", () => {
  it("developer: a second press with the box's time goes ahead; something newer stops it again with only that line", async () => {
    const { dev, testId } = await setup({ spots: 5 });
    const seenAt = new Date(Date.now() - 1000).toISOString();
    const a = await joined(testId, "Ana Silva");
    const first = await act(testId, "next-round", dev.cookie, { seenAt, closeThis: false });
    expect(first.status).toBe(409);
    expect(first.body.error.code).toBe("stop_once");
    const boxAt = first.body.error.now as string;
    expect(typeof boxAt).toBe("string");
    // Something new after the box: the second press stops again, listing only the new line.
    await wait(20);
    await joined(testId, "Ben Ito");
    const second = await act(testId, "next-round", dev.cookie, { seenAt, confirmed: true, boxAt, closeThis: false });
    expect(second.status).toBe(409);
    const lines = (second.body.error.changes as { text: string }[]).map((c) => c.text);
    expect(lines.some((l) => l.includes("Ben Ito"))).toBe(true);
    expect(lines.some((l) => l.includes("Ana Silva"))).toBe(false);
    // Nothing new since that box: the next press goes ahead.
    const third = await act(testId, "next-round", dev.cookie, { seenAt, confirmed: true, boxAt: second.body.error.now, closeThis: false });
    expect(third.status).toBe(200);
    expect(a).toBeTruthy();
  });

  it("12b: Invite anyway names the box's time; something newer than the box stops it again (also the 'what's missing changed' stop carries its time)", async () => {
    const { dev, testId } = await setup({ languages: ["English"], spots: 5 });
    const cara = await makeUser({ tester: true, name: "Cara Diaz" });
    await db.testerProfile.update({ where: { userId: cara.user.id }, data: { languages: ["Spanish"] } });
    await wait(20);
    const seenAt = new Date().toISOString();
    const box = await act(testId, "invite", dev.cookie, { seenAt, testerIds: [cara.user.id] });
    expect(box.body.error.code).toBe("needs_confirm");
    expect(typeof box.body.error.now).toBe("string");
    await wait(20);
    await joined(testId, "Ben Ito"); // newer than the box
    const stopped = await act(testId, "invite", dev.cookie, { seenAt, testerIds: [cara.user.id], anyway: true, seenGaps: box.body.error.lines, confirmed: true, boxAt: box.body.error.now });
    expect(stopped.body.error.code).toBe("stop_once");
    const lines = (stopped.body.error.changes as { text: string }[]).map((c) => c.text);
    expect(lines.some((l) => l.includes("Ben Ito"))).toBe(true);
    const ok = await act(testId, "invite", dev.cookie, { seenAt, testerIds: [cara.user.id], anyway: true, seenGaps: box.body.error.lines, confirmed: true, boxAt: stopped.body.error.now });
    expect(ok.status).toBe(200);
  });

  it("12b: the call-request limit box: a second press goes ahead only if who is blocked / at the limit is as the box said", async () => {
    const { dev, testId } = await setup({ spots: 5 });
    const a = await joined(testId, "Ana Silva");
    const b = await joined(testId, "Ben Ito");
    const start = (h: number) => { const d = new Date(Date.now() + h * 3_600_000); d.setSeconds(0, 0); return d.toISOString(); };
    for (const h of [100, 130, 160]) await db.callRequest.create({ data: { testId, contractId: a.sessionId, fromSide: "developer", startsAt: new Date(start(h)), times: [new Date(start(h))], weeks: 0, repeat: "", minutes: 30 } });
    await wait(20);
    const seenAt = new Date().toISOString();
    const body = { seenAt, contractIds: [a.sessionId, b.sessionId], startsAt: start(300) };
    const first = await act(testId, "request-time", dev.cookie, body);
    expect(first.body.error.code).toBe("stop_once");
    const text = first.body.error.limitSeen as string;
    expect(text).toContain("Ana Silva");
    // Who is at the limit changed (Ben now too): the second press stops again with the new line.
    for (const h of [190, 220, 250]) await db.callRequest.create({ data: { testId, contractId: b.sessionId, fromSide: "developer", startsAt: new Date(start(h)), times: [new Date(start(h))], weeks: 0, repeat: "", minutes: 30 } });
    const second = await act(testId, "request-time", dev.cookie, { ...body, confirmed: true, boxAt: first.body.error.now, limitSeen: text });
    expect(second.status).toBe(409);
  });

  it("the tester's Leave still stops just once (no box time sent)", async () => {
    const { testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    expect((await sact(sessionId, "leave", tester.cookie, { seenAt: new Date(Date.now() - 1000).toISOString(), confirmed: true })).status).toBe(200);
  });
});
