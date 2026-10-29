import { db } from "@/lib/db";
import { displayName, fmtDate } from "@/lib/format";
import { HttpError } from "./http";
import { adminUsers, notify } from "./notify";

// (Owner, Oct 27) "Report <name>" on a profile (tester profile on the developer side, developer profile on the tester side): a reason and Send to the team.
// Each person may report another person ONCE (per pair, ever). The admin sees it in the reports list. The only stop is a race check: already reported in another tab.
// (The call's "Report a problem with this call" is a different thing and stays on the call.)

export const REPORT_NOTE_MIN = 5;

export async function reportPerson(me: { id: string }, body: Record<string, unknown>) {
  const otherId = String(body.userId ?? "");
  if (!otherId || otherId === me.id) throw new HttpError(400, "bad_user", "Choose someone to report.");
  const other = await db.user.findUnique({ where: { id: otherId } });
  if (!other || other.deletedAt) throw new HttpError(404, "not_found", "That person doesn't exist.");
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : "";
  const had = await db.report.findUnique({ where: { reporterId_reportedId: { reporterId: me.id, reportedId: otherId } } });
  if (had) throw new HttpError(409, "already", `You already reported ${displayName(other)} on ${fmtDate(had.createdAt)}.`);
  if (note.length < REPORT_NOTE_MIN) throw new HttpError(400, "bad_note", "Say what happened (the team reads it).");
  const r = await db.report.create({ data: { reporterId: me.id, reportedId: otherId, note } }).catch(() => null);
  if (!r) throw new HttpError(409, "already", `You already reported ${displayName(other)}.`);
  // The admins are told (batch 29 §29: their own daily entry, "Reports · 2 new"; each line opens its row, marked); the reported person is NOT told.
  const flagged = await reportedOver3([me.id, otherId]);
  const meRow = await db.user.findUniqueOrThrow({ where: { id: me.id } });
  for (const a of await adminUsers()) {
    const line = `New report: ${labelled(displayName(meRow), flagged.has(me.id))} reported ${labelled(displayName(other), flagged.has(otherId))}`;
    await notify(a.email, line, [line], `/admin#report-${r.id}`, { group: "adminreports" }); // follows the admin's own email setting, like a normal notification
  }
  return { reported: true, at: r.createdAt.toISOString() };
}

/** (Owner, Oct 27) One line in an account's history for the admin: a hold starting / lifting / approved, a suspension, a reinstatement, and who acted. */
export async function accountEvent(userId: string, kind: "hold" | "hold-lifted" | "hold-approved" | "suspended" | "reinstated" | "deleted", byId: string | null = null, note = "", side = "") {
  await db.accountEvent.create({ data: { userId, kind, byId, note, side } }).catch(() => null);
}

// ---------- The "Reported more than 3 times" label (owner, Oct 27) ----------

export const REPORTED_LABEL = "Reported more than 3 times";
export const REPORTED_OVER = 3;

/** How many times each account was reported: profile reports plus call no-show / late reports against them. Admin-only knowledge. */
export async function reportCounts(ids: string[]) {
  const out = new Map<string, number>();
  if (!ids.length) return out;
  const [profile, calls] = await Promise.all([
    db.report.groupBy({ by: ["reportedId"], where: { reportedId: { in: ids } }, _count: { _all: true } }),
    db.call.findMany({ where: { noShowBy: { not: null }, OR: [{ noShowBy: "tester", contract: { test: { developerId: { in: ids } } } }, { noShowBy: "developer", contract: { testerId: { in: ids } } }] }, select: { noShowBy: true, contract: { select: { testerId: true, test: { select: { developerId: true } } } } } }),
  ]);
  for (const r of profile) out.set(r.reportedId, (out.get(r.reportedId) ?? 0) + r._count._all);
  for (const c of calls) {
    const accused = c.noShowBy === "tester" ? c.contract.test.developerId : c.contract.testerId;
    if (ids.includes(accused)) out.set(accused, (out.get(accused) ?? 0) + 1);
  }
  return out;
}

/** The accounts among `ids` reported MORE than 3 times (the label is shown instead of the number). */
export async function reportedOver3(ids: string[]) {
  const counts = await reportCounts([...new Set(ids)]);
  return new Set([...counts].filter(([, n]) => n > REPORTED_OVER).map(([id]) => id));
}
/** "Ana Silva (Reported more than 3 times)": admin rows and admin bell lines only. */
export const labelled = (name: string, flagged: boolean) => (flagged ? `${name} (${REPORTED_LABEL})` : name);
