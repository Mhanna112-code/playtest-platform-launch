import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { findQuery, testState, type TestState } from "@/lib/findSearch";
import { textFilters } from "@/lib/nameSearch";

/**
 * (Owner, Oct 28, batch 17 section 8) The search box's filter, on the server: the test's name, its product name or the developer's name contains the text (any part,
 * any case). `email`: the team also finds a developer by their email.
 */
export function testSearchWhere(q: unknown, email = false): Prisma.TestWhereInput {
  const typed = findQuery(q);
  if (!typed) return {};
  // (Batch 20 section 9) From 1 character: 1-2 characters match the start of a word (or the whole text), 3+ any part.
  const any = textFilters(typed), start = textFilters(typed, true);
  // Under AND, so it can be spread into a where that has its own OR.
  return { AND: [{ OR: [...any.map((f) => ({ title: f })), ...any.map((f) => ({ productName: f })), ...any.map((f) => ({ developer: { name: f } })), ...(email ? start.map((f) => ({ developer: { email: f } })) : [])] }] };
}

/** The most tests an admin's Find tests lists at once (newest first); a search narrows it. */
export const ADMIN_FIND_LIMIT = 500;

/**
 * (Batch 17 section 8) An admin's Find tests: every test (drafts, paused, full, stopped, closed, invite only too), newest first, matching the search, each with
 * its state; `states` (none = every state) keeps only those.
 */
export async function adminFindTests(q: unknown, states: TestState[] = [], now = new Date()) {
  const rows = await db.test.findMany({
    where: testSearchWhere(q, true),
    include: { _count: { select: { contracts: { where: { status: "working" } } } }, developer: { select: { name: true, email: true, deletedAt: true, holdStartedAt: true, devSuspendedAt: true } } },
    orderBy: { createdAt: "desc" },
    take: ADMIN_FIND_LIMIT + 1,
  });
  const more = rows.length > ADMIN_FIND_LIMIT;
  const tests = rows.slice(0, ADMIN_FIND_LIMIT).map((t) => ({ ...t, state: testState(t, t.developer, t._count.contracts, now) }));
  return { tests: states.length ? tests.filter((t) => states.includes(t.state)) : tests, more };
}
