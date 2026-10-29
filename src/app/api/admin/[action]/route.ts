import { db } from "@/lib/db";
import { fmtTime } from "@/lib/format";
import { countingSince, countsOf, lockedFields, storedCounts } from "@/lib/limits";
import { HttpError, handle, ok, readJson, readText } from "@/lib/server/http";
import { LIMITS } from "@/lib/limits";
import { decideDispute } from "@/lib/server/payments";
import { ADMIN_PAUSED, adminAccount, isAdmin, requireUser } from "@/lib/server/session";
import { approveHoldLift } from "@/lib/server/holds";
import { approveChargebackHold } from "@/lib/server/chargeback";
import { closePausedTest, extendPauseClosure } from "@/lib/server/pauseClosure";
import { adminStopTest, deleteAccount, pauseTest, previewSuspension, reinstateAccount, seenFromBody, suspendAccount, unpauseTest } from "@/lib/server/restrictions";
import { withAccountState } from "@/lib/server/accountState";

type Ctx = { params: Promise<{ action: string }> };

export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { action } = await params;
    const u = await requireUser(req);
    if (adminAccount(u) && !isAdmin(u)) throw new HttpError(403, "suspended", ADMIN_PAUSED); // (batch 15 section 35) a suspended admin
    if (!isAdmin(u)) throw new HttpError(403, "not_admin", "Only admins can do that.");
    const body = await readJson(req);
    const id = String(body.id ?? "");
    const res = await run(u, action, id, body);
    // (Batch 15 section 21) Every admin action is kept with the admin who did it (a preview changes nothing). (Batch 22 section 5) Lift the pause keeps its own, with
    // the lift itself, so a second admin's press names the first.
    if (action !== "preview-suspension" && action !== "unpause-test") await db.adminAction.create({ data: { adminId: u.id, action, targetId: id } });
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
        return ok(await withAccountState(id, () => deleteAccount(id, "admin", reason)));
      }
      case "pause-test":
        return ok(await pauseTest(u.id, id, readText(body.note, LIMITS.reason, "bad_note")));
      case "unpause-test":
        return ok(await unpauseTest(id, u.id));
      case "stop-test":
        return ok(await adminStopTest(id, readText(body.note, LIMITS.reason, "bad_note"), u.id));
      // (Owner, Oct 28, batch 8) "Free for everyone until <date>" (blank clears it).
      case "allow-critical-changes":
      {
        // (Owner, Oct 28 afternoon) Per field: each locked field gets its 3 changes back; the other fields keep their counts.
        const t = await db.test.findUniqueOrThrow({ where: { id } });
        const counts = countsOf(t.criticalCounts);
        for (const f of lockedFields(counts)) counts[f] = 0;
        await db.test.update({ where: { id }, data: { criticalCounts: storedCounts(counts, countingSince(t.criticalCounts)) } }); // (batch 14) when the count started stays
      }
        return ok({ ok: true });
      // (Owner, Oct 26) A chargeback hold needs the admin's approval (id = the developer) once the card is verified and what is owed is paid.
      case "approve-hold":
        return ok(await approveHoldLift(u.id, id, readText(body.note, LIMITS.reason, "bad_note")));
      case "approve-chargeback":
        return ok(await approveChargebackHold(id));
      // A paused test closes after 7 days: the admin can move its date later (days, default 7) or close it now (id = the test).
      case "approve-outage":
        return ok(await (await import("@/lib/server/outages")).approveOutage(u.id, id));
      case "extend-pause":
        return ok(await extendPauseClosure(id, body.days));
      case "close-paused":
        return ok(await closePausedTest(id, "admin", new Date(), u.id));
    }
    throw new HttpError(404, "not_found", "That action doesn't exist.");
  }
}
