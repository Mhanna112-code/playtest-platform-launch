import { HttpError, handle, ok, readJson } from "@/lib/server/http";
import { devCancelCall, offerTimes, removeTime, reportNoShow } from "@/lib/server/calls";
import { sendMessage } from "@/lib/server/messages";
import { editTest, endEarly, joinTest, nextRound, openDraft, stopTest } from "@/lib/server/tests";
import { requireActive } from "@/lib/server/users";

type Ctx = { params: Promise<{ id: string; action: string }> };

// Developer actions on their test, and the tester's Join. Every one re-checks on the server.
export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id, action } = await params;
    const u = await requireActive(req);
    const body = await readJson(req);
    switch (action) {
      case "edit": {
        const t = await editTest(u, id, body);
        return ok({ version: t.version });
      }
      case "open":
        await openDraft(u, id);
        return ok({ ok: true });
      case "stop":
        return ok(await stopTest(u, id, body));
      case "end-early":
        return ok(await endEarly(u, id, body));
      case "next-round":
        return ok(await nextRound(u, id, body));
      case "offer-times":
        return ok(await offerTimes(u, id, body));
      case "remove-time":
        return ok(await removeTime(u, id, body));
      case "cancel-call":
        return ok(await devCancelCall(u, id, body));
      case "no-show":
        return ok(await reportNoShow(u, String(body.callId ?? ""), body));
      case "message": {
        const m = await sendMessage(u, String(body.contractId ?? ""), body.body);
        return ok({ id: m.id });
      }
      case "join": {
        const c = await joinTest(u, id, body);
        return ok({ sessionId: c.id });
      }
    }
    throw new HttpError(404, "not_found", "That action doesn't exist.");
  });
}
