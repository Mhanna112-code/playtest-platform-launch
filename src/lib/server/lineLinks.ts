import { db } from "@/lib/db";
import { displayName } from "@/lib/format";
import { testTitleOf } from "@/lib/rules";
import { linksIn, personLink, testLink, type LineLink } from "@/lib/lineLinks";

// (Owner, Nov 5, §270) The people and tests a reader's lines can name, each with where it opens for this reader, built once per page (or per refused press) and
// matched against each line where it is built (`linksIn`): the bell, the payment rows, the confirm rows, the owed lines, the stop boxes, the refusals, the top box.

type U = { id: string; name: string; email: string; deletedAt: Date | null; isDeveloper?: boolean };
const who = { id: true, name: true, email: true, deletedAt: true, isDeveloper: true } as const;
const person = (u: U | null | undefined, as: "tester" | "developer", viewerId: string) =>
  u ? personLink({ id: u.id, name: displayName(u), deleted: !!u.deletedAt }, as, viewerId) : null;

/** (§270) A reader's link pool: `all` (every link) and `byTest` (a test's own people and names first, for a name two people share). */
export type LinkPool = { all: LineLink[]; byTest: Map<string, LineLink[]> };
export const EMPTY_POOL: LinkPool = { all: [], byTest: new Map() };

/**
 * (Owner, Nov 5, §270) Everyone and every test the reader's lines can name: the reader's own tests (as developer: the test page; its testers, applicants and invitees
 * open their tester profile), the tests they test (their session page; the developer's profile), the tests in `testIds` they have no part in (the public page,
 * with its developer and testers), and the people they message directly. The reader is never in it ("You" is never a link), nor a deleted account.
 */
export async function linkPool(viewerId: string | null | undefined, testIds: (string | null | undefined)[] = []): Promise<LinkPool> {
  if (!viewerId) return EMPTY_POOL;
  const byTest = new Map<string, LineLink[]>();
  const add = (testId: string, l: LineLink | null) => {
    if (!l) return;
    const list = byTest.get(testId) ?? [];
    if (!list.some((x) => x.text === l.text)) list.push(l);
    byTest.set(testId, list);
  };
  const extra = [...new Set(testIds.filter((x): x is string => !!x))];
  const tests = await db.test.findMany({
    where: { OR: [{ developerId: viewerId }, { contracts: { some: { testerId: viewerId } } }, ...(extra.length ? [{ id: { in: extra } }] : [])] },
    select: { id: true, title: true, round: true, developerId: true, developer: { select: who }, contracts: { select: { id: true, title: true, testerId: true, tester: { select: who } } } },
  });
  for (const t of tests) {
    const mine = t.developerId === viewerId;
    const own = t.contracts.find((c) => c.testerId === viewerId);
    const at = { developer: mine, sessionId: own?.id ?? null };
    // The test's names: its title now, and the titles its contracts were written with (a line written before a rename).
    for (const title of new Set([testTitleOf(t), ...t.contracts.map((c) => c.title)])) add(t.id, testLink({ id: t.id, title }, at));
    if (!mine) add(t.id, person(t.developer, "developer", viewerId));
    for (const c of t.contracts) add(t.id, person(c.tester, "tester", viewerId));
  }
  // The developer's applicants and invitees (the bell's "Ana Silva applied to …").
  const mineIds = tests.filter((t) => t.developerId === viewerId).map((t) => t.id);
  if (mineIds.length) {
    const [apps, invites] = await Promise.all([
      db.application.findMany({ where: { testId: { in: mineIds } }, select: { testId: true, testerId: true } }),
      db.invite.findMany({ where: { testId: { in: mineIds } }, select: { testId: true, testerId: true } }),
    ]);
    const asked = [...apps, ...invites];
    const users = new Map((await db.user.findMany({ where: { id: { in: [...new Set(asked.map((a) => a.testerId))] } }, select: who })).map((u) => [u.id, u]));
    for (const a of asked) add(a.testId, person(users.get(a.testerId), "tester", viewerId));
  }
  // The people the reader messages directly (not about a test).
  const convs = await db.directConversation.findMany({ where: { OR: [{ firstId: viewerId }, { secondId: viewerId }] }, select: { first: { select: who }, second: { select: who } } });
  for (const c of convs) {
    const other = c.first.id === viewerId ? c.second : c.first;
    add("", person(other, other.isDeveloper ? "developer" : "tester", viewerId));
  }
  const all: LineLink[] = [];
  const seen = new Set<string>();
  for (const list of byTest.values()) for (const l of list) if (!seen.has(l.text)) { seen.add(l.text); all.push(l); }
  return { all, byTest };
}

/** (§270) The links a line needs from a pool: its own test's people and names win a shared name. */
export const lineLinks = (pool: LinkPool, text: string, testId?: string | null): LineLink[] => linksIn(text, pool.all, testId ? pool.byTest.get(testId) ?? [] : []);

/** (§270) Every link any of these lines needs (one list: a peek's notice lines, a stop box's). */
export const linksForTexts = (pool: LinkPool, texts: string[]): LineLink[] => {
  const seen = new Set<string>();
  const out: LineLink[] = [];
  for (const t of texts) for (const l of lineLinks(pool, t)) if (!seen.has(l.text)) { seen.add(l.text); out.push(l); }
  return out;
};

type Lined = { text?: unknown; full?: unknown; links?: unknown };
const textOf = (x: Lined) => (typeof x.full === "string" && x.full ? x.full : typeof x.text === "string" ? x.text : "");
/**
 * (Owner, Nov 5, §270) A refused or stopped press's reply for its reader: the refusal's names (`links`), each stop line's (`changes[i].links`) and each Pay what
 * you owe line a stop hands back (`lines[i].links`), so the blue notice and its bullets draw them as green links. Nothing for a reply that names no one.
 */
export async function withLineLinksFor(viewerId: string | null | undefined, message: string, data: Record<string, unknown> | undefined): Promise<Record<string, unknown> | undefined> {
  if (!viewerId) return data;
  const changes = Array.isArray(data?.changes) ? (data!.changes as unknown[]) : [];
  const lines = Array.isArray(data?.lines) ? (data!.lines as unknown[]) : [];
  const pool = await linkPool(viewerId);
  if (!pool.all.length) return data;
  const own = lineLinks(pool, message);
  const lined = (xs: unknown[]) => xs.map((x) => (x && typeof x === "object" && !Array.isArray(x) ? { ...(x as object), links: lineLinks(pool, textOf(x as Lined)) } : x));
  return { ...(data ?? {}), ...(own.length ? { links: own } : {}), ...(changes.length ? { changes: lined(changes) } : {}), ...(lines.length ? { lines: lined(lines) } : {}) };
}

/** (§270) The reader of this request (its session cookie), for a refusal's links; null outside a request (tests calling a route's code directly). */
export async function requestViewerId(): Promise<string | null> {
  try {
    const [{ cookies }, { SESSION_COOKIE, userForToken }] = await Promise.all([import("next/headers"), import("./session")]);
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    return token ? (await userForToken(token))?.id ?? null : null;
  } catch {
    return null;
  }
}
