import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { POST as adminPOST } from "@/app/api/admin/[action]/route";
import { POST as joinPOST } from "@/app/api/calls/[id]/join/route";
import { adminPage, type TestVM } from "@/lib/server/adminLists";
import { ANSWER_TERMS_CODE, ANSWER_TERMS_FIRST, termsBlockedPath } from "@/lib/answerTerms";
import { refusalLine } from "@/lib/pressLabels";
import { pillLabel, pillSide } from "@/lib/livePill";
import { shownWithFresh } from "@/lib/adminScroll";
import { CALL_MIN_AHEAD_MINUTES, farEnoughAhead } from "@/lib/callLead";
import { json, makeUser, req } from "./helpers";
import { act, bookCall, joined, sact, seen, settle, setup } from "./fixtures";

// Batch 27 (owner, Oct 29): new terms answered before sending or calls (1), "Go to the next round" stops once (2), the update pill always, pointing at the updates (4),
// admin Tests rows follow a pause lifted elsewhere (5), a call may start 1 minute ahead when testing locally (6). Section 3 (files placed in answers) waits for the owner's choice of design.
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const later = () => new Promise((r) => setTimeout(r, 30));
const edit = async (testId: string, cookie: string, fields: Record<string, unknown>) => {
  const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
  return act(testId, "edit", cookie, { version: v, fields, confirmed: true });
};
const again = () => ({ confirmed: true, boxAt: new Date().toISOString() });
const expectBlocked = (r: { status: number; body: { error?: { code: string; message: string } } }) => {
  expect(r.status).toBe(409);
  expect(r.body.error).toMatchObject({ code: ANSWER_TERMS_CODE, message: ANSWER_TERMS_FIRST });
};

/** A working tester with an open new-terms offer (the written price went up), and the page time from before the offer. */
async function offered(over: Record<string, unknown> = {}) {
  const s = await setup(over);
  const j = await joined(s.testId);
  const loaded = seen();
  await later();
  expect((await edit(s.testId, s.dev.cookie, { writtenCents: "12.00" })).body.offered).toBe(1);
  const offer = await db.termsOffer.findFirstOrThrow({ where: { contractId: j.sessionId, status: "open" } });
  return { ...s, ...j, loaded, offer };
}

describe("batch 27 section 1: an open new-terms offer blocks Send and calls until it's answered", () => {
  it("Send my answers: refused with the line from an old page and a fresh one, every press (no second press gets through); nothing is sent", async () => {
    const o = await offered();
    // An old page that hasn't seen the offer.
    expectBlocked(await sact(o.sessionId, "written", o.tester.cookie, { answers: ["a", "b"], seenAt: o.loaded }));
    // The second press (as the stop-once box used to allow) is refused the same way.
    expectBlocked(await sact(o.sessionId, "written", o.tester.cookie, { answers: ["a", "b"], seenAt: o.loaded, ...again() }));
    // A page that shows the offer, and a press with a missing answer: the offer still comes first.
    expectBlocked(await sact(o.sessionId, "written", o.tester.cookie, { answers: ["", ""], seenAt: seen() }));
    expect(await db.submission.count({ where: { contractId: o.sessionId } })).toBe(0);
  });

  it("Send my updated answers and Send my recording are blocked too", async () => {
    const s = await setup({ recordingCents: "15.00" });
    const j = await joined(s.testId);
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"], seenAt: seen(), confirmed: true })).status).toBe(200);
    await later();
    await edit(s.testId, s.dev.cookie, { writtenCents: "12.00" });
    expectBlocked(await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a2", "b2"], seenAt: seen() }));
    expectBlocked(await sact(j.sessionId, "recording-send", j.tester.cookie, { seenAt: seen() }));
    expect((await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId, kind: "written" } })).answers).not.toContain("a2");
  });

  it("every call press: Request a time, Accept, Decline, Withdraw, Cancel call, Cancel the remaining calls, Join call", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    const call = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie, 72);
    const at = new Date(Date.now() + 96 * 3_600_000);
    at.setSeconds(0, 0);
    expect((await act(s.testId, "request-time", s.dev.cookie, { contractIds: [j.sessionId], rows: [{ startsAt: at.toISOString(), repeat: "once", count: 1 }], minutes: "30", seenAt: seen(), confirmed: true })).status).toBe(200);
    const devReq = await db.callRequest.findFirstOrThrow({ where: { contractId: j.sessionId, status: "pending", fromSide: "developer" } });
    const mine = await db.callRequest.create({ data: { testId: s.testId, contractId: j.sessionId, fromSide: "tester", startsAt: new Date(at.getTime() + 3_600_000), times: [], weeks: 0, repeat: "once", minutes: 30 } });
    await later();
    await edit(s.testId, s.dev.cookie, { writtenCents: "12.00" });
    const fresh = { seenAt: seen() };
    expectBlocked(await sact(j.sessionId, "request-time", j.tester.cookie, { ...fresh, rows: [{ startsAt: new Date(at.getTime() + 7_200_000).toISOString(), repeat: "once", count: 1 }], minutes: "30" }));
    expectBlocked(await sact(j.sessionId, "answer-request", j.tester.cookie, { ...fresh, requestId: devReq.id, action: "accept" }));
    expectBlocked(await sact(j.sessionId, "answer-request", j.tester.cookie, { ...fresh, requestId: devReq.id, action: "decline" }));
    expectBlocked(await sact(j.sessionId, "answer-request", j.tester.cookie, { ...fresh, requestId: mine.id, action: "withdraw" }));
    expectBlocked(await sact(j.sessionId, "cancel-call", j.tester.cookie, { ...fresh, callId: call.id, reason: "" }));
    expectBlocked(await sact(j.sessionId, "cancel-set", j.tester.cookie, { ...fresh, setId: "any", reason: "" }));
    // Join call while the room is open: the tester's press waits; the developer's Join isn't touched by the tester's offer.
    await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() - 60_000) } });
    const join = (cookie: string) => joinPOST(req(`/api/calls/${call.id}/join`, { cookie, body: {} }), { params: Promise.resolve({ id: call.id }) }).then(json);
    expectBlocked(await join(j.tester.cookie));
    expect((await join(s.dev.cookie)).status).toBe(200);
    // Nothing happened to the requests or the call.
    expect((await db.callRequest.findUniqueOrThrow({ where: { id: devReq.id } })).status).toBe("pending");
    expect((await db.callRequest.findUniqueOrThrow({ where: { id: mine.id } })).status).toBe("pending");
    expect((await db.call.findUniqueOrThrow({ where: { id: call.id } })).status).toBe("booked");
  });

  it("Keep unlocks (the old terms stay); Switch unlocks too", async () => {
    const o = await offered();
    expect((await sact(o.sessionId, "terms", o.tester.cookie, { offerId: o.offer.id, choice: "keep", seenAt: seen() })).status).toBe(200);
    expect((await sact(o.sessionId, "written", o.tester.cookie, { answers: ["a", "b"], seenAt: o.loaded, confirmed: true })).status).toBe(200);
    expect((await db.submission.findFirstOrThrow({ where: { contractId: o.sessionId } })).agreedCents).toBe(1000); // kept the old price
    const p = await offered();
    expect((await sact(p.sessionId, "terms", p.tester.cookie, { offerId: p.offer.id, choice: "switch", seenAt: seen() })).status).toBe(200);
    expect((await sact(p.sessionId, "written", p.tester.cookie, { answers: ["a", "b"], seenAt: seen() })).status).toBe(200);
    expect((await db.submission.findFirstOrThrow({ where: { contractId: p.sessionId } })).agreedCents).toBe(1200);
  });

  it("with Alerts Off the block still applies; a newer Save keeps it blocked until the newest is answered", async () => {
    const o = await offered();
    await db.user.update({ where: { id: o.tester.user.id }, data: { testerAlertsOff: true } });
    expectBlocked(await sact(o.sessionId, "written", o.tester.cookie, { answers: ["a", "b"], seenAt: seen() }));
    await later();
    await edit(o.testId, o.dev.cookie, { writtenCents: "14.00" });
    expectBlocked(await sact(o.sessionId, "written", o.tester.cookie, { answers: ["a", "b"], seenAt: seen() }));
    // Keep pressed on the older offer's page: the "changed the terms again" stop first, then the newest is decided and Send works.
    const r = await sact(o.sessionId, "terms", o.tester.cookie, { offerId: o.offer.id, choice: "keep", seenAt: seen() });
    expect(r.body.error.code).toBe("stop_once");
    expectBlocked(await sact(o.sessionId, "written", o.tester.cookie, { answers: ["a", "b"], seenAt: seen() }));
    expect((await sact(o.sessionId, "terms", o.tester.cookie, { offerId: r.body.error.offerId, choice: "keep", seenAt: seen() })).status).toBe(200);
    expect((await sact(o.sessionId, "written", o.tester.cookie, { answers: ["a", "b"], seenAt: seen() })).status).toBe(200);
  });

  it("an offer whose work closed blocks nothing (the test stopped: Send gets the stopped refusal instead)", async () => {
    const o = await offered();
    expect((await act(o.testId, "stop", o.dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true })).status).toBe(200);
    const r = await sact(o.sessionId, "written", o.tester.cookie, { answers: ["a", "b"], seenAt: seen() });
    expect(r.body.error.code).not.toBe(ANSWER_TERMS_CODE);
  });

  it("(batch 32 §7) Charge, Let it go and Dispute are blocked too until Switch or Keep; Leave goes through", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"], seenAt: seen(), confirmed: true })).status).toBe(200);
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    await db.submission.update({ where: { id: sub.id }, data: { choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 7 * 86_400_000) } });
    await later();
    await edit(s.testId, s.dev.cookie, { writtenCents: "12.00" });
    const offer = await db.termsOffer.findFirstOrThrow({ where: { contractId: j.sessionId, status: "open" } });
    // Every press, from a fresh page too (no second press gets through).
    expectBlocked(await sact(j.sessionId, "choose", j.tester.cookie, { submissionId: sub.id, choice: "letgo", seenAt: seen() }));
    expectBlocked(await sact(j.sessionId, "choose", j.tester.cookie, { submissionId: sub.id, choice: "charge", seenAt: seen(), ...again() }));
    expectBlocked(await sact(j.sessionId, "dispute", j.tester.cookie, { kind: "submission", id: sub.id, reason: "The pay was not what we agreed.", seenAt: seen() }));
    expect(await db.review.count({ where: { submissionId: sub.id } })).toBe(0);
    // Keep unlocks.
    expect((await sact(j.sessionId, "terms", j.tester.cookie, { offerId: offer.id, choice: "keep", seenAt: seen() })).status).toBe(200);
    expect((await sact(j.sessionId, "choose", j.tester.cookie, { submissionId: sub.id, choice: "letgo", seenAt: seen() })).status).toBe(200);
    const d = await sact(j.sessionId, "dispute", j.tester.cookie, { kind: "submission", id: sub.id, reason: "The pay was not what we agreed.", seenAt: seen() });
    expect(d.body.error?.code).not.toBe(ANSWER_TERMS_CODE);
    const k = await joined(s.testId, "Ben Carter", "he");
    await later();
    await edit(s.testId, s.dev.cookie, { writtenCents: "13.00" });
    expect(await db.termsOffer.count({ where: { contractId: k.sessionId, status: "open" } })).toBe(1);
    expect((await sact(k.sessionId, "leave", k.tester.cookie, { seenAt: seen() })).status).toBe(200);
  });

  it("the page: the blocked presses, the line exactly under the button (no 'didn't go through' prefix), the move up to Switch / Keep", () => {
    for (const a of ["written", "recording-send", "request-time", "answer-request", "cancel-call", "cancel-set", "choose", "dispute"]) expect(termsBlockedPath(`/api/sessions/s1/${a}`), a).toBe(true);
    expect(termsBlockedPath("/api/calls/c1/join")).toBe(true);
    for (const a of ["rate", "leave", "message", "terms", "recording-start", "recording-done", "no-show"]) expect(termsBlockedPath(`/api/sessions/s1/${a}`), a).toBe(false);
    expect(termsBlockedPath("/api/tests/t1/request-time")).toBe(false); // the developer's
    expect(refusalLine("Send", ANSWER_TERMS_FIRST)).toBe("Answer the new terms first: Switch or Keep.");
    const client = src("lib/client.ts");
    expect(client).toContain("if (body !== undefined && blockedByTerms(path)) throw new ApiError(409, ANSWER_TERMS_CODE, ANSWER_TERMS_FIRST);");
    expect(client).toContain("if (e?.code === ANSWER_TERMS_CODE && typeof window !== \"undefined\") window.dispatchEvent(new Event(ANSWER_TERMS_EVENT));");
    const top = src("app/app/sessions/[id]/TesterTop.tsx");
    expect(top).toContain("window.addEventListener(ANSWER_TERMS_EVENT, on);");
    expect(top).toContain("setTimeout(() => jumpTo(\"terms-offer\"), 30);");
    expect(top).toContain("router.refresh();"); // an old page loads the offer first
    expect(top).toContain("data-[marked]:ring-2 data-[marked]:ring-sky-300");
    // The line stays under its button: no scroll back down to it.
    expect(src("components/Err.tsx")).toContain("if (text && text !== ANSWER_TERMS_FIRST) bringInView(ref.current);");
    expect(src("components/ChangesBox.tsx")).toContain("if (changes || (error && error !== ANSWER_TERMS_FIRST)) bringInView(ref.current);");
    // The offer comes before the form's own checks.
    expect(src("app/app/sessions/[id]/SessionActions.tsx")).toContain("const missing = terms ? null : answersMissing(questions, answers);");
    expect(src("components/CallRequests.tsx")).toContain("((p.side === \"tester\" && offerShown()) || checkFields(form.current))");
  });
});

describe("batch 27 section 2: Go to the next round stops once too", () => {
  it("updated answers after the page loaded: the first press stops naming them, the second opens the draft; nothing new opens at once", async () => {
    const s = await setup();
    const j = await joined(s.testId, "fbbb", "they");
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"], seenAt: seen(), confirmed: true })).status).toBe(200);
    const made = await act(s.testId, "next-round", s.dev.cookie, { seenAt: seen(), confirmed: true });
    expect(made.status).toBe(200);
    await settle();
    const quiet = await act(s.testId, "go-next-round", s.dev.cookie, { seenAt: seen() });
    expect(quiet.status).toBe(200);
    expect(quiet.body.id).toBe(made.body.id);
    const loaded = seen();
    await later();
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a2", "b2"], seenAt: seen(), confirmed: true })).status).toBe(200);
    const first = await act(s.testId, "go-next-round", s.dev.cookie, { seenAt: loaded });
    expect(first.body.error.code).toBe("stop_once");
    expect(first.body.error.changes.map((c: { text: string }) => c.text)).toContain("fbbb updated their written answers");
    await later();
    const second = await act(s.testId, "go-next-round", s.dev.cookie, { seenAt: loaded, ...again() });
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(made.body.id);
  });

  it("on a stopped test it opens at once; the button is a press with its box under the buttons", async () => {
    const s = await setup();
    const j = await joined(s.testId, "fbbb", "they");
    const made = await act(s.testId, "next-round", s.dev.cookie, { seenAt: seen(), confirmed: true });
    expect((await act(s.testId, "stop", s.dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true })).status).toBe(200);
    await settle();
    const loaded = seen();
    await later();
    await sact(j.sessionId, "rate", j.tester.cookie, { stars: 5, seenAt: seen(), confirmed: true }).catch(() => null);
    const r = await act(s.testId, "go-next-round", s.dev.cookie, { seenAt: loaded });
    expect(r.status).toBe(200);
    expect(r.body.id).toBe(made.body.id);
    const panel = src("app/app/tests/[id]/TopPanel.tsx");
    expect(panel).toContain("onClick={() => void go(\"go-next-round\")}><Repeat className=\"h-4 w-4\" /> Go to the next round</button>");
    expect(panel).toContain("{box(\"go-next-round\")}");
    expect(panel).toContain("else if (action === \"go-next-round\" && r.id) window.location.href = `/app/tests/${r.id}`;");
  });
});

describe("batch 27 section 4: the update pill, always, pointing at the updates", () => {
  it("the arrow by position: above the screen ↑, below ↓, in view nothing (the pill goes)", () => {
    expect(pillSide({ top: -400, bottom: -100 }, 800)).toBe("up");
    expect(pillSide({ top: -50, bottom: 300 }, 800)).toBe("up"); // its newest line is above
    expect(pillSide({ top: 100, bottom: 300 }, 800)).toBe("");
    expect(pillSide({ top: 600, bottom: 1600 }, 800)).toBe(""); // a tall box whose top shows
    expect(pillSide({ top: 900, bottom: 1100 }, 800)).toBe("down"); // Edit: under Save, below the screen
    expect(pillLabel(1, "up")).toBe("1 new update ↑");
    expect(pillLabel(3, "down")).toBe("3 new updates ↓");
  });

  it("no automatic scroll: every update out of view raises the pill, typing or not; pressing it scrolls there and clears it; the box in view clears it", () => {
    const top = src("components/LiveTop.tsx");
    expect(top).not.toContain("scrolled.current");
    expect(top).not.toContain("else go();");
    expect(top).toContain("const s = where();\n      if (!s) return;\n      setSide(s);\n      setPill((p) => p + n);");
    expect(top).toContain("if (!s) setPill(0);\n      else setSide(s);");
    expect(top).toContain("{pillLabel(pill, side)}");
    expect(top).toContain("onClick={go}");
    expect(top).toContain("behavior: reduce ? \"auto\" : \"smooth\"");
    expect(top).toContain("data-flash={flash === key(l) ? \"\" : undefined}");
  });
});

describe("batch 27 section 5: admin Tests rows follow the test's pause live", () => {
  async function admin() {
    const a = await makeUser({ email: `admin-${randomUUID()}@playtest.test` });
    await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
    return a;
  }
  const aact = (cookie: string, action: string, body: Record<string, unknown>) => adminPOST(req(`/api/admin/${action}`, { cookie, body }), { params: Promise.resolve({ action }) }).then(json);

  it("two admins, one with a searched list: a lift on one turns the other's row into Pause on its next check; its history reads open", async () => {
    const ada = await admin(), bo = await admin();
    const s = await setup({ title: `Harbor Run ${randomUUID().slice(0, 6)}` });
    const title = (await db.test.findUniqueOrThrow({ where: { id: s.testId } })).title;
    expect((await aact(ada.cookie, "pause-test", { id: s.testId, note: "Checking" })).status).toBe(200);
    const boRows = async () => (await adminPage("tests", bo.user.id, null, "", { q: title, ticks: [] })).rows as TestVM[];
    const shown = await boRows();
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ adminPaused: true });
    expect(shown[0].line).toContain(`paused by ${ada.user.email}`);
    expect((await aact(ada.cookie, "unpause-test", { id: s.testId })).status).toBe(200);
    // Bo's next live check (the same search): the row's fresh copy replaces the shown one.
    const after = shownWithFresh(shown, await boRows());
    expect(after[0].adminPaused).toBe(false); // Pause (with its Why box), not Lift the pause
    expect(after[0].line).toMatch(new RegExp(` · open · paused by ${ada.user.email.replace(/[.+]/g, "\\$&")}, lifted by ${ada.user.email.replace(/[.+]/g, "\\$&")} at .+`));
    expect(after[0].line).not.toContain("unpaused by");
    // Paused again elsewhere: Lift the pause again, and the older lift isn't listed as if it were the state.
    expect((await aact(bo.cookie, "pause-test", { id: s.testId, note: "Again" })).status).toBe(200);
    const again2 = shownWithFresh(after, await boRows());
    expect(again2[0].adminPaused).toBe(true);
    expect(again2[0].line).toContain(`paused by ${bo.user.email}`);
    expect(again2[0].line).not.toContain("lifted by");
    // Stopped: no Pause / Lift, its state line.
    expect((await aact(ada.cookie, "stop-test", { id: s.testId, note: "Broken build link" })).status).toBe(200);
    const stopped = shownWithFresh(again2, await boRows());
    expect(stopped[0].stopped).toBe(true);
    expect(stopped[0].line).toContain(`stopped by ${ada.user.email}`);
    // Nothing changed: the same array (no re-render).
    expect(shownWithFresh(stopped, stopped.map((x) => ({ ...x })))).toBe(stopped);
  });

  it("the list checks at once on focus, a visible tab and the live nudge; the button is keyed by the state", () => {
    const list = src("app/admin/PagedList.tsx");
    expect(list).toContain("window.addEventListener(\"live-tick\", now);");
    expect(list).toContain("document.addEventListener(\"visibilitychange\", onVisible);");
    expect(list).toContain("<AdminButton key=\"lift\" action=\"unpause-test\"");
    expect(list).toContain("<AdminButton key=\"pause\" action=\"pause-test\"");
    expect(list).toContain("setRows((prev) => shownWithFresh(prev, fresh));");
  });
});

describe("batch 27 section 6: a call request may start 1 minute ahead outside production", () => {
  it("not in production: a time 2 minutes ahead is accepted by the server; under a minute is refused", async () => {
    expect(CALL_MIN_AHEAD_MINUTES).toBe(1);
    const s = await setup();
    const j = await joined(s.testId);
    const soon = new Date(Date.now() + 2 * 60_000).toISOString();
    expect((await act(s.testId, "request-time", s.dev.cookie, { contractIds: [j.sessionId], rows: [{ startsAt: soon, repeat: "once", count: 1 }], minutes: "30", seenAt: seen(), confirmed: true })).status).toBe(200);
    const tooSoon = new Date(Date.now() + 20_000).toISOString();
    const r = await sact(j.sessionId, "request-time", j.tester.cookie, { rows: [{ startsAt: tooSoon, repeat: "weekly", count: 2 }], minutes: "30", seenAt: seen(), confirmed: true });
    expect(r.body.error).toMatchObject({ code: "bad_time", message: "Pick a time in the future." }); // (batch 29 section 20) one wording
  });

  it("production always keeps 5 minutes, whatever CALL_MIN_AHEAD_MINUTES says; locally the variable sets it", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CALL_MIN_AHEAD_MINUTES", "0");
    vi.resetModules();
    const prod = await import("@/lib/callLead");
    expect(prod.CALL_MIN_AHEAD_MINUTES).toBe(5);
    expect(prod.farEnoughAhead(new Date(Date.now() + 2 * 60_000))).toBe(false);
    expect(prod.farEnoughAhead(new Date(Date.now() + 6 * 60_000))).toBe(true);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CALL_MIN_AHEAD_MINUTES", "3");
    vi.resetModules();
    expect((await import("@/lib/callLead")).CALL_MIN_AHEAD_MINUTES).toBe(3);
    vi.unstubAllEnvs();
    vi.resetModules();
    expect(farEnoughAhead(new Date(Date.now() + 90_000))).toBe(true);
    expect(src("lib/server/requests.ts")).toContain("if (!farEnoughAhead(d)) throw new HttpError(400, \"bad_time\", \"Pick a time in the future.\");");
    // (Batch 29 section 20) The forms take the server's lead as a prop (the browser can't read CALL_MIN_AHEAD_MINUTES).
    expect(src("components/CallRequests.tsx")).toContain("useLocalMin(p.leadMinutes)");
    expect(src("app/app/tests/[id]/DevCallPanel.tsx")).toContain("useLocalMin(leadMinutes)");
  });
});
