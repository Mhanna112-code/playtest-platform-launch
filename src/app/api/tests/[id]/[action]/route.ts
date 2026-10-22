import { HttpError, handle, ok, readJson } from "@/lib/server/http";
import { devCancelCall, reportNoShow, setCallLength } from "@/lib/server/calls";
import { cancelInvite, inviteGaps, inviteTesters } from "@/lib/server/invites";
import { answerRequest, devRequestTime } from "@/lib/server/requests";
import { apply, decideApplication, join, withdrawApplication } from "@/lib/server/joining";
import { addDevSide } from "@/lib/server/payments";
import { sendChat, sendMessage } from "@/lib/server/messages";
import { editTest, endEarly, nextRound, openDraft, stopTest } from "@/lib/server/tests";
import { requireActive } from "@/lib/server/users";
import { logTestAction } from "@/lib/server/actionText";

type Ctx = { params: Promise<{ id: string; action: string }> };

// Developer actions on their test, and the tester's Join. Every one re-checks on the server.
export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id, action } = await params;
    const u = await requireActive(req);
    const body = await readJson(req);
    const res0 = await run(u, id, action, body);
    const data = await res0.clone().json().catch(() => null);
    // A rename the page hadn't shown: the press went ahead; the note goes under the button.
    const res = res0.ok && typeof body.__note === "string" && data && typeof data === "object" ? ok({ ...data, note: body.__note }) : res0;
    if (res.ok) await logTestAction(u.id, id, action, body, data);
    return res;
  });
}

async function run(u: Awaited<ReturnType<typeof requireActive>>, id: string, action: string, body: Record<string, unknown>) {
  {
    switch (action) {
      case "edit": {
        const t = await editTest(u, id, body);
        return ok({ version: t.version, offered: (t as { offered?: number }).offered ?? 0, changed: (t as { changed?: string[] }).changed ?? [], notReinvited: (t as { notReinvited?: string[] }).notReinvited ?? [], resent: (t as { resent?: string[] }).resent ?? [], closedApps: (t as { closedApps?: string[] }).closedApps ?? [], spotClosed: (t as { spotClosed?: string[] }).spotClosed ?? [], spots: t.spots });
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
      case "request-time":
        return ok(await devRequestTime(u, id, body));
      case "answer-request":
        return ok(await answerRequest(u, String(body.contractId ?? ""), body));
      case "invite-check":
        return ok(await inviteGaps(u.id, id, Array.isArray(body.testerIds) ? body.testerIds.map(String) : []));
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
        return ok(await withdrawApplication(u, id, body));
      case "application":
        return ok(await decideApplication(u, id, body));
    }
    throw new HttpError(404, "not_found", "That action doesn't exist.");
  }
}
