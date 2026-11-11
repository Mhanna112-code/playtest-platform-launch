import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as sessionPOST } from "@/app/api/sessions/[id]/[action]/route";
import { api, newPageLoad, pageLoad } from "@/lib/client";
import { clearShown, notePageLoaded, setShownOnPage } from "@/lib/live";
import { json, makeUser, req } from "./helpers";
import { act, addTo, atHours, joined, sact, seen, settle, setup } from "./fixtures";

const pay = (cookie: string, id: string) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), kind: "submission", id, amount: "10.00", tickedCents: 1000, confirmed: true } })).then(json);
const texts = (r: { body: { error?: { changes?: { text: string }[] } } }) => (r.body.error?.changes ?? []).map((e) => e.text);
async function ready(paid = true) {
  const s = await setup();
  const j = await joined(s.testId, "Ana Silva", "they");
  expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"], tab: "rate-tab" })).status).toBe(200);
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  if (paid) expect((await pay(s.dev.cookie, sub.id)).status).toBe(200);
  await settle();
  return { ...s, ...j, sub };
}
const rate = (x: Awaited<ReturnType<typeof ready>>, loaded: string, extra: Record<string, unknown> = {}) => sessionPOST(req(`/api/sessions/${x.sessionId}/rate`, { cookie: x.tester.cookie, headers: { "x-tab": "rate-tab", "x-load": "rate-load" }, body: { stars: 5, seenAt: loaded, pageSeenAt: loaded, loadedAt: loaded, ...extra } }), { params: Promise.resolve({ id: x.sessionId, action: "rate" }) }).then(json);
async function edit(x: Awaited<ReturnType<typeof ready>>, fields: Record<string, unknown>) {
  const t = await db.test.findUniqueOrThrow({ where: { id: x.testId } });
  const r = await act(x.testId, "edit", x.dev.cookie, { version: t.version, fields, confirmed: true });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("batch 35 §93: tester Rate uses every shared tester stop", () => {
  // (Owner, Nov 5, §268; was "even with Alerts Off") New terms follow the ordinary rule for Rate: Alerts on and not yet shown.
  it("new terms stop once (Alerts on) and the second press rates without another stop box; with Alerts Off they never stop Rate", async () => {
    const x = await ready(); const loaded = seen(); await settle();
    await edit(x, { writtenCents: "12.00" });
    const first = await rate(x, loaded);
    expect(first.body.error?.code).toBe("stop_once");
    expect(texts(first)).toContain("Nora Lane offered you new terms: Switch or Keep them");
    expect(await db.rating.count({ where: { contractId: x.sessionId } })).toBe(0);
    expect((await rate(x, loaded, { confirmed: true, boxAt: first.body.error.now })).status).toBe(200);
    expect(await db.rating.count({ where: { contractId: x.sessionId, side: "tester" } })).toBe(1);
    const y = await ready(); const loadedY = seen(); await settle();
    await db.user.update({ where: { id: y.tester.user.id }, data: { testerAlertsOff: true } });
    await edit(y, { writtenCents: "12.00" });
    expect((await rate(y, loadedY)).status).toBe(200);
  });

  it.each([false, true])("listing edits follow Alerts Off = %s", async (off) => {
    const x = await ready();
    await db.user.update({ where: { id: x.tester.user.id }, data: { testerAlertsOff: off } });
    const loaded = seen(); await settle(); await edit(x, { description: "Sail through the new course" });
    const first = await rate(x, loaded);
    if (off) expect(first.status, JSON.stringify(first.body)).toBe(200);
    else {
      expect(first.body.error?.code).toBe("stop_once");
      expect(texts(first)).toEqual(["Nora Lane edited the listing"]);
      expect((await rate(x, loaded, { confirmed: true, boxAt: first.body.error.now })).status).toBe(200);
    }
  });

  it("Send in another tab stops Rate even with Alerts Off", async () => {
    const x = await ready();
    await db.user.update({ where: { id: x.tester.user.id }, data: { testerAlertsOff: true } });
    const loaded = seen(); await settle();
    const sent = await addTo(x.sessionId, x.tester.cookie, { text: "updated answer", confirmed: true, tab: "another-tab", load: "another-load" }); // (batch 35 §136) an addition
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    const first = await rate(x, loaded);
    expect(first.body.error?.code).toBe("stop_once");
    expect(texts(first)).toEqual([expect.stringMatching(/^You added to your answer to “.+” in another tab$/)]); // (§167) it names the question
    expect(first.body.error.alertsOff).toBe(true);
    expect((await rate(x, loaded, { confirmed: true, boxAt: first.body.error.now })).status).toBe(200);
  });

  it("Pay on their work still stops once, and a payment already shown does not stop", async () => {
    const x = await ready(false); const loaded = seen(); await settle();
    expect((await pay(x.dev.cookie, x.sub.id)).status).toBe(200);
    const first = await rate(x, loaded);
    expect(first.body.error?.code).toBe("stop_once");
    expect(texts(first)).toEqual(["Nora Lane paid $10.00 for your written answers"]);
    await settle();
    expect((await rate(x, loaded, { seenAt: seen() })).status).toBe(200);
  });

  it("Pay follows Alerts Off, like every other tester press", async () => {
    const x = await ready(false); const loaded = seen(); await settle();
    await db.user.update({ where: { id: x.tester.user.id }, data: { testerAlertsOff: true } });
    expect((await pay(x.dev.cookie, x.sub.id)).status).toBe(200);
    expect((await rate(x, loaded)).status).toBe(200);
  });

  // (Owner, Nov 11, §386 E) A pause still on refuses the tester's Rate ("This test is paused …"): the "pause" case lifts it again before rating.
  it.each(["terms", "listing", "call", "stop", "pause", "own"])("§90: already shown %s never stops despite older load/render markers", async (kind) => {
    const x = await ready(); const loaded = seen(); await settle();
    if (kind === "terms") await edit(x, { writtenCents: "12.00" });
    if (kind === "listing") await edit(x, { description: "Updated sailing course" });
    if (kind === "call") expect((await act(x.testId, "request-time", x.dev.cookie, { confirmed: true, contractIds: [x.sessionId], startsAt: atHours(48), minutes: 30 })).status).toBe(200);
    if (kind === "stop") expect((await act(x.testId, "stop", x.dev.cookie, { confirmed: true, reason: "We have all the feedback" })).status).toBe(200);
    if (kind === "own") expect((await addTo(x.sessionId, x.tester.cookie, { text: "updated answer", confirmed: true, tab: "another-tab" })).status).toBe(200);
    if (kind === "pause") {
      const a = await makeUser();
      await (await import("@/lib/server/restrictions")).pauseTest(a.user.id, x.testId, "Checking the test");
      expect((await rate(x, loaded, { seenAt: seen(), boxSeenAt: loaded })).body.error.message).toBe("This test is paused, so your Rate didn't go through."); // (§386 E)
      await (await import("@/lib/server/restrictions")).unpauseTest(x.testId);
    }
    await settle();
    const r = await rate(x, loaded, { seenAt: seen(), boxSeenAt: loaded });
    // (Owner, Nov 5, §268; replaces §232) An open offer already shown never stops Rate: it goes through like the rest.
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });

  // (Codex c220ae22, docs/STOP-ONCE-NOTICES.md: the tester's Charge, Let it go and Rate skip the work-ending retry): the stop moment is no longer in the box.
  it("one box merges terms, listing and pay (not the stop moment); boxAt clears all of them together", async () => {
    const x = await ready(false); const loaded = seen(); await settle();
    await edit(x, { writtenCents: "12.00", description: "A new sailing route" });
    await settle(); expect((await pay(x.dev.cookie, x.sub.id)).status).toBe(200);
    await settle(); expect((await act(x.testId, "stop", x.dev.cookie, { confirmed: true, reason: "We have the feedback" })).status).toBe(200);
    const first = await rate(x, loaded);
    expect(first.body.error?.code).toBe("stop_once");
    const lines = first.body.error.changes as { text: string; at: string; kind?: string }[];
    expect(texts(first)).toContain("Nora Lane edited the listing");
    expect(texts(first)).toContain("Nora Lane paid $10.00 for your written answers");
    expect(texts(first)).not.toContainEqual(expect.stringMatching(/^Nora Lane stopped this test/));
    expect(lines.filter((e) => e.kind === "stop")).toHaveLength(0);
    expect(lines.map((e) => new Date(e.at).getTime())).toEqual(lines.map((e) => new Date(e.at).getTime()).sort((a, b) => a - b));
    expect((await rate(x, loaded, { confirmed: true, boxAt: first.body.error.now })).status).toBe(200);
  });

  it("a change after boxAt stops again, listing only the newer change", async () => {
    const x = await ready(); const loaded = seen(); await settle(); await edit(x, { description: "First new course" });
    const first = await rate(x, loaded); expect(first.body.error?.code).toBe("stop_once");
    await settle(); await edit(x, { writtenCents: "12.00" });
    const second = await rate(x, loaded, { confirmed: true, boxAt: first.body.error.now });
    expect(second.body.error?.code).toBe("stop_once");
    expect(texts(second)).toContain("Nora Lane offered you new terms: Switch or Keep them");
    expect((await rate(x, loaded, { confirmed: true, boxAt: second.body.error.now })).status).toBe(200);
  });

  it("an unseen pause and an ignored listing edit do not stop tester Rate", async () => {
    const x = await ready(); const loaded = seen(); await settle();
    await edit(x, { description: "Different course" });
    await db.user.update({ where: { id: x.tester.user.id }, data: { testerAlertsOff: true } });
    const a = await makeUser();
    const { pauseTest } = await import("@/lib/server/restrictions");
    await pauseTest(a.user.id, x.testId, "Checking the test");
    // (§386 E) The pause itself refuses Rate while it lasts; after the lift, neither the unseen pause nor the ignored edit stops it.
    expect((await rate(x, loaded)).body.error.message).toBe("This test is paused, so your Rate didn't go through.");
    await (await import("@/lib/server/restrictions")).unpauseTest(x.testId);
    const first = await rate(x, loaded);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
  });

  it("close-out keeps the existing Rating closed refusal before the stop gate", async () => {
    const x = await ready(); const loaded = seen();
    const past = new Date(Date.now() - 30 * 86400000);
    await db.test.update({ where: { id: x.testId }, data: { openUntil: past } });
    await db.contract.update({ where: { id: x.sessionId }, data: { dueAt: past } });
    const r = await rate(x, loaded);
    expect(r.body.error?.code).toBe("not_yet");
    expect(r.body.error.message).toMatch(/^Rating closed on .+\.$/);
    expect(r.body.error.changes).toBeUndefined();
  });

  it("Rate's existing usePress/api path sends the shared gate's markers and x-load", async () => {
    const scope = "/app/sessions/rate-client-test";
    const loaded = "2026-10-30T01:00:00.000Z", shown = "2026-10-30T02:00:00.000Z", boxAt = "2026-10-30T03:00:00.000Z";
    vi.stubGlobal("window", Object.assign(new EventTarget(), { location: { pathname: scope } }));
    notePageLoaded(loaded); newPageLoad(); setShownOnPage(scope, shown);
    const fetcher = vi.fn(async () => Response.json({ rated: true })); vi.stubGlobal("fetch", fetcher);
    await api("/api/sessions/rate-client-test/rate", { stars: 5, seenAt: loaded, confirmed: true, boxAt });
    const init = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init[1].body))).toMatchObject({ seenAt: shown, pageSeenAt: loaded, loadedAt: loaded, boxSeenAt: shown, boxAt, confirmed: true });
    expect(init[1].headers).toMatchObject({ "x-load": pageLoad() }); expect(pageLoad()).not.toBe("");
    const source = fs.readFileSync(path.resolve("src/components/RateBox.tsx"), "utf8");
    expect(source).toContain("usePress(p.seenAt"); expect(source).toContain("await press(p.path");
    clearShown(scope);
  });
});
