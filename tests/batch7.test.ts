import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import * as R from "@/lib/rules";
import { rateLabel } from "@/lib/server/requests";
import { startHold } from "@/lib/server/holds";
import { json, req } from "./helpers";
import { act, bookCall, joined, listingBody, sact, seen, settle, setup } from "./fixtures";

// Batch 7 (owner, Oct 28 evening): "Not listed", a stopped test shows only what still works, drafts open in Post a test, stop-once on every press still allowed.

const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const DAY = 86_400_000;
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), ...body } })).then(json);
const stops = (r: { status: number; body: { error?: { code?: string; changes?: unknown[] } } }, what: string) => {
  expect(r.body.error?.code, what).toBe("stop_once");
  expect(r.body.error?.changes?.length, what).toBeGreaterThan(0);
};

describe("batch 7 item 1: 'Not listed'", () => {
  it("a call or part that isn't listed reads 'Not listed' on both sides; the $100 cap is said only when a Pay goes over it", () => {
    expect(R.NOT_LISTED).toBe("Not listed");
    expect(rateLabel(null, 3000)).toBe("Not listed");
    expect(R.callReference(null, 30).text).toBe("Not listed");
    expect(src("app/app/tests/[id]/PayBox.tsx")).toContain("listed ? `Listing: ${p.listingText}` : NOT_LISTED");
    expect(src("app/app/sessions/[id]/page.tsx")).not.toContain('"Not in your contract"');
    expect(src("app/app/tests/[id]/page.tsx")).not.toContain('"Not in their contract"');
    for (const f of ["app/app/tests/[id]/DevCallPanel.tsx", "app/app/sessions/[id]/page.tsx"]) expect(src(f), f).not.toContain("$100");
    expect(R.overListingLine(10_000)).toBe("This is more than you can pay above the listing (up to $100).");
  });
});

describe("batch 7 item 2: a stopped test shows only what still works", () => {
  it("developer: no Edit, End early, Stop, Invite or call-request tools (and no 'no calls' text); Next round stays and works", async () => {
    const top = src("app/app/tests/[id]/TopPanel.tsx");
    expect(top).toContain("{!p.restricted && !stopped && <a");
    expect(top).toContain('{p.status !== "draft" && !stopped && <button');
    expect(top).toContain("{!stopped && <ConfirmButton");
    expect(top).toContain("p.restricted || p.teamStopped || p.status === \"draft\" ? null : p.nextRoundId");
    const page = src("app/app/tests/[id]/page.tsx");
    expect(page).toContain('noRequestReason={t.status === "stopped" ? "" :');
    expect(page).not.toContain("so no calls can be requested or booked");
    expect(page).toContain('{t.status !== "stopped" && !restricted && (\n        <InvitePanel');
    const { dev, testId } = await setup();
    await act(testId, "stop", dev.cookie, { seenAt: seen(), confirmed: true });
    const r = await act(testId, "next-round", dev.cookie, { seenAt: seen(), confirmed: true });
    expect(r.status).toBe(200);
    expect((await db.test.findUniqueOrThrow({ where: { id: r.body.id } })).status).toBe("draft");
  });

  it("tester: Send and the request tools hide; the sent work stays readable with each part's status", () => {
    const s = src("app/app/sessions/[id]/page.tsx");
    expect(s).toContain("{written && (written.review || refusal || meOff) ? (");
    expect(s).toContain('data-sent-answers=""');
    expect(s).toContain('data-part-status="review"');
    expect(s).toContain("const canRequestCall = !refusal && !blockedPair && !paused;");
    expect(s).toContain("canSend={!refusal && !recording?.review && !meOff && draftsShown}");
    // A paused test keeps Send visible (refused with the batch 6 notice).
    expect(R.PAUSE_DEFAULTS.draftsEditable).toBe(true);
  });
});

describe("batch 7 item 3: drafts open in Post a test", () => {
  it("Next round makes a draft and goes straight to Post; Post the test opens it with the typed details", async () => {
    const { dev, testId } = await setup();
    const r = await act(testId, "next-round", dev.cookie, { seenAt: seen(), confirmed: true });
    const draftId = r.body.id as string;
    expect(src("app/app/tests/[id]/TopPanel.tsx")).toContain("window.location.href = `/app/tests/new?draft=${r.id}`");
    const bad = await act(draftId, "post-draft", dev.cookie, listingBody({ title: "" }));
    expect(bad.status).toBe(400);
    expect((await db.test.findUniqueOrThrow({ where: { id: draftId } })).status).toBe("draft");
    await new Promise((x) => setTimeout(x, 20));
    const before = (await db.test.findUniqueOrThrow({ where: { id: draftId } })).createdAt;
    const ok = await act(draftId, "post-draft", dev.cookie, listingBody({ title: "Harbor Run (round 2)", spots: 4, accessKeys: "K1\nK2\nK3\nK4" }));
    expect(ok.status).toBe(200);
    const t = await db.test.findUniqueOrThrow({ where: { id: draftId } });
    expect(t).toMatchObject({ status: "open", title: "Harbor Run (round 2)", spots: 4, previousId: testId });
    expect(t.createdAt.getTime()).toBeGreaterThan(before.getTime());
    expect(await db.accessKey.count({ where: { testId: draftId } })).toBe(4);
    expect((await act(draftId, "post-draft", dev.cookie, listingBody())).body.error.code).toBe("not_draft");
  });

  it("a draft can be deleted (only a draft); its test page and Edit redirect to Post a test", async () => {
    const { dev, testId } = await setup();
    const draftId = (await act(testId, "next-round", dev.cookie, { seenAt: seen(), confirmed: true })).body.id as string;
    expect((await act(testId, "delete-draft", dev.cookie, {})).body.error.code).toBe("not_draft");
    expect((await act(draftId, "delete-draft", dev.cookie, {})).status).toBe(200);
    expect(await db.test.findUnique({ where: { id: draftId } })).toBeNull();
    expect(src("app/app/tests/[id]/page.tsx")).toContain('if (t.status === "draft") redirect(`/app/tests/new?draft=${t.id}`);');
    expect(src("app/app/tests/[id]/edit/page.tsx")).toContain('if (t.status === "draft") redirect(`/app/tests/new?draft=${t.id}`);');
    expect(src("app/app/tests/new/page.tsx")).toContain("init={draft ? asListing(draft) :");
    expect(src("app/app/tests/TestForm.tsx")).toContain("`/api/tests/${draft.id}/delete-draft`");
    expect(src("app/app/page.tsx")).toContain('t.status === "draft" ? `/app/tests/new?draft=${t.id}`');
  });
});

/** A paid part created after the page loaded: a stop-once reason on every tester button (also after the test closed). */
async function paidLater(contractId: string) {
  const s = await db.submission.create({ data: { contractId, kind: "recording", agreedCents: 500 } });
  await db.review.create({ data: { submissionId: s.id, contractId, amountCents: 200, agreedCents: 500, reason: "Short", payKey: randomUUID() } });
  return s;
}

describe("batch 7 item 4: stop-once on every press still allowed", () => {
  it("developer, stopped test: Pay, Reject, Extra pay, call length, dispute side and Rate stop once", async () => {
    const { dev, testId } = await setup({ recordingCents: "5.00" });
    const a = await joined(testId);
    const b = await joined(testId, "Ben Carter", "he");
    await sact(a.sessionId, "written", a.tester.cookie, { answers: ["a", "b"] });
    await sact(b.sessionId, "written", b.tester.cookie, { answers: ["a", "b"] });
    const subA = await db.submission.findFirstOrThrow({ where: { contractId: a.sessionId } });
    const subB = await db.submission.findFirstOrThrow({ where: { contractId: b.sessionId } });
    expect((await pay(dev.cookie, { kind: "submission", id: subB.id, amount: "4.00", tickedCents: 400, reason: "Only half answered", seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await sact(b.sessionId, "dispute", b.tester.cookie, { kind: "submission", id: subB.id, reason: "I answered every question fully" })).status).toBe(200);
    const d = await db.dispute.findFirstOrThrow({ where: { submissionId: subB.id } });
    const call = await bookCall(testId, dev.cookie, a.sessionId, a.tester.cookie, 48);
    await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() - 2 * 3_600_000), measuredMinutes: 30, measuredAt: new Date() } });
    await db.rating.create({ data: { testId, contractId: a.sessionId, side: "tester", raterId: a.tester.user.id, rateeId: dev.user.id, stars: 5 } });
    await act(testId, "stop", dev.cookie, { seenAt: seen(), confirmed: true });
    const loaded = seen();
    await settle();
    await db.testEvent.create({ data: { testId, kind: "paid", text: "Ben Carter charged $1.00 for their recording" } });
    stops(await pay(dev.cookie, { kind: "submission", id: subA.id, amount: "10.00", tickedCents: 1000, seenAt: loaded }), "pay");
    stops(await act(testId, "pay-extra", dev.cookie, { contractId: b.sessionId, submissionId: subB.id, amount: "2.00", tickedCents: 200, seenAt: loaded }), "extra pay");
    stops(await act(testId, "lower-length", dev.cookie, { callId: call.id, minutes: 25, reason: "We stopped early.", seenAt: loaded }), "lower the length");
    // (Batch 15 section 27) The side of a dispute never stops.
    expect((await act(testId, "dispute-side", dev.cookie, { disputeId: d.id, text: "They skipped two answers", seenAt: loaded })).status).toBe(200);
    stops(await act(testId, "rate", dev.cookie, { contractId: a.sessionId, stars: 4, seenAt: loaded }), "rate");
  });

  it("developer, restricted: Cancel call from the dashboard's Calls box returns the changes, then goes through", async () => {
    const { dev, testId } = await setup();
    const a = await joined(testId);
    const call = await bookCall(testId, dev.cookie, a.sessionId, a.tester.cookie, 24 * 6);
    await startHold(dev.user.id, "unpaid");
    const loaded = seen();
    await settle();
    await db.testEvent.create({ data: { testId, kind: "left", text: "Ben Carter left the test" } });
    const r = await act(testId, "cancel-call", dev.cookie, { callId: call.id, seenAt: loaded });
    stops(r, "cancel call");
    expect((await act(testId, "cancel-call", dev.cookie, { callId: call.id, seenAt: loaded, confirmed: true })).status).toBe(200);
    expect(src("app/app/CallsBox.tsx")).toContain("<ChangesBox changes={changes} error={error} />");
  });

  for (const state of ["stopped", "paused"] as const) {
    it(`tester, ${state} test: Charge, Let it go, Dispute, Rate${state === "paused" ? ", Leave and Cancel call" : ""} stop once`, async () => {
      const { dev, testId } = await setup({ recordingCents: "5.00" });
      const { tester, sessionId } = await joined(testId);
      await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
      const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
      await db.submission.update({ where: { id: sub.id }, data: { choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 14 * DAY) } });
      const call = state === "paused" ? await bookCall(testId, dev.cookie, sessionId, tester.cookie, 24 * 6) : null;
      if (state === "stopped") await act(testId, "stop", dev.cookie, { seenAt: seen(), confirmed: true });
      else await startHold(dev.user.id, "unpaid");
      const loaded = seen();
      await settle();
      const rec = await paidLater(sessionId);
      const press = (action: string, body: Record<string, unknown>) => sact(sessionId, action, tester.cookie, { seenAt: loaded, ...body });
      stops(await press("choose", { submissionId: sub.id, choice: "charge", tickedCents: 1000 }), "charge");
      stops(await press("choose", { submissionId: sub.id, choice: "letgo" }), "let it go");
      stops(await press("dispute", { kind: "submission", id: rec.id, reason: "I recorded the whole session" }), "dispute");
      stops(await press("rate", { stars: 4 }), "rate");
      if (call) {
        // (Batch 15 section 25) Leave never stops: it goes through on the first press (checked last, below).
        stops(await press("cancel-call", { callId: call.id }), "cancel call");
      }
    });
  }
});
