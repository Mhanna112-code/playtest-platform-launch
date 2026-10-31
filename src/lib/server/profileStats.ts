import { db } from "@/lib/db";
import { compact } from "@/lib/format";
import { LET_GO_BY_TESTER, chargedByTester } from "@/lib/rules";
import { ratingSummary } from "./ratings";

const DAY = 86_400_000;
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (x: number | null) => (x == null ? "-" : `${Math.round(x * 100)}%`);

/** What each tile counts, said once under the tiles (the full app's footnote under its profile tiles). */
export const DEV_FOOTNOTE =
  "Pays on average: the share of the listing paid for work in testers' contracts once decided (after any dispute); parts testers let go and work outside the contract don't count. " +
  "Typical review: the median time from when the work was sent (or the call ended) to the developer's Pay. " +
  "Rating: the average of testers' ratings, one per test, counted once they show.";
/** (Batch 35 §14) The footnote where testers read it: no "Pays on average" (only the developer's own dashboard shows it). */
export const DEV_FOOTNOTE_NO_PAYS = DEV_FOOTNOTE.slice(DEV_FOOTNOTE.indexOf("Typical review:"));
export const TESTER_FOOTNOTE =
  "Accepted parts: the written answers, recordings and live calls developers paid for (in full or partly, including ones the tester charged after the review window), out of the ones sent. " +
  "Rating: the average of developers' ratings, one per test, counted once they show.";

/** "of the listing, over 4 pieces of work" / "of the listing, over 1 piece of work" / "no paid work yet" (the value is then "-"). */
export const paysHint = (n: number) => (n ? `of the listing, over ${n} piece${n === 1 ? "" : "s"} of work` : "no paid work yet");

/** The rating tile: "4.6 ★" with "12 ratings" (revealed ratings only). */
export async function ratingTile(userId: string) {
  const r = await ratingSummary(userId);
  return { value: r.n ? `${r.avg.toFixed(1)} ★` : "-", hint: r.n ? `${r.n} rating${r.n === 1 ? "" : "s"}` : "no ratings yet" };
}

/** A developer's tiles (the full app's "Pays on average", "Typical review"), from lean data. */
export async function developerStats(developerId: string) {
  const contractIds = (await db.contract.findMany({ where: { test: { developerId } }, select: { id: true } })).map((c) => c.id);
  const [reviews, disputes] = await Promise.all([
    db.review.findMany({ where: { contractId: { in: contractIds } }, include: { submission: { select: { sentAt: true } }, call: { select: { startsAt: true, minutes: true, actualMinutes: true } } } }),
    db.dispute.findMany({ where: { contractId: { in: contractIds }, status: "decided" } }),
  ]);
  const decidedFor = new Map(disputes.map((d) => [d.submissionId ?? d.callId ?? "", d.decidedCents ?? 0]));
  const decided = reviews.filter((r) => r.reason !== LET_GO_BY_TESTER);
  const paidOf = (r: (typeof reviews)[number]) => Math.max(r.amountCents, decidedFor.get(r.submissionId ?? r.callId ?? "") ?? 0);
  // Pays on average: contract work only (a listing amount above zero), after any dispute.
  const shares = decided.filter((r) => r.agreedCents != null && r.agreedCents > 0).map((r) => Math.min(1, paidOf(r) / r.agreedCents!));
  const avg = shares.length ? shares.reduce((a, x) => a + x, 0) / shares.length : null;
  // Typical review: by hand only (not the testers' charges), from sending (or the call's end) to the decision.
  const byTester = (r: (typeof reviews)[number]) => chargedByTester(r.reason) || r.auto;
  const days = decided
    .filter((r) => !byTester(r))
    .map((r) => {
      const sent = r.submission ? r.submission.sentAt : r.call ? new Date(r.call.startsAt.getTime() + (r.call.actualMinutes ?? r.call.minutes) * 60_000) : null;
      return sent ? Math.max(0, (r.createdAt.getTime() - sent.getTime()) / DAY) : null;
    })
    .filter((x): x is number => x != null);
  const med = median(days);
  const charged = decided.filter(byTester).length;
  const disputesWon = disputes.filter((d) => {
    const r = reviews.find((x) => (d.submissionId ? x.submissionId === d.submissionId : x.callId === d.callId));
    return !!r && (d.decidedCents ?? 0) > r.amountCents;
  }).length;
  const n = med == null ? null : Math.max(1, Math.round(med));
  return {
    // (Owner, Oct 28, batch 16 section 5) No split by outcome: the average share, over how many pieces it counts.
    pays: { value: pct(avg), hint: paysHint(shares.length) },
    review: { value: n == null ? "-" : `${n} day${n === 1 ? "" : "s"}`, hint: `${charged} charged by testers after the review window · ${disputesWon} dispute${disputesWon === 1 ? "" : "s"} decided for testers` },
  };
}

/** A tester's "Accepted parts" tile: N of M sent · K sessions with accepted work. */
export async function testerStats(testerId: string, now = new Date()) {
  const contracts = await db.contract.findMany({
    where: { testerId },
    select: { id: true, submissions: { select: { id: true, review: true } }, calls: { select: { id: true, status: true, startsAt: true, minutes: true, devJoinedAt: true, testerJoinedAt: true, review: true } } },
  });
  const disputes = await db.dispute.findMany({ where: { contractId: { in: contracts.map((c) => c.id) }, status: "decided" } });
  const decidedFor = new Map(disputes.map((d) => [d.submissionId ?? d.callId ?? "", d.decidedCents ?? 0]));
  let sent = 0, accepted = 0;
  const sessions = new Set<string>();
  for (const c of contracts) {
    // A call counts as sent once it took place (both joined and it's over) or the developer reviewed it.
    const held = c.calls.filter((x) => x.review || (x.status === "booked" && x.devJoinedAt && x.testerJoinedAt && x.startsAt.getTime() + x.minutes * 60_000 <= now.getTime()));
    const pieces = [...c.submissions.map((s) => ({ id: s.id, review: s.review })), ...held.map((x) => ({ id: x.id, review: x.review }))];
    sent += pieces.length;
    for (const p of pieces) {
      if (!p.review || p.review.reason === LET_GO_BY_TESTER) continue;
      if (Math.max(p.review.amountCents, decidedFor.get(p.id) ?? 0) > 0) {
        accepted++;
        sessions.add(c.id);
      }
    }
  }
  return { accepted: { value: compact(accepted), hint: `of ${sent} sent · ${sessions.size} session${sessions.size === 1 ? "" : "s"} with accepted work` } };
}
