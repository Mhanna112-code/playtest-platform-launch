import { db } from "@/lib/db";
import { displayName, fmtDateTime, money } from "@/lib/format";
import { pauseCountdownLine } from "@/lib/pause";
import { chargebackHolds } from "./chargeback";
import { disputeBounds } from "./payments";
import { NOT_LISTED, termsLine } from "@/lib/rules";
import { CRITICAL_FIELDS, CRITICAL_KEYS, countsOf, lockedFields } from "@/lib/limits";
import { adminSubLine } from "@/lib/subscription";
import { pausedTestsForAdmin } from "./pauseClosure";
import { REPORTED_OVER, labelled, reportCounts, reportedOver3 } from "./reports";
import { HOLD_APPROVAL_AFTER, MANY_HOLDS_LABEL } from "@/lib/rules";
import { callMinutesOf } from "@/lib/callMeasure";
import { itemsOf } from "@/lib/answerSets";
import { writtenQuestions as writtenQuestionsOf } from "./tests";
import type { DisputedWork } from "@/app/admin/DisputeWork";

// (Owner, Oct 26) The admin dashboard's lists. Every long list is a page of 25 with Previous / Next (keyset by date: newest first; the lists ordered by
// closure date go soonest first). Rows are plain, already-formatted view models so the same loaders serve the page and /api/admin/more.

export const PAGE = 25;
export type Page<T> = { rows: T[]; next: string | null; total: number };

export type DisputeVM = { work?: DisputedWork | null; type?: "dispute"; id: string; at: string; head: string; money: string; said: string; open: boolean; decided: string; min: number; max: number; devSide?: string; devSideAt?: string | null; dev?: string };
export type MineVM = { id: string; at: string; title: string; dev: string; why: string; when: string; testId: string };
export type UserVM = { href: string; id: string; at: string; line: string; reports: number; state: "deleted" | "suspended" | "normal"; stateLine: string; devSuspended?: boolean; testerSuspended?: boolean; isDeveloper?: boolean; isTester?: boolean };
export type TestVM = { href: string; id: string; at: string; line: string; status: string; adminPaused: boolean; stopped: boolean; critical: number; closedLine: string };
/** (Owner, Oct 28 afternoon) The per-field change counts on an admin test row: "NDA 3, steps 1". */
const countsText = (v: unknown) => { const c = countsOf(v); return CRITICAL_KEYS.filter((k) => c[k] > 0).map((k) => `${CRITICAL_FIELDS[k]} ${c[k]}`).join(", "); };
export type TextVM = { id: string; at: string; text: string; href?: string };
/** A hold lift waiting for an admin's Approve (the 4th hold onward), in its own box: styled like a dispute row. */
export type LiftVM = { id: string; at: string; head: string; owed: string; paid: string };
/** A profile report: who reported whom, when, why, with links to both profiles. */
export type ReportVM = { id: string; at: string; reporter: string; reporterHref: string; reported: string; reportedHref: string; when: string; note: string };
export type PausedVM = { id: string; at: string; text: string; closure: string; extended: boolean };
export type ChargebackVM = { id: string; at: string; email: string; since: string; chargebacks: string[]; cardVerified: boolean; owedPaid: boolean; owedLine: string };

export type Kind = "contact" | "disputes" | "decided" | "mine" | "users" | "tests" | "noshows" | "payments" | "waitlist" | "paused" | "chargebacks" | "lifts" | "reports" | "u-payments" | "u-payouts" | "u-disputes" | "u-chargebacks" | "u-holds" | "u-tests" | "u-reports" | "u-parts" | "t-timeline" | "t-contracts" | "t-payments";
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
  "release-share": "released to the tester", "refund-share": "refunded to the developer", transfer: "sent", "approve-hold": "lift approved", "approve-chargeback": "lift approved", "delete-account": "deleted",
  suspend: "suspended", unsuspend: "reinstated", decide: "decided", "contact-replied": "marked replied", "approve-outage": "outage approved",
};

export const KINDS: Kind[] = ["contact", "disputes", "decided", "mine", "users", "tests", "noshows", "payments", "waitlist", "paused", "chargebacks", "lifts", "reports", "u-payments", "u-payouts", "u-disputes", "u-chargebacks", "u-holds", "u-tests", "u-reports", "u-parts", "t-timeline", "t-contracts", "t-payments"];

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
  let min = 0, max = 0, partSoFar = "", base = r?.agreedCents == null ? NOT_LISTED : `Listing ${money(r.agreedCents)}`;
  if (d.status === "open" && r) {
    const b = await disputeBounds(d);
    min = b.min;
    max = b.max;
    partSoFar = ` · Paid for this part so far ${money(b.other + r.amountCents)}`;
    // (Batch 10) An unlisted part: the admin's range goes up to its max minus what was already paid.
    if (b.unlisted) base = `${NOT_LISTED} (max ${money(b.listing)})`;
  }
  return {
    id: d.id,
    at: d.createdAt.toISOString(),
    type: "dispute" as const,
    head: `${c ? labelled(displayName(c.tester), flagged.has(c.testerId)) : "?"} vs ${c ? labelled(displayName(c.test.developer), flagged.has(c.test.developerId)) : "?"} · ${c?.title ?? ""} · ${what}`,
    money: `${base} · Paid for this piece ${money(r?.amountCents)}${r?.rejected ? " (rejected)" : ""}${partSoFar}`,
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

async function users(cursor: string | null): Promise<Page<UserVM>> {
  const c = parse(cursor);
  const [list, total] = await Promise.all([
    db.user.findMany({ where: olderThan("createdAt", c), orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: PAGE + 1 }),
    db.user.count(),
  ]);
  const page = list.slice(0, PAGE);
  const names = new Map((await db.user.findMany({ where: { id: { in: page.flatMap((u) => [u.devSuspendedById, u.testerSuspendedById]).filter((x): x is string => !!x) } }, select: { id: true, email: true } })).map((u) => [u.id, u.email]));
  // (Batch 15 sections 16 and 21) Each suspended side, with the admin who did it ("an admin (deleted)" when that account is gone).
  const sideLine = (x: (typeof page)[number], s: "developer" | "tester") => {
    const at = s === "developer" ? x.devSuspendedAt : x.testerSuspendedAt;
    const by = s === "developer" ? x.devSuspendedById : x.testerSuspendedById;
    const note = s === "developer" ? x.devSuspendNote : x.testerSuspendNote;
    return at ? `Suspended (${s} side) ${fmtDateTime(at)}${by ? ` by ${names.get(by) ?? "an admin (deleted)"}` : ""}${note ? ` · “${note}”` : ""}` : "";
  };
  const reports = await reportCounts(page.map((u) => u.id));
  // (Batch 15 section 21) The admin who deleted an account, by email.
  const delActs = await db.adminAction.findMany({ where: { action: "delete-account", targetId: { in: page.filter((x) => x.deletedAt).map((x) => x.id) } } });
  const delName = await adminEmails(delActs.map((a) => a.adminId));
  const deletedBy = new Map(delActs.map((a) => [a.targetId, delName(a.adminId)]));
  const rows: UserVM[] = page.map((x) => ({
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
    stateLine: x.deletedAt
      ? `Deleted ${fmtDateTime(x.deletedAt)} by ${x.deletedBy === "admin" ? deletedBy.get(x.id) ?? "the team" : "the owner of the account"}${x.deleteReason ? `: ${x.deleteReason}` : ""}`
      : [sideLine(x, "developer"), sideLine(x, "tester")].filter(Boolean).join(" · "),
  }));
  const last = page[page.length - 1];
  return { rows, next: list.length > PAGE && last ? cur(last.createdAt, last.id) : null, total };
}

export async function testRow(t: Awaited<ReturnType<typeof db.test.findMany<{ include: { developer: true; _count: { select: { contracts: true } } } }>>>[number]): Promise<TestVM> {
  // (Batch 15 section 21) Which admin did what to this test, by email.
  // (The state already names who stopped or paused it: the list adds the other actions.)
  const acted = (await lastActions([t.id], ["unpause-test", "extend-pause", "close-paused", "allow-critical-changes", ...(t.adminStoppedAt ? [] : ["stop-test"]), ...(t.adminPausedAt ? [] : ["pause-test"])])).get(t.id) ?? [];
  const name = await adminEmails([t.adminStoppedById, t.adminPausedById]);
  const state = t.adminStoppedAt ? `stopped by ${name(t.adminStoppedById) || "the team"}` : t.adminPausedAt ? `paused by ${name(t.adminPausedById) || "the team"}` : t.status;
  return {
    id: t.id,
    at: t.createdAt.toISOString(),
    line: `${fmtDateTime(t.createdAt)} · “${t.title}” · ${state} · ${displayName(t.developer)} · ${t._count.contracts} joined${countsText(t.criticalCounts) ? ` · changes since testers joined: ${countsText(t.criticalCounts)}` : ""}${acted.length ? ` · ${acted.slice(0, 3).join(" · ")}` : ""}`,
    href: `/app/find/${t.id}`,
    status: t.status,
    adminPaused: !!t.adminPausedAt,
    stopped: t.status === "stopped",
    critical: lockedFields(countsOf(t.criticalCounts)).length, // fields that used all 3 changes
    closedLine: t.pauseClosedAt ? `Closed after 7 days paused: ${t.pauseClosedReason}` : "",
  };
}

async function tests(cursor: string | null): Promise<Page<TestVM>> {
  const c = parse(cursor);
  const [list, total] = await Promise.all([
    db.test.findMany({ where: olderThan("createdAt", c), orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: PAGE + 1, include: { developer: true, _count: { select: { contracts: true } } } }),
    db.test.count(),
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

async function waitlist(cursor: string | null): Promise<Page<TextVM>> {
  const c = parse(cursor);
  const [list, total] = await Promise.all([
    db.waitlistEntry.findMany({ where: olderThan("createdAt", c), orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: PAGE + 1 }),
    db.waitlistEntry.count(),
  ]);
  const page = list.slice(0, PAGE);
  const last = page[page.length - 1];
  return { rows: page.map((w) => ({ id: w.id, at: w.createdAt.toISOString(), text: `${fmtDateTime(w.createdAt)} · ${w.email} · ${w.role}` })), next: list.length > PAGE && last ? cur(last.createdAt, last.id) : null, total };
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
    owedLine: steps.owedPaid ? "" : ` (${money(steps.owedCents)} owed)`,
  }));
  return slice(all, (r) => r.date, cursor);
}

/** One page of one list. `adminId` is the admin looking (for "mine"). */
export async function adminPage(kind: Kind, adminId: string, cursor: string | null, arg = ""): Promise<Page<unknown>> {
  const p: Page<unknown> = await (async () => {
    switch (kind) {
      case "contact": return contact(cursor);
      case "disputes": return disputes("open", cursor);
      case "decided": return disputes("decided", cursor);
      case "mine": return mine(adminId, cursor);
      case "users": return users(cursor);
      case "tests": return tests(cursor);
      case "noshows": return noShows(cursor);
      case "payments": return payments(cursor);
      case "waitlist": return waitlist(cursor);
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
    for (const e of await db.testEvent.findMany({ where: { testId }, orderBy: { createdAt: "desc" }, take: 3000 })) rows.push(mk("event", e.id, e.createdAt, `${e.text}${e.contractId ? ` (${of(e.contractId)})` : ""}`));
    for (const i of await db.invite.findMany({ where: { testId } })) rows.push(mk("invite", i.id, i.createdAt, `Invited a tester (${i.status})`));
    for (const k of await db.call.findMany({ where: { contractId: { in: ids } } })) {
      rows.push(mk("call", k.id, k.createdAt, `Call booked with ${of(k.contractId)} for ${fmtDateTime(k.startsAt)}`));
      if (k.status === "cancelled" && k.cancelledAt) rows.push(mk("call-cancelled", k.id, k.cancelledAt, `Call with ${of(k.contractId)} cancelled by ${k.cancelledBy || "someone"}`));
    }
    for (const d of await db.dispute.findMany({ where: { contractId: { in: ids } } })) {
      rows.push(mk("dispute", d.id, d.createdAt, `${of(d.contractId)} disputed a payment: “${d.reason}”`));
      if (d.decidedAt) rows.push(mk("dispute-decided", d.id, d.decidedAt, `Dispute by ${of(d.contractId)} decided: ${money(d.decidedCents)} in all`));
    }
    if (t.adminPausedAt) rows.push(mk("admin-paused", t.id, t.adminPausedAt, `Paused by ${who(t.adminPausedById)}${t.adminNote ? `: ${t.adminNote}` : ""}`));
    if (t.adminStoppedAt) rows.push(mk("admin-stopped", t.id, t.adminStoppedAt, `Stopped by ${who(t.adminStoppedById)}${t.adminNote ? `: ${t.adminNote}` : ""}`));
    if (t.pauseClosedAt) rows.push(mk("pause-closed", t.id, t.pauseClosedAt, `Closed after being paused${t.adminStoppedById ? ` (by ${who(t.adminStoppedById)})` : " (by the daily job)"}: ${t.pauseClosedReason}`));
    if (t.developer.devSuspendedAt) rows.push(mk("dev-suspended", t.id, t.developer.devSuspendedAt, `Its developer was suspended (developer side) by ${who(t.developer.devSuspendedById)}`));
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
