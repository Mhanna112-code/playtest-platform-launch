import { HttpError, handle, ok, readJson } from "@/lib/server/http";
import { bookTime, reportNoShow, testerCancelCall } from "@/lib/server/calls";
import { sendMessage } from "@/lib/server/messages";
import { finishRecording, sendRecording, startRecording } from "@/lib/server/recordings";
import { chooseOutcome } from "@/lib/server/holds";
import { openDispute } from "@/lib/server/payments";
import { leaveTest, sendWritten } from "@/lib/server/tests";
import { requireActive } from "@/lib/server/users";

type Ctx = { params: Promise<{ id: string; action: string }> };

// Tester actions on their own session (contract).
export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id, action } = await params;
    const u = await requireActive(req);
    const body = await readJson(req);
    switch (action) {
      case "leave":
        return ok(await leaveTest(u, id));
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
      case "choose":
        return ok(await chooseOutcome(u, id, body));
      case "book":
        return ok(await bookTime(u, id, body));
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
  });
}
