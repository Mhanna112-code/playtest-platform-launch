import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as confirmPOST } from "@/app/api/payments/confirm/route";
import { awayAction } from "@/lib/server/confirm";
import { autoChargeCalls } from "@/lib/server/holds";
import { addDevSide, decideDispute } from "@/lib/server/payments";
import { pressLabelOf, pressVerb } from "@/lib/pressLabels";
import { ALERT_TYPES } from "@/lib/alerts";
import { ALREADY_DISPUTED } from "@/lib/rules";
import { json, makeUser, req } from "./helpers";
import { act, addTo, atHours, bookCall, joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 9, §365 file 3, narrowed) THE STOP-ONCE MATRIX, the always-stop rules only, each with Alerts Off and with Alerts On:
//   1. the presser's own action in another tab (both sides);
//   2. a dispute or the team's decision about that tester (the developer's Pay, Pay more, Confirm with your bank, End early, Request a time about them), and the
//      team's decision or the developer's side on the tester's dispute (the tester's presses);
//   3. charges about that tester (an automatic call charge);
//   4. the payment's tester leaving (Pay / Pay more forced; Confirm with your bank follows "Testers leaving", §340);
//   5. §362's same-part stops: the tester's Send / Add / recording add / Dispute after a developer payment on that part; Needs you's Pay / Pay more (`from: "needs"`)
//      after work on that part, while the Testers list's Pay more doesn't stop with "Work sent" ignored;
// plus ONE ordinary (Alerts-following) line per button: it stops with its tick on and goes ahead with it off.
// Every case: the first press stops with exactly these lines and the box's tail, nothing is charged or saved; then, with Alerts Off, the second press (confirmed,
// with the box's time) goes ahead; with Alerts On, a press sending the line's identity as already listed by a box (`shownIds`) goes ahead without stopping again.

type Res = { status: number; body: { error?: { code?: string; message?: string; now?: string; changes?: { text: string; forced?: boolean; sid?: string }[] } } & Record<string, unknown> };
type Press = { path: string; body: Record<string, unknown>; go: (extra: Record<string, unknown>) => Promise<Res> };
const DAY = 86_400_000;
const ALL_ALERTS = ALERT_TYPES.map((a) => a.key);
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), ...body } })).then(json) as Promise<Res>;
const ANS = "The harbour level was clear and the boats handled well on the first try.";

/**
 * Ana: written answers paid $4.00 (Pay more open; disputable), a recording sent (unpaid), a call that took place (unpaid), and a second call whose automatic charge
 * waits for "Confirm with your bank". Ben: written answers sent (unpaid). Alerts Off: every developer Alerts type ignored and both testers' Alerts off.
 */
async function world(off: boolean) {
  const s = await setup({ recordingCents: "10.00" });
  const ana = await joined(s.testId, "Ana Silva");
  const ben = await joined(s.testId, "Ben Okafor", "he");
  for (const t of [ana, ben]) expect((await sact(t.sessionId, "written", t.tester.cookie, { answers: [ANS, ANS], seenAt: seen(), confirmed: true })).status).toBe(200);
  await settle();
  const anaSub = await db.submission.findFirstOrThrow({ where: { contractId: ana.sessionId, kind: "written" } });
  const benSub = await db.submission.findFirstOrThrow({ where: { contractId: ben.sessionId } });
  const anaRec = await db.submission.create({ data: { contractId: ana.sessionId, kind: "recording", agreedCents: 1000, sentAt: new Date(), updatedAt: new Date() } });
  expect((await pay(s.dev.cookie, { kind: "submission", id: anaSub.id, amount: "4.00", tickedCents: 400, reason: "Only half of it was useful", seenAt: seen(), confirmed: true })).status).toBe(200);
  const call = await bookCall(s.testId, s.dev.cookie, ana.sessionId, ana.tester.cookie, 48);
  await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() - 2 * 3_600_000), actualMinutes: 30, payBy: new Date(Date.now() + 5 * DAY) } });
  const call2 = await bookCall(s.testId, s.dev.cookie, ana.sessionId, ana.tester.cookie, 50);
  await db.call.update({ where: { id: call2.id }, data: { startsAt: new Date(Date.now() - 4 * 3_600_000), actualMinutes: 30, payBy: new Date(Date.now() + 5 * DAY) } });
  await db.review.create({ data: { contractId: ana.sessionId, callId: call2.id, amountCents: 1500, agreedCents: 1500, rateCents: 3000, payKey: randomUUID(), reason: "charged automatically", auto: true } });
  const p = await db.payment.create({ data: { kind: "call", contractId: ana.sessionId, callId: call2.id, developerId: s.dev.user.id, testerId: ana.tester.user.id, amountCents: 1500, feeCents: 0, testerCents: 0, status: "pending" } });
  await awayAction(p.id, { status: "requires_action", stripePaymentIntentId: `pi_${randomUUID()}`, clientSecret: "test_only" });
  for (const t of [ana, ben]) await db.user.update({ where: { id: t.tester.user.id }, data: { testerAlertsOff: off, stripeAccountId: "acct_" + randomUUID().slice(0, 12), payoutsReady: true } });
  if (off) await db.test.update({ where: { id: s.testId }, data: { ignoredAlerts: ALL_ALERTS } });
  const a = await makeUser({ name: "Admin" });
  const admin = await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  await settle();
  return { ...s, ana, ben, anaSub, benSub, anaRec, call, waitId: p.id, admin };
}
type W = Awaited<ReturnType<typeof world>>;

/** Everything a stopped press could have charged or saved on this test. */
async function fingerprint(testId: string) {
  const cs = await db.contract.findMany({ where: { testId }, orderBy: { id: "asc" }, select: { id: true, status: true, dueAt: true } });
  const ids = cs.map((c) => c.id);
  const [subs, reviews, pays, disputes, reqs, calls] = await Promise.all([
    db.submission.findMany({ where: { contractId: { in: ids } }, orderBy: { id: "asc" }, select: { id: true, updatedAt: true, additions: true, paidUpdateAt: true } }),
    db.review.count({ where: { contractId: { in: ids } } }),
    db.payment.findMany({ where: { contractId: { in: ids } }, orderBy: { id: "asc" }, select: { id: true, status: true, actionPi: true } }),
    db.dispute.count({ where: { contractId: { in: ids } } }),
    db.callRequest.count({ where: { contractId: { in: ids } } }),
    db.call.findMany({ where: { contractId: { in: ids } }, orderBy: { id: "asc" }, select: { id: true, status: true } }),
  ]);
  return JSON.stringify({ cs, subs, reviews, pays, disputes, reqs, calls });
}

/** The box's tail as the page draws it under the pressed button ("Press Pay again to go ahead."). */
const tailOf = (p: Press) => `Press ${pressVerb(pressLabelOf(p.path, p.body))} again to go ahead.`;

/**
 * The first press (from a page loaded at `loaded`) stops with exactly `lines` (strings, or patterns for a line naming a time) and `tail`, changing nothing; then the
 * Alerts Off run presses again (confirmed, with the box's time) and the Alerts On run presses with the box's lines as listed (`shownIds`): both go ahead.
 */
async function stopsOnce(w: W, off: boolean, loaded: string, p: Press, lines: (string | RegExp)[], tail: string, forced = true) {
  const before = await fingerprint(w.testId);
  const first = await p.go({ seenAt: loaded, loadedAt: loaded });
  expect(first.body.error?.code, JSON.stringify(first.body)).toBe("stop_once");
  expect(first.body.error?.message).toBe("Press again to go ahead.");
  const got = first.body.error!.changes!;
  expect(got.map((c) => c.text)).toEqual(lines.map((l) => (typeof l === "string" ? l : expect.stringMatching(l))));
  expect(got.every((c) => !!c.forced === forced), JSON.stringify(got)).toBe(true);
  expect(tailOf(p)).toBe(tail);
  expect(await fingerprint(w.testId), "nothing charged or saved").toBe(before);
  await settle();
  const second = off
    ? await p.go({ seenAt: loaded, confirmed: true, boxAt: first.body.error!.now })
    : await p.go({ seenAt: loaded, loadedAt: loaded, shownIds: got.map((c) => c.sid) });
  expect(second.status, JSON.stringify(second.body)).toBe(200);
}
/** The press goes straight through (an ordinary line with its Alerts tick off). */
async function goesAhead(w: W, loaded: string, p: Press) {
  const r = await p.go({ seenAt: loaded, loadedAt: loaded });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
}

// The developer's presses about Ana (and Confirm on her call's waiting charge).
const devPress = {
  pay: (w: W): Press => { const body = { kind: "submission", id: w.anaRec.id, amount: "10.00", tickedCents: 1000 }; return { path: "/api/review", body, go: (x) => pay(w.dev.cookie, { ...body, ...x }) }; },
  payMore: (w: W): Press => { const body = { contractId: w.ana.sessionId, submissionId: w.anaSub.id, amount: "1.00", tickedCents: 100, payKey: randomUUID() }; return { path: `/api/tests/${w.testId}/pay-extra`, body, go: (x) => act(w.testId, "pay-extra", w.dev.cookie, { ...body, ...x }) as Promise<Res> }; },
  confirm: (w: W): Press => { const body = { paymentId: w.waitId, start: true }; return { path: "/api/payments/confirm", body, go: (x) => confirmPOST(req("/api/payments/confirm", { cookie: w.dev.cookie, body: { ...body, ...x } })).then(json) as Promise<Res> }; },
  endEarly: (w: W): Press => { const body = { contractIds: [w.ana.sessionId], reason: "We have enough feedback now." }; return { path: `/api/tests/${w.testId}/end-early`, body, go: (x) => act(w.testId, "end-early", w.dev.cookie, { ...body, ...x }) as Promise<Res> }; },
  request: (w: W): Press => { const body = { minutes: "30", contractIds: [w.ana.sessionId], rows: [{ startsAt: atHours(72), repeat: "once", count: 1 }] }; return { path: `/api/tests/${w.testId}/request-time`, body, go: (x) => act(w.testId, "request-time", w.dev.cookie, { ...body, ...x }) as Promise<Res> }; },
};
const DEV_TAILS: Record<keyof typeof devPress, string> = { pay: "Press Pay again to go ahead.", payMore: "Press Pay more again to go ahead.", confirm: "Press Confirm with your bank again to go ahead.", endEarly: "Press End early again to go ahead.", request: "Press Request a time again to go ahead." };
// Ana's presses on her session.
const testerPress = {
  add: (w: W): Press => ({ path: `/api/sessions/${w.ana.sessionId}/written-add`, body: {}, go: (x) => addTo(w.ana.sessionId, w.ana.tester.cookie, { text: "One more thing about the harbour.", ...x }) as Promise<Res> }),
  request: (w: W): Press => { const body = { minutes: "30", rows: [{ startsAt: atHours(74), repeat: "once", count: 1 }] }; return { path: `/api/sessions/${w.ana.sessionId}/request-time`, body, go: (x) => sact(w.ana.sessionId, "request-time", w.ana.tester.cookie, { ...body, ...x }) as Promise<Res> }; },
  leave: (w: W): Press => ({ path: `/api/sessions/${w.ana.sessionId}/leave`, body: {}, go: (x) => sact(w.ana.sessionId, "leave", w.ana.tester.cookie, x) as Promise<Res> }),
  dispute: (w: W): Press => { const body = { kind: "submission", id: w.anaSub.id, reason: "I answered every question fully and in detail." }; return { path: `/api/sessions/${w.ana.sessionId}/dispute`, body, go: (x) => sact(w.ana.sessionId, "dispute", w.ana.tester.cookie, { ...body, ...x }) as Promise<Res> }; },
};
const TESTER_TAILS: Record<keyof typeof testerPress, string> = { add: "Press Add again to go ahead.", request: "Press Request a time again to go ahead.", leave: "Press Leave again to go ahead.", dispute: "Press Dispute again to go ahead." };

/** Ana disputes her written answers (from a page of hers loaded before), returning the dispute row. */
async function anaDisputes(w: W) {
  expect((await testerPress.dispute(w).go({ seenAt: seen(), confirmed: true })).status).toBe(200);
  return db.dispute.findFirstOrThrow({ where: { submissionId: w.anaSub.id } });
}
const DECIDED_DEV = "The team decided Ana Silva's dispute on her written answers: raised the pay to $10.00 ($6.00 more)";
const NEEDS_REC_LINE = "Ana Silva added a recording";
const NEEDS_WRITTEN_LINE = "Ana Silva added to her answer to “What did you like?” after you paid";
const DECIDED_TESTER = "The team decided your dispute with Nora Lane about your written answers: the pay was raised to $10.00";

for (const off of [true, false]) {
  const alerts = off ? "Alerts Off" : "Alerts On";
  describe(`§365 stop-once matrix (${alerts})`, () => {
    describe("1. own action in another tab", () => {
      it("the developer: a Pay in tab B stops tab A's Pay once", async () => {
        const w = await world(off);
        const loaded = seen(); await settle();
        expect((await pay(w.dev.cookie, { kind: "submission", id: w.benSub.id, amount: "10.00", tickedCents: 1000, seenAt: seen(), confirmed: true, tab: "B" })).status).toBe(200);
        await settle();
        const p = devPress.pay(w);
        await stopsOnce(w, off, loaded, { ...p, go: (x) => p.go({ tab: "A", ...x }) }, ["You paid Ben Okafor $10.00 for the written answers in another tab"], DEV_TAILS.pay);
      });
      it("the tester: a Request a time in tab B stops tab A's Add once", async () => {
        const w = await world(off);
        const loaded = seen(); await settle();
        expect((await testerPress.request(w).go({ seenAt: seen(), confirmed: true, tab: "B" })).status).toBe(200);
        await settle();
        const p = testerPress.add(w);
        await stopsOnce(w, off, loaded, { ...p, go: (x) => p.go({ tab: "A", ...x }) }, [/^You requested a call with Nora Lane for .+ in another tab$/], TESTER_TAILS.add);
      });
    });

    describe("2. a dispute or the team's decision about that tester", () => {
      for (const k of Object.keys(devPress) as (keyof typeof devPress)[]) {
        it(`Ana's dispute stops the developer's ${k} about her`, async () => {
          const w = await world(off);
          const loaded = seen(); await settle();
          await anaDisputes(w);
          await settle();
          await stopsOnce(w, off, loaded, devPress[k](w), ["Ana Silva disputed the pay for her written answers"], DEV_TAILS[k]);
        });
        it(`the team's decision on Ana's dispute stops the developer's ${k} about her`, async () => {
          const w = await world(off);
          const row = await anaDisputes(w);
          const loaded = seen(); await settle();
          await decideDispute(w.admin, row.id, { total: "10.00", tickCents: 600 });
          await settle();
          await stopsOnce(w, off, loaded, devPress[k](w), [DECIDED_DEV], DEV_TAILS[k]);
        });
      }
      for (const k of Object.keys(testerPress) as (keyof typeof testerPress)[]) {
        it(`the developer's side on Ana's dispute stops her ${k}`, async () => {
          const w = await world(off);
          const row = await anaDisputes(w);
          const loaded = seen(); await settle();
          await addDevSide(w.dev.user as never, w.testId, { disputeId: row.id, text: "We paid for what was useful to us.", seenAt: seen(), confirmed: true });
          await settle();
          // Her written answers are disputed already: a second Dispute is refused at once, never stopped first.
          if (k === "dispute") return expect((await testerPress.dispute(w).go({ seenAt: loaded, loadedAt: loaded })).body.error?.message).toBe(ALREADY_DISPUTED);
          await stopsOnce(w, off, loaded, testerPress[k](w), ["Nora Lane added her side to your dispute about your written answers"], TESTER_TAILS[k]);
        });
        it(`the team's decision on Ana's dispute stops her ${k}`, async () => {
          const w = await world(off);
          const row = await anaDisputes(w);
          const loaded = seen(); await settle();
          await decideDispute(w.admin, row.id, { total: "10.00", tickCents: 600 });
          await settle();
          // Her written answers are disputed already: a second Dispute is refused at once, never stopped first.
          if (k === "dispute") return expect((await testerPress.dispute(w).go({ seenAt: loaded, loadedAt: loaded })).body.error?.message).toBe(ALREADY_DISPUTED);
          await stopsOnce(w, off, loaded, testerPress[k](w), [DECIDED_TESTER], TESTER_TAILS[k]);
        });
      }
    });

    describe("3. a charge about that tester (her call's automatic charge)", () => {
      for (const k of Object.keys(devPress) as (keyof typeof devPress)[]) {
        it(`stops the developer's ${k} about her`, async () => {
          const w = await world(off);
          const loaded = seen(); await settle();
          await db.call.update({ where: { id: w.call.id }, data: { payBy: new Date(Date.now() - 60_000) } });
          expect(await autoChargeCalls(new Date())).toBeGreaterThanOrEqual(1);
          await settle();
          await stopsOnce(w, off, loaded, devPress[k](w), [/^Ana Silva's call on .+ was charged automatically: \$15\.00$/], DEV_TAILS[k]);
        });
      }
    });

    describe("4. the payment's tester leaving", () => {
      for (const k of ["pay", "payMore", "confirm"] as const) {
        it(`Ana leaves: ${k} on her part`, async () => {
          const w = await world(off);
          const loaded = seen(); await settle();
          expect((await testerPress.leave(w).go({ seenAt: seen(), confirmed: true })).status).toBe(200);
          await settle();
          // (§340) Confirm with your bank follows the "Testers leaving" tick: through with Alerts Off, stopped (not forced) with it on.
          if (k === "confirm" && off) return goesAhead(w, loaded, devPress.confirm(w));
          await stopsOnce(w, off, loaded, devPress[k](w), ["Ana Silva left the test"], DEV_TAILS[k], k !== "confirm");
        });
      }
    });

    describe("5. §362 same-part stops", () => {
      /** Ana sent her written answers and a recording (one file), both paid $10.00 unless `unpaid`. */
      async function sent(unpaid = false) {
        const w = await world(off);
        await db.recording.create({ data: { contractId: w.ana.sessionId, submissionId: w.anaRec.id, storageKey: "k/clip.mp4", filename: "clip.mp4", sizeBytes: 1000, contentType: "video/mp4", part: "recording", uploadedAt: new Date() } });
        if (!unpaid) {
          expect((await act(w.testId, "pay-extra", w.dev.cookie, { contractId: w.ana.sessionId, submissionId: w.anaSub.id, amount: "6.00", tickedCents: 600, payKey: randomUUID(), seenAt: seen(), confirmed: true })).status).toBe(200);
          expect((await devPress.pay(w).go({ seenAt: seen(), confirmed: true })).status).toBe(200);
        }
        await settle();
        return w;
      }
      async function addRecording(w: W) {
        const r = await sact(w.ana.sessionId, "recording-start", w.ana.tester.cookie, { filename: "run.mp4", size: 1000, contentType: "video/mp4" });
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        expect((await sact(w.ana.sessionId, "recording-done", w.ana.tester.cookie, { recordingId: r.body.recordingId })).status).toBe(200);
      }
      const more = (w: W, submissionId: string, extra: Record<string, unknown> = {}) => act(w.testId, "pay-extra", w.dev.cookie, { contractId: w.ana.sessionId, submissionId, amount: "2.00", tickedCents: 200, payKey: randomUUID(), seenAt: seen(), confirmed: true, ...extra }) as Promise<Res>;
      const recSend = (w: W, add: boolean): Press => ({ path: `/api/sessions/${w.ana.sessionId}/recording-send`, body: add ? { add: true } : {}, go: (x) => sact(w.ana.sessionId, "recording-send", w.ana.tester.cookie, { ...(add ? { add: true } : {}), ...x }) as Promise<Res> });

      it("Ana's Add on her written answers after a Pay more on them", async () => {
        const w = await sent();
        const loaded = seen(); await settle();
        expect((await more(w, w.anaSub.id)).status).toBe(200);
        await settle();
        await stopsOnce(w, off, loaded, testerPress.add(w), ["Nora Lane paid you $2.00 more for your written answers"], TESTER_TAILS.add);
      });
      for (const add of [false, true]) {
        it(`Ana's recording ${add ? "Add" : "Send"} after a Pay more on her recording`, async () => {
          const w = await sent();
          await addRecording(w);
          const loaded = seen(); await settle();
          expect((await more(w, w.anaRec.id)).status).toBe(200);
          await settle();
          await stopsOnce(w, off, loaded, recSend(w, add), ["Nora Lane paid you $2.00 more for your recording"], add ? "Press Add again to go ahead." : "Press Send again to go ahead.");
        });
      }
      it("Ana's Dispute on her written answers after a Pay more on them", async () => {
        const w = await sent();
        const loaded = seen(); await settle();
        expect((await more(w, w.anaSub.id)).status).toBe(200);
        await settle();
        await stopsOnce(w, off, loaded, testerPress.dispute(w), ["Nora Lane paid you $2.00 more for your written answers"], TESTER_TAILS.dispute);
      });
      it("Needs you's Pay on her recording after she added to it (\"Work sent\" ignored or not)", async () => {
        const w = await sent(true);
        const loaded = seen(); await settle();
        await addRecording(w);
        expect((await recSend(w, true).go({ seenAt: seen(), confirmed: true })).status).toBe(200);
        await settle();
        const p = devPress.pay(w);
        await stopsOnce(w, off, loaded, { ...p, body: { ...p.body, from: "needs" }, go: (x) => p.go({ from: "needs", ...x }) }, [NEEDS_REC_LINE], DEV_TAILS.pay);
      });
      it("the Testers list's Pay more after she added to her written answers: goes ahead with \"Work sent\" ignored, stops (not forced) with it on", async () => {
        const w = await sent();
        const loaded = seen(); await settle();
        expect((await addTo(w.ana.sessionId, w.ana.tester.cookie, { text: "An addition after the payment.", seenAt: seen(), confirmed: true })).status).toBe(200);
        await settle();
        const body = { contractId: w.ana.sessionId, submissionId: w.anaSub.id, amount: "1.00", tickedCents: 100, payKey: randomUUID() };
        const row: Press = { path: `/api/tests/${w.testId}/pay-extra`, body, go: (x) => act(w.testId, "pay-extra", w.dev.cookie, { ...body, ...x }) as Promise<Res> };
        if (off) return goesAhead(w, loaded, row);
        await stopsOnce(w, off, loaded, row, [NEEDS_WRITTEN_LINE], DEV_TAILS.payMore, false);
      });
      it("Needs you's Pay on her written answers after she added to them stops once even with \"Work sent\" ignored", async () => {
        const w = await sent();
        const loaded = seen(); await settle();
        expect((await addTo(w.ana.sessionId, w.ana.tester.cookie, { text: "An addition after the payment.", seenAt: seen(), confirmed: true })).status).toBe(200);
        await settle();
        const body = { contractId: w.ana.sessionId, submissionId: w.anaSub.id, amount: "1.00", tickedCents: 100, payKey: randomUUID(), from: "needs", press: "Pay" };
        await stopsOnce(w, off, loaded, { path: `/api/tests/${w.testId}/pay-extra`, body, go: (x) => act(w.testId, "pay-extra", w.dev.cookie, { ...body, ...x }) as Promise<Res> }, [NEEDS_WRITTEN_LINE], "Press Pay again to go ahead.");
      });
    });

    describe("6. one ordinary line per button: stops with its tick on, goes ahead with it off", () => {
      for (const k of Object.keys(devPress) as (keyof typeof devPress)[]) {
        it(`Ben adds to his answers: the developer's ${k} about Ana`, async () => {
          const w = await world(off);
          const loaded = seen(); await settle();
          expect((await addTo(w.ben.sessionId, w.ben.tester.cookie, { text: "Something more to say here.", seenAt: seen(), confirmed: true })).status).toBe(200);
          await settle();
          if (off) return goesAhead(w, loaded, devPress[k](w));
          await stopsOnce(w, off, loaded, devPress[k](w), ["Ben Okafor added to his answer to “What did you like?”"], DEV_TAILS[k], false);
        });
      }
      for (const k of Object.keys(testerPress) as (keyof typeof testerPress)[]) {
        it(`the developer pays Ana's recording: her ${k}`, async () => {
          const w = await world(off);
          const loaded = seen(); await settle();
          expect((await devPress.pay(w).go({ seenAt: seen(), confirmed: true })).status).toBe(200);
          await settle();
          if (off) return goesAhead(w, loaded, testerPress[k](w));
          await stopsOnce(w, off, loaded, testerPress[k](w), ["Nora Lane paid $10.00 for your recording"], TESTER_TAILS[k], false);
        });
      }
    });
  });
}
