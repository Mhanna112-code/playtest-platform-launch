import { limitedTesterSession } from "@/lib/limitedTesterSession";
import { HttpError, handle, ok, readJson } from "@/lib/server/http";
import { notListed, sidOf } from "@/lib/server/shownLines";
import { reportNoShow, testerCancelCall } from "@/lib/server/calls";
import { sendMessage } from "@/lib/server/messages";
import { abandonUpload, finishRecording, sendRecording, removeRecording, startRecording, uploadAlive } from "@/lib/server/recordings";
import { chooseOutcome } from "@/lib/server/holds";
import { alreadyDone, answerRequest, cancelCallSet, requestTime } from "@/lib/server/requests";
import { closeOffersOfEnded, decideTerms, ndaBlockFirst } from "@/lib/server/terms";
import { openDispute } from "@/lib/server/payments";
import { db } from "@/lib/db";
import { NDA_FREE } from "@/lib/ndaNotice";
import { displayName, fmtDate, stopTimeIn } from "@/lib/format";
import { PAUSE_DEFAULTS, WORK_OVER_ACTIONS, testerPaused, testerRefusal, workOver, workOverLine, workOverPress } from "@/lib/rules";
import { loadedOf, stopBox, testerStopSince } from "@/lib/server/stopMoment";
import { requireUser } from "@/lib/server/session";
import { testerBoxRule, testerGate } from "@/lib/server/testerGate";
import { addWritten, leaveTest, sendWritten } from "@/lib/server/tests";
import { requireActive, requireConfirmed } from "@/lib/server/users";

/** (Owner, Nov 5, §267 / §268) The presses the NDA block never stops: Rate and Leave, the notice's Acknowledge (§302), the terms pill, and an upload already under way. */
const NDA_FREE_SET = new Set(NDA_FREE);
// (Owner, Oct 27) No press on a session needs a confirmed email any more (only Post a test, Join, Apply and accepting an invite do).
const NEEDS_CONFIRMED = new Set<string>();
/** (Owner, Nov 11, §375) The presses made in one pass under the test's lock: they check part over, paused and the NDA themselves. */
const ONE_PASS = new Set(["written", "written-add", "recording-send"]);
import { maybePromptRating, testerRate } from "@/lib/server/ratings";
import { logTesterAction } from "@/lib/server/actionText";

import * as RF from "@/lib/refusal";
import { overPressLine } from "@/lib/rules";
type Ctx = { params: Promise<{ id: string; action: string }> };


/**
 * (Owner, Oct 26) When the test was stopped or the tester's work was ended while the page is open, every later press is a FINAL
 * refusal (not a stop-once): Send, any call action, Switch / Keep, Request, uploads ((Owner, Nov 6, §304) "This key doesn't work" is gone). (Charge / Let it go, Dispute, Rate,
 * Report a problem, chat and excerpts keep their own rules.) (Owner, Oct 28, batch 16 section 24) After a stop, a closure or an early end the refusal
 * names the press ("Nora Lane stopped the test on Nov 3, so your Send didn't go through. Work you sent is still reviewed.") with the code
 * "work_over": the page moves to its top, where the stopped line says the same. A leave, a rating or a block keep their own (neutral) line.
 */
const FINAL_AFTER_END = new Set<string>(WORK_OVER_ACTIONS);
/** (§380 H) The call presses among them. */
const CALL_PRESS_ACTIONS = new Set(["request-time", "answer-request", "cancel-call", "cancel-set"]);
async function finalRefusal(userId: string, contractId: string, action: string, body: Record<string, unknown>) {
  if (!FINAL_AFTER_END.has(action)) return;
  const c = await db.contract.findUnique({ where: { id: contractId }, include: { test: { include: { developer: true } } } });
  if (!c || c.testerId !== userId || c.status === "working") return;
  // (Owner, Nov 2, batch 35 §118; replaces batch 16 §24 for Switch / Keep) Once the part has ended (rated, left, removed, stopped, ended early, the work window
  // ended) its terms offer is closed: an old page's Switch or Keep gets the one plain line, whatever ended it.
  if (action === "terms") {
    await closeOffersOfEnded(db, [contractId], c.endedAt ?? new Date());
    throw new HttpError(409, "gone", overPressLine(c, workOverPress(action, body))); // (§364: "Your part in this test has ended, so your Switch …"; a stop: §363)
  }
  const dev = displayName(c.test.developer);
  // (Batch 26 section 3) A team Stop reads "This test was stopped at 3:10 PM" (the tester's own zone), never who.
  const tz = (await db.user.findUnique({ where: { id: userId }, select: { timeZone: true } }))?.timeZone;
  const ctx = { ...c, teamTime: c.endedAt ? stopTimeIn(c.endedAt, tz) : undefined };
  if (workOver(c)) {
    // (Batch 17 section 12) Cancel call from a page opened before the stop: the stop already cancelled the calls ahead.
    // (Owner, Nov 9, §363 and §364) Cancel call too: the one line by why (stopped / ended / your part ended), naming the press.
    const press = workOverPress(action, body);
    throw new HttpError(409, "work_over", workOverLine(ctx, dev, fmtDate, press), { failed: press, top: true });
  }
  // (Owner, Nov 11, §380 H) A call press on a part the tester's OWN block ended: "You blocked Nora Lane, so your Request a time didn't go through."
  if (c.endKind === "blocked" && CALL_PRESS_ACTIONS.has(action)) await (await import("@/lib/server/blocks")).ownBlockStop(userId, c.test.developerId, dev, workOverPress(action, body));
  // (§364 item 3) Left, rated or blocked: "Your part in this test has ended, so your Send didn't go through."
  if (testerRefusal(ctx, { openUntil: null }, dev, fmtDate, new Date())) throw new HttpError(409, "gone", overPressLine(c, workOverPress(action, body)));
}

/**
 * (Owner, Oct 28 afternoon) A paused test (the developer's payment hold, chargeback hold or suspension; the team's pause too, PAUSE_DEFAULTS.teamPauseSameRules): testers can't send
 * work. Drafts can still be written and saved (PAUSE_DEFAULTS.draftsEditable: the written answers are kept as typed, recordings can be uploaded); Charge / Let it go, disputes,
 * rating, leaving and cancelling calls carry on under their own rules. Testers read only "paused". (Batch 15 section 1) Chat isn't closed by a paused test: only while a
 * person is restricted, or (owner, Nov 4, §172) the team paused the test (messages.ts).
 */
const SEND_ACTIONS = new Set(["written", "written-add", "recording-send"]); // (batch 35 §136) adding follows Send's windows
const DRAFT_ACTIONS = new Set(["recording-start", "recording-done", "recording-remove"]);
async function pausedRefusal(userId: string, contractId: string, action: string, body: Record<string, unknown>) {
  if (!SEND_ACTIONS.has(action) && !DRAFT_ACTIONS.has(action)) return;
  const c = await db.contract.findUnique({ where: { id: contractId }, select: { testerId: true, test: { select: { adminPausedAt: true, developer: { select: { devSuspendedAt: true, holdStartedAt: true } } } } } });
  if (!c || c.testerId !== userId || !testerPaused(c.test.developer, c.test)) return;
  if (SEND_ACTIONS.has(action) || !PAUSE_DEFAULTS.draftsEditable) throw new HttpError(409, "paused", RF.pressRefused(RF.PAUSED_CAUSE, workOverPress(action, body))); // (§364 item 5)
}

/** The remaining session actions that check for an unseen end of work. */
const MOMENT_ACTIONS = new Set(["dispute", "cancel-call", "cancel-set", "request-time", "answer-request", "terms"]);
async function stateMoment(contractId: string, action: string, body: Record<string, unknown>) {
  if (!MOMENT_ACTIONS.has(action)) return;
  const loaded = loadedOf(body);
  const stop = await testerStopSince(contractId, loaded);
  // (Owner, Nov 5, §250) A moment a stop box on this page already listed is seen: the press follows its usual gate.
  const found = notListed(stop ? [stop] : [], body);
  if (!found.length) return;
  // (Batch 30, Oct 29 addition) ONE box: the stop with every other change the page hadn't shown (the press's own reasons), oldest first; the second press goes ahead.
  const c = await db.contract.findUnique({ where: { id: contractId }, select: { testerId: true, testId: true } });
  // (Owner, Nov 10, §374) The part the press is about: Dispute's piece (submission or call id). Its own gate stops for a developer payment on that part whatever
  // the Alerts (§362, lib/server/payments.ts), so this box lists one too, and its rule lets one picked up live join it; a payment on another part never does.
  const part = action === "dispute" && typeof body.id === "string" && body.id ? body.id : undefined;
  let more: { text: string; at: Date | string }[] = [];
  let extra: Record<string, unknown> = {};
  if (c) {
    try {
      await testerGate(c.testerId, contractId, c.testId, body, undefined, { skipTerms: action === "terms", ...(part ? { piece: part } : {}) });
    } catch (e) {
      if (e instanceof HttpError && e.code === "stop_once" && Array.isArray(e.data?.changes)) {
        more = e.data.changes as typeof more;
        // (§373) And the rule that box was built under: the lines the page picks up while it is open follow it (lib/live.ts boxKeeps).
        extra = { top: e.data.top === true, alertsOff: e.data.alertsOff === true, ...(e.data.liveRule ? { liveRule: e.data.liveRule } : {}) };
      } else throw e;
    }
  }
  // (§374) The gate added no lines: the box is the stop alone, and still carries her Alerts and its rule (it used to carry neither, so with Alerts Off it took in
  // every live line, a payment on another part included).
  if (!more.length) stopBox(found, c ? await testerBoxRule(c.testerId, part) : {});
  const lines = [...found.map((m) => ({ text: m.text, at: m.createdAt, ...sidOf(m), kind: "stop", forced: true })), ...more].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  throw new HttpError(409, "stop_once", "Press again to go ahead.", { changes: lines, tail: "Press again to go ahead.", ...extra });
}

/**
 * (Owner, Oct 28, batch 16 section 28; batch 17 section 10) A suspended tester side: all their own sessions open in a limited view where Dispute is the only
 * press, under the same stop-once rules as everywhere (batch 29 section 11). Charge, Let it go and Rate are hidden there and refused here (nothing is lost: Charge never
 * happens on its own, so what was open is still open after the reinstatement). Every other press stays refused while suspended (excerpt requests too, through their
 * own route, until the suspension lifts).
 */
const LIMITED_ACTIONS = new Set(["dispute"]);
async function limitedUser(req: Request, contractId: string, action: string) {
  if (action === "choose" || action === "rate") {
    const me = await requireUser(req);
    // (§364 item 8) "Your account is paused, so your Rate didn't go through." (Charge or Let it go, by the body's choice).
    if (me.testerSuspendedAt) throw new HttpError(409, "inactive", RF.pressRefused(RF.ACCOUNT_PAUSED_CAUSE, action === "rate" ? "Rate" : (await req.clone().json().catch(() => ({})) as { choice?: unknown }).choice === "letgo" ? "Let it go" : "Charge"));
  }
  if (!LIMITED_ACTIONS.has(action)) return null;
  const u = await requireUser(req);
  if (!u.testerSuspendedAt) return null;
  const c = await db.contract.findUnique({ where: { id: contractId }, select: { testerId: true, endKind: true, status: true } });
  return c && limitedTesterSession(u, c) ? u : null;
}

// Tester actions on their own session (contract).
export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id, action } = await params;
    const u = (await limitedUser(req, id, action)) ?? (await requireActive(req));
    const body = await readJson(req, 900_000); // (batch 14; batch 15) a written part of up to 20,000 characters (§186; was 50,000), with the question set it answers (20 × 20,000)
    if (NEEDS_CONFIRMED.has(action)) requireConfirmed(u);
    // (Owner, Nov 11, §380) Already what the press wanted (a cancelled call, a set with nothing left, a closed request of hers): silent, before any refusal.
    const done = await alreadyDone("tester", { contractId: id }, action, body);
    if (done) return ok(done);
    // (Owner, Nov 11, §375) Send Answers, Add to this answer and a recording's Send / Add make ONE pass under the test's lock (lib/server/tests.ts onePass): part
    // over, paused and the NDA are checked there, in the owner's order, with the same lines and codes as here (after the drafts are saved), never before it.
    const onePass = ONE_PASS.has(action);
    // (§375) Starting an upload checks part over in its own pass under the lock too (startRecording), with the same line.
    if (!onePass && action !== "recording-start") await finalRefusal(u.id, id, action, body);
    if (!onePass) await pausedRefusal(u.id, id, action, body);
    // (Owner, Nov 5, §267; Nov 6, §302: every NDA change) An NDA change not yet acknowledged blocks every press here but Rate and Leave (§268), the
    // Acknowledge button and the pill.
    if (!NDA_FREE_SET.has(action) && !onePass) await ndaBlockFirst(id);
    await stateMoment(id, action, body);
    const res0 = await run(u, id, action, body);
    const data = await res0.clone().json().catch(() => null);
    // A rename the page hadn't shown: the press went ahead; the note goes under the button.
    const res = res0.ok && typeof body.__note === "string" && data && typeof data === "object" ? ok({ ...data, note: body.__note }) : res0;
    if (res.ok && !data?.already) await logTesterAction(u.id, id, action, body, data); // (§380) a silent no-op did nothing
    if (res.ok && action === "choose") await maybePromptRating(id);
    return res;
  });
}

async function run(u: Awaited<ReturnType<typeof requireActive>>, id: string, action: string, body: Record<string, unknown>) {
  {
    switch (action) {
      // (Owner, Nov 6, §302; was §267's link opening) The NDA notice acknowledged: from now, which lifts the block at once. (Owner, Nov 6, §314) Pressed by the
      // notice's line itself (no button); the bell's and the top box's links are navigation only.
      case "nda-seen": {
        const c = await db.contract.findUnique({ where: { id }, select: { testerId: true, ndaText: true, ndaAcceptedAt: true } });
        if (!c || c.testerId !== u.id) throw new HttpError(404, "not_found", "That session doesn't exist or isn't yours.");
        // An added NDA acknowledged counts as read and accepted ("Accepted <date>" on its line, the developer's "NDA accepted" badge).
        const now = new Date();
        await db.contract.update({ where: { id }, data: { ndaNoticeSeenAt: now, ...(c.ndaText && !c.ndaAcceptedAt ? { ndaAcceptedAt: now } : {}) } });
        return ok({ seen: true });
      }
      // (Owner, Nov 5, §268) The contract box's "New terms" pill pressed: it stays gone for this offer (a newer offer brings it back).
      case "terms-pill": {
        const c = await db.contract.findUnique({ where: { id }, select: { testerId: true } });
        if (!c || c.testerId !== u.id) throw new HttpError(404, "not_found", "That session doesn't exist or isn't yours.");
        await db.termsOffer.updateMany({ where: { contractId: id, status: "open", pillPressedAt: null }, data: { pillPressedAt: new Date() } });
        return ok({ pressed: true });
      }
      case "leave":
        return ok(await leaveTest(u, id, body));
      // (Owner, Nov 11, §380 L) "You were removed from this test" cards have no Dismiss / Dismiss all any more ("dismiss-removed" is gone).
      case "rate":
        return ok(await testerRate(u, id, body));
      case "recording-start":
        return ok(await startRecording(u, id, body));
      case "recording-done":
        return ok(await finishRecording(u, id, body));
      case "recording-send":
        return ok(await sendRecording(u, id, body));
      case "recording-remove":
        return ok(await removeRecording(u, id, body));
      case "recording-abandon":
        return ok(await abandonUpload(u, id, body));
      case "recording-alive":
        return ok(await uploadAlive(u, id, body));
      case "message": {
        const m = await sendMessage(u, id, body.body, body.clientId, body); // (§271) with the page's load time
        return ok({ id: m.id });
      }
      case "terms":
        return ok(await decideTerms(u, id, body));
      case "choose":
        return ok(await chooseOutcome(u, id, body));
      case "request-time":
        return ok(await requestTime(u, id, body));
      case "answer-request":
        return ok(await answerRequest(u, id, body));
      case "cancel-call":
        return ok(await testerCancelCall(u, id, body));
      case "cancel-set":
        return ok(await cancelCallSet(u, id, body));
      case "no-show":
        return ok(await reportNoShow(u, String(body.callId ?? ""), body));
      case "dispute": {
        const d = await openDispute(u, id, body);
        return ok({ id: d.id });
      }
      case "written": {
        const s = await sendWritten(u, id, body);
        return ok({ id: s.id });
      }
      // (Batch 35 §136) Add more on sent written answers.
      case "written-add": {
        const s = await addWritten(u, id, body);
        return ok({ id: s.id, added: true });
      }
    }
    throw new HttpError(404, "not_found", "That action doesn't exist.");
  }
}
