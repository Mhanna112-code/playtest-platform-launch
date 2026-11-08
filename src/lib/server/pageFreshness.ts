import { revealedRatingsWhere } from "./ratings";
import { createHash } from "node:crypto";
import type { User } from "@prisma/client";
import { db } from "@/lib/db";
import { sideFor } from "@/lib/sides";
import { contractsOnSide } from "./sidePage";
import { isAdmin } from "./session";
import { notificationScopeFor } from "./notify";
import { findTests } from "./tests";
import { adminFindTests } from "./findSearch";
import type { TestState } from "@/lib/findSearch";

// Return only an opaque version, never private rows. Clock boundaries refresh deadline-dependent controls too.
export function stateV(value: unknown, now = Date.now()): string {
  const phases: number[][] = [];
  const visit = (v: unknown) => {
    if (v instanceof Date) {
      const remaining = v.getTime() - now;
      phases.push([remaining > 0 ? 1 : 0, ...[60_000, 600_000, 3_600_000, 4 * 3_600_000, 6 * 3_600_000, 86_400_000, 7 * 86_400_000, 14 * 86_400_000].map((n) => Math.abs(remaining) < n ? 1 : 0)]);
    } else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object") Object.values(v).forEach(visit);
  };
  visit(value);
  return createHash("sha256").update(JSON.stringify([value, phases])).digest("hex");
}

export async function discoveryV(u: User, q = "", states: TestState[] = []) {
  const [tests, profile] = await Promise.all([
    isAdmin(u) ? adminFindTests(q, states) : findTests(u, q),
    db.testerProfile.findUnique({ where: { userId: u.id } }),
  ]);
  return stateV([tests, profile]);
}

export async function messagesV(u: User) {
  const contracts = await db.contract.findMany({ where: contractsOnSide(u.id, sideFor(u)), orderBy: [{ joinedAt: "desc" }, { id: "asc" }], take: 100, select: { id: true, title: true, testId: true, testerId: true, joinedAt: true, status: true, tester: { select: { name: true, email: true, deletedAt: true } }, test: { select: { developer: { select: { name: true, email: true, deletedAt: true } } } } } });
  const pairs = contracts.map((c) => ({ testId: c.testId, testerId: c.testerId }));
  const [messages, reads] = await Promise.all([
    pairs.length ? db.message.groupBy({ by: ["testId", "testerId"], where: { OR: pairs }, _count: { _all: true }, _max: { createdAt: true }, orderBy: [{ testId: "asc" }, { testerId: "asc" }] }) : [],
    pairs.length ? db.chatRead.findMany({ where: { userId: u.id, OR: pairs }, orderBy: [{ testId: "asc" }, { testerId: "asc" }] }) : [],
  ]);
  return stateV([contracts, messages, reads]);
}

export async function paymentsV(u: User) {
  const rows = await db.payment.findMany({ where: sideFor(u) === "tester" ? { testerId: u.id } : { developerId: u.id }, orderBy: { id: "asc" }, select: { id: true, status: true, amountCents: true, testerCents: true, feeCents: true, contractId: true, transferStatus: true, settledAt: true, actionBy: true, actionPi: true, chargeback: true, owedUntil: true, failure: true, reversedCents: true } }); // (§133) what a dispute reversed
  const names = await db.contract.findMany({ where: { id: { in: rows.flatMap((r) => r.contractId ? [r.contractId] : []) } }, orderBy: { id: "asc" }, select: { id: true, title: true, tester: { select: { name: true, email: true, deletedAt: true } }, test: { select: { developer: { select: { name: true, email: true, deletedAt: true } } } } } });
  // (Owner, Nov 4, §192) A refund line (the bank lowered what it took back after the repayment) redraws the developer's list too.
  const refunds = sideFor(u) === "tester" ? [] : await db.paymentRefund.findMany({ where: { developerId: u.id }, orderBy: { id: "asc" }, select: { id: true, status: true, amountCents: true } });
  // (Owner, Nov 5, §272) The developer's chargeback steps (a card verified, the team's approval) read from the account, not from a payment: Verify a card in
  // another tab or device redraws this page (and the dashboard, whose version includes this one) on its next poll, the step ticked and the button gone.
  const cb = sideFor(u) === "tester" ? null : await chargebackStateV(u.id);
  return stateV([rows, names, ...(refunds.length ? [refunds] : []), ...(cb ? [cb] : [])]);
}

/** (Owner, Nov 5, §272) The account's chargeback hold state, as the chargeback steps read it: "" when there's no chargeback hold. */
export async function chargebackStateV(userId: string) {
  const me = await db.user.findUnique({ where: { id: userId }, select: { holdStartedAt: true, holdReason: true, chargebackCardVerifiedAt: true, chargebackApprovedAt: true } });
  if (!me?.holdStartedAt || me.holdReason !== "chargeback") return "";
  return [me.holdStartedAt.getTime(), me.chargebackCardVerifiedAt?.getTime() ?? 0, me.chargebackApprovedAt?.getTime() ?? 0].join(":");
}

export async function notificationsV(u: User) {
  const rows = await db.notification.findMany({ where: { userId: u.id, ...await notificationScopeFor(u.id) }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 200 });
  const titles = await db.test.findMany({ where: { id: { in: rows.flatMap((r) => r.testId ? [r.testId] : []) } }, orderBy: { id: "asc" }, select: { id: true, title: true } });
  return stateV([rows, titles, u.emailPref]);
}

export async function blockedV(u: User) {
  const rows = await db.block.findMany({ where: { blockerId: u.id }, orderBy: { id: "asc" } });
  const people = await db.user.findMany({ where: { id: { in: rows.map((r) => r.blockedId) } }, orderBy: { id: "asc" }, select: { id: true, name: true, email: true, deletedAt: true } });
  return stateV([rows, people]);
}

export async function publicProfileV(viewer: User, id: string) {
  const [person, blocks] = await Promise.all([
    // (Batch 35 §134) The developer's bio too (the tester's is in the profile row below): an edit shows on an open profile within the poll.
    db.user.findUnique({ where: { id }, select: { id: true, name: true, email: true, pronoun: true, deletedAt: true, isDeveloper: true, isTester: true, devSuspendedAt: true, testerSuspendedAt: true, holdStartedAt: true, devBio: true } }),
    db.block.findMany({ where: { OR: [{ blockerId: viewer.id, blockedId: id }, { blockerId: id, blockedId: viewer.id }] }, orderBy: { id: "asc" } }),
  ]);
  if (!person || person.deletedAt || (!isAdmin(viewer) && blocks.some((b) => b.blockerId === id && b.blockedId === viewer.id))) return stateV("unavailable");
  const [profile, ratings, contracts, excerpts, reports, payments] = await Promise.all([
    db.testerProfile.findUnique({ where: { userId: id } }),
    db.rating.findMany({ where: { rateeId: id, ...revealedRatingsWhere() }, orderBy: { id: "asc" } }),
    db.contract.findMany({ where: { OR: [{ testerId: id }, { test: { developerId: id } }] }, orderBy: { id: "asc" }, select: { id: true, status: true, endKind: true, testerId: true, testId: true, submissions: { select: { id: true, updatedAt: true, review: true } }, calls: { select: { id: true, status: true, review: true, actualMinutes: true, measuredAt: true, dispute: true } } } }),
    // (Batch 35 §129) Each shown excerpt with whether its test has an NDA now: adding or removing one hides or brings back the excerpt live.
    db.excerpt.findMany({ where: { testerId: id, status: "shown" }, orderBy: { id: "asc" }, include: { test: { select: { ndaText: true } } } }).then((rows) => rows.map(({ test, ...x }) => ({ ...x, nda: !!test.ndaText }))),
    db.report.findMany({ where: { reporterId: viewer.id, reportedId: id }, orderBy: { id: "asc" }, select: { id: true } }),
    db.payment.findMany({ where: { OR: [{ developerId: id }, { testerId: id }] }, orderBy: { id: "asc" }, select: { id: true, status: true, amountCents: true, testerCents: true } }),
  ]);
  const raters = await db.user.findMany({ where: { id: { in: ratings.map((r) => r.raterId) } }, orderBy: { id: "asc" }, select: { id: true, name: true, email: true, deletedAt: true } });
  return stateV([person, blocks, profile, ratings, contracts, excerpts, reports, payments, raters]);
}

/** Metadata of this side's dashboard, across all its tests. No work bodies or message bodies. */
export async function dashboardV(u: User) {
  const contracts = await db.contract.findMany({ where: contractsOnSide(u.id, sideFor(u)), orderBy: { id: "asc" }, select: { id: true, testId: true, testerId: true, title: true, status: true, endKind: true, endedAt: true, dueAt: true, submissions: { select: { id: true, kind: true, agreedCents: true, sentAt: true, updatedAt: true, choiceBy: true, choiceOfferedAt: true, review: true, dispute: true } }, calls: { select: { id: true, startsAt: true, minutes: true, status: true, cancelledAt: true, endedAt: true, actualMinutes: true, payBy: true, review: true, dispute: true } }, test: { select: { id: true, title: true, status: true, updatedAt: true, openUntil: true, adminPausedAt: true, developer: { select: { id: true, name: true, email: true, pronoun: true, deletedAt: true, holdStartedAt: true, devSuspendedAt: true } } }, }, tester: { select: { name: true, email: true, pronoun: true, deletedAt: true, testerSuspendedAt: true } } } });
  const ids = contracts.map((c) => c.id), testIds = contracts.map((c) => c.testId);
  const ownTests = sideFor(u) === "developer" ? await db.test.findMany({ where: { developerId: u.id }, orderBy: { id: "asc" }, select: { id: true, title: true, categories: true, spots: true, status: true, updatedAt: true, openUntil: true } }) : [];
  const tests = [...new Set([...testIds, ...ownTests.map((t) => t.id)])];
  const [apps, requests, offers, invites, excerpts, keys, money, discovery, messages] = await Promise.all([
    db.application.findMany({ where: sideFor(u) === "tester" ? { testerId: u.id } : { testId: { in: tests } }, orderBy: { id: "asc" } }),
    db.callRequest.findMany({ where: { contractId: { in: ids } }, orderBy: { id: "asc" }, select: { id: true, status: true, updatedAt: true, startsAt: true } }),
    db.termsOffer.findMany({ where: { contractId: { in: ids } }, orderBy: { id: "asc" }, select: { id: true, status: true, createdAt: true } }),
    db.invite.findMany({ where: sideFor(u) === "tester" ? { testerId: u.id } : { testId: { in: tests } }, orderBy: { id: "asc" }, select: { id: true, testId: true, status: true, updatedAt: true } }),
    // (§129) With the test's NDA now (a request's row notes "it stays hidden while <test> has an NDA").
    db.excerpt.findMany({ where: { testId: { in: tests } }, orderBy: { id: "asc" }, select: { id: true, status: true, decidedAt: true, test: { select: { ndaText: true } } } }).then((rows) => rows.map(({ test, ...x }) => ({ ...x, nda: !!test.ndaText }))),
    db.accessKey.groupBy({ by: ["testId", "status"], where: { testId: { in: tests } }, _count: { _all: true }, orderBy: [{ testId: "asc" }, { status: "asc" }] }),
    paymentsV(u), sideFor(u) === "tester" ? discoveryV(u) : "", messagesV(u),
  ]);
  const pendingTests = await db.test.findMany({ where: { id: { in: [...new Set([...apps.map((a) => a.testId), ...invites.map((i) => i.testId)])] } }, orderBy: { id: "asc" }, select: { id: true, title: true, status: true, spots: true, openUntil: true, adminPausedAt: true, developer: { select: { name: true, email: true, pronoun: true, deletedAt: true, holdStartedAt: true, devSuspendedAt: true } }, _count: { select: { contracts: { where: { status: "working" } } } } } });
  // (Batch 35 §162) The applicants' pronouns (the rejoin line, "answer her in Needs you"): a change redraws the dashboard on its poll.
  const applicantPronouns = sideFor(u) === "developer" && apps.length ? await db.user.findMany({ where: { id: { in: apps.map((a) => a.testerId) } }, orderBy: { id: "asc" }, select: { id: true, pronoun: true } }) : [];
  const ratings = await db.rating.findMany({where:{contractId:{in:ids}},orderBy:{id:"asc"},select:{id:true,contractId:true,side:true,createdAt:true}});
  return stateV([contracts, ownTests, apps, requests, offers, invites, excerpts, keys, money, discovery, messages, pendingTests, applicantPronouns, ratings, Math.floor(Date.now()/60000)]);
}
