import type { User } from "@prisma/client";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { HttpError } from "./http";

// (Batch 17 §6) An account's suspension and deletion state as the admin's Suspend / Reinstate / Delete see it, on the Accounts list and on a profile's admin view.
// `at` is when this state was read: Suspend and Reinstate send it back (or the Preview's time) so the server can refuse a press made from an older view.

export type AccountState = {
  id: string;
  /** When this state was read (server time). */
  at: string;
  email: string;
  isDeveloper: boolean;
  isTester: boolean;
  /** Each suspended side: "Oct 28, 3:10 PM by ana@… · “why”" ("" = not suspended). */
  suspended: { developer: string; tester: string };
  /** "Deleted Oct 28, 3:10 PM by ana@…: why" ("" = not deleted). */
  deleted: string;
  /** (Batch 34 §4) A payment or chargeback hold is on ("" = none): the developer side's Reinstate waits for it. */
  held?: "" | "payment" | "chargeback";
  /** (Batch 35 §43) The typed reasons on their own, for the small quoted box: each suspended side's Why and the deletion's. */
  notes?: { developer: string; tester: string; deleted: string };
};

type Acct = Pick<User, "id" | "email" | "isDeveloper" | "isTester" | "devSuspendedAt" | "devSuspendedById" | "devSuspendNote" | "testerSuspendedAt" | "testerSuspendedById" | "testerSuspendNote" | "deletedAt" | "deletedBy" | "deleteReason"> & Partial<Pick<User, "holdStartedAt" | "holdReason">>;

/** The states of several accounts at once (the Accounts list's page). */
export async function accountStates(users: Acct[]): Promise<Map<string, AccountState>> {
  const byIds = users.flatMap((u) => [u.devSuspendedById, u.testerSuspendedById]).filter((x): x is string => !!x);
  const dels = await db.adminAction.findMany({ where: { action: "delete-account", targetId: { in: users.filter((u) => u.deletedAt).map((u) => u.id) } }, orderBy: { createdAt: "desc" } });
  const emails = new Map((await db.user.findMany({ where: { id: { in: [...byIds, ...dels.map((d) => d.adminId)] } }, select: { id: true, email: true, deletedAt: true } })).map((x) => [x.id, x.deletedAt ? "an admin (deleted)" : x.email]));
  const deletedBy = new Map<string, string>();
  for (const d of dels) if (!deletedBy.has(d.targetId)) deletedBy.set(d.targetId, emails.get(d.adminId) ?? "an admin (deleted)");
  const at = new Date().toISOString();
  const side = (u: Acct, s: "developer" | "tester") => {
    const when = s === "developer" ? u.devSuspendedAt : u.testerSuspendedAt;
    const by = s === "developer" ? u.devSuspendedById : u.testerSuspendedById;
    const note = s === "developer" ? u.devSuspendNote : u.testerSuspendNote;
    return when ? `${fmtDateTime(when)}${by ? ` by ${emails.get(by) ?? "an admin (deleted)"}` : ""}${note ? ` · “${note}”` : ""}` : "";
  };
  return new Map(
    users.map((u) => [
      u.id,
      {
        id: u.id,
        at,
        email: u.email,
        isDeveloper: u.isDeveloper,
        isTester: u.isTester,
        suspended: { developer: side(u, "developer"), tester: side(u, "tester") },
        notes: { developer: u.devSuspendedAt ? u.devSuspendNote ?? "" : "", tester: u.testerSuspendedAt ? u.testerSuspendNote ?? "" : "", deleted: u.deletedAt ? u.deleteReason ?? "" : "" },
        held: u.holdStartedAt ? (u.holdReason === "chargeback" ? "chargeback" : "payment") : "",
        deleted: u.deletedAt ? `Deleted ${fmtDateTime(u.deletedAt)} by ${u.deletedBy === "admin" ? deletedBy.get(u.id) ?? "the team" : "the owner of the account"}${u.deleteReason ? `: ${u.deleteReason}` : ""}` : "",
      },
    ]),
  );
}

export async function accountState(userId: string): Promise<AccountState | null> {
  const u = await db.user.findUnique({ where: { id: userId } });
  return u ? (await accountStates([u])).get(u.id) ?? null : null;
}

/** (Batch 17 §6) A refused Suspend, Reinstate or Delete carries the account's state now, so the row or the profile updates where the admin pressed. */
export async function withAccountState<T>(userId: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof HttpError && e.status === 409) throw new HttpError(e.status, e.code, e.message, { ...(e.data ?? {}), account: await accountState(userId) });
    throw e;
  }
}
