import type { Prisma, User } from "@prisma/client";
import { db } from "@/lib/db";
export { ACCOUNT_CLOSED } from "@/lib/accountClosed";

// (Owner, Nov 1, §114; wording Nov 5) A deleted account's email can sign up again, as a brand-new account, when the deleted account is CLEAN at that moment: nothing
// owed (no owed / failed-unsettled / deferred / needs_confirmation payment, nor one being paid by Pay what you owe), no payment or chargeback hold, no open chargeback,
// no suspension on either side, and not deleted by an admin. Otherwise sign-up (the email form and Google alike) is refused with "This account was closed.".
//
// Freeing the email (no schema change): the deleted row's email becomes a tombstone that KEEPS the original inside it, "<original> (deleted <id>)". So
// - the unique email index takes the new sign-up, and every exact lookup (sign-in, Forgot password, Google, sign-up, the email links, notify by email) finds the new
//   account only: the tombstone has a space, so no typed email can ever be it (isEmail refuses it) and the old account can never be signed into;
// - the admin's console still finds the old account by the original email (its search matches any part of the email) and shows it on every admin line;
// - emails still about the old account (a receipt, a summary) go to the original address (sendEmail reads it back out: email.ts), as any deleted account's do.
// The old account keeps everything (history, ratings, tests, payments, its Stripe ids); nothing carries over. Its unused email links (reset / confirm) are used up and
// move to the tombstone; an AccountEvent "email-freed" (note: the original email) records when, for the admin's account boxes.

const TOMBSTONE = /^(\S+@\S+) \(deleted ([^\s()]+)\)$/;
/** "ana@example.com (deleted ck…)": the freed email of a deleted account. */
export const tombstoneOf = (email: string, id: string) => `${email} (deleted ${id})`;
export const isTombstone = (email: string) => TOMBSTONE.test(email);
/** The address an email is really for: a tombstone's original email, or the address itself. */
export const originalEmail = (email: string) => TOMBSTONE.exec(email)?.[1] ?? email;

type Q = Pick<Prisma.TransactionClient, "payment">;
type Deleted = Pick<User, "id" | "deletedAt" | "deletedBy" | "holdStartedAt" | "devSuspendedAt" | "testerSuspendedAt">;

/** Why a deleted account isn't clean ("" = clean). For the tests and the code only: the person reads the one line, no details. */
export async function notCleanWhy(u: Deleted, q: Q = db): Promise<string> {
  if (!u.deletedAt) return "not deleted";
  if (u.deletedBy === "admin") return "deleted by an admin";
  if (u.holdStartedAt) return "on a hold";
  if (u.devSuspendedAt || u.testerSuspendedAt) return "suspended";
  const money = await q.payment.findFirst({
    where: {
      developerId: u.id,
      OR: [
        { chargeback: "open" },
        { status: "failed", owedUntil: { not: null }, settledAt: null },
        { status: "deferred", settledAt: null },
        { status: { in: ["owed", "needs_confirmation", "paying"] } },
      ],
    },
    select: { chargeback: true },
  });
  return money ? (money.chargeback === "open" ? "an open chargeback" : "money owed") : "";
}
export const isClean = async (u: Deleted, q: Q = db) => !(await notCleanWhy(u, q));

/**
 * Inside the sign-up's transaction, before the new account is created: frees the deleted account's email (checked clean again, now). `refuse` is thrown when it
 * isn't clean any more. Already freed by another tab at the same moment: nothing here; the create then meets the other tab's new account ("already exists").
 */
export async function freeDeletedEmail(tx: Prisma.TransactionClient, old: { id: string; email: string }, refuse: () => Error, now = new Date()) {
  const u = await tx.user.findUnique({ where: { id: old.id } });
  if (!u || !u.deletedAt || u.email !== old.email) return false;
  if (!(await isClean(u, tx))) throw refuse();
  const tomb = tombstoneOf(old.email, old.id);
  const r = await tx.user.updateMany({ where: { id: old.id, email: old.email, deletedAt: { not: null } }, data: { email: tomb } });
  if (r.count !== 1) return false;
  // The old account's email links (reset, confirm) are used up and stay with it: none of them can reach the new account.
  await tx.loginToken.updateMany({ where: { email: old.email, usedAt: null }, data: { usedAt: now } });
  await tx.loginToken.updateMany({ where: { email: old.email }, data: { email: tomb } });
  await tx.accountEvent.create({ data: { userId: old.id, kind: "email-freed", note: old.email, createdAt: now } });
  return true;
}
