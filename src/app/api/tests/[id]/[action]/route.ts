import { db } from "@/lib/db";
import { gapsOf } from "@/lib/gaps";
import { HttpError, handle, ok, readJson } from "@/lib/server/http";
import { devCancelCall, reportNoShow, setCallLength } from "@/lib/server/calls";
import { cancelInvite, inviteGaps, inviteTesters } from "@/lib/server/invites";
import { answerRequest, devRequestTime } from "@/lib/server/requests";
import { apply, decideApplication, join, withdrawApplication } from "@/lib/server/joining";
import { addDevSide } from "@/lib/server/payments";
import { sendChat, sendMessage } from "@/lib/server/messages";
import { editTest, endEarly, nextRound, openDraft, stopTest } from "@/lib/server/tests";
import { requireActive, requireConfirmed } from "@/lib/server/users";

// (NEWEST+8) Presses that need a confirmed email.
const NEEDS_CONFIRMED = new Set(["edit", "invite", "request-time", "answer-request", "join", "apply", "application", "rate", "call-length"]);
import { devRate } from "@/lib/server/ratings";
import { logTestAction } from "@/lib/server/actionText";

type Ctx = { params: Promise<{ id: string; action: string }> };

// Developer actions on their test, and the tester's Join. Every one re-checks on the server.
export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id, action } = await params;
    const u = await requireActive(req);
    const body = await readJson(req);
    if (NEEDS_CONFIRMED.has(action)) requireConfirmed(u);
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
      case "rate":
        return ok(await devRate(u, id, body));
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
      case "my-gaps": {
        // The join page's "What this test needs" pop-up checks the profile and the test again while it is open.
        const t = await db.test.findUniqueOrThrow({ where: { id } });
        return ok({ gaps: gapsOf(t, await db.testerProfile.findUnique({ where: { userId: u.id } })) });
      }
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
