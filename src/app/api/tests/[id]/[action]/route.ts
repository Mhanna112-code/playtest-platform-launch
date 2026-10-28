import { db } from "@/lib/db";
import { countsOf } from "@/lib/limits";
import { gapsOf } from "@/lib/gaps";
import { HttpError, handle, ok, readJson } from "@/lib/server/http";
import { devCancelCall, reportNoShow, setCallLength } from "@/lib/server/calls";
import { cancelInvite, inviteGaps, inviteTesters } from "@/lib/server/invites";
import { answerRequest, cancelCallSet, devRequestTime } from "@/lib/server/requests";
import { apply, askToRejoin, decideApplication, join, withdrawApplication } from "@/lib/server/joining";
import { addDevSide, payExtra } from "@/lib/server/payments";
import { sendChat, sendMessage } from "@/lib/server/messages";
import { startedCounting, asListing, deleteDraft, editTest, endEarly, nextRound, openDraft, ownTest, postDraft, stopTest } from "@/lib/server/tests";
import { keyBoxes } from "@/lib/server/accessKeys";
import { getUserFromRequest } from "@/lib/server/session";
import { failedLine, requireActive, requireConfirmed } from "@/lib/server/users";
import { RESTRICTED_OK_ACTIONS } from "@/lib/restricted";

// (Owner, Oct 27) Email confirmation is needed only for Post a test (its own route), Join (which is also accepting an invite) and Apply. A blocked press is a blue notice under the button with Resend the link.
const NEEDS_CONFIRMED = new Set(["join", "apply", "post-draft"]);
import { devRate } from "@/lib/server/ratings";
import { logTestAction } from "@/lib/server/actionText";

type Ctx = { params: Promise<{ id: string; action: string }> };

/** (Owner, Oct 27) A suspended or held developer: only Cancel call works (from the dashboard's Calls box). No Stop, no End early. */
const SUSPENDED_OK = RESTRICTED_OK_ACTIONS;

/** (Design doc 5) The Edit page's live view of the test: its listing and version, and the In use / Free access keys. */
export async function GET(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id, action } = await params;
    const u = await getUserFromRequest(req);
    if (!u) throw new HttpError(401, "signed_out", "You're signed out. Sign in again to keep going.");
    if (action !== "listing") throw new HttpError(404, "not_found", "That doesn't exist.");
    const t = await ownTest(u.id, id);
    return ok({ version: t.version, listing: asListing(t), keys: await keyBoxes(id), at: new Date().toISOString(), criticalCounts: countsOf(t.criticalCounts), everJoined: !!(await startedCounting(t)) }); // (batch 14) the count runs once anyone is affected
  });
}

// Developer actions on their test, and the tester's Join. Every one re-checks on the server.
export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id, action } = await params;
    const u = await requireActive(req, { devOk: SUSPENDED_OK.has(action), devSide: !TESTER_SIDE.has(action) });
    const body = await readJson(req);
    if (NEEDS_CONFIRMED.has(action)) requireConfirmed(u);
    await adminRefusal(req, u.id, id, action);
    const res0 = await run(u, id, action, body);
    const data = await res0.clone().json().catch(() => null);
    // A rename the page hadn't shown: the press went ahead; the note goes under the button.
    const res = res0.ok && typeof body.__note === "string" && data && typeof data === "object" ? ok({ ...data, note: body.__note }) : res0;
    if (res.ok) await logTestAction(u.id, id, action, body, data);
    return res;
  });
}

/** The tester-side and read-only presses on this route: the team's pause or stop of the test never refuses them here. */
const STOPPED_ALLOWS = new Set(["message", "rate", "dispute-side", "pay-extra", "call-length", "no-show"]);
const TESTER_SIDE = new Set(["join", "apply", "rejoin-ask", "withdraw-application", "my-gaps"]);

/**
 * (Design doc 6) The team paused the test: the developer can only stop it. The team stopped it: every press the developer made
 * fails and they are sent back to the test, where a permanent banner says so and names the press that failed.
 */
async function adminRefusal(req: Request, userId: string, testId: string, action: string) {
  if (TESTER_SIDE.has(action)) return;
  const t = await db.test.findUnique({ where: { id: testId }, select: { developerId: true, adminPausedAt: true, adminStoppedAt: true } });
  if (!t || t.developerId !== userId) return;
  // (Owner, Oct 28) A team stop is a HARD refusal for every press a stopped test does not allow (no stop-once); what a stopped test allows (chat, rate, a dispute reply, extra pay, a call's length
  // and problem report) goes on under its own rules.
  if (t.adminStoppedAt && !STOPPED_ALLOWS.has(action)) throw new HttpError(409, "admin_stopped", "The team stopped this test.", { failed: await failedLine(req) });
  if (t.adminStoppedAt) return;
  // (Batch 15 section 1) Chat is never closed by a paused test.
  if (t.adminPausedAt && action !== "stop" && action !== "message") throw new HttpError(409, "admin_paused", "The team paused this test: you can only stop it.", { failed: await failedLine(req) });
}

async function run(u: Awaited<ReturnType<typeof requireActive>>, id: string, action: string, body: Record<string, unknown>) {
  {
    switch (action) {
      case "edit": {
        const t = await editTest(u, id, body);
        return ok({ version: t.version, offered: (t as { offered?: number }).offered ?? 0, changed: (t as { changed?: string[] }).changed ?? [], notReinvited: (t as { notReinvited?: string[] }).notReinvited ?? [], resent: (t as { resent?: string[] }).resent ?? [], closedApps: (t as { closedApps?: string[] }).closedApps ?? [], spotClosed: (t as { spotClosed?: string[] }).spotClosed ?? [], spots: t.spots });
      }
      case "open":
        await openDraft(u, id, body);
        return ok({ ok: true });
      // (Owner, Oct 28 evening) A draft opens in Post a test: "Post the test" saves and opens it; it can also be deleted there.
      case "post-draft":
        return ok({ id: (await postDraft(u, id, body)).id });
      case "delete-draft":
        return ok(await deleteDraft(u, id));
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
      case "cancel-set":
        return ok(await cancelCallSet(u, String(body.contractId ?? ""), body));
      case "call-length":
        return ok(await setCallLength(u, id, body));
      case "no-show":
        return ok(await reportNoShow(u, String(body.callId ?? ""), body));
      case "pay-extra":
        return ok(await payExtra(u, id, body));
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
        return ok({ gaps: gapsOf(t, await db.testerProfile.findUnique({ where: { userId: u.id } })), needs: { devices: t.devices, languages: t.languages } });
      }
      case "invite-check":
        return ok(await inviteGaps(u.id, id, Array.isArray(body.testerIds) ? body.testerIds.map(String) : []));
      case "cancel-invite":
        return ok(await cancelInvite(u, id, body));
      case "message": {
        const m = body.testerId ? await sendChat(u, id, String(body.testerId), body.body, body.clientId) : await sendMessage(u, String(body.contractId ?? ""), body.body, body.clientId);
        return ok({ id: m.id });
      }
      case "join": {
        const c = await join(u, id, body);
        return ok({ sessionId: c.id });
      }
      case "apply":
        return ok(await apply(u, id, body));
      case "rejoin-ask":
        return ok(await askToRejoin(u, id, body));
      case "withdraw-application":
        return ok(await withdrawApplication(u, id, body));
      case "application":
        return ok(await decideApplication(u, id, body));
    }
    throw new HttpError(404, "not_found", "That action doesn't exist.");
  }
}
