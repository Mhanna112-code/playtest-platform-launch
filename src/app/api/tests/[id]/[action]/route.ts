import { HttpError, handle, ok, readJson } from "@/lib/server/http";
import { devCancelCall, offerTimes, removeTime, reportNoShow, setCallLength } from "@/lib/server/calls";
import { cancelInvite, inviteTesters } from "@/lib/server/invites";
import { apply, decideApplication, join, withdrawApplication } from "@/lib/server/joining";
import { addDevSide } from "@/lib/server/payments";
import { sendChat, sendMessage } from "@/lib/server/messages";
import { editTest, endEarly, nextRound, openDraft, stopTest } from "@/lib/server/tests";
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
        return ok({ version: t.version, offered: (t as { offered?: number }).offered ?? 0 });
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
      case "call-length":
        return ok(await setCallLength(u, id, body));
      case "no-show":
        return ok(await reportNoShow(u, String(body.callId ?? ""), body));
      case "dispute-side":
        return ok(await addDevSide(u, id, body));
      case "invite":
        return ok(await inviteTesters(u, id, body));
      case "cancel-invite":
        return ok(await cancelInvite(u, id, body));
      case "message": {
        const m = body.testerId ? await sendChat(u, id, String(body.testerId), body.body) : await sendMessage(u, String(body.contractId ?? ""), body.body);
        return ok({ id: m.id });
      }
      case "join": {
        const c = await join(u, id, body);
        return ok({ sessionId: c.id });
      }
      case "apply":
        return ok(await apply(u, id, body));
      case "withdraw-application":
        return ok(await withdrawApplication(u, id));
      case "application":
        return ok(await decideApplication(u, id, body));
    }
    throw new HttpError(404, "not_found", "That action doesn't exist.");
  });
}
