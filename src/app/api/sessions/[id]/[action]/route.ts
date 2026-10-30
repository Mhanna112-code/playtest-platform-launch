import { HttpError, handle, ok, readJson } from "@/lib/server/http";
import { reportNoShow, testerCancelCall } from "@/lib/server/calls";
import { sendMessage } from "@/lib/server/messages";
import { abandonUpload, finishRecording, sendRecording, removeRecording, startRecording } from "@/lib/server/recordings";
import { chooseOutcome } from "@/lib/server/holds";
import { answerRequest, cancelCallSet, requestTime } from "@/lib/server/requests";
import { decideTerms } from "@/lib/server/terms";
import { openDispute } from "@/lib/server/payments";
import { reportKeyBroken } from "@/lib/server/accessKeys";
import { db } from "@/lib/db";
import { displayName, fmtDate, stopTimeIn } from "@/lib/format";
import { CALL_CANCELLED_BY_STOP, LIMITED_CHOICE_REFUSAL, RATE_INACTIVE, PAUSE_DEFAULTS, PAUSED_SEND, WORK_OVER_ACTIONS, testerPaused, testerRefusal, workOver, workOverLine, workOverPress } from "@/lib/rules";
import { loadedOf, stopBox, testerPauseSince, testerStopSince } from "@/lib/server/stopMoment";
import { requireUser } from "@/lib/server/session";
import { leaveTest, sendWritten } from "@/lib/server/tests";
import { requireActive, requireConfirmed } from "@/lib/server/users";

// (Owner, Oct 27) No press on a session needs a confirmed email any more (only Post a test, Join, Apply and accepting an invite do).
const NEEDS_CONFIRMED = new Set<string>();
import { maybePromptRating, testerRate } from "@/lib/server/ratings";
import { logTesterAction } from "@/lib/server/actionText";

type Ctx = { params: Promise<{ id: string; action: string }> };

/**
 * (Owner, Oct 26) When the test was stopped or the tester's work was ended while the page is open, every later press is a FINAL
 * refusal (not a stop-once): Send, any call action, Switch / Keep, Request, uploads, "This key doesn't work". (Charge / Let it go, Dispute, Rate,
 * Report a problem, chat and excerpts keep their own rules.) (Owner, Oct 28, batch 16 section 24) After a stop, a closure or an early end the refusal
 * names the press ("Nora Lane stopped the test on Nov 3, so your Send didn't go through. Work you sent is still reviewed.") with the code
 * "work_over": the page moves to its top, where the stopped line says the same. A leave, a rating or a block keep their own (neutral) line.
 */
const FINAL_AFTER_END = new Set<string>(WORK_OVER_ACTIONS);
async function finalRefusal(userId: string, contractId: string, action: string, body: Record<string, unknown>) {
  if (!FINAL_AFTER_END.has(action)) return;
  const c = await db.contract.findUnique({ where: { id: contractId }, include: { test: { include: { developer: true } } } });
  if (!c || c.testerId !== userId || c.status === "working") return;
  const dev = displayName(c.test.developer);
  // (Batch 26 section 3) A team Stop reads "This test was stopped at 3:10 PM" (the tester's own zone), never who.
  const tz = (await db.user.findUnique({ where: { id: userId }, select: { timeZone: true } }))?.timeZone;
  const ctx = { ...c, teamTime: c.endedAt ? stopTimeIn(c.endedAt, tz) : undefined };
  if (workOver(c)) {
    // (Batch 17 section 12) Cancel call from a page opened before the stop: the stop already cancelled the calls ahead.
    if (action === "cancel-call" || action === "cancel-set") throw new HttpError(409, "call_cancelled", CALL_CANCELLED_BY_STOP);
    const press = workOverPress(action, body);
    throw new HttpError(409, "work_over", workOverLine(ctx, dev, fmtDate, press), { failed: press, top: true });
  }
  const line = testerRefusal(ctx, { openUntil: null }, dev, fmtDate, new Date());
  if (line) throw new HttpError(409, "gone", line);
}

/**
 * (Owner, Oct 28 afternoon) A paused test (the developer's payment hold, chargeback hold or suspension; the team's pause too, PAUSE_DEFAULTS.teamPauseSameRules): testers can't send
 * work. Drafts can still be written and saved (PAUSE_DEFAULTS.draftsEditable: the written answers are kept as typed, recordings can be uploaded); Charge / Let it go, disputes,
 * rating, leaving and cancelling calls carry on under their own rules. Testers read only "paused". (Batch 15 section 1) Chat isn't closed by a paused test: only while a
 * person is restricted (messages.ts).
 */
const SEND_ACTIONS = new Set(["written", "recording-send"]);
const DRAFT_ACTIONS = new Set(["recording-start", "recording-done", "recording-remove"]);
async function pausedRefusal(userId: string, contractId: string, action: string) {
  if (!SEND_ACTIONS.has(action) && !DRAFT_ACTIONS.has(action)) return;
  const c = await db.contract.findUnique({ where: { id: contractId }, select: { testerId: true, test: { select: { adminPausedAt: true, developer: { select: { devSuspendedAt: true, holdStartedAt: true } } } } } });
  if (!c || c.testerId !== userId || !testerPaused(c.test.developer, c.test)) return;
  if (SEND_ACTIONS.has(action) || !PAUSE_DEFAULTS.draftsEditable) throw new HttpError(409, "paused", PAUSED_SEND);
}

/**
 * (Owner, Oct 29, batch 29 section 11; replaces batch 16 section 25's "goes through on the first press") On a stopped, closed or paused test (any cause) and after the
 * tester's work ended, every press still allowed follows the same stop-once rules as on a running test. The stop, close, early end or pause itself is a change like any
 * other: a press on a page opened before it stops once naming it ("Nora Lane stopped this test at 3:10 PM.", "This test was paused at 3:10 PM."); the second goes ahead.
 * Rate checks the same in its own gate (its short list: no pause); Leave and Block never stop; chat and the excerpt presses keep their own rules.
 */
const MOMENT_ACTIONS = new Set(["choose", "dispute", "cancel-call", "cancel-set", "request-time", "answer-request", "terms"]);
async function stateMoment(contractId: string, action: string, body: Record<string, unknown>) {
  if (!MOMENT_ACTIONS.has(action)) return;
  const loaded = loadedOf(body);
  const stop = (await testerStopSince(contractId, loaded)) ?? (await testerPauseSince(contractId, loaded));
  if (stop) stopBox([stop]);
}

/**
 * (Owner, Oct 28, batch 16 section 28; batch 17 section 10) A suspended tester side: the tests they were removed from open in a limited view where Dispute is the only
 * press, under the same stop-once rules as everywhere (batch 29 section 11). Charge, Let it go and Rate are hidden there and refused here (nothing is lost: Charge never
 * happens on its own, so what was open is still open after the reinstatement). Every other press stays refused while suspended (excerpt requests too, through their
 * own route, until the suspension lifts).
 */
const LIMITED_ACTIONS = new Set(["dispute"]);
async function limitedUser(req: Request, contractId: string, action: string) {
  if (action === "choose" || action === "rate") {
    const me = await requireUser(req);
    if (me.testerSuspendedAt) throw new HttpError(409, "inactive", action === "rate" ? RATE_INACTIVE : LIMITED_CHOICE_REFUSAL);
  }
  if (!LIMITED_ACTIONS.has(action)) return null;
  const u = await requireUser(req);
  if (!u.testerSuspendedAt) return null;
  const c = await db.contract.findUnique({ where: { id: contractId }, select: { testerId: true, endKind: true, status: true } });
  return c && c.testerId === u.id && c.status !== "working" && c.endKind === "suspended" ? u : null;
}

// Tester actions on their own session (contract).
export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id, action } = await params;
    const u = (await limitedUser(req, id, action)) ?? (await requireActive(req));
    const body = await readJson(req, 900_000); // (batch 14; batch 15) a written part of up to 50,000 characters, with the question set it answers (20 × 20,000)
    if (NEEDS_CONFIRMED.has(action)) requireConfirmed(u);
    await finalRefusal(u.id, id, action, body);
    await pausedRefusal(u.id, id, action);
    // (Batch 17 section 12; batch 29 section 11) A press on a page opened before the test stopped, closed, paused or this tester's work ended: it stops once with that
    // as the change (the second press goes ahead).
    await stateMoment(id, action, body);
    const res0 = await run(u, id, action, body);
    const data = await res0.clone().json().catch(() => null);
    // A rename the page hadn't shown: the press went ahead; the note goes under the button.
    const res = res0.ok && typeof body.__note === "string" && data && typeof data === "object" ? ok({ ...data, note: body.__note }) : res0;
    if (res.ok) await logTesterAction(u.id, id, action, body, data);
    if (res.ok && action === "choose") await maybePromptRating(id);
    return res;
  });
}

async function run(u: Awaited<ReturnType<typeof requireActive>>, id: string, action: string, body: Record<string, unknown>) {
  {
    switch (action) {
      case "leave":
        return ok(await leaveTest(u, id, body));
      case "dismiss-removed": {
        // (Owner, Oct 28) After a reinstatement the "You were removed from this test" card stays on the dashboard until the tester asks to rejoin or dismisses it.
        const c = await db.contract.findUnique({ where: { id } });
        if (!c || c.testerId !== u.id || c.endKind !== "suspended") throw new HttpError(404, "not_found", "That card isn't there any more.");
        await db.contract.update({ where: { id }, data: { removedDismissedAt: new Date() } });
        return ok({ dismissed: true });
      }
      case "key-broken":
        return ok(await reportKeyBroken(u, id));
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
      case "message": {
        const m = await sendMessage(u, id, body.body, body.clientId);
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
    }
    throw new HttpError(404, "not_found", "That action doesn't exist.");
  }
}
