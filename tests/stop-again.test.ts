import { describe, expect, it } from "vitest";
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

  it("the tester's Leave still stops just once (no box time sent)", async () => {
    const { testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    expect((await sact(sessionId, "leave", tester.cookie, { seenAt: new Date(Date.now() - 1000).toISOString(), confirmed: true })).status).toBe(200);
  });
});
