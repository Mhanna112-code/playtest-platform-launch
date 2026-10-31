import { db } from "@/lib/db";
import { fmtTime } from "@/lib/format";
import { HttpError, handle, ok, readJson, readText } from "@/lib/server/http";
import { LIMITS } from "@/lib/limits";
import { decideDispute } from "@/lib/server/payments";
import { ADMIN_PAUSED, adminAccount, isAdmin, requireUser } from "@/lib/server/session";
import { approveHoldLift } from "@/lib/server/holds";
import { approveChargebackHold, declineChargebackReserve } from "@/lib/server/chargeback";
import { clearFailedEmails } from "@/lib/server/email";
import { adminClosePaused, extendPauseClosure } from "@/lib/server/pauseClosure";
import { adminDeleteAccount, adminStopTest, allowLockedChanges, pauseTest, previewSuspension, reinstateAccount, seenFromBody, suspendAccount, unpauseTest } from "@/lib/server/restrictions";
import { adminSeen, markPress, ownChange, presserOf, tabOf, youAlready } from "@/lib/server/adminRace";
import { withAccountState } from "@/lib/server/accountState";
import { previewTeamClose, teamClose, type TeamCloseScope } from "@/lib/server/teamClose";

/** (Batch 30 §5) The scope of a team closure: every test of a developer, or one test. */
function teamCloseScope(id: string, body: Record<string, unknown>): TeamCloseScope {
  if (!id) throw new HttpError(404, "not_found", "That account or test doesn't exist.");
  return body.scope === "test" ? { testId: id } : { developerId: id };
}

type Ctx = { params: Promise<{ action: string }> };

export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { action } = await params;
    const u = await requireUser(req);
    if (adminAccount(u) && !isAdmin(u)) throw new HttpError(403, "suspended", ADMIN_PAUSED); // (batch 15 section 35) a suspended admin
    if (!isAdmin(u)) throw new HttpError(403, "not_admin", "Only admins can do that.");
    const body = await readJson(req);
    const id = String(body.id ?? "");
    const start = new Date();
    const res = await run(u, action, id, body);
    // (Batch 15 section 21) Every admin action is kept with the admin who did it (a preview changes nothing). (Batch 22 section 5) Lift the pause keeps its own, with
    // the lift itself, so a second admin's press names the first.
    if (action !== "preview-suspension" && action !== "unpause-test" && action !== "preview-team-close") await db.adminAction.create({ data: { adminId: u.id, action, targetId: id, createdAt: new Date() } }); // (batch 34 §1) this server's clock, like the page times
    // (Batch 35 §45) What this page load did (from the press's start to now): its own presses never stop for it; other tabs' read "You … in another tab".
    if (action !== "preview-suspension" && action !== "preview-team-close") await markPress(u.id, tabOf(body), start); // (batch 35 §51) the page load
    return res;
  });
}

async function run(u: Awaited<ReturnType<typeof requireUser>>, action: string, id: string, body: Record<string, unknown>) {
  {
    switch (action) {
      // (Batch 15 section 21) Contact us: an admin marks a message replied (the list says who and when).
      case "contact-replied": {
        const done = await db.contactMessage.updateMany({ where: { id, repliedById: null }, data: { repliedById: u.id, repliedAt: new Date() } });
        if (done.count !== 1) {
          const m = await db.contactMessage.findUnique({ where: { id } });
          if (!m) throw new HttpError(404, "not_found", "That message doesn't exist.");
          // (Batch 35 §45) This admin's own (another tab): "You already marked this replied in another tab at 3:20 AM."
          const own = m.repliedAt ? await ownChange(presserOf(u.id, body), m.repliedById, m.repliedAt) : null;
          if (own && m.repliedAt) throw new HttpError(409, "replied", youAlready("marked this replied", own, m.repliedAt));
          const by = m.repliedById ? await db.user.findUnique({ where: { id: m.repliedById }, select: { email: true } }) : null;
          throw new HttpError(409, "replied", `${by?.email ?? "An admin (deleted)"} already marked this replied${m.repliedAt ? ` at ${fmtTime(m.repliedAt)}` : ""}.`);
        }
        return ok({ ok: true });
      }
      case "decide":
        return ok(await decideDispute(u, id, body));
      case "suspend": {
        if (id === u.id) throw new HttpError(409, "self", "You can't pause your own account.");
        const note = readText(body.note, LIMITS.reason, "bad_note");
        if (note.length < 3) throw new HttpError(400, "bad_note", "Record why (it is kept with the suspension).");
        // (Batch 17 §6) `since`: when the admin's Preview (or the page) was loaded; a refusal carries the account's state now (the row or profile updates).
        return ok(await withAccountState(id, () => suspendAccount(u.id, id, note, body.side, seenFromBody(body))));
      }
      case "unsuspend":
        return ok(await withAccountState(id, () => reinstateAccount(id, body.side, u.id, seenFromBody(body))));
      case "preview-suspension":
        // (Batch 17 §6) The Preview's time: Suspend and Reinstate send it back.
        return ok({ ...(await previewSuspension(id)), at: new Date().toISOString() });
      case "delete-account": {
        if (id === u.id) throw new HttpError(409, "self", "Use Settings to delete your own account.");
        const reason = readText(body.note, LIMITS.reason, "bad_note");
        if (reason.length < 3) throw new HttpError(400, "bad_note", "Record why (it is kept with the deletion).");
        // (Batch 34 §1) With the page's time: already deleted is named; another admin's change to the account since then stops once.
        return ok(await withAccountState(id, () => adminDeleteAccount(u.id, id, reason, adminSeen(body))));
      }
      case "pause-test":
        return ok(await pauseTest(u.id, id, readText(body.note, LIMITS.reason, "bad_note"), adminSeen(body)));
      case "unpause-test":
        return ok(await unpauseTest(id, u.id, adminSeen(body)));
      case "stop-test":
        return ok(await adminStopTest(id, readText(body.note, LIMITS.reason, "bad_note"), u.id, adminSeen(body)));
      // (Owner, Oct 28, batch 8) "Free for everyone until <date>" (blank clears it).
      case "allow-critical-changes":
        // (Owner, Oct 28 afternoon) Per field: each locked field gets its 3 changes back; the other fields keep their counts. (Batch 34 §1) Already allowed: named.
        return ok(await allowLockedChanges(u.id, id, adminSeen(body)));
      // (Owner, Oct 26) A chargeback hold needs the admin's approval (id = the developer) once the card is verified and what is owed is paid.
      case "approve-hold":
        return ok(await approveHoldLift(u.id, id, readText(body.note, LIMITS.reason, "bad_note"), adminSeen(body)));
      case "approve-chargeback":
        return ok(await approveChargebackHold(id, u.id, adminSeen(body)));
      // (Batch 23 section 6) Not approved: the reservation is cancelled (nothing taken) and the hold stays (id = the developer).
      case "decline-chargeback":
        return ok(await declineChargebackReserve(id, readText(body.note, LIMITS.reason, "bad_note"), u.id, adminSeen(body)));
      // (Batch 23 section 2) The red box's failed-for-good list is cleared (the emails are kept).
      case "emails-clear":
        return ok(await clearFailedEmails());
      // A paused test closes after 7 days: the admin can move its date later (days, default 7) or close it now (id = the test).
      case "approve-outage":
        return ok(await (await import("@/lib/server/outages")).approveOutage(u.id, id, presserOf(u.id, body)));
      // (Batch 28 §1) A heartbeat gap: Approve moves every timer by it; Dismiss drops it (id = the gap).
      case "approve-gap":
        return ok(await (await import("@/lib/server/outages")).approveGap(u.id, id, presserOf(u.id, body)));
      case "dismiss-gap":
        return ok(await (await import("@/lib/server/outages")).dismissGap(id, presserOf(u.id, body)));
      // (Batch 30 §5) Close a developer's open reviews at $0 (id = the developer, scope "developer"; or id = a test, scope "test"): Preview first, then the reason.
      case "preview-team-close":
        return ok(await previewTeamClose(teamCloseScope(id, body)));
      case "team-close":
        return ok(await teamClose(u.id, teamCloseScope(id, body), body));
      case "extend-pause":
        return ok(await extendPauseClosure(id, body.days, new Date(), u.id, adminSeen(body)));
      case "close-paused":
        return ok(await adminClosePaused(u.id, id, adminSeen(body)));
    }
    throw new HttpError(404, "not_found", "That action doesn't exist.");
  }
}
