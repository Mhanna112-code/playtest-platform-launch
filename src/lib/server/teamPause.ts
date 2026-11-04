import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { teamPausedNow, teamPausedWaits } from "@/lib/restricted";
import { HttpError } from "./http";

// (Owner, Nov 4, §172) "Make the team's pause of a test the same exact rules as a developer suspension." Where a suspension refuses a money press (Pay, Pay more,
// Confirm with your bank, Confirm all) for every test of the developer, the team's pause refuses it for the ONE test it paused, with the team's wording (never
// "suspended" or "hold"). The developer's other tests and account are unaffected.

type Q = Prisma.TransactionClient | typeof db;

/** The id of the test a contract belongs to when the team paused it right now (null otherwise). */
export async function teamPausedTestOf(q: Q, contractId: string | null | undefined) {
  if (!contractId) return null;
  const c = await q.contract.findUnique({ where: { id: contractId }, select: { test: { select: { id: true, status: true, adminPausedAt: true } } } });
  return c && teamPausedNow(c.test) ? c.test.id : null;
}

/** The test's own check (read inside a press's locked step: the team's Pause locks the same Test row, so one of them lands first). */
export async function refuseTeamPausedTest(q: Q, testId: string, what: string, extra: Record<string, unknown> = {}) {
  const t = await q.test.findUnique({ where: { id: testId }, select: { status: true, adminPausedAt: true } });
  if (t && teamPausedNow(t)) throw new HttpError(409, "admin_paused", teamPausedWaits(what), { testId, ...extra });
}

/** A press on a payment or a piece of a test the team paused: refused like a suspended developer's ("The team paused this test: Pay waits until the pause is lifted."). */
export async function refuseTeamPaused(q: Q, contractId: string | null | undefined, what: string, extra: Record<string, unknown> = {}) {
  const testId = await teamPausedTestOf(q, contractId);
  if (testId) throw new HttpError(409, "admin_paused", teamPausedWaits(what), { testId, ...extra });
}

/** The contracts of every test the team paused right now for this developer (their waiting charges wait for the lift, as a suspended developer's do). */
export async function teamPausedContractIds(devId: string) {
  const rows = await db.contract.findMany({ where: { test: { developerId: devId, adminPausedAt: { not: null }, status: { not: "stopped" } } }, select: { id: true } });
  return rows.map((c) => c.id);
}
