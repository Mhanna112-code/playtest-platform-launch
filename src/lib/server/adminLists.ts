import { db } from "@/lib/db";
import { displayName, fmtDateTime, money } from "@/lib/format";
import { pauseCountdownLine } from "@/lib/pause";
import { chargebackHolds } from "./chargeback";
import { disputeBounds } from "./payments";
import { pausedTestsForAdmin } from "./pauseClosure";

// (Owner, Oct 26) The admin dashboard's lists. Every long list shows 20, then "Load more" (keyset by date: newest first; the two lists ordered by
// closure date go soonest first). Rows are plain, already-formatted view models so the same loaders serve the page and /api/admin/more.

export const PAGE = 20;
export type Page<T> = { rows: T[]; next: string | null; total: number };

export type DisputeVM = { id: string; at: string; head: string; money: string; said: string; open: boolean; decided: string; min: number; max: number };
export type MineVM = { id: string; at: string; title: string; dev: string; why: string; when: string; testId: string };
export type UserVM = { id: string; at: string; line: string; reports: number; state: "deleted" | "suspended" | "normal"; stateLine: string };
export type TestVM = { id: string; at: string; line: string; status: string; adminPaused: boolean; stopped: boolean; critical: number; closedLine: string };
export type TextVM = { id: string; at: string; text: string };
export type PausedVM = { id: string; at: string; text: string; closure: string; extended: boolean };
export type ChargebackVM = { id: string; at: string; email: string; since: string; chargebacks: string[]; cardVerified: boolean; owedPaid: boolean; owedLine: string };

export type Kind = "disputes" | "decided" | "mine" | "users" | "tests" | "noshows" | "payments" | "waitlist" | "paused" | "chargebacks";
export const KINDS: Kind[] = ["disputes", "decided", "mine", "users", "tests", "noshows", "payments", "waitlist", "paused", "chargebacks"];

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
  let min = 0, max = 0, partSoFar = "";
  if (d.status === "open" && r) {
    const b = await disputeBounds(d);
    min = b.min;
    max = b.max;
    partSoFar = ` · Paid for this part so far ${money(b.other + r.amountCents)}`;
  }
  return {
    id: d.id,
    at: d.createdAt.toISOString(),
    head: `${c ? displayName(c.tester) : "?"} vs ${c ? displayName(c.test.developer) : "?"} · ${c?.title ?? ""} · ${what}`,
    money: `Listing ${money(r?.agreedCents)} · Paid for this piece ${money(r?.amountCents)}${r?.rejected ? " (rejected)" : ""}${partSoFar}`,
    said: `Tester: “${d.reason}”${r?.reason ? ` · Developer's note when ${r.rejected ? "rejecting" : "paying"}: “${r.reason}”` : ""}${d.devSide ? ` · Developer's side: “${d.devSide}”` : ""}`,
    open: d.status === "open",
    decided: d.status === "open" ? "" : `Decided ${d.decidedAt ? fmtDateTime(d.decidedAt) : ""}: ${money(d.decidedCents)} in all${d.decisionNote ? ` · “${d.decisionNote}”` : ""}`,
    min,
    max,
  };
}

/** Tests THIS admin paused or stopped, or whose developer this admin suspended, newest first. */
async function mine(adminId: string, cursor: string | null): Promise<Page<MineVM & { date: Date }>> {
  const tests = await db.test.findMany({
    where: { OR: [{ adminPausedById: adminId }, { adminStoppedById: adminId }, { developer: { suspendedById: adminId, suspendedAt: { not: null } } }] },
    include: { developer: true },
  });
  const all: (MineVM & { date: Date })[] = [];
  for (const t of tests) {
    const reasons: { why: string; date: Date }[] = [];
    if (t.adminStoppedById === adminId) reasons.push({ why: "stopped by you", date: t.stoppedAt ?? t.adminStoppedAt ?? t.updatedAt });
    if (t.adminPausedById === adminId && t.adminPausedAt) reasons.push({ why: "paused by you", date: t.adminPausedAt });
    if (t.developer.suspendedById === adminId && t.developer.suspendedAt) reasons.push({ why: "developer suspended by you", date: t.developer.suspendedAt });
    if (!reasons.length) continue;
    reasons.sort((a, b) => b.date.getTime() - a.date.getTime());
    all.push({ id: t.id, testId: t.id, date: reasons[0].date, at: reasons[0].date.toISOString(), title: t.title, dev: displayName(t.developer), why: reasons.map((r) => r.why).join(" · "), when: fmtDateTime(reasons[0].date) });
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
  const names = new Map((await db.user.findMany({ where: { id: { in: page.map((u) => u.suspendedById).filter((x): x is string => !!x) } }, select: { id: true, email: true } })).map((u) => [u.id, u.email]));
  const reports = await reportCounts(page.map((u) => u.id));
  const rows: UserVM[] = page.map((x) => ({
    id: x.id,
    at: x.createdAt.toISOString(),
    line: `${x.email} · ${displayName(x)} · ${[x.isDeveloper && "developer", x.isTester && "tester"].filter(Boolean).join(" + ") || "no role"}`,
    reports: reports.get(x.id) ?? 0,
    state: x.deletedAt ? "deleted" : x.suspendedAt ? "suspended" : "normal",
    stateLine: x.deletedAt
      ? `Deleted ${fmtDateTime(x.deletedAt)} by ${x.deletedBy === "admin" ? "the team" : "the owner of the account"}${x.deleteReason ? `: ${x.deleteReason}` : ""}`
      : x.suspendedAt ? `suspended ${fmtDateTime(x.suspendedAt)}${x.suspendedById ? ` by ${names.get(x.suspendedById) ?? "an admin"}` : ""}${x.suspendNote ? ` · “${x.suspendNote}”` : ""}` : "",
  }));
  const last = page[page.length - 1];
  return { rows, next: list.length > PAGE && last ? cur(last.createdAt, last.id) : null, total };
}

/** Reports (no-show / late) per accused person: more than three flags the account (a count is never proof by itself). */
async function reportCounts(ids: string[]) {
  const calls = await db.call.findMany({ where: { noShowBy: { not: null }, OR: [{ contract: { testerId: { in: ids } } }, { contract: { test: { developerId: { in: ids } } } }] }, include: { contract: { include: { test: true } } } });
  const out = new Map<string, number>();
  for (const c of calls) {
    const accused = c.noShowBy === "tester" ? c.contract.test.developerId : c.contract.testerId;
    out.set(accused, (out.get(accused) ?? 0) + 1);
  }
  return out;
}

export async function testRow(t: Awaited<ReturnType<typeof db.test.findMany<{ include: { developer: true; _count: { select: { contracts: true } } } }>>>[number]): Promise<TestVM> {
  return {
    id: t.id,
    at: t.createdAt.toISOString(),
    line: `${fmtDateTime(t.createdAt)} · “${t.title}” · ${t.adminStoppedAt ? "stopped by the team" : t.adminPausedAt ? "paused by the team" : t.status} · ${displayName(t.developer)} · ${t._count.contracts} joined${t.criticalChanges > 0 ? ` · ${t.criticalChanges} critical change${t.criticalChanges === 1 ? "" : "s"}` : ""}`,
    status: t.status,
    adminPaused: !!t.adminPausedAt,
    stopped: t.status === "stopped",
    critical: t.criticalChanges,
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
  const last = page[page.length - 1];
  return {
    rows: page.map((x) => ({ id: x.id, at: (x.noShowAt ?? x.startsAt).toISOString(), text: `${fmtDateTime(x.startsAt)} · “${x.contract.title}” · reported by the ${x.noShowBy} (${x.noShowBy === "tester" ? displayName(x.contract.tester) : displayName(x.contract.test.developer)}): “${x.noShowNote}”` })),
    next: list.length > PAGE && last ? cur(last.noShowAt ?? last.startsAt, last.id) : null,
    total,
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
  const last = page[page.length - 1];
  return {
    rows: page.map((p) => ({ id: p.id, at: p.createdAt.toISOString(), text: `${fmtDateTime(p.createdAt)} · ${p.kind} · ${money(p.amountCents)} (fee ${money(p.feeCents)}) · ${p.status}${p.failure ? ` · ${p.failure}` : ""} · ${emails.get(p.developerId)} → ${emails.get(p.testerId)}` })),
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
export async function adminPage(kind: Kind, adminId: string, cursor: string | null): Promise<Page<unknown>> {
  const p: Page<unknown> = await (async () => {
    switch (kind) {
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
    }
  })();
  return { ...p, rows: p.rows.map((r) => { const { date, ...rest } = r as Record<string, unknown>; void date; return rest; }) };
}
