import { db } from "@/lib/db";
import { displayName } from "@/lib/format";
import { testPaused } from "@/lib/rules";
import { blockPartners } from "./blocks";

/** (Batch 17 §18) Record (or refresh) this tester's visit to a test's join page. The caller checks they're a tester not in the test (and not its developer). */
export async function recordVisit(testerId: string, testId: string, now = new Date()) {
  await db.testVisit.upsert({ where: { testerId_testId: { testerId, testId } }, update: { visitedAt: now }, create: { testerId, testId, visitedAt: now } });
}

/**
 * (Batch 17 §18) The join page notes the visit of a signed-in tester who isn't in the test (no contract of theirs, whatever its status), isn't its developer and isn't
 * on the team. Returns whether it was recorded.
 */
export async function noteJoinPageVisit(viewer: { id: string; isTester: boolean }, t: { id: string; developerId: string }, admin: boolean, now = new Date()) {
  if (!viewer.isTester || admin || t.developerId === viewer.id) return false;
  if (await db.contract.count({ where: { testId: t.id, testerId: viewer.id } })) return false;
  await recordVisit(viewer.id, t.id, now);
  return true;
}

/**
 * (Owner, Oct 28, batch 17 §18) An open invite-only test whose join page shows this tester only "This test isn't available right now." (nothing of the listing, as
 * from a profile, batch 17 §9): they have no open invite, no pending application and were never in it (a tester who was in it keeps the page, with Ask to rejoin).
 */
export async function inviteOnlyHidden(t: { id: string; status: string; joinMode: string; developerId: string }, viewerId: string) {
  if (t.status !== "open" || t.joinMode !== "invite" || t.developerId === viewerId) return false;
  const where = { testId: t.id, testerId: viewerId };
  const [c, i, a] = await Promise.all([db.contract.count({ where }), db.invite.count({ where: { ...where, status: "sent" } }), db.application.count({ where: { ...where, status: "pending" } })]);
  return c + i + a === 0;
}

/** (Batch 17 §18) "Remove" (×) on a card: drops it at once, no confirm. */
export async function removeVisit(testerId: string, testId: string) {
  await db.testVisit.deleteMany({ where: { testerId, testId } });
}

/** Eligible visited tests, most recent visit first. Keep hidden visits so they can return when eligible. */
export async function visitedTests(testerId: string, now = new Date()) {
  const visits = await db.testVisit.findMany({
    where: { testerId, test: { status: "open", joinMode: { not: "invite" }, contracts: { none: { testerId } }, invites: { none: { testerId, status: "sent" } } } },
    orderBy: { visitedAt: "desc" },
    include: { test: { include: { developer: { select: { id: true, name: true, email: true, deletedAt: true, holdStartedAt: true, devSuspendedAt: true, timeZone: true } }, contracts: { where: { status: "working" }, select: { id: true } } } } },
  });
  const partners = new Set(await blockPartners(testerId));
  const shown = visits.filter(({ test }) =>
    !partners.has(test.developerId) && test.contracts.length < test.spots && (!test.openUntil || test.openUntil >= now));
  const ids = shown.map((v) => v.testId);
  const apps = ids.length
    ? await db.application.findMany({ where: { testerId, testId: { in: ids }, status: "pending" }, select: { testId: true } })
    : [];
  const applied = new Set(apps.map((a) => a.testId));
  return shown.map((v) => {
    const t = v.test;
    const paused = testPaused(t.developer, t);
    const state = paused ? "Paused" : applied.has(t.id) ? "Applied" : "Open";
    const label = state === "Open" ? "Accepting testers" : state === "Applied" ? "Applied (waiting)" : state;
    return {
      test: t,
      testId: t.id,
      title: t.title,
      productName: t.productName,
      categories: t.categories,
      developer: displayName(t.developer),
      state,
      label,
      visitedAt: v.visitedAt,
      href: `/app/find/${t.id}`,
    };
  });
}

/** (Batch 17 §18) The list's fingerprint for the dashboard's poll: a listed test's state (or title) changing, a card removed or a test joined changes it. */
export const visitedV = (rows: { testId: string; label: string; title: string; developer: string }[]) => rows.map((r) => `${r.testId}:${r.label}:${r.title}:${r.developer}`).join("|");
export const visitedTestsV = async (testerId: string) => visitedV(await visitedTests(testerId));
