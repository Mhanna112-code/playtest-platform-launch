import { db } from "@/lib/db";
import { displayName } from "@/lib/format";
import { testState } from "@/lib/findSearch";
import { blockPartners } from "./blocks";

/**
 * (Owner, Oct 28, batch 17 §18) "Tests visited" on the tester dashboard: every test whose join page this tester opened but never joined, most recent visit first,
 * each with its state now. A visit is recorded when a signed-in tester opens a join page for a test they're not in (no contract of theirs, whatever its status);
 * joining takes it off the list (a contract), Remove deletes the row and opening the join page again brings it back. Tests from a developer blocked either way
 * are left out (batch 16 §11).
 */

const utcDay = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export type VisitState = "Open" | "Full" | "Joining closed" | "Paused" | "Stopped" | "Closed" | "Applied" | "Invited" | "Invite only";

/**
 * (Batch 17 §18) One visited test's state for this tester, the first that applies: Stopped / Closed; Paused (a hold, the developer's suspension or the team's pause:
 * always "Paused" to testers); Invited (an open invite of theirs); Applied (a pending application); Invite only (and none of those: the join page shows only "This
 * test isn't available right now."); Joining closed (Open until passed); Full; Open.
 */
export function visitState(
  t: { status: string; openUntil: Date | null; adminPausedAt?: Date | null; pauseClosedAt?: Date | null; joinMode: string; spots: number },
  dev: { holdStartedAt?: Date | null; devSuspendedAt?: Date | null },
  working: number,
  mine: { invited: boolean; applied: boolean },
  now = new Date(),
): { state: VisitState; label: string } {
  const s = testState(t, dev, working, now);
  if (s === "Stopped" || s === "Closed" || s === "Paused") return { state: s, label: s };
  if (s === "Draft") return { state: "Closed", label: "Closed" }; // (not reachable: a draft's join page isn't found)
  if (mine.invited) return { state: "Invited", label: "Invited" };
  if (mine.applied) return { state: "Applied", label: "Applied (waiting)" };
  if (t.joinMode === "invite") return { state: "Invite only", label: "Invite only" };
  if (s === "Joining closed") return { state: s, label: `Closed to new testers on ${utcDay(t.openUntil!)}` };
  if (s === "Full") return { state: s, label: "Full" };
  return { state: "Open", label: "Accepting testers" };
}

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

/** (Batch 17 §18) The cards, most recent visit first: the test, its developer, its state now and where the card goes (an invite opens the invitation). */
export async function visitedTests(testerId: string, now = new Date()) {
  const visits = await db.testVisit.findMany({
    where: { testerId, test: { status: { not: "draft" }, contracts: { none: { testerId } } } },
    orderBy: { visitedAt: "desc" },
    include: { test: { include: { developer: { select: { id: true, name: true, email: true, deletedAt: true, holdStartedAt: true, devSuspendedAt: true } }, contracts: { where: { status: "working" }, select: { id: true } } } } },
  });
  const partners = new Set(await blockPartners(testerId));
  const shown = visits.filter((v) => !partners.has(v.test.developerId));
  const ids = shown.map((v) => v.testId);
  const [invites, apps] = ids.length
    ? await Promise.all([
        db.invite.findMany({ where: { testerId, testId: { in: ids }, status: "sent" }, select: { testId: true } }),
        db.application.findMany({ where: { testerId, testId: { in: ids }, status: "pending" }, select: { testId: true } }),
      ])
    : [[], []];
  const invited = new Set(invites.map((i) => i.testId));
  const applied = new Set(apps.map((a) => a.testId));
  return shown.map((v) => {
    const t = v.test;
    const { state, label } = visitState(t, t.developer, t.contracts.length, { invited: invited.has(t.id), applied: applied.has(t.id) }, now);
    return {
      testId: t.id,
      title: t.title,
      productName: t.productName,
      categories: t.categories,
      developer: displayName(t.developer),
      state,
      label,
      visitedAt: v.visitedAt,
      href: state === "Invited" ? `/app/find/${t.id}#invitation` : `/app/find/${t.id}`,
    };
  });
}

/** (Batch 17 §18) The list's fingerprint for the dashboard's poll: a listed test's state (or title) changing, a card removed or a test joined changes it. */
export const visitedV = (rows: { testId: string; label: string; title: string; developer: string }[]) => rows.map((r) => `${r.testId}:${r.label}:${r.title}:${r.developer}`).join("|");
export const visitedTestsV = async (testerId: string) => visitedV(await visitedTests(testerId));
