import { db } from "@/lib/db";
import { gapsOf } from "@/lib/gaps";
import { HttpError, handle, ok, readJson } from "@/lib/server/http";
import { devCancelCall, reportNoShow } from "@/lib/server/calls";
import { cancelInvite, inviteGaps, invitePanel, inviteTesters } from "@/lib/server/invites";
import { answerRequest, cancelCallSet, devRequestTime } from "@/lib/server/requests";
import { apply, askToRejoin, decideApplication, join, joinStopList, withdrawApplication } from "@/lib/server/joining";
import { addDevSide, payExtra } from "@/lib/server/payments";
import { sendChat, sendMessage } from "@/lib/server/messages";
import { countingState, asListing, deleteDraft, editTest, endEarly, goNextRound, nextRound, openDraft, ownTest, postDraft, stopTest } from "@/lib/server/tests";
import { keyBoxes } from "@/lib/server/accessKeys";
import { getUserFromRequest } from "@/lib/server/session";
import { failedLine, requireActive, requireConfirmed, requireCurrentTerms } from "@/lib/server/users";
import { RESTRICTED_OK_ACTIONS, TEAM_PAUSED_OK_ACTIONS } from "@/lib/restricted";
import { bodyPressVerb } from "@/lib/pressLabels";

// (Owner, Oct 27) Email confirmation is needed only for Post a test (its own route), Join (which is also accepting an invite) and Apply. A blocked press is a blue notice under the button with Resend the link.
const NEEDS_CONFIRMED = new Set(["join", "apply", "post-draft"]);
// (Batch 18 section 1) An account on an older Terms of Use version agrees again (the box's tick) on these presses only: post a draft, and Join (also accepting an
// invite), Apply and Ask to rejoin.
const NEEDS_CURRENT_TERMS = new Set(["join", "apply", "rejoin-ask", "post-draft"]);
import { devRate } from "@/lib/server/ratings";
import { logTestAction } from "@/lib/server/actionText";

type Ctx = { params: Promise<{ id: string; action: string }> };

/** (Owner, Oct 30, batch 15 section 29) A suspended or held developer: Stop, End early and Cancel call (and the side of a dispute). */
const SUSPENDED_OK = RESTRICTED_OK_ACTIONS;

/** (Design doc 5) The Edit page's live view of the test: its listing and version, and the In use / Free access keys. */
export async function GET(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id, action } = await params;
    const u = await getUserFromRequest(req);
    if (!u) throw new HttpError(401, "signed_out", "You're signed out. Sign in again to keep going.");
    if (action !== "listing") throw new HttpError(404, "not_found", "That doesn't exist.");
    const t = await ownTest(u.id, id);
    const counting = await countingState(t); // (batch 35 §66) the count runs once a tester joined
    return ok({ version: t.version, listing: asListing(t), keys: await keyBoxes(id), at: new Date().toISOString(), criticalCounts: counting.counts, everJoined: !!counting.since });
  });
}

// Developer actions on their test, and the tester's Join. Every one re-checks on the server.
export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id, action } = await params;
    // (Batch 17 section 2) Rate reaches its own refusal ("You can rate once your account is active again.") while the developer is suspended or on a hold.
    // (Batch 27 section 2) "Go to the next round" only opens the draft (it was a plain link): never refused for a paused test or account.
    const what = await pressWhat(req, action);
    const u = await requireActive(req, { devOk: SUSPENDED_OK.has(action) || action === "rate" || action === "go-next-round", devSide: !TESTER_SIDE.has(action), what });
    const body = await readJson(req, 900_000); // (batch 15 sections 3 and 17) an Edit with 20 questions and the steps at 20,000 characters each
    if (NEEDS_CONFIRMED.has(action)) requireConfirmed(u);
    await adminRefusal(req, u.id, id, action, what);
    if (NEEDS_CURRENT_TERMS.has(action)) await requireCurrentTerms(u, body);
    const res0 = await run(u, id, action, body);
    const data = await res0.clone().json().catch(() => null);
    // A rename the page hadn't shown: the press went ahead; the note goes under the button.
    const res = res0.ok && typeof body.__note === "string" && data && typeof data === "object" ? ok({ ...data, note: body.__note }) : res0;
    if (res.ok) await logTestAction(u.id, id, action, body, data);
    return res;
  });
}

/** The tester-side and read-only presses on this route: the team's pause or stop of the test never refuses them here. */
const STOPPED_ALLOWS = new Set(["message", "rate", "dispute-side", "pay-extra", "no-show"]);
const TESTER_SIDE = new Set(["join", "apply", "rejoin-ask", "withdraw-application", "my-gaps"]);

/**
 * (Design doc 6; batch 15 sections 23 and 37) The team paused the test: the developer can stop it, end testers' work early or cancel calls. The team stopped it: every press the developer made
 * fails and they are sent back to the test, where a permanent banner says so and names the press that failed.
 */
async function adminRefusal(req: Request, userId: string, testId: string, action: string, what?: string) {
  if (TESTER_SIDE.has(action) || action === "go-next-round") return;
  const t = await db.test.findUnique({ where: { id: testId }, select: { developerId: true, adminPausedAt: true, adminStoppedAt: true } });
  if (!t || t.developerId !== userId) return;
  // (Owner, Oct 28) A team stop is a HARD refusal for every press a stopped test does not allow (no stop-once); what a stopped test allows (chat, rate, a dispute reply, extra pay, a call's length
  // and problem report) goes on under its own rules.
  if (t.adminStoppedAt && !STOPPED_ALLOWS.has(action)) throw new HttpError(409, "admin_stopped", "The team stopped this test.", { failed: await failedLine(req, what) });
  if (t.adminStoppedAt) return;
  // (Batch 15 section 1) Chat is never closed by a paused test.
  // (Batch 15 sections 23 and 37) A test the team paused: Stop, End early and Cancel call (and chat, and the side of a dispute); every other press goes to the banner.
  if (t.adminPausedAt && !TEAM_PAUSED_OK_ACTIONS.has(action)) throw new HttpError(409, "admin_paused", "The team paused this test: you can stop it, end testers' work early, or cancel calls.", { failed: await failedLine(req, what) });
}

/**
 * (Batch 35 §2) An application's Accept / Decline is named by its body's `action`: the failed-press lines read "Your Accept on <test> didn't go through" (not "Answer").
 * The body is peeked from a copy of the request (small bodies only), since the account checks run before it is read.
 */
async function pressWhat(req: Request, action: string) {
  if (action !== "application" || Number(req.headers.get("content-length") || 0) > 100_000) return undefined;
  return bodyPressVerb(action, await req.clone().json().catch(() => null));
}

async function run(u: Awaited<ReturnType<typeof requireActive>>, id: string, action: string, body: Record<string, unknown>) {
  {
    switch (action) {
      case "edit": {
        const t = await editTest(u, id, body);
        return ok({ version: t.version, offered: (t as { offered?: number }).offered ?? 0, changed: (t as { changed?: string[] }).changed ?? [], notReinvited: (t as { notReinvited?: string[] }).notReinvited ?? [], resent: (t as { resent?: string[] }).resent ?? [], closedApps: (t as { closedApps?: string[] }).closedApps ?? [], spotClosed: (t as { spotClosed?: string[] }).spotClosed ?? [], spots: t.spots,
          // (Batch 34 §9) What was just saved: the page's base becomes it (a Back / forward return or a tab switch never brings older text back).
          listing: asListing(t), keys: await keyBoxes(id) });
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
      case "go-next-round":
        return ok(await goNextRound(u, id, body));
      case "cancel-call":
        return ok(await devCancelCall(u, id, body));
      case "keys-dismiss":
        return ok(await (await import("@/lib/server/accessKeys")).dismissBrokenKeys(u, id, body));
      case "cancel-set":
        return ok(await cancelCallSet(u, String(body.contractId ?? ""), body));
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
        // (Batch 30 §12) With the page's seen marker: what the needs-covered notice shows with it (every change the page hadn't shown), the box's time and its last line.
        const verb = body.verb === "apply" || body.verb === "ask" ? body.verb : "join";
        const stop = typeof body.seenAt === "string" ? await joinStopList(u.id, id, body, verb) : null;
        // (Batch 35 §14) `needsSaveAt`: the Save that last changed the needs, for the pop-up's own lines' See it.
        const needsSave = await (await import("@/lib/server/listingPanel")).needsSaveAt(id);
        // (Batch 35 §44) `profileAt` (the tester's own profile's last save) and `needsSaveAt` against the pop-up's open time (`now` as it opened) say where a change came from.
        const profile = await db.testerProfile.findUnique({ where: { userId: u.id } });
        return ok({ gaps: gapsOf(t, profile), needs: { devices: t.devices, languages: t.languages }, ...(needsSave ? { needsSaveAt: needsSave } : {}), ...(profile ? { profileAt: profile.updatedAt.toISOString() } : {}), now: new Date().toISOString(), ...(stop ?? {}) });
      }
      case "invite-check":
        return ok(await inviteGaps(u.id, id, Array.isArray(body.testerIds) ? body.testerIds.map(String) : []));
      case "invite-search":
        // (Batch 16 section 12) The invite panel's lists over every tester: Suggested after the ticks, and the name search.
        return ok(await invitePanel(u.id, id, { q: body.q, devices: body.devices, languages: body.languages }));
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
