import { HttpError, handle, ok, readJson } from "@/lib/server/http";
import { reportNoShow, testerCancelCall } from "@/lib/server/calls";
import { sendMessage } from "@/lib/server/messages";
import { finishRecording, sendRecording, startRecording } from "@/lib/server/recordings";
import { chooseOutcome } from "@/lib/server/holds";
import { answerRequest, cancelCallSet, requestTime } from "@/lib/server/requests";
import { decideTerms } from "@/lib/server/terms";
import { openDispute } from "@/lib/server/payments";
import { reportKeyBroken } from "@/lib/server/accessKeys";
import { db } from "@/lib/db";
import { displayName, fmtDate } from "@/lib/format";
import { testerRefusal } from "@/lib/rules";
import { leaveTest, sendWritten } from "@/lib/server/tests";
import { requireActive, requireConfirmed } from "@/lib/server/users";

// (NEWEST+8) Presses that need a confirmed email.
const NEEDS_CONFIRMED = new Set(["written", "recording-start", "recording-send", "request-time", "answer-request", "choose", "rate"]);
import { maybePromptRating, testerRate } from "@/lib/server/ratings";
import { logTesterAction } from "@/lib/server/actionText";

type Ctx = { params: Promise<{ id: string; action: string }> };

/**
 * (Owner, Oct 26) When the test was stopped or the tester's work was ended while the page is open, every later press is a FINAL
 * refusal, blue under the button (not a stop-once): Send, any call action, Switch / Keep, Request. (Charge / Let it go, Dispute, Rate,
 * Report a problem, chat and Leave keep their own rules.)
 */
const FINAL_AFTER_END = new Set(["terms", "written", "recording-start", "recording-done", "recording-send", "request-time", "answer-request", "cancel-call", "cancel-set", "key-broken"]);
async function finalRefusal(userId: string, contractId: string, action: string) {
  if (!FINAL_AFTER_END.has(action)) return;
  const c = await db.contract.findUnique({ where: { id: contractId }, include: { test: { include: { developer: true } } } });
  if (!c || c.testerId !== userId || c.status === "working") return;
  const line = testerRefusal(c, { openUntil: null }, displayName(c.test.developer), fmtDate, new Date());
  if (line) throw new HttpError(409, "gone", line);
}

// Tester actions on their own session (contract).
export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id, action } = await params;
    const u = await requireActive(req);
    const body = await readJson(req);
    if (NEEDS_CONFIRMED.has(action)) requireConfirmed(u);
    await finalRefusal(u.id, id, action);
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
      case "message": {
        const m = await sendMessage(u, id, body.body);
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
