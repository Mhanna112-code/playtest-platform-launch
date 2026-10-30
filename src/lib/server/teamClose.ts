import { db } from "@/lib/db";
import { displayName, fmtDate } from "@/lib/format";
import { PAYABLE_TESTER, callReference } from "@/lib/rules";
import { callMinutesOf } from "@/lib/callMeasure";
import { LIMITS } from "@/lib/limits";
import { TEAM_CLOSE_REASON } from "@/lib/moneyLines";
import { HttpError, readText } from "./http";
import { notify } from "./notify";
import { serverKey } from "./pressKeys";
import { recordEvent } from "./tests";
import { closedOut, pieceCloseOut } from "./closeOut";

/**
 * (Owner, Oct 29, batch 30 §5) For abuse cases (spam testers, a fraudulent test, an abandoned account) the team settles every unpaid piece at $0 on the developer's
 * behalf: on the developer's admin box ("Close all open reviews for $0", every test of theirs) or on a test's admin box ("Close this test's open reviews for $0").
 * Preview first; then a required reason (5 to 1,000 characters; testers read it). Each piece still open is paid $0 with the team's reason (no charge, no Charge /
 * Let it go, no automatic call charge, no reminders, its Needs you row goes); anything settled since the preview is left alone and counted. Final: no dispute.
 */

export type TeamCloseScope = { developerId: string } | { testId: string };
type Piece = { kind: "submission" | "call"; id: string; contractId: string; testId: string; title: string; tester: string; testerId: string; testerEmail: string; part: string; at: Date };

/** What's still open in the scope: sent written answers and recordings not paid yet, and calls that took place (length final) not paid or charged yet. */
async function openPieces(scope: TeamCloseScope, now = new Date()): Promise<Piece[]> {
  const where = "developerId" in scope ? { test: { developerId: scope.developerId } } : { testId: scope.testId };
  const contracts = await db.contract.findMany({
    where: { ...where, tester: PAYABLE_TESTER },
    include: { tester: true, submissions: { where: { review: null } }, calls: { where: { review: null, status: "booked", startsAt: { lte: now } } } },
  });
  const out: Piece[] = [];
  for (const c of contracts) {
    const base = { contractId: c.id, testId: c.testId, title: c.title, tester: displayName(c.tester), testerId: c.testerId, testerEmail: c.tester.email };
    for (const s of c.submissions) {
      if (closedOut(await pieceCloseOut({ submissionId: s.id }, "developer", now), now)) continue; // already closed unpaid at its closing date
      out.push({ ...base, kind: "submission", id: s.id, part: s.kind === "recording" ? "recording" : "written answers", at: s.sentAt });
    }
    for (const x of c.calls) {
      if (callMinutesOf(x) == null) continue; // still being measured: not a piece yet
      if (closedOut(await pieceCloseOut({ callId: x.id }, "developer", now), now)) continue;
      out.push({ ...base, kind: "call", id: x.id, part: "live call", at: x.startsAt });
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pieceLine = (p: Piece) => `${p.tester}'s ${p.part} on “${p.title}” (${p.kind === "call" ? "call on" : "sent"} ${fmtDate(p.at)})`;

/** The Preview: "This closes 7 pieces from 4 testers on 3 tests at $0: …" and the list (each piece's id, sent back with Close). */
export async function previewTeamClose(scope: TeamCloseScope) {
  const pieces = await openPieces(scope);
  const testers = new Set(pieces.map((p) => p.testerId)).size, tests = new Set(pieces.map((p) => p.testId)).size;
  const line = pieces.length
    ? `This closes ${plural(pieces.length, "piece")} from ${plural(testers, "tester")} on ${plural(tests, "test")} at $0:`
    : "There are no open reviews to close.";
  return { line, lines: pieces.map(pieceLine), pieces: pieces.map((p) => ({ kind: p.kind, id: p.id })), at: new Date().toISOString() };
}

/**
 * Close the pieces the Preview listed (still open ones only), at $0 with the team's reason. Returns "5 closed; 2 were settled meanwhile" (the race check: anything
 * paid, charged or let go since the preview is left alone).
 */
export async function teamClose(adminId: string, scope: TeamCloseScope, body: Record<string, unknown>) {
  const reason = readText(body.reason ?? body.note, LIMITS.reason, "bad_reason");
  if (reason.trim().length < 5) throw new HttpError(400, "bad_reason", TEAM_CLOSE_REASON);
  const asked = Array.isArray(body.pieces) ? (body.pieces as { kind?: unknown; id?: unknown }[]).filter((p) => p && (p.kind === "submission" || p.kind === "call") && typeof p.id === "string") : [];
  if (!asked.length) throw new HttpError(400, "no_preview", "Press Preview first: it lists what this closes.");
  // (Owner, Oct 30, batch 34 §1) Another admin suspended or reinstated the developer since the Preview: the close-out stops once; the second press goes ahead.
  const race = await import("./adminRace");
  const from = race.checkFrom(race.adminSeen(body));
  if (from) {
    const devId = "developerId" in scope ? scope.developerId : (await db.test.findUnique({ where: { id: scope.testId }, select: { developerId: true } }))?.developerId;
    if (devId) race.stopIfChanged("developerId" in scope ? "Close all open reviews for $0" : "Close this test's open reviews for $0", await race.accountChangesSince(devId, adminId, from, ["suspended", "reinstated"]));
  }
  const now = new Date();
  // Only pieces still open in this scope (a piece outside it is never touched); the rest of the preview's list were settled meanwhile.
  const open = new Map((await openPieces(scope, now)).map((p) => [`${p.kind}:${p.id}`, p]));
  const closed: Piece[] = [];
  for (const a of asked) {
    const p = open.get(`${a.kind}:${a.id}`);
    if (!p) continue;
    const ok = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Test" WHERE id = ${p.testId} FOR UPDATE`;
      const key = p.kind === "submission" ? { submissionId: p.id } : { callId: p.id };
      if (await tx.review.findFirst({ where: key })) return false; // paid, charged or let go meanwhile
      let listing: number | null = null;
      if (p.kind === "submission") listing = (await tx.submission.findUniqueOrThrow({ where: { id: p.id } })).agreedCents;
      else {
        const call = await tx.call.findUniqueOrThrow({ where: { id: p.id } });
        listing = callReference(call.rateCents, callMinutesOf(call) ?? call.minutes).cents;
      }
      await tx.review.create({ data: { ...key, contractId: p.contractId, amountCents: 0, agreedCents: listing, reason, payKey: serverKey("teamclose", p.id), teamClosedById: adminId } });
      return true;
    }).catch(() => false);
    if (ok) closed.push(p);
  }
  const settled = asked.length - closed.length;
  if (closed.length) await tellEveryone(adminId, scope, closed, reason);
  const result = settled ? `${closed.length} closed; ${settled} ${settled === 1 ? "was" : "were"} settled meanwhile` : `${closed.length} closed`;
  return { closed: closed.length, settled, line: result };
}

/** Testers (one payment line per piece), the developer (one line), the tests' timelines and the admin history. */
async function tellEveryone(adminId: string, scope: TeamCloseScope, closed: Piece[], reason: string) {
  for (const p of closed) {
    const line = `“${p.title}”: the team closed your ${p.part} for $0`;
    const anchor = p.kind === "call" ? "part-live" : p.part === "recording" ? "part-recording" : "part-written";
    await notify(p.testerEmail, line, [line + ".", `The team's reason: “${reason}”`], `/app/sessions/${p.contractId}#${anchor}`, { side: "developer", payment: true, group: "tpaid" });
  }
  const byTest = new Map<string, Piece[]>();
  for (const p of closed) byTest.set(p.testId, [...(byTest.get(p.testId) ?? []), p]);
  for (const [testId, list] of byTest) {
    // The developer's live box (a stop-once line, as the team's other actions) and the test's admin timeline (third person there, naming the admin).
    await db.$transaction((tx) => recordEvent(tx, testId, "admin", `The team closed ${plural(list.length, "open review")} on this test for $0: “${reason}”`, false));
  }
  const test = "testId" in scope ? await db.test.findUnique({ where: { id: scope.testId }, select: { title: true, developerId: true } }) : null;
  const developerId = "developerId" in scope ? scope.developerId : test!.developerId;
  const dev = await db.user.findUniqueOrThrow({ where: { id: developerId } });
  const devLine = `The team closed ${plural(closed.length, "open review")} on ${test ? `“${test.title}”` : "your tests"} for $0`;
  await notify(dev.email, devLine, [devLine + ".", `The team's reason: “${reason}”`, "Nothing was charged."], test ? `/app/tests/${"testId" in scope ? scope.testId : ""}` : "/app", { side: "developer", payment: true, group: "payhold" });
  // The developer's account history (their admin box's "Holds and suspensions") and this admin's "Your actions": who, when, the count and the reason.
  await db.accountEvent.create({ data: { userId: developerId, kind: "team-closed", byId: adminId, createdAt: new Date(), note: `${plural(closed.length, "open review")} closed for $0${test ? ` on “${test.title}”` : ""}: ${reason}` } });
}
