import { db } from "@/lib/db";
import { displayName, fmtDateTime, money } from "@/lib/format";
import { pauseCountdownLine } from "@/lib/pause";
import { chargebackHolds } from "./chargeback";
import { disputeBounds } from "./payments";
import { NOT_LISTED, termsLine } from "@/lib/rules";
import { CRITICAL_FIELDS, CRITICAL_KEYS, countsOf, lockedFields } from "@/lib/limits";
import { SUBSCRIPTION_ENDED, adminSubLine } from "@/lib/subscription";
import { pausedTestsForAdmin } from "./pauseClosure";
import { REPORTED_OVER, labelled, reportCounts, reportedOver3 } from "./reports";
import { HOLD_APPROVAL_AFTER, MANY_HOLDS_LABEL, adminReservedLine, disputeRangeLine } from "@/lib/rules";
import { callMinutesOf } from "@/lib/callMeasure";
import { LISTING_VALUES } from "@/lib/listingInfo";
import { itemsOf } from "@/lib/answerSets";
import { writtenQuestions as writtenQuestionsOf } from "./tests";
import type { DisputedWork } from "@/app/admin/DisputeWork";
import type { Prisma } from "@prisma/client";
import { accountStates, type AccountState } from "./accountState";
import { textFilters } from "@/lib/nameSearch";

// (Owner, Oct 26) The admin dashboard's lists, 25 rows at a time (keyset by date: newest first; the lists ordered by closure date go soonest first). Rows are
// plain, already-formatted view models so the same loaders serve the page and /api/admin/more. (Batch 17 §7) Each list is a scroll box that loads the next 25
// near its end (the same cursors); (Batch 17 §5) Accounts and Tests also take a search and tick boxes, applied here, over every row.

export const PAGE = 25;
export type Page<T> = { rows: T[]; next: string | null; total: number };

export type DisputeVM = {
  work?: DisputedWork | null; type?: "dispute"; id: string; at: string; head: string; money: string; said: string; open: boolean; decided: string; min: number; max: number; devSide?: string; devSideAt?: string | null; dev?: string;
  /** (Batch 28 §15) "$20.00 paid · can raise up to $20.00 more" */ range?: string;
  /** (Owner, Oct 29, batch 28 §15) Their chat on this test, read-only, newest last: the only place an admin can read a chat. */ chat?: { id: string; who: string; at: string; text: string }[];
};
export type MineVM = { id: string; at: string; title: string; dev: string; why: string; when: string; testId: string };
export type UserVM = { href: string; id: string; at: string; line: string; reports: number; state: "deleted" | "suspended" | "normal"; stateLine: string; devSuspended?: boolean; testerSuspended?: boolean; isDeveloper?: boolean; isTester?: boolean; acct: AccountState };
/** (Batch 17 §5) A search and ticks on the Accounts or Tests list (see lib/adminScroll.ts). */
export type ListFilter = { q?: string; ticks?: string[] };
export type TestVM = { href: string; id: string; at: string; line: string; status: string; adminPaused: boolean; stopped: boolean; critical: number; closedLine: string };
/** (Owner, Oct 28 afternoon) The per-field change counts on an admin test row: "NDA 3, steps 1". */
const countsText = (v: unknown) => { const c = countsOf(v); return CRITICAL_KEYS.filter((k) => c[k] > 0).map((k) => `${CRITICAL_FIELDS[k]} ${c[k]}`).join(", "); };
/** (Batch 22 section 4) `em`: a quoted reason shown in italics after the text (a dispute's). */
export type TextVM = { id: string; at: string; text: string; href?: string; em?: string };
/** A hold lift waiting for an admin's Approve (the 4th hold onward), in its own box: styled like a dispute row. */
export type LiftVM = { id: string; at: string; head: string; owed: string; paid: string };
/** A profile report: who reported whom, when, why, with links to both profiles. */
export type ReportVM = { id: string; at: string; reporter: string; reporterHref: string; reported: string; reportedHref: string; when: string; note: string };
export type PausedVM = { id: string; at: string; text: string; closure: string; extended: boolean };
export type ChargebackVM = { id: string; at: string; email: string; since: string; chargebacks: string[]; cardVerified: boolean; owedPaid: boolean; owedLine: string; /** (Batch 23 section 6) money reserved on the card; the last reservation lapsed */ reservedCents: number; expired: boolean };

export type Kind = "contact" | "disputes" | "decided" | "mine" | "users" | "tests" | "noshows" | "payments" | "payouts" | "paused" | "chargebacks" | "lifts" | "reports" | "u-payments" | "u-payouts" | "u-disputes" | "u-chargebacks" | "u-holds" | "u-tests" | "u-reports" | "u-parts" | "t-timeline" | "t-contracts" | "t-payments";
/** (Batch 15 section 21) An admin by email, as admin views name them ("an admin (deleted)" once the account is gone). */
export async function adminEmails(ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  const found = new Map((await db.user.findMany({ where: { id: { in: list } }, select: { id: true, email: true, deletedAt: true } })).map((u) => [u.id, u.deletedAt ? "an admin (deleted)" : u.email]));
  return (id: string | null | undefined) => (id ? found.get(id) ?? "an admin (deleted)" : "");
}
/** The latest admin action of these kinds on each target: "stopped by ana@… · Oct 30, 3:10 PM". */
async function lastActions(targetIds: string[], actions: string[]) {
  const rows = await db.adminAction.findMany({ where: { targetId: { in: targetIds }, action: { in: actions } }, orderBy: { createdAt: "desc" } });
  const name = await adminEmails(rows.map((r) => r.adminId));
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.targetId, [...(out.get(r.targetId) ?? []), `${ACTION_WORDS[r.action] ?? r.action} by ${name(r.adminId)} ${fmtDateTime(r.createdAt)}`]);
  return out;
}
const ACTION_WORDS: Record<string, string> = {
  "pause-test": "paused", "unpause-test": "unpaused", "stop-test": "stopped", "extend-pause": "closing date extended", "close-paused": "closed now", "allow-critical-changes": "3 more changes allowed",
  "release-share": "released to the tester", "refund-share": "refunded to the developer", transfer: "sent", "approve-hold": "lift approved", "approve-chargeback": "lift approved", "decline-chargeback": "reservation released", "emails-clear": "failed emails cleared", "delete-account": "deleted",
  suspend: "suspended", unsuspend: "reinstated", decide: "decided", "contact-replied": "marked replied", "approve-outage": "outage approved",
};

export const KINDS: Kind[] = ["contact", "disputes", "decided", "mine", "users", "tests", "noshows", "payments", "payouts", "paused", "chargebacks", "lifts", "reports", "u-payments", "u-payouts", "u-disputes", "u-chargebacks", "u-holds", "u-tests", "u-reports", "u-parts", "t-timeline", "t-contracts", "t-payments"];

/** The profile page an admin can open for an account: the developer's, or else the tester's. */
const profileHref = (u: { id: string; isDeveloper: boolean }) => (u.isDeveloper ? `/app/developers/${u.id}` : `/app/testers/${u.id}`);

const cur = (at: Date, id: string) => `${at.toISOString()}|${id}`;
function parse(cursor: string | null) {
  if (!cursor) return null;
  const [iso, id] = cursor.split("|");
  const at = new Date(iso);
  return isNaN(at.getTime()) ? null : { at, id: id ?? "" };
}
/** Keyset condition for "older than the cursor" on a createdAt-style column. */
const olderThan = (field: string, c: { at: Date; id: string } | null) => (c ? { OR: [{ [field]: { lt: c.at } }, { [field]: c.at, id: { lt: c.id } }] } : {});
/** (Batch 28 §7) The keyset cursor of a list shown oldest first. */
const newerThan = (field: string, c: { at: Date; id: string } | null) => (c ? { OR: [{ [field]: { gt: c.at } }, { [field]: c.at, id: { gt: c.id } }] } : {});

/** Slice an in-memory list (already sorted) after a cursor; `key` gives each row's date. */
function slice<T extends { id: string }>(all: T[], key: (r: T) => Date, cursor: string | null): Page<T> {
  const c = parse(cursor);
  let start = 0;
  if (c) start = all.findIndex((r) => key(r).getTime() === c.at.getTime() && r.id === c.id) + 1;
  const rows = all.slice(start, start + PAGE);
  const last = rows[rows.length - 1];
  return { rows, next: start + PAGE < all.length && last ? cur(key(last), last.id) : null, total: all.length };
}

async function disputes(status: "open" | "decided", cursor: string | null): Promise<Page<DisputeVM>> {
  const where = status === "open" ? { status: "open" } : { status: { not: "open" } };
  const c = parse(cursor);
  const [list, total] = await Promise.all([
    db.dispute.findMany({ where: { ...where, ...olderThan("createdAt", c) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: PAGE + 1 }),
    db.dispute.count({ where }),
  ]);
  const page = list.slice(0, PAGE);
  const rows: DisputeVM[] = [];
  for (const d of page) rows.push(await disputeRow(d));
  const last = page[page.length - 1];
  return { rows, next: list.length > PAGE && last ? cur(last.createdAt, last.id) : null, total };
}

export async function disputeRow(d: Awaited<ReturnType<typeof db.dispute.findMany>>[number]): Promise<DisputeVM> {
  const c = await db.contract.findUnique({ where: { id: d.contractId }, include: { tester: true, test: { include: { developer: true } } } });
  const sub = d.submissionId ? await db.submission.findUnique({ where: { id: d.submissionId } }) : null;
  const call = d.callId ? await db.call.findUnique({ where: { id: d.callId } }) : null;
  const r = await db.review.findFirst({ where: d.submissionId ? { submissionId: d.submissionId } : { callId: d.callId ?? "none" } });
  const what = call ? `Live call (${fmtDateTime(call.startsAt)})` : `${sub?.kind === "recording" ? "Recording" : "Written answers"} (sent ${sub ? fmtDateTime(sub.sentAt) : ""})`;
  const flagged = await reportedOver3([d.testerId, c?.test.developerId ?? ""]);
  let min = 0, max = 0, range = "";
  const base = r?.agreedCents == null ? NOT_LISTED : `Listing ${money(r.agreedCents)}`;
  // (Batch 29 §37) "Paid for this piece" is the same total as the range line: the Pay plus every Pay more (and a decision's raise once decided).
  let paidForPiece = r?.amountCents ?? 0;
  if (r) {
    // (Batch 28 §15) The range runs up to the piece's cap (the same as Pay + Pay more), less what the piece was already paid.
    const b = await disputeBounds(d);
    paidForPiece = b.min;
    if (d.status === "open") {
      min = b.min;
      max = b.max;
      range = disputeRangeLine(b.min, b.max - b.min);
    }
  }
  // (Owner, Oct 29, batch 28 §15) Their chat on this test, so an agreement made in chat can be checked (read-only; no read log).
  const chat = c ? await db.message.findMany({ where: { testId: c.testId, testerId: c.testerId }, orderBy: { createdAt: "asc" }, include: { sender: true }, take: 500 }) : [];
  return {
    id: d.id,
    at: d.createdAt.toISOString(),
    type: "dispute" as const,
    head: `${c ? labelled(displayName(c.tester), flagged.has(c.testerId)) : "?"} vs ${c ? labelled(displayName(c.test.developer), flagged.has(c.test.developerId)) : "?"} · ${c?.title ?? ""} · ${what}`,
    money: `${base} · Paid for this piece ${money(paidForPiece)}${r?.rejected ? " (rejected)" : ""}`,
    range,
    chat: chat.map((m) => ({ id: m.id, who: displayName(m.sender), at: fmtDateTime(m.createdAt), text: m.body })),
    work: await disputedWork(d),
    // (Batch 15 section 27) The developer's side shows on its own line ("added <time>"), live.
    said: `Tester: “${d.reason}”${r?.reason ? ` · Developer's note when ${r.rejected ? "rejecting" : "paying"}: “${r.reason}”` : ""}`,
    devSide: d.devSide,
    devSideAt: d.devSideAt ? d.devSideAt.toISOString() : null,
    dev: c ? displayName(c.test.developer) : "",
    open: d.status === "open",
    decided: d.status === "open" ? "" : `Decided ${d.decidedAt ? fmtDateTime(d.decidedAt) : ""}${d.decidedById ? ` by ${(await adminEmails([d.decidedById]))(d.decidedById)}` : ""}: ${money(d.decidedCents)} in all${d.decisionNote ? ` · “${d.decisionNote}”` : ""}`,
    min,
    max,
  };
}

/**
 * Tests THIS admin paused or stopped, or whose developer this admin suspended, and (batch 15 section 35) the ACCOUNTS this admin suspended (per side) or deleted, newest
 * first. An account row has no testId.
 */
async function mine(adminId: string, cursor: string | null): Promise<Page<MineVM & { date: Date }>> {
  const tests = await db.test.findMany({
    where: { OR: [{ adminPausedById: adminId }, { adminStoppedById: adminId }, { developer: { devSuspendedById: adminId, devSuspendedAt: { not: null } } }] },
    include: { developer: true },
  });
  const all: (MineVM & { date: Date })[] = [];
  for (const t of tests) {
    const reasons: { why: string; date: Date }[] = [];
    if (t.adminStoppedById === adminId) reasons.push({ why: "stopped by you", date: t.stoppedAt ?? t.adminStoppedAt ?? t.updatedAt });
    if (t.adminPausedById === adminId && t.adminPausedAt) reasons.push({ why: "paused by you", date: t.adminPausedAt });
    if (t.developer.devSuspendedById === adminId && t.developer.devSuspendedAt) reasons.push({ why: "developer suspended by you", date: t.developer.devSuspendedAt });
    if (!reasons.length) continue;
    reasons.sort((a, b) => b.date.getTime() - a.date.getTime());
    all.push({ id: t.id, testId: t.id, date: reasons[0].date, at: reasons[0].date.toISOString(), title: t.title, dev: displayName(t.developer), why: reasons.map((r) => r.why).join(" · "), when: fmtDateTime(reasons[0].date) });
  }
  // (Batch 15 section 35) The accounts themselves: each side this admin suspended (still suspended), and each account this admin deleted.
  const events = await db.accountEvent.findMany({ where: { byId: adminId, kind: { in: ["suspended", "deleted"] } }, orderBy: { createdAt: "desc" }, take: 500 });
  const people = new Map((await db.user.findMany({ where: { id: { in: events.map((e) => e.userId) } } })).map((u) => [u.id, u]));
  for (const e of events) {
    const p = people.get(e.userId);
    if (!p) continue;
    if (e.kind === "suspended") {
      const at = e.side === "tester" ? p.testerSuspendedAt : p.devSuspendedAt;
      if (!at || at.getTime() > e.createdAt.getTime() + 5_000 || at.getTime() < e.createdAt.getTime() - 5_000) continue; // reinstated since (or suspended again by someone else)
    }
    const why = e.kind === "deleted" ? "account deleted by you" : `suspended by you (${e.side || "developer"} side)`;
    all.push({ id: `acct-${e.id}`, testId: "", date: e.createdAt, at: e.createdAt.toISOString(), title: p.email, dev: displayName({ ...p, deletedAt: null }), why, when: fmtDateTime(e.createdAt) });
  }
  all.sort((a, b) => b.date.getTime() - a.date.getTime() || (a.id < b.id ? 1 : -1));
  return slice(all, (r) => r.date, cursor);
}

/** (Batch 17 §5) Name or email, any part, case-insensitive; ticks: a role group (Developer / Tester) and a state group (Suspended / On a hold / Deleted), each matching ANY ticked box. */
export function userWhere(f?: ListFilter): Prisma.UserWhereInput {
  const and: Prisma.UserWhereInput[] = [];
  const q = f?.q?.trim();
  // (Batch 20 section 9) From 1 character: 1-2 characters match the start of the email or of a word in the name (or the whole name), 3+ any part.
  if (q) and.push({ OR: [...textFilters(q, true).map((f) => ({ email: f })), ...textFilters(q).map((f) => ({ name: f }))] });
  const t = new Set(f?.ticks ?? []);
  const roles: Prisma.UserWhereInput[] = [...(t.has("developer") ? [{ isDeveloper: true }] : []), ...(t.has("tester") ? [{ isTester: true }] : [])];
  const states: Prisma.UserWhereInput[] = [
    ...(t.has("suspended") ? [{ devSuspendedAt: { not: null } }, { testerSuspendedAt: { not: null } }] : []),
    ...(t.has("hold") ? [{ holdStartedAt: { not: null } }] : []),
    ...(t.has("deleted") ? [{ deletedAt: { not: null } }] : []),
  ];
  if (roles.length) and.push({ OR: roles });
  if (states.length) and.push({ OR: states });
  return and.length ? { AND: and } : {};
}

async function users(cursor: string | null, f?: ListFilter): Promise<Page<UserVM>> {
  const c = parse(cursor);
  const where = userWhere(f);
  // (Batch 20 section 9) An exact name or email match comes first (on the first page; the pages after it leave them out).
  const q = f?.q?.trim() ?? "";
  const exactWhere: Prisma.UserWhereInput | null = q ? { AND: [where, { OR: [{ name: { equals: q, mode: "insensitive" } }, { email: { equals: q, mode: "insensitive" } }] }] } : null;
  const rest: Prisma.UserWhereInput = exactWhere ? { AND: [where, { NOT: exactWhere }] } : where;
  const [exact, list, total] = await Promise.all([
    exactWhere && !c ? db.user.findMany({ where: exactWhere, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: PAGE }) : Promise.resolve([]),
    db.user.findMany({ where: { AND: [rest, olderThan("createdAt", c)] }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: PAGE + 1 }),
    db.user.count({ where }),
  ]);
  const page = [...exact, ...list.slice(0, PAGE)];
  // (Batch 15 sections 16 and 21; batch 17 §6) Each suspended side with the admin who did it, and who deleted it: the same state the profile's admin view shows.
  const states = await accountStates(page);
  const reports = await reportCounts(page.map((u) => u.id));
  const rows: UserVM[] = page.map((x) => {
    const acct = states.get(x.id)!;
    return {
      id: x.id,
      at: x.createdAt.toISOString(),
      line: `${x.email} · ${displayName(x)} · ${[x.isDeveloper && "developer", x.isTester && "tester"].filter(Boolean).join(" + ") || "no role"}${x.isDeveloper ? ` · ${adminSubLine(x)}` : ""}`,
      href: profileHref(x),
      reports: reports.get(x.id) ?? 0,
      state: x.deletedAt ? "deleted" : x.devSuspendedAt || x.testerSuspendedAt ? "suspended" : "normal",
      devSuspended: !!x.devSuspendedAt,
      testerSuspended: !!x.testerSuspendedAt,
      isDeveloper: x.isDeveloper,
      isTester: x.isTester,
      acct,
      stateLine: acct.deleted || (["developer", "tester"] as const).filter((s) => acct.suspended[s]).map((s) => `Suspended (${s} side) ${acct.suspended[s]}`).join(" · "),
    };
  });
  const last = list.slice(0, PAGE).pop();
  return { rows, next: list.length > PAGE && last ? cur(last.createdAt, last.id) : null, total };
}

export async function testRow(t: Awaited<ReturnType<typeof db.test.findMany<{ include: { developer: true; _count: { select: { contracts: true } } } }>>>[number]): Promise<TestVM> {
  // (Batch 15 section 21) Which admin did what to this test, by email.
  // (The state already names who stopped or paused it: the list adds the other actions.)
  // (Batch 27 section 5) The pause's history reads as the test's state now: paused ("paused by X"; an older lift isn't listed), or, once lifted, open with who paused
  // and who lifted it ("open · paused by X, lifted by Y at Thu, Oct 29, 8:29 AM"), never "paused by" alone on a test that isn't paused.
  const acted = (await lastActions([t.id], ["extend-pause", "close-paused", "allow-critical-changes", ...(t.adminStoppedAt ? [] : ["stop-test"])])).get(t.id) ?? [];
  // (Owner, Oct 29, batch 29 section 20) A lift is paired with the pause it ended: only a lift made after the last pause counts (an older one belongs to an earlier pause).
  const lastPause = await db.adminAction.findFirst({ where: { targetId: t.id, action: "pause-test" }, orderBy: { createdAt: "desc" } });
  const lastLift = await db.adminAction.findFirst({ where: { targetId: t.id, action: "unpause-test", ...(lastPause ? { createdAt: { gte: lastPause.createdAt } } : {}) }, orderBy: { createdAt: "desc" } });
  const name = await adminEmails([t.adminStoppedById, t.adminPausedById, lastPause?.adminId, lastLift?.adminId]);
  // (Batch 29 section 20) "the team" whenever an admin's name is missing (a deleted admin).
  const who = (id: string | null | undefined) => name(id) || "the team";
  const lifted = !t.adminPausedAt && lastLift ? `${t.status} · paused by ${who(lastPause?.adminId)}, lifted by ${who(lastLift.adminId)} at ${fmtDateTime(lastLift.createdAt)}` : "";
  // (Batch 29 section 20) A team-paused test closed after 7 days keeps its adminPausedAt (pauseClosure.ts): it reads as closed, never as paused (no Lift the pause).
  const closed = !!t.pauseClosedAt;
  const state = t.adminStoppedAt ? `stopped by ${who(t.adminStoppedById)}` : closed ? "closed" : t.adminPausedAt ? `paused by ${who(t.adminPausedById)}` : lifted || (lastPause ? `${t.status} · paused by ${who(lastPause.adminId)} at ${fmtDateTime(lastPause.createdAt)}` : t.status);
  return {
    id: t.id,
    at: t.createdAt.toISOString(),
    line: `${fmtDateTime(t.createdAt)} · “${t.title}” · ${state} · ${displayName(t.developer)} · ${t._count.contracts} joined${countsText(t.criticalCounts) ? ` · changes since testers joined: ${countsText(t.criticalCounts)}` : ""}${acted.length ? ` · ${acted.slice(0, 3).join(" · ")}` : ""}`,
    href: `/app/find/${t.id}`,
    status: t.status,
    adminPaused: !!t.adminPausedAt && !closed && t.status !== "stopped",
    stopped: t.status === "stopped",
    critical: lockedFields(countsOf(t.criticalCounts)).length, // fields that used all 3 changes
    closedLine: t.pauseClosedAt ? `Closed after 7 days paused: ${t.pauseClosedReason}` : "",
  };
}

/**
 * (Batch 17 §5) Test name, product name or the developer's name or email, any part, case-insensitive; ticks (ANY of): Open (taking testers, not paused), Joining
 * closed (closed to new testers, or past Open until), Paused (any cause: a hold, a suspension or the team), Stopped / closed, Draft.
 */
export function testWhere(f?: ListFilter, now = new Date()): Prisma.TestWhereInput {
  const and: Prisma.TestWhereInput[] = [];
  const q = f?.q?.trim();
  if (q) {
    const has = { contains: q, mode: "insensitive" as const };
    and.push({ OR: [{ title: has }, { productName: has }, { developer: { OR: [{ name: has }, { email: has }] } }] });
  }
  const t = new Set(f?.ticks ?? []);
  const notPaused: Prisma.TestWhereInput = { pausedSince: null, adminPausedAt: null };
  const states: Prisma.TestWhereInput[] = [
    ...(t.has("open") ? [{ status: "open", ...notPaused, OR: [{ openUntil: null }, { openUntil: { gte: now } }] }] : []),
    ...(t.has("joining-closed") ? [{ status: "closed", ...notPaused }, { status: "open", ...notPaused, openUntil: { lt: now } }] : []),
    ...(t.has("paused") ? [{ status: { not: "stopped" }, OR: [{ pausedSince: { not: null } }, { adminPausedAt: { not: null } }] }] : []),
    ...(t.has("stopped") ? [{ status: "stopped" }] : []),
    ...(t.has("draft") ? [{ status: "draft", ...notPaused }] : []),
  ];
  if (states.length) and.push({ OR: states });
  return and.length ? { AND: and } : {};
}

async function tests(cursor: string | null, f?: ListFilter): Promise<Page<TestVM>> {
  const c = parse(cursor);
  const where = testWhere(f);
  const [list, total] = await Promise.all([
    db.test.findMany({ where: { AND: [where, olderThan("createdAt", c)] }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: PAGE + 1, include: { developer: true, _count: { select: { contracts: true } } } }),
    db.test.count({ where }),
  ]);
  const page = list.slice(0, PAGE);
  const last = page[page.length - 1];
  return { rows: await Promise.all(page.map(testRow)), next: list.length > PAGE && last ? cur(last.createdAt, last.id) : null, total };
}

async function noShows(cursor: string | null): Promise<Page<TextVM>> {
  const c = parse(cursor);
  const where = { noShowBy: { not: null } };
  const [list, total] = await Promise.all([
    db.call.findMany({ where: { ...where, ...(c ? { OR: [{ noShowAt: { lt: c.at } }, { noShowAt: c.at, id: { lt: c.id } }] } : {}) }, orderBy: [{ noShowAt: "desc" }, { id: "desc" }], take: PAGE + 1, include: { contract: { include: { tester: true, test: { include: { developer: true } } } } } }),
    db.call.count({ where }),
  ]);
  const page = list.slice(0, PAGE);
  const flagged = await reportedOver3(page.flatMap((x) => [x.contract.testerId, x.contract.test.developerId]));
  const last = page[page.length - 1];
  return {
    rows: page.map((x) => ({ id: x.id, at: (x.noShowAt ?? x.startsAt).toISOString(), text: `${fmtDateTime(x.startsAt)} · “${x.contract.title}” · reported by the ${x.noShowBy} (${x.noShowBy === "tester" ? labelled(displayName(x.contract.tester), flagged.has(x.contract.testerId)) : labelled(displayName(x.contract.test.developer), flagged.has(x.contract.test.developerId))}) against ${x.noShowBy === "tester" ? labelled(displayName(x.contract.test.developer), flagged.has(x.contract.test.developerId)) : labelled(displayName(x.contract.tester), flagged.has(x.contract.testerId))}: “${x.noShowNote}”` })),
    next: list.length > PAGE && last ? cur(last.noShowAt ?? last.startsAt, last.id) : null,
    total,
  };
}

/** (Batch 15 section 21) Contact us messages, newest first: each in a scroll box about 8 lines tall; who marked it replied and when. */
export type ContactVM = { id: string; at: string; from: string; topic: string; message: string; replied: string };
async function contact(cursor: string | null): Promise<Page<ContactVM>> {
  const c = parse(cursor);
  const [list, total] = await Promise.all([
    db.contactMessage.findMany({ where: olderThan("createdAt", c), orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: PAGE + 1 }),
    db.contactMessage.count(),
  ]);
  const page = list.slice(0, PAGE);
  const users = new Map((await db.user.findMany({ where: { id: { in: page.map((m) => m.userId) } }, select: { id: true, email: true } })).map((u) => [u.id, u.email]));
  const name = await adminEmails(page.map((m) => m.repliedById));
  const last = page[page.length - 1];
  return {
    rows: page.map((m) => ({ id: m.id, at: m.createdAt.toISOString(), from: `${fmtDateTime(m.createdAt)} · ${users.get(m.userId) ?? "a deleted account"}`, topic: m.topic, message: m.message, replied: m.repliedById ? `Replied by ${name(m.repliedById)}${m.repliedAt ? ` · ${fmtDateTime(m.repliedAt)}` : ""}` : "" })),
    next: list.length > PAGE && last ? cur(last.createdAt, last.id) : null,
    total,
  };
}

/** (Batch 15 section 8) The disputed piece for the admin's "See the work" fold (the developer's piece view). */
async function disputedWork(d: { submissionId: string | null; callId: string | null }): Promise<DisputedWork | null> {
  if (d.callId) {
    const call = await db.call.findUnique({ where: { id: d.callId }, include: { contract: true } });
    if (!call) return null;
    const m = callMinutesOf(call);
    return { kind: "call", when: fmtDateTime(call.startsAt), length: m != null ? `${m} min (booked ${call.minutes})` : `booked ${call.minutes} min`, rate: call.rateCents != null ? `${money(call.rateCents)}/h` : "Not listed" };
  }
  const s = d.submissionId ? await db.submission.findUnique({ where: { id: d.submissionId }, include: { recordings: true, contract: true } }) : null;
  if (!s) return null;
  return {
    kind: "submission", part: s.kind === "recording" ? "recording" : "written", setUntil: s.setUntil ? s.setUntil.toISOString() : null,
    items: s.kind === "written" ? itemsOf(s.answers, writtenQuestionsOf(s.contract)) : [], notes: s.notes,
    files: s.recordings.filter((r) => r.uploadedAt).map((r) => ({ id: r.id, filename: r.filename, contentType: r.contentType, sizeBytes: r.sizeBytes })),
  };
}

async function payments(cursor: string | null): Promise<Page<TextVM>> {
  const c = parse(cursor);
  const [list, total] = await Promise.all([
    db.payment.findMany({ where: olderThan("createdAt", c), orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: PAGE + 1 }),
    db.payment.count(),
  ]);
  const page = list.slice(0, PAGE);
  const emails = new Map((await db.user.findMany({ where: { id: { in: page.flatMap((p) => [p.developerId, p.testerId]) } }, select: { id: true, email: true } })).map((u) => [u.id, u.email]));
  // (Batch 15 section 21) Refunds and payouts of held shares, and transfers sent by hand: which admin.
  const acted = await lastActions(page.map((p) => p.id), ["release-share", "refund-share", "transfer"]);
  const last = page[page.length - 1];
  return {
    rows: page.map((p) => ({ id: p.id, at: p.createdAt.toISOString(), text: `${fmtDateTime(p.createdAt)} · ${p.kind} · ${money(p.amountCents)} (fee ${money(p.feeCents)}) · ${p.status}${p.failure ? ` · ${p.failure}` : ""} · ${emails.get(p.developerId)} → ${emails.get(p.testerId)}${acted.get(p.id)?.length ? ` · ${acted.get(p.id)![0]}` : ""}` })),
    next: list.length > PAGE && last ? cur(last.createdAt, last.id) : null,
    total,
  };
}

/**
 * (Owner, Oct 29, batch 26 section 12) "Payouts waiting for a payout account": every one, in the plain scroll box of batch 17 §7 (the next 25 as it nears its end,
 * "That's all (N)"). (Batch 28 §7) Oldest first: the longest-waiting payouts are the most urgent. Read-only: each goes out on its own when the tester finishes their payout
 * setup.
 */
export const WAITING_PAYOUT = { transferStatus: "waiting", status: "charged" } as const;
async function payouts(cursor: string | null): Promise<Page<TextVM>> {
  const c = parse(cursor);
  const [list, total] = await Promise.all([
    db.payment.findMany({ where: { ...WAITING_PAYOUT, ...newerThan("createdAt", c) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: PAGE + 1 }),
    db.payment.count({ where: WAITING_PAYOUT }),
  ]);
  const page = list.slice(0, PAGE);
  const emails = new Map((await db.user.findMany({ where: { id: { in: page.map((p) => p.testerId) } }, select: { id: true, email: true } })).map((u) => [u.id, u.email]));
  const last = page[page.length - 1];
  return {
    rows: page.map((p) => ({ id: p.id, at: p.createdAt.toISOString(), text: `${emails.get(p.testerId) ?? "?"} · ${money(p.testerCents)} · waiting since ${fmtDateTime(p.createdAt)}` })),
    next: list.length > PAGE && last ? cur(last.createdAt, last.id) : null,
    total,
  };
}

const CAUSES = { hold: "payment hold", chargeback: "chargeback hold", suspension: "suspended", team: "paused by the team" } as const;

async function paused(cursor: string | null): Promise<Page<PausedVM & { date: Date }>> {
  const all = (await pausedTestsForAdmin()).map(({ test: t, info, dev }) => ({
    id: t.id,
    date: info.at,
    at: info.at.toISOString(),
    text: `“${t.title}” · ${dev} (${t.developer.email}) · ${info.causes.map((c) => CAUSES[c]).join(" + ")} since ${fmtDateTime(info.since)}`,
    closure: `${pauseCountdownLine(info.at, info.causes)} (${fmtDateTime(info.at)})`,
    extended: info.extended,
  }));
  return slice(all, (r) => r.date, cursor);
}

async function chargebacks(cursor: string | null): Promise<Page<ChargebackVM & { date: Date }>> {
  const all = (await chargebackHolds()).map(({ dev, steps, chargebacks: cbs }) => ({
    id: dev.id,
    date: dev.holdStartedAt!,
    at: dev.holdStartedAt!.toISOString(),
    email: dev.email,
    since: fmtDateTime(dev.holdStartedAt!),
    chargebacks: cbs.map((p) => `Chargeback open: ${money(p.amountCents)} · ${p.stripePaymentIntentId}`),
    cardVerified: steps.cardVerified,
    owedPaid: steps.owedPaid,
    // (Batch 23 section 6) Pay what you owe reserves: the row says how much is reserved against what is owed.
    // (Batch 28 §8) What was added since the reservation is charged after the hold lifts (it never blocks Approve).
    owedLine: steps.owedPaid ? (steps.reservedCents ? ` (${adminReservedLine(steps.reservedCents, steps.addedCents)})` : "") : ` (${money(steps.owedCents)} owed, ${money(steps.reservedCents)} reserved)`,
    reservedCents: steps.reservedCents,
    expired: steps.expired,
  }));
  return slice(all, (r) => r.date, cursor);
}

/**
 * (Owner, Oct 29, batch 29 section 20) The Tests list's rows by id: the live check refreshes every row shown, also those loaded further down by scrolling (beyond the
 * first 25), so their state line and Pause / Lift the pause follow a pause set or lifted elsewhere. At most 100 at once.
 */
export async function testRowsByIds(ids: string[]): Promise<TestVM[]> {
  const list = await db.test.findMany({ where: { id: { in: ids.slice(0, 100) } }, include: { developer: true, _count: { select: { contracts: true } } } });
  return Promise.all(list.map(testRow));
}

/** One page of one list. `adminId` is the admin looking (for "mine"). */
export async function adminPage(kind: Kind, adminId: string, cursor: string | null, arg = "", filter?: ListFilter): Promise<Page<unknown>> {
  const p: Page<unknown> = await (async () => {
    switch (kind) {
      case "contact": return contact(cursor);
      case "disputes": return disputes("open", cursor);
      case "decided": return disputes("decided", cursor);
      case "mine": return mine(adminId, cursor);
      case "users": return users(cursor, filter);
      case "tests": return tests(cursor, filter);
      case "noshows": return noShows(cursor);
      case "payments": return payments(cursor);
      case "payouts": return payouts(cursor);
      case "paused": return paused(cursor);
      case "chargebacks": return chargebacks(cursor);
      case "lifts": return lifts(cursor);
      case "reports": return reports(cursor);
      case "u-payments": case "u-payouts": case "u-disputes": case "u-chargebacks": case "u-holds": case "u-tests": case "u-reports": case "u-parts": return userBox(kind, arg, cursor);
      case "t-timeline": case "t-contracts": case "t-payments": return testBox(kind, arg, cursor);
    }
  })();
  return { ...p, rows: p.rows.map((r) => { const { date, ...rest } = r as Record<string, unknown>; void date; return rest; }) };
}

// ---------- Lifts (owner, Oct 27) ----------

/** Hold lifts waiting for an admin's Approve: the 4th hold onward, once the developer has paid what they owe. Newest (by when they paid) first. */
async function lifts(cursor: string | null): Promise<Page<LiftVM & { date: Date }>> {
  const devs = await db.user.findMany({ where: { holdStartedAt: { not: null }, holdReason: { not: "chargeback" }, holdCount: { gt: HOLD_APPROVAL_AFTER }, holdApprovedAt: null }, take: 2000 });
  const flagged = await reportedOver3(devs.map((d) => d.id));
  const all: (LiftVM & { date: Date })[] = [];
  for (const d of devs) {
    if ((await db.payment.count({ where: { developerId: d.id, status: "failed", owedUntil: { not: null }, settledAt: null } })) > 0) continue; // still owes: nothing to approve yet
    const settled = await db.payment.findMany({ where: { developerId: d.id, owedUntil: { not: null }, settledAt: { gte: d.holdStartedAt! } }, orderBy: { settledAt: "desc" } });
    const total = settled.reduce((a, p) => a + p.amountCents, 0);
    const paidAt = settled[0]?.settledAt ?? d.holdStartedAt!;
    all.push({ id: d.id, date: paidAt, at: paidAt.toISOString(), head: `${labelled(displayName(d), flagged.has(d.id))} (${d.email}) · ${MANY_HOLDS_LABEL}`, owed: settled.length ? `Owed ${money(total)}` : "Nothing was owed", paid: settled.length ? `paid ${fmtDateTime(paidAt)}` : `on hold since ${fmtDateTime(d.holdStartedAt!)}` });
  }
  all.sort((a, b) => b.date.getTime() - a.date.getTime() || (a.id < b.id ? 1 : -1));
  return slice(all, (r) => r.date, cursor);
}

// ---------- Reports (owner, Oct 27) ----------

async function reports(cursor: string | null): Promise<Page<ReportVM>> {
  const c = parse(cursor);
  const [list, total] = await Promise.all([
    db.report.findMany({ where: olderThan("createdAt", c), orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: PAGE + 1 }),
    db.report.count(),
  ]);
  const page = list.slice(0, PAGE);
  const users = new Map((await db.user.findMany({ where: { id: { in: page.flatMap((r) => [r.reporterId, r.reportedId]) } } })).map((u) => [u.id, u]));
  const flagged = await reportedOver3(page.flatMap((r) => [r.reporterId, r.reportedId]));
  const last = page[page.length - 1];
  return {
    rows: page.map((r) => {
      const a = users.get(r.reporterId), b = users.get(r.reportedId);
      return { id: r.id, at: r.createdAt.toISOString(), reporter: a ? labelled(displayName(a), flagged.has(a.id)) : "?", reporterHref: a ? profileHref(a) : "", reported: b ? labelled(displayName(b), flagged.has(b.id)) : "?", reportedHref: b ? profileHref(b) : "", when: fmtDateTime(r.createdAt), note: r.note };
    }),
    next: list.length > PAGE && last ? cur(last.createdAt, last.id) : null,
    total,
  };
}

// ---------- A person's admin boxes (owner, Oct 27) ----------

type Row = TextVM & { date: Date };
const mk = (src: string, id: string, date: Date, text: string, href?: string): Row => ({ id: `${src}-${id}`, date, at: date.toISOString(), text: `${fmtDateTime(date)} · ${text}`, ...(href ? { href } : {}) });
const sortDesc = (rows: Row[]) => rows.sort((a, b) => b.date.getTime() - a.date.getTime() || (a.id < b.id ? 1 : -1));

/** The totals line at the top of a person's boxes: spent / paid out, and how many reports, disputes, chargebacks, holds and suspensions. */
export async function userTotals(userId: string) {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const contracts = await db.contract.findMany({ where: { OR: [{ testerId: userId }, { test: { developerId: userId } }] }, select: { id: true } });
  const cids = contracts.map((c) => c.id);
  const [spent, paidOut, disputes, chargebacks, suspensions, reports, partsSent, partsPaid] = await Promise.all([
    db.payment.aggregate({ where: { developerId: userId, status: { in: ["charged", "not_set_up"] } }, _sum: { amountCents: true } }),
    db.payment.aggregate({ where: { testerId: userId, kind: { not: "subscription" }, status: { in: ["charged", "not_set_up"] } }, _sum: { testerCents: true } }),
    db.dispute.count({ where: { OR: [{ testerId: userId }, { contractId: { in: cids } }] } }),
    db.payment.count({ where: { developerId: userId, chargebackAt: { not: null } } }),
    db.accountEvent.count({ where: { userId, kind: "suspended" } }),
    reportCounts([userId]),
    db.submission.count({ where: { contract: { testerId: userId } } }),
    db.payment.aggregate({ where: { testerId: userId, submissionId: { not: null }, status: { in: ["charged", "not_set_up"] } }, _sum: { testerCents: true } }),
  ]);
  const n = reports.get(userId) ?? 0;
  const parts: string[] = [];
  if (u.isDeveloper) parts.push(`Total spent ${money(spent._sum.amountCents ?? 0)}`);
  if (u.isTester) parts.push(`Total paid out ${money(paidOut._sum.testerCents ?? 0)}`);
  parts.push(`${n} report${n === 1 ? "" : "s"}`, `${disputes} dispute${disputes === 1 ? "" : "s"}`, `${chargebacks} chargeback${chargebacks === 1 ? "" : "s"}`, `${u.holdCount} hold${u.holdCount === 1 ? "" : "s"}`, `${suspensions} suspension${suspensions === 1 ? "" : "s"}`);
  return { line: parts.join(" · "), partsLine: `${partsSent} part${partsSent === 1 ? "" : "s"} sent · ${money(partsPaid._sum.testerCents ?? 0)} paid out for them`, reportedOver3: n > REPORTED_OVER };
}

async function userBox(kind: Kind, userId: string, cursor: string | null): Promise<Page<Row>> {
  const rows: Row[] = [];
  const name = async (id: string | null) => (id ? (await db.user.findUnique({ where: { id }, select: { email: true } }))?.email ?? "an admin" : "the system");
  if (kind === "u-payments" || kind === "u-payouts") {
    const dev = kind === "u-payments";
    const pays = await db.payment.findMany({ where: dev ? { developerId: userId } : { testerId: userId, kind: { not: "subscription" } }, orderBy: { createdAt: "desc" }, take: 2000 });
    const people = new Map((await db.user.findMany({ where: { id: { in: pays.map((p) => (dev ? p.testerId : p.developerId)) } }, select: { id: true, email: true } })).map((u) => [u.id, u.email]));
    for (const p of pays) rows.push(mk("pay", p.id, p.createdAt, dev ? `${p.kind} ${money(p.amountCents)} to ${people.get(p.testerId)} · ${p.status}${p.chargeback === "open" ? " · chargeback open" : ""}` : `${money(p.testerCents)} from ${people.get(p.developerId)} (${p.kind}) · payout ${p.transferStatus}`));
  } else if (kind === "u-disputes") {
    const cids = (await db.contract.findMany({ where: { test: { developerId: userId } }, select: { id: true } })).map((c) => c.id);
    const ds = await db.dispute.findMany({ where: { OR: [{ testerId: userId }, { contractId: { in: cids } }] }, orderBy: { createdAt: "desc" }, take: 2000 });
    for (const d of ds) {
      const c = await db.contract.findUnique({ where: { id: d.contractId } });
      rows.push(mk("dispute", d.id, d.createdAt, `“${c?.title ?? "?"}”: “${d.reason}” · ${d.status === "open" ? "open" : `decided ${money(d.decidedCents)} by ${await name(d.decidedById)}`}`, c ? `/app/find/${c.testId}` : undefined));
    }
  } else if (kind === "u-chargebacks") {
    for (const p of await db.payment.findMany({ where: { developerId: userId, chargebackAt: { not: null } }, orderBy: { chargebackAt: "desc" }, take: 2000 })) rows.push(mk("cb", p.id, p.chargebackAt!, `Chargeback ${money(p.amountCents)} (${p.chargeback})`));
  } else if (kind === "u-holds") {
    const labels: Record<string, string> = { hold: "Payment hold started", "hold-lifted": "Payment hold lifted", "hold-approved": "Hold lift approved", suspended: "Suspended", reinstated: "Reinstated" };
    for (const e of await db.accountEvent.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 2000 })) rows.push(mk("acct", e.id, e.createdAt, `${labels[e.kind] ?? e.kind}${e.byId ? ` by ${await name(e.byId)}` : ""}${e.note ? `: ${e.note}` : ""}`));
  } else if (kind === "u-tests") {
    for (const t of await db.test.findMany({ where: { developerId: userId }, orderBy: { createdAt: "desc" }, take: 2000 })) rows.push(mk("posted", t.id, t.createdAt, `Posted “${t.title}” (${t.status})`, `/app/find/${t.id}`));
    for (const c of await db.contract.findMany({ where: { testerId: userId }, orderBy: { joinedAt: "desc" }, take: 2000 })) rows.push(mk("joined", c.id, c.joinedAt, `Joined “${c.title}” (${c.status})`, `/app/find/${c.testId}`));
  } else if (kind === "u-reports") {
    for (const r of await db.report.findMany({ where: { reportedId: userId }, orderBy: { createdAt: "desc" }, take: 2000 })) rows.push(mk("report", r.id, r.createdAt, `Reported by ${await name(r.reporterId)}: “${r.note}”`));
    const calls = await db.call.findMany({ where: { noShowBy: { not: null }, OR: [{ noShowBy: "tester", contract: { test: { developerId: userId } } }, { noShowBy: "developer", contract: { testerId: userId } }] }, orderBy: { noShowAt: "desc" }, take: 2000, include: { contract: true } });
    for (const c of calls) rows.push(mk("noshow", c.id, c.noShowAt ?? c.startsAt, `Call report on “${c.contract.title}” by the ${c.noShowBy}: “${c.noShowNote}”`));
  } else if (kind === "u-parts") {
    const subs = await db.submission.findMany({ where: { contract: { testerId: userId } }, include: { contract: true, review: true }, orderBy: { sentAt: "desc" }, take: 2000 });
    for (const s of subs) rows.push(mk("part", s.id, s.sentAt, `“${s.contract.title}”: ${s.kind === "recording" ? "recording" : "written answers"} · ${s.review ? (s.review.rejected ? "rejected" : `paid ${money(s.review.amountCents)}`) : "waiting for review"}`, `/app/find/${s.contract.testId}`));
  }
  sortDesc(rows);
  return slice(rows, (r) => r.date, cursor);
}

// ---------- A test's admin boxes (owner, Oct 27) ----------

async function testBox(kind: Kind, testId: string, cursor: string | null): Promise<Page<Row>> {
  const t = await db.test.findUnique({ where: { id: testId }, include: { developer: true } });
  if (!t) return { rows: [], next: null, total: 0 };
  const contracts = await db.contract.findMany({ where: { testId }, include: { tester: true } });
  const ids = contracts.map((c) => c.id);
  const byContract = new Map(contracts.map((c) => [c.id, displayName(c.tester)]));
  const of = (cid: string | null) => (cid ? byContract.get(cid) ?? "a tester" : "");
  const adminIds = [t.adminPausedById, t.adminStoppedById, t.developer.devSuspendedById].filter((x): x is string => !!x);
  const admins = new Map((await db.user.findMany({ where: { id: { in: adminIds } }, select: { id: true, email: true } })).map((u) => [u.id, u.email]));
  const who = (id: string | null | undefined) => (id ? admins.get(id) ?? "an admin" : "an admin");
  const rows: Row[] = [];
  if (kind === "t-timeline") {
    // (Owner, Oct 29, batch 22 section 4) For admins every line names who did it, in the third person ("Nora Lane paid Ana Silva $10.00 …", "Nora Lane's tests are
    // running again", "Nora Lane's developer account was paused (by ana@…)"), and each dispute and each decision shows once.
    const dev = displayName(t.developer);
    const [events, suspensions, actions, disputes] = await Promise.all([
      // (Batch 30 §15) Not the session pages' stored listing values (they're never a line).
      db.testEvent.findMany({ where: { testId, kind: { not: LISTING_VALUES } }, orderBy: { createdAt: "desc" }, take: 3000 }),
      db.accountEvent.findMany({ where: { userId: t.developerId, kind: "suspended" }, orderBy: { createdAt: "asc" } }),
      db.adminAction.findMany({ where: { targetId: testId, action: { in: ["pause-test", "unpause-test", "stop-test", "close-paused"] } }, orderBy: { createdAt: "asc" } }),
      db.dispute.findMany({ where: { contractId: { in: ids } }, include: { submission: { select: { kind: true } } } }),
    ]);
    const emails = await adminEmails([...suspensions.map((s) => s.byId), ...actions.map((a) => a.adminId), ...disputes.map((d) => d.decidedById)]);
    /** The admin action of that kind closest to the moment (the route records it right after the change). */
    const by = (action: string, at: Date) => {
      const near = actions.filter((a) => a.action === action && Math.abs(a.createdAt.getTime() - at.getTime()) < 60_000).sort((a, b) => Math.abs(a.createdAt.getTime() - at.getTime()) - Math.abs(b.createdAt.getTime() - at.getTime()))[0];
      return (near && emails(near.adminId)) || "The team";
    };
    const suspendedBy = (at: Date) => {
      const s = suspensions.filter((x) => x.createdAt.getTime() <= at.getTime() + 60_000).pop();
      return (s && emails(s.byId)) || "the team";
    };
    const thirdPerson = (e: { text: string; createdAt: Date }) => {
      const x = e.text;
      if (x === "Your account is paused") return `${dev}'s developer account was paused (by ${suspendedBy(e.createdAt)})`;
      if (x === "Your tests are running again") return `${dev}'s tests are running again`;
      if (x === "Your tests are paused until you pay what you owe") return `${dev}'s tests are paused until they pay what they owe`;
      if (x === SUBSCRIPTION_ENDED) return `${dev}'s subscription ended`;
      if (x.startsWith("Your bank reversed your ")) return `${dev}'s bank reversed their ${x.slice("Your bank reversed your ".length)}`;
      if (x.startsWith("You ")) return `${dev} ${x.slice(4)}`;
      if (x === "The team paused this test") return `${by("pause-test", e.createdAt)} paused this test${t.adminPausedAt && Math.abs(t.adminPausedAt.getTime() - e.createdAt.getTime()) < 5_000 && t.adminNote ? `: ${t.adminNote}` : ""}`;
      if (x === "The team lifted the pause on this test") return `${by("unpause-test", e.createdAt)} lifted the pause on this test`;
      if (x === "The team stopped this test") return `${by("stop-test", e.createdAt)} stopped this test${t.adminStoppedAt && t.adminNote ? `: ${t.adminNote}` : ""}`;
      return x.replace(/ rated you$/, ` rated ${dev}`).replace(/\(rated you\)$/, `(rated ${dev})`);
    };
    const decisions = events.filter((e) => e.kind === "admin" && e.text.startsWith("The team decided"));
    for (const e of events) {
      // One line per dispute and per decision: those come from the disputes themselves (below).
      if (e.kind === "dispute" || decisions.includes(e)) continue;
      // The closing after a pause has its own line (below), with who closed it.
      if (t.pauseClosedAt && e.text === "The test was closed") continue;
      const text = thirdPerson(e);
      const name = of(e.contractId);
      rows.push(mk("event", e.id, e.createdAt, `${text}${name && !text.includes(name) ? ` (${name})` : ""}`));
    }
    for (const i of await db.invite.findMany({ where: { testId } })) rows.push(mk("invite", i.id, i.createdAt, `Invited a tester (${i.status})`));
    for (const k of await db.call.findMany({ where: { contractId: { in: ids } } })) {
      rows.push(mk("call", k.id, k.createdAt, `Call booked with ${of(k.contractId)} for ${fmtDateTime(k.startsAt)}`));
      if (k.status === "cancelled" && k.cancelledAt) rows.push(mk("call-cancelled", k.id, k.cancelledAt, `Call with ${of(k.contractId)} cancelled by ${k.cancelledBy === "developer" ? dev : k.cancelledBy === "tester" ? of(k.contractId) : "the app"}`));
    }
    for (const d of disputes) {
      const part = d.callId ? "live call" : d.submission?.kind === "recording" ? "recording" : "written answers";
      rows.push({ ...mk("dispute", d.id, d.createdAt, `${of(d.contractId)} disputed the pay for their ${part}:`), em: d.reason });
      if (d.decidedAt) {
        const ev = decisions.filter((e) => e.contractId === d.contractId && Math.abs(e.createdAt.getTime() - d.decidedAt!.getTime()) < 60_000)[0];
        const what = ev ? ev.text.replace(/^The team decided [^:]*: /, "") : `${money(d.decidedCents ?? 0)} in all`;
        rows.push(mk("dispute-decided", d.id, d.decidedAt, `${emails(d.decidedById) || "The team"} decided ${of(d.contractId)}'s dispute: ${what}`));
      }
    }
    if (t.pauseClosedAt) rows.push(mk("pause-closed", t.id, t.pauseClosedAt, `Closed after being paused${t.adminStoppedById ? ` (by ${who(t.adminStoppedById)})` : " (by the daily job)"}: ${t.pauseClosedReason}`));
  } else if (kind === "t-contracts") {
    for (const c of contracts) rows.push(mk("contract", c.id, c.joinedAt, `${displayName(c.tester)} joined on: ${termsLine(c)}`));
    for (const o of await db.termsOffer.findMany({ where: { testId } })) {
      rows.push(mk("offer", o.id, o.createdAt, `New terms offered to ${of(o.contractId)}: ${o.diff}`));
      if (o.decidedAt) rows.push(mk("offer-decided", o.id, o.decidedAt, `${of(o.contractId)} ${o.status === "switched" ? "switched to" : o.status === "kept" ? "kept their terms instead of" : "did not take"} the new terms`));
    }
  } else {
    for (const p of await db.payment.findMany({ where: { contractId: { in: ids } } })) rows.push(mk("payment", p.id, p.createdAt, `${p.kind} ${money(p.amountCents)} to ${of(p.contractId)} · ${p.status}${p.chargeback === "open" ? " · chargeback open" : ""}`));
  }
  sortDesc(rows);
  return slice(rows, (r) => r.date, cursor);
}
