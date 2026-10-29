import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { GET as pulseGET } from "@/app/api/pulse/route";
import { POST as blocksPOST } from "@/app/api/blocks/route";
import { POST as joinPOST } from "@/app/api/calls/[id]/join/route";
import { KEEP_MS, currentKept, dropKept, keepRefusal, keptRefusalLine, keptShows, notePress, resetKept } from "@/lib/keptRefusal";
import { json, req } from "./helpers";
import { bookCall, joined, setup } from "./fixtures";

const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");

describe("batch 29 §36: a refused press's line survives the redraw that takes its button away", () => {
  beforeEach(() => resetKept());

  it("the line names the press, then the server's reason (a sentence's first word lowercased, names kept)", () => {
    expect(keptRefusalLine("Join call", "This call isn't available.")).toBe("Your Join call didn't go through: this call isn't available.");
    expect(keptRefusalLine("Pay", "You already paid for this piece.")).toBe("Your Pay didn't go through: you already paid for this piece.");
    expect(keptRefusalLine("Charge", "Nora Lane already paid for this work.")).toBe("Your Charge didn't go through: Nora Lane already paid for this work.");
    // Already naming the press, or no label: as the server wrote it.
    expect(keptRefusalLine("Send", "Your Send didn't go through: the test was stopped.")).toBe("Your Send didn't go through: the test was stopped.");
    expect(keptRefusalLine("press", "This request is closed.")).toBe("This request is closed.");
  });

  it("kept where the pressed button was; shown only once the button is gone; gone after about 10 seconds", () => {
    const spot = { top: 400, left: 120, width: 260 };
    notePress(null, spot, 1_000);
    const k = keepRefusal("Join call", "This call isn't available.", 2_000)!;
    expect(k).toMatchObject({ text: "Your Join call didn't go through: this call isn't available.", message: "This call isn't available.", spot, at: 2_000 });
    expect(keptShows(k, 2_100, true)).toBe(false); // before the redraw: the button (and its own line) still there
    expect(keptShows(k, 2_300, false)).toBe(true); // the redraw took the button away
    expect(keptShows(k, 2_000 + KEEP_MS - 1, false)).toBe(true);
    expect(keptShows(k, 2_000 + KEEP_MS, false)).toBe(false);
    expect(KEEP_MS).toBe(10_000);
  });

  it("the next press anywhere on the page clears it; an old timer never clears a newer line", () => {
    notePress(null, { top: 10, left: 10, width: 260 });
    const a = keepRefusal("Pay", "You already paid for this piece.")!;
    expect(currentKept()?.id).toBe(a.id);
    notePress(null, { top: 50, left: 10, width: 260 }); // another press
    expect(currentKept()).toBeNull();
    const b = keepRefusal("Withdraw", "This request is closed.")!;
    dropKept(a.id);
    expect(currentKept()?.id).toBe(b.id);
    dropKept(b.id);
    expect(currentKept()).toBeNull();
    expect(keepRefusal("Pay", "  ")).toBeNull();
  });

  it("wired in: every refused press (409, not a stop box) keeps its line before the redraw; the root layout holds it outside the page", () => {
    const client = src("lib/client.ts");
    expect(client).toContain("keepRefusal(LAST_PRESS, e.message);");
    expect(client.indexOf("keepRefusal(LAST_PRESS, e.message);")).toBeLessThan(client.indexOf("window.dispatchEvent(new Event(PRESS_REFUSED_EVENT))"));
    expect(src("app/layout.tsx")).toContain("<KeptRefusal />");
    const comp = src("components/KeptRefusal.tsx");
    expect(comp).toContain("createPortal(");
    expect(comp).toContain('document.addEventListener("click", onPress, true);');
    expect(comp).toContain("data-kept-refusal");
  });
});

describe("batch 29 §36 (batch 28 §9's unchecked part): a block drops the session page's call controls on its normal poll", () => {
  const pulse = async (q: string, cookie: string) => (await json(await pulseGET(req(`/api/pulse?${q}`, { cookie, method: "GET" })))).body.v as string;

  it("the developer blocks the tester: the session page's poll changes (the page redraws without Join call, Request a time or requests); a stale Join is refused", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    const call = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie, 48);
    const before = await pulse(`session=${j.sessionId}`, j.tester.cookie);
    const testBefore = await pulse(`test=${s.testId}`, s.dev.cookie);
    expect(await pulse(`session=${j.sessionId}`, j.tester.cookie)).toBe(before); // steady while nothing changes
    expect((await json(await blocksPOST(req("/api/blocks", { cookie: s.dev.cookie, body: { userId: j.tester.user.id } })))).status).toBe(200);
    // No pending requests and no test event: before, nothing in the fingerprint changed, so the page kept its call controls until a reload.
    expect(await pulse(`session=${j.sessionId}`, j.tester.cookie)).not.toBe(before);
    expect(await pulse(`test=${s.testId}`, s.dev.cookie)).not.toBe(testBefore);
    // The redraw's state: the session ended and its call cancelled (the page shows no Join call / Request a time for it).
    expect(await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } })).toMatchObject({ status: "ended", endKind: "blocked" });
    expect((await db.call.findUniqueOrThrow({ where: { id: call.id } })).status).toBe("cancelled");
    // A Join pressed on the page from before is refused (409: the page redraws, and the refusal line is kept where Join was).
    const r = await json(await joinPOST(req(`/api/calls/${call.id}/join`, { cookie: j.tester.cookie, body: {} }), { params: Promise.resolve({ id: call.id }) }));
    expect(r.status).toBe(409);
    expect(keptRefusalLine("Join call", r.body.error.message)).toMatch(/^Your Join call didn't go through: /);
  });

  it("the tester blocks the developer with no session working: the block alone changes the session page's poll", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    await db.contract.update({ where: { id: j.sessionId }, data: { status: "ended", endKind: "early", endedAt: new Date() } });
    const before = await pulse(`session=${j.sessionId}`, j.tester.cookie);
    expect((await json(await blocksPOST(req("/api/blocks", { cookie: j.tester.cookie, body: { userId: s.dev.user.id } })))).status).toBe(200);
    expect(await pulse(`session=${j.sessionId}`, j.tester.cookie)).not.toBe(before);
  });
});
