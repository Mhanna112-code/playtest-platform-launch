import { HttpError, handle, ok, readJson } from "@/lib/server/http";
import { reportNoShow, testerCancelCall } from "@/lib/server/calls";
import { sendMessage } from "@/lib/server/messages";
import { finishRecording, sendRecording, startRecording } from "@/lib/server/recordings";
import { chooseOutcome } from "@/lib/server/holds";
import { answerRequest, requestTime } from "@/lib/server/requests";
import { decideTerms } from "@/lib/server/terms";
import { openDispute } from "@/lib/server/payments";
import { leaveTest, sendWritten } from "@/lib/server/tests";
import { requireActive } from "@/lib/server/users";
import { logTesterAction } from "@/lib/server/actionText";

type Ctx = { params: Promise<{ id: string; action: string }> };

// Tester actions on their own session (contract).
export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id, action } = await params;
    const u = await requireActive(req);
    const body = await readJson(req);
    const res = await run(u, id, action, body);
    const data = await res.clone().json().catch(() => null);
    if (res.ok) await logTesterAction(u.id, id, action, body, data);
    return res;
  });
}

async function run(u: Awaited<ReturnType<typeof requireActive>>, id: string, action: string, body: Record<string, unknown>) {
  {
    switch (action) {
      case "leave":
        return ok(await leaveTest(u, id, body));
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
