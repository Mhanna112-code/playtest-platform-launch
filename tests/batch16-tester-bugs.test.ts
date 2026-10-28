import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { NO_LONGER_ON_OFFER } from "@/lib/server/terms";
import { json, req } from "./helpers";
import { act, atHours, bookCall, joined, sact, seen, settle, setup } from "./fixtures";

// Batch 16 section 38: two bugs from the owner's test.
const DAY = 86_400_000;
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
const editPrice = async (testId: string, cookie: string, price: string) =>
  act(testId, "edit", cookie, { version: (await db.test.findUniqueOrThrow({ where: { id: testId } })).version, fields: { writtenCents: price }, seenAt: seen(), confirmed: true });

describe("A. Switch / Keep for an offer that arrived while the page was open", () => {
  it("the page's offer id follows the offer shown (it arrives live)", () => {
    const top = src("app/app/sessions/[id]/TesterTop.tsx");
    expect(top).toContain("if (offer?.id) setOfferId(offer.id);");
    expect(top).toContain("}, [offer?.id]);");
  });

  for (const choice of ["switch", "keep"] as const) {
    it(`${choice}: an empty id (the old page) stops once with the newest offer, then decides on it; the right id goes straight through`, async () => {
      const { dev, testId } = await setup();
      const { tester, sessionId } = await joined(testId);
      const opened = seen();
      await settle();
      expect((await editPrice(testId, dev.cookie, "12.00")).status).toBe(200);
      const offer = await db.termsOffer.findFirstOrThrow({ where: { contractId: sessionId, status: "open" } });
      const first = await sact(sessionId, "terms", tester.cookie, { offerId: "", choice, seenAt: opened });
      expect(first.body.error?.code, JSON.stringify(first.body)).toBe("stop_once");
      expect(first.body.error.offerId).toBe(offer.id);
      expect(first.body.error.message).not.toMatch(/doesn't exist/);
      const second = await sact(sessionId, "terms", tester.cookie, { offerId: first.body.error.offerId, choice, seenAt: opened, confirmed: true, boxAt: first.body.error.now });
      expect(second.status, JSON.stringify(second.body)).toBe(200);
      expect((await db.termsOffer.findUniqueOrThrow({ where: { id: offer.id } })).status).toBe(choice === "switch" ? "switched" : "kept");
      // With the id the page shows now (the fix): straight through.
      const { tester: t2, sessionId: s2 } = await joined(testId, "Ben Okafor", "he");
      await editPrice(testId, dev.cookie, "13.00");
      const o2 = await db.termsOffer.findFirstOrThrow({ where: { contractId: s2, status: "open" } });
      const direct = await sact(s2, "terms", t2.cookie, { offerId: o2.id, choice, seenAt: seen() });
      expect(direct.status, JSON.stringify(direct.body)).toBe(200);
    });
  }

  it("an offer replaced by a newer one: stops once naming the newest, then decides on the newest; with none left: “These terms are no longer on offer.”", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    expect((await editPrice(testId, dev.cookie, "12.00")).status).toBe(200);
    const old = await db.termsOffer.findFirstOrThrow({ where: { contractId: sessionId, status: "open" } });
    const opened = seen();
    await settle();
    expect((await editPrice(testId, dev.cookie, "14.00")).status).toBe(200);
    const newest = await db.termsOffer.findFirstOrThrow({ where: { contractId: sessionId, status: "open" } });
    expect(newest.id).not.toBe(old.id);
    const stop = await sact(sessionId, "terms", tester.cookie, { offerId: old.id, choice: "switch", seenAt: opened });
    expect(stop.body.error.code).toBe("stop_once");
    expect(stop.body.error.offerId).toBe(newest.id);
    expect(stop.body.error.changes.map((c: { text: string }) => c.text).join(" ")).toMatch(/changed the terms again/);
    expect((await sact(sessionId, "terms", tester.cookie, { offerId: newest.id, choice: "switch", seenAt: opened, confirmed: true, boxAt: stop.body.error.now })).status).toBe(200);
    expect((await db.contract.findUniqueOrThrow({ where: { id: sessionId } })).writtenCents).toBe(1400);
    // Nothing open any more.
    expect((await sact(sessionId, "terms", tester.cookie, { offerId: "", choice: "keep", seenAt: seen() })).body.error.message).toBe(NO_LONGER_ON_OFFER);
    expect(NO_LONGER_ON_OFFER).toBe("These terms are no longer on offer.");
    expect((await sact(sessionId, "terms", tester.cookie, { offerId: "nope", choice: "keep", seenAt: seen() })).body.error.message).toBe(NO_LONGER_ON_OFFER);
    expect((await sact(sessionId, "terms", tester.cookie, { offerId: newest.id, choice: "keep", seenAt: seen() })).body.error.message).toBe("You already switched to these terms.");
  });
});

/** A session with something for every tester press: paid written answers (Dispute), a recording with Charge open, a booked call ahead, an open offer. */
async function everyPress() {
  const { dev, testId } = await setup({ recordingCents: "15.00" });
  const { tester, sessionId } = await joined(testId);
  await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"], seenAt: seen(), confirmed: true });
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId, kind: "written" } });
  expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "4.00", tickedCents: 400, reason: "Short answers" })).status).toBe(200);
  const rec = await db.submission.create({ data: { contractId: sessionId, kind: "recording", agreedCents: 1500, sentAt: new Date(), updatedAt: new Date(), payBy: new Date(Date.now() - DAY), choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 7 * DAY), devMarks: [] } });
  const call = await bookCall(testId, dev.cookie, sessionId, tester.cookie, 96);
  await editPrice(testId, dev.cookie, "12.00");
  const offer = await db.termsOffer.findFirstOrThrow({ where: { contractId: sessionId, status: "open" } });
  await settle();
  return { dev, testId, tester, sessionId, sub, rec, call, offer };
}

describe("B. every call change stops every tester press once (Alerts On), never with Alerts Off", () => {
  it("root cause: the server already stops for a call request; a refresh of the page moved the press's seen marker past it. Now it's counted from when the page loaded", async () => {
    const s = await everyPress();
    const loaded = seen();
    await settle();
    expect((await act(s.testId, "request-time", s.dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [s.sessionId], startsAt: atHours(60) })).status).toBe(200);
    await settle();
    const refreshed = seen(); // the page's data after a refresh: rendered after the request
    const presses: [string, Record<string, unknown>][] = [
      ["dispute", { kind: "submission", id: s.sub.id, reason: "I answered every question in full." }],
      ["written", { answers: ["c", "d"] }],
      ["choose", { submissionId: s.rec.id, choice: "charge" }],
      ["choose", { submissionId: s.rec.id, choice: "letgo" }],
      ["rate", { stars: 4 }],
      ["cancel-call", { callId: s.call.id, reason: "Something came up at work." }],
      ["request-time", { startsAt: atHours(120) }],
      ["terms", { offerId: s.offer.id, choice: "keep" }],
    ];
    for (const [action, body] of presses) {
      // Without the page's load time (as before), the refreshed marker hides the request.
      const r = await sact(s.sessionId, action, s.tester.cookie, { ...body, seenAt: refreshed, loadedAt: loaded });
      expect(r.body.error?.code, `${action} ${JSON.stringify(r.body)}`).toBe("stop_once");
      expect(r.body.error.changes.map((c: { text: string }) => c.text).join(" "), action).toMatch(/requested a call/);
    }
    // Once a stop box in this tab listed it, it doesn't stop again.
    const listed = await sact(s.sessionId, "dispute", s.tester.cookie, { kind: "submission", id: s.sub.id, reason: "I answered every question in full.", seenAt: refreshed, loadedAt: loaded, boxSeenAt: new Date().toISOString() });
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);
  }, 60_000);

  it("a call the developer cancelled stops too; with Alerts Off nothing stops", async () => {
    const s = await everyPress();
    const loaded = seen();
    await settle();
    expect((await act(s.testId, "cancel-call", s.dev.cookie, { seenAt: seen(), confirmed: true, callId: s.call.id })).status).toBe(200);
    const r = await sact(s.sessionId, "dispute", s.tester.cookie, { kind: "submission", id: s.sub.id, reason: "I answered every question in full.", seenAt: seen(), loadedAt: loaded });
    expect(r.body.error?.code, JSON.stringify(r.body)).toBe("stop_once");
    expect(r.body.error.changes.map((c: { text: string }) => c.text).join(" ")).toMatch(/was cancelled/);
    await db.user.update({ where: { id: s.tester.user.id }, data: { testerAlertsOff: true } });
    const off = await sact(s.sessionId, "dispute", s.tester.cookie, { kind: "submission", id: s.sub.id, reason: "I answered every question in full.", seenAt: seen(), loadedAt: loaded });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
  }, 60_000);

  it("the session page notes when it loaded; every press sends it; the Dispute box sends seenAt", () => {
    expect(src("app/app/sessions/[id]/page.tsx")).toContain("<PageLoaded at={seenAt} />");
    expect(src("lib/client.ts")).toContain("loadedAt: pageLoadedAt()");
    expect(src("lib/live.ts")).toContain("if (c.at > boxSeenUpTo) boxSeenUpTo = c.at;");
    expect(src("app/app/sessions/[id]/SessionActions.tsx")).toContain("await api(`/api/sessions/${sessionId}/dispute`, { kind, id, reason, seenAt, confirmed, boxAt });");
  });
});

describe("section 40: the tester's live call part has no blue box per call", () => {
  it("each held call is one short grey line: time · length · waiting / paid $X / charged / let go; blue only for a real notice", () => {
    const page = src("app/app/sessions/[id]/page.tsx");
    expect(page).not.toContain("Live call on {fmtDateTime(x.startsAt)}: waiting for {dev} to pay.");
    expect(page).toContain('<p className="text-xs text-slate-400" data-call-row="" data-call-length="">{fmtDateTime(x.startsAt)} · {callMinutesOf(x)} min · waiting for {dev} to pay</p>');
    expect(page).toContain('{failedCalls.has(x.id) && <p className="info">{DELAYED_CALL_LINE}</p>}');
    expect(page).toContain("{fmtDateTime(x.startsAt)} · {callMinutesOf(x) ?? x.minutes} min · {callOutcome(x.review!)}");
    expect(page).toContain('r.rejected ? "rejected" : r.reason === LET_GO_BY_TESTER ? "let go" : chargedByTester(r.reason) ? "charged" : `paid ${money(r.amountCents)}`');
  });
});
