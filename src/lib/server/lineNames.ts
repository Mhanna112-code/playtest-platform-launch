import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { displayName } from "@/lib/format";

/**
 * (Owner, Nov 11, §388) Bell lines and their email lines always show people's and tests' CURRENT names. A line is still stored as text (every reader, search and
 * test keeps working on it), and with it WHERE it names a person or a test: `names`, one mark per place ({ k: "u" | "t", id, at, name }: who or which test, the
 * character it starts at, the name written then). The bell, the Notifications page and the summary / morning emails read each line with renderNames, which puts
 * the current name (displayName: "Deleted account" once deleted; a test's current title) in each marked place. A line written before (names null) keeps its text.
 * An email already queued keeps its text (it is rendered when it is made).
 *
 * The marks are found when the line is written (markNames): the names of the people and tests the line can be about (its test, its `about` person, the tests
 * the recipient develops or tests in, with their developers and testers), each place one of them appears as a whole word. Longer names first; the line's own
 * people and test before others of the same name. Nothing is ever named that the line didn't already name (a line that hides a name has none to mark).
 */
export type NameMark = { k: "u" | "t"; id: string; at: number; name: string };
type Candidate = { k: "u" | "t"; id: string; name: string };

const WORD = /[\p{L}\p{N}]/u;
/**
 * Words the lines use themselves: a person whose name is one of them (an email's first part as the name: "test", "team") is never marked, so a later rename never
 * changes the line's own words.
 */
const LINE_WORDS = new Set(["you", "your", "test", "tests", "call", "calls", "pay", "paid", "team", "tester", "testers", "developer", "admin", "account", "answer", "answers", "update", "updates", "rate", "dispute", "charge", "reminder", "deleted", "playtest", "the", "and", "for", "on", "in", "at", "to", "of", "a", "an"]);
const isWordAt = (s: string, i: number) => i >= 0 && i < s.length && WORD.test(s[i]);

/** Every place each candidate's name appears in `text` as a whole word, longest names first, never overlapping. */
export function markNames(text: string, candidates: Candidate[]): NameMark[] {
  const seen = new Set<string>();
  const list = candidates
    .map((c, i) => ({ ...c, name: c.name.trim(), i }))
    .filter((c) => c.name.length >= 2 && c.name !== displayName({ email: "", deletedAt: new Date() }) && !(c.k === "u" && LINE_WORDS.has(c.name.toLowerCase())) && !seen.has(`${c.k}:${c.id}:${c.name}`) && seen.add(`${c.k}:${c.id}:${c.name}`))
    .sort((a, b) => b.name.length - a.name.length || a.i - b.i);
  const taken: [number, number][] = [];
  const marks: NameMark[] = [];
  for (const c of list) {
    for (let at = text.indexOf(c.name); at >= 0; at = text.indexOf(c.name, at + 1)) {
      const end = at + c.name.length;
      if (isWordAt(text, at - 1) && WORD.test(c.name[0])) continue;
      if (isWordAt(text, end) && WORD.test(c.name[c.name.length - 1])) continue;
      if (taken.some(([a, b]) => at < b && end > a)) continue;
      taken.push([at, end]);
      marks.push({ k: c.k, id: c.id, at, name: c.name });
    }
  }
  return marks.sort((a, b) => a.at - b.at);
}

const PERSON = { id: true, name: true, email: true, deletedAt: true } as const;

/**
 * The people and tests a line for `recipientId` can name: its own test (with its developer and testers) and its `about` person first, then the tests the
 * recipient develops or tests in (with theirs).
 */
export async function nameCandidates(recipientId: string, testId: string | null | undefined, about?: string | null, client: Prisma.TransactionClient | typeof db = db): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const person = (u: { id: string; name: string | null; email: string; deletedAt: Date | null }) => out.push({ k: "u", id: u.id, name: displayName(u) });
  const test = (t: { id: string; title: string; developer: { id: string; name: string | null; email: string; deletedAt: Date | null }; contracts: { tester: { id: string; name: string | null; email: string; deletedAt: Date | null } }[] }) => {
    out.push({ k: "t", id: t.id, name: t.title });
    person(t.developer);
    for (const c of t.contracts) person(c.tester);
  };
  const select = { id: true, title: true, developer: { select: PERSON }, contracts: { select: { tester: { select: PERSON } } } } as const;
  if (about) {
    const a = await client.user.findUnique({ where: { id: about }, select: PERSON });
    if (a) person(a);
  }
  if (testId) {
    const t = await client.test.findUnique({ where: { id: testId }, select });
    if (t) test(t);
  }
  for (const t of await client.test.findMany({ where: { id: { not: testId ?? undefined }, OR: [{ developerId: recipientId }, { contracts: { some: { testerId: recipientId } } }] }, select, orderBy: { createdAt: "desc" }, take: 100 })) test(t);
  return out;
}

/** The marks for one line written to `recipientId` ([] when it names nobody: stored as null). */
export async function namesFor(recipientId: string, text: string, testId: string | null | undefined, about?: string | null, client: Prisma.TransactionClient | typeof db = db) {
  const marks = markNames(text, await nameCandidates(recipientId, testId, about, client));
  return marks.length ? (marks as unknown as Prisma.InputJsonValue) : undefined;
}

const marksOf = (names: unknown): NameMark[] =>
  Array.isArray(names) ? names.filter((m): m is NameMark => !!m && typeof m === "object" && (m.k === "u" || m.k === "t") && typeof m.id === "string" && typeof m.at === "number" && typeof m.name === "string") : [];

/**
 * Each line's text with the current names in its marked places. One look-up of the people and one of the tests for all the lines (the bell's 200, a summary's
 * lines). A mark whose place no longer holds the name it wrote (the text was rewritten since) is left as it is.
 */
export async function renderNames<N extends { text: string; names?: unknown }>(rows: N[]): Promise<N[]> {
  const marks = rows.map((r) => marksOf(r.names));
  const userIds = [...new Set(marks.flat().filter((m) => m.k === "u").map((m) => m.id))];
  const testIds = [...new Set(marks.flat().filter((m) => m.k === "t").map((m) => m.id))];
  if (!userIds.length && !testIds.length) return rows;
  const [users, tests] = await Promise.all([
    userIds.length ? db.user.findMany({ where: { id: { in: userIds } }, select: PERSON }) : [],
    testIds.length ? db.test.findMany({ where: { id: { in: testIds } }, select: { id: true, title: true } }) : [],
  ]);
  const now = new Map<string, string>([...users.map((u) => [`u:${u.id}`, displayName(u)] as const), ...tests.map((t) => [`t:${t.id}`, t.title] as const)]);
  return rows.map((r, i) => {
    const ms = marks[i];
    if (!ms.length) return r;
    let text = r.text;
    for (const m of [...ms].sort((a, b) => b.at - a.at)) {
      const current = now.get(`${m.k}:${m.id}`);
      if (current == null || current === m.name || text.slice(m.at, m.at + m.name.length) !== m.name) continue;
      text = text.slice(0, m.at) + current + text.slice(m.at + m.name.length);
    }
    return text === r.text ? r : { ...r, text };
  });
}
