import { TESTING_NO_LIMITS } from "@/lib/testingLimits";
import { Prisma } from "@prisma/client";
import { T } from "@/lib/tz";
import { db } from "@/lib/db";
import { displayName, fmtDate, fmtDateTime, fmtTime, pronouns } from "@/lib/server/dateFormat";
import {
  PAUSED_RIGHT_NOW, closedToNewLine, canAskToRejoin, leftText, movedDue, MAX_ACTIVE_TESTS, termsLine, testPaused, TEST_LIMIT_LINE, type TestEventLike,
} from "@/lib/rules";
import { HttpError } from "./http";
import { NOT_TAKING_CAUSE, asPressRefusal, joinPressRefusal, ownBlockCause, pressRefused } from "@/lib/refusal";
import { NO_FREE_KEY, noKeyWaitingLine } from "@/lib/keys";
import { LIMITS } from "@/lib/limits";
import { bell, notify } from "./notify";
import { APP_WITHDRAWN_GROUP, APPLICATIONS_GROUP } from "@/lib/bell";
import { unanswered, answersIt, asLines, listingSaveLines, logEvent, ownChanges, seenOf, tabOf, withRenamed } from "./live";
import {
  afterJoin, asListing, devGate, gapStop, joinTest, lockTest, needsGap, onePass, ownTest, PROFILE_FIRST, profileSaved, saveJoin, stopOf, type Joined, type Pass,
} from "./tests";
import { ratingChangedLine } from "./invites";
import { ratingSummary } from "./ratings";

// Joining (owner rule): Who can join = Anyone (Join) / Apply (Apply to join → the developer Accepts or Declines) /
// Invite only. No offers or counter-offers on the join page. Join and Apply stop once if ANYTHING about the listing
// changed since the page loaded (including who can join). Refused for good: full, stopped, past Open until, paused,
// blocked, 10 tests, already in.
//
// The presses in this file (each with a header listing its steps in order; docs/INVITES-APPS-GUIDE.md walks through them):
//   joinRefusal (the shared refusals) · join · apply · askToRejoin (one pass each, under the test's lock: see the note above j01)
//   withdrawApplication · decideApplication (Accept / Decline) · onSwitchToAnyone · closeApplicationsAfterEdit · matchInviteAndAsk

type U = { id: string; email: string; name: string; pronoun: string; isTester: boolean; isDeveloper: boolean };
/** The developer blocks the tester (never why); (§377) Ask to rejoin's line for a block either way. The same words as blocks.ts NOT_TAKING_LINE. */
const NOT_TAKING_NEUTRAL = "This test isn't taking new testers right now.";
type Tx = Prisma.TransactionClient;
/** (Owner, Nov 11, §377) Where a check reads: the press's transaction (under the test's lock) in the one pass, else the database. */
type Q = Tx | typeof db;

const listingSnapshot = (t: Parameters<typeof asListing>[0]) => {
  const l = asListing(t);
  return { ...l, joinMode: undefined } as Record<string, unknown>;
};
/** Application validity ignores the join mode and spot count, which may change as part of the switch. */
const sameListingIgnoringMode = (saved: unknown, current: Parameters<typeof listingSnapshot>[0]) => {
  const clean = (value: unknown) => {
    const o = { ...((value ?? {}) as Record<string, unknown>) };
    delete o.joinMode;
    delete o.spots;
    return JSON.stringify(Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))));
  };
  return clean(saved) === clean(listingSnapshot(current));
};
/**
 * Shared final refusals for Join, Apply to join, Accept invite and Ask to rejoin (and the developer's Accept). ONE reason at a time, the first that applies, in
 * this order (owner, Nov 9, §348):
 *   1. "This test was stopped."   2. Open until passed: "“…” closed to new testers on <date>."   3. "This test isn't taking new testers any more." (not open)
 *   4. Paused right now   5. "You've already joined this test."   6. rated / can't join again   7. ended with no invite: "You can't join this test again."
 *   8. full: "This test is full." ("<title> is full right now." with an invite; (owner, Nov 11, §377) Join / Apply / Ask to rejoin say it in the pattern, "This
 *      test is full, so your Join didn't go through.": joinPressRefusal)   9. (§348) no free access key with a spot open: the key line, NO_FREE_KEY
 *   10. a block either way   11. the 10-test limit.
 * Then the press's own checks (§377: see join(), apply(), askToRejoin()), so a test that is both full and keyless, or full and invite only, reads only "full".
 * (Owner, Nov 11, §377) `q`: the press's transaction, which holds the test's lock (the one pass), so nothing here can change before the save.
 * (Owner, Nov 9, §341) `byDeveloper`: the developer's own Accept / Invite / switch to "Anyone can join" skip 9; the join itself is then refused with the key line.
 */
export async function joinRefusal(testerId: string, testId: string, opts: { rejoin?: boolean; byDeveloper?: boolean } = {}, q: Q = db) {
  const t = await q.test.findUniqueOrThrow({ where: { id: testId }, include: { developer: true } });
  // 1-4. The test itself.
  const testLine = testNotTakingTesters(t);
  if (testLine) return testLine;
  // 5-7. This tester's earlier part in the test.
  const earlierLine = await earlierPartRefusal(q, testerId, testId, !!opts.rejoin);
  if (earlierLine) return earlierLine;
  // 8. Full.
  const fullLine = await testFullRefusal(q, t, testerId);
  if (fullLine) return fullLine;
  // 9. (§341, §348) A test that uses access keys with none free (a spot open): the tester's presses read the key line, not "full"; nothing closes
  // (applications, asks and invites stay) and Find leaves it out. The developer's own presses skip this check.
  if (!opts.byDeveloper && (await hasNoFreeKey(q, testId))) return NO_FREE_KEY;
  // 10. A block either way.
  const blockLine = await blockRefusal(q, t, testerId, !!opts.byDeveloper);
  if (blockLine) return blockLine;
  // 11. The tester's 10-test limit.
  const testsIn = await q.contract.count({ where: { testerId, status: "working" } });
  if (testsIn >= MAX_ACTIVE_TESTS) return TEST_LIMIT_LINE;
  return "";
}

type TestWithDeveloper = Prisma.TestGetPayload<{ include: { developer: true } }>;
/** "Nov 20" (no year). */
const shortDate = (d: Date) => fmtDate(d).replace(/, \d{4}$/, "");

/** joinRefusal 1-4: stopped, Open until passed, not open, paused (no database reads). */
function testNotTakingTesters(t: TestWithDeveloper) {
  // 1.
  if (t.status === "stopped") return "This test was stopped.";
  // 2. (Batch 15 section 18) Open until passed.
  if (t.openUntil && t.openUntil < new Date()) return closedToNewLine(t.openUntil, shortDate);
  // 3. Not open (closed: its work ended; or a draft).
  if (t.status !== "open") return "This test isn't taking new testers any more.";
  // 4. (Owner, Oct 28 afternoon) Invites and applications wait while the test is paused; the join page says only this.
  if (testPaused(t.developer, t)) return PAUSED_RIGHT_NOW;
  return "";
}

/** The tester's open (sent) invite to this test, or null. */
const openInviteOf = (q: Q, testId: string, testerId: string) => q.invite.findFirst({ where: { testId, testerId, status: "sent" } });

/** joinRefusal 5-7: already in, rated, or ended with no invite to come back on. */
async function earlierPartRefusal(q: Q, testerId: string, testId: string, rejoin: boolean) {
  const old = await q.contract.findUnique({ where: { testId_testerId: { testId, testerId } } });
  // 5.
  if (old?.status === "working") return "You've already joined this test.";
  // 6. Rated (or any rating on that part).
  if (old && (await q.rating.count({ where: { contractId: old.id } }))) {
    const ratedAndLeft = old.status === "left" && old.endKind === "rated";
    return ratedAndLeft ? "You rated this test, so you can't join it again." : "You can't join this test again.";
  }
  // 7. The developer ended their work: only an invite (or an accepted rejoin ask) brings them back.
  if (old?.status === "ended" && !rejoin && !(await openInviteOf(q, testId, testerId))) return "You can't join this test again.";
  return "";
}

/** joinRefusal 8: every spot taken. With an open invite: "<title> is full right now." (the invite stays open). */
async function testFullRefusal(q: Q, t: TestWithDeveloper, testerId: string) {
  const testersIn = await q.contract.count({ where: { testId: t.id, status: "working" } });
  if (testersIn < t.spots) return "";
  const invited = await openInviteOf(q, t.id, testerId);
  return invited ? `${t.title} is full right now.` : "This test is full.";
}

/** joinRefusal 9: the test uses access keys and none is free. */
async function hasNoFreeKey(q: Q, testId: string) {
  const keyless = await (await import("./accessKeys")).noFreeKeyTests(q, [testId]);
  return keyless.has(testId);
}

/**
 * joinRefusal 10. (Owner, Nov 11, §380 H; replaces "You blocked Nora Lane: unblock her in Account → Blocked people to join.") The tester's own block, for Join,
 * Apply and Ask to rejoin alike: "You blocked Nora Lane." (named with the press: "…, so your Apply didn't go through."). The developer's presses (byDeveloper)
 * read it neutral. The developer's block always reads neutral (never why).
 */
async function blockRefusal(q: Q, t: TestWithDeveloper, testerId: string, byDeveloper: boolean) {
  const testerBlockedDev = await q.block.count({ where: { blockerId: testerId, blockedId: t.developerId } });
  if (testerBlockedDev) return byDeveloper ? NOT_TAKING_NEUTRAL : `${ownBlockCause(displayName(t.developer))}.`;
  const devBlockedTester = await q.block.count({ where: { blockerId: t.developerId, blockedId: testerId } });
  if (devBlockedTester) return NOT_TAKING_NEUTRAL;
  return "";
}

/** What changed on the listing since the page loaded (edits: any field, spots, Open until, who can join). */
export async function listingChanges(testId: string, seenAt: unknown): Promise<TestEventLike[]> {
  const d = typeof seenAt === "string" ? new Date(seenAt) : null;
  if (!d || isNaN(d.getTime())) return [];
  return db.testEvent.findMany({ where: { testId, kind: "edited", createdAt: { gt: d } }, orderBy: { createdAt: "asc" } });
}

/** The join page's stop-once reasons: (D) the listing changed (spots excepted), (E) the tester's own actions in another tab. */
export async function joinPageChanges(userId: string, testId: string, seenAt: unknown, tab: string, q: Q = db): Promise<TestEventLike[]> {
  const d = seenOf(seenAt);
  if (!d) return [];
  // (Batch 30 §10, §12) ONE line per listing save, every save since the page last showed them (the NDA too: "Marc Hanna changed the NDA at 6:58 PM: read and accept it
  // again below"); a rename alone is info only.
  const edits = await listingSaveLines(testId, d, userId, "join", q);
  // (NEWEST+4, LIVE + GONE) Their application closed / their invite re-sent on the updated listing.
  const t = await q.test.findUniqueOrThrow({ where: { id: testId }, include: { developer: true } });
  // (Batch 16 section 11) A test a block hides from this tester shows nothing (its page reads "This test isn't available right now.").
  if (await (await import("./blocks")).hiddenByBlock(userId, t)) return [];
  const gone: TestEventLike[] = [];
  // (§354) Each application closed since then, with its real reason.
  const closedApps = await q.application.findMany({ where: { testId, testerId: userId, status: "closed", decidedAt: { gt: d } } });
  for (const a of closedApps) gone.push({ kind: "applied", text: await closedApplicationLine(t, a), createdAt: a.decidedAt! });
  // (Correction 6) Invited: the test filled (the invite stays open) / a spot opened.
  if (await openInviteOf(q, testId, userId)) {
    const fullOrOpen = await q.testEvent.findMany({ where: { testId, kind: { in: ["full", "spot_open"] }, createdAt: { gt: d } } });
    for (const e of fullOrOpen) {
      const text = e.kind === "full" ? `${t.title} is full right now. Your invite stays open; we'll tell you when a spot opens.` : e.text;
      gone.push({ kind: e.kind, text, createdAt: e.createdAt });
    }
  }
  // An invite an older edit replaced (edits no longer re-send invites; these are from before).
  const replaced = await q.invite.findMany({ where: { testId, testerId: userId, status: "replaced", updatedAt: { gt: d } } });
  if (replaced.length) {
    const fresh = await q.invite.findFirst({ where: { testId, testerId: userId, status: "sent" }, orderBy: { createdAt: "desc" } });
    const dev = displayName(t.developer);
    gone.push(fresh
      ? { kind: "invite", text: `${dev} changed the listing: here's a new invite on the updated listing`, createdAt: fresh.createdAt, item: fresh.id }
      : { kind: "invite", text: `${dev} changed the listing: your invite closed (no spots left)`, createdAt: replaced[0].updatedAt });
  }
  // (Owner) Rejoining a test they LEFT stops once for the same reasons as their in-test buttons (A-F): paid / rejected,
  // call changes, their own other-tab actions; the listing's one line covers new terms (they rejoin on the current listing, no offer).
  const left = await q.contract.findUnique({ where: { testId_testerId: { testId, testerId: userId } } });
  const rejoin: TestEventLike[] = [];
  if (left && left.status === "left") {
    const { testerChanges } = await import("./testerGate");
    rejoin.push(...(await testerChanges(userId, left.id, testId, d, tab)).filter((e) => e.kind !== "terms"));
    // (Batch 35 §53) No "changed the terms: <fields>" line: the save's one listing line ("<Dev> edited the listing · See it") already covers it, and a tester
    // who isn't working has no offer to answer.
  }
  const all = [...edits, ...gone, ...(await ownChanges(userId, testId, d, tab, q)), ...rejoin];
  const seen = new Set<string>();
  return all.filter((e) => {
    const k = `${e.createdAt.getTime()}|${e.text}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/**
 * The join page's line for an application that closed, by its closedReason. "full" no longer happens ((Owner, Dec 10 2026) a full test keeps applications
 * open); it stays for applications closed that way before.
 */
async function closedApplicationLine(
  t: TestWithDeveloper,
  a: { closedReason: string | null; decidedAt: Date | null },
) {
  const dev = displayName(t.developer);
  switch (a.closedReason) {
    case "blocked":
      return (await import("./blocks")).appClosedLine(t.title).replace(/\.$/, "");
    case "full":
      return `${t.title} is full: your application was closed`;
    case "invite_only":
      return `${dev} made the test invite only: your application was closed`;
    case "joining_closed":
      return `Joining ${t.title} closed (Open until passed) on ${fmtDate(t.openUntil ?? a.decidedAt!)}: your application was closed`;
    case "stopped":
      return `${t.title} was stopped: your application was closed`;
    default:
      return `${dev} changed the listing: your application was closed`;
  }
}

/** Join / Apply / Withdraw application / No thanks stop once (box under the button) for the join page's reasons. */
export async function listingGate(userId: string, testId: string, body: Record<string, unknown>, verb: string, q: Q = db) {
  const r = await joinStopList(userId, testId, body, verb, q);
  if (r) throw new HttpError(409, "stop_once", r.tail, r);
}

/**
 * The join page's stop for a press (null: it goes ahead): every change since the page last showed them, oldest first, each with its time, the tester's own in
 * another tab with the developer's (batch 30 §12 and the Oct 29 addition: one box, never one source hiding another). (Batch 30 §12) Also what the needs-covered
 * notice ("You now meet this test's needs") shows with it, before the press.
 */
export async function joinStopList(userId: string, testId: string, body: Record<string, unknown>, verb: string, q: Q = db) {
  // (Owner) The second press goes ahead only if nothing new happened since the box last updated (boxAt).
  const boxAt = seenOf(body.boxAt);
  if (body.confirmed === true && !boxAt) return null;
  const since = body.confirmed === true ? boxAt!.toISOString() : body.seenAt;
  const raw0 = await joinPageChanges(userId, testId, since, tabOf(body), q);
  // (Batch 17 section 13) The tester's box drops "Turn off alerts" when their Alerts are already Off.
  const me = await db.user.findUnique({ where: { id: userId }, select: { testerAlertsOff: true } });
  const alertsOff = !!me?.testerAlertsOff;
  // (Owner, Oct 31, batch 35 §61; replaces batch 29 section 13 here) Their own changes in another tab ("You applied to join in another tab") always stop once,
  // Alerts Off too, like the developer's own other-tab actions.
  // (Batch 35 §79) Join from the invite that just arrived: never the line about that invite itself.
  const aboutPressedInvite = (e: TestEventLike) => typeof body.inviteId === "string" && answersIt(e, { item: body.inviteId });
  const raw = (await unanswered(userId, testId, raw0, q)).filter((e) => !aboutPressedInvite(e));
  // (Batch 17 section 4) A full test keeps the invite open: No thanks just declines it (the test filling or a spot opening doesn't stop it).
  const counted = verb === "decline" ? raw.filter((e) => e.kind !== "full" && e.kind !== "spot_open") : raw;
  const changes = withRenamed(counted, body);
  if (!changes.length) return null;
  // (Owner, Nov 9, §364) One retry tail: the box reads it as "Press <button> again to go ahead." (only Save keeps its own).
  const tail = "Press again to go ahead.";
  // (Batch 30 §12) `now`: the box's newest line (the next press goes ahead unless something newer came); each line says whether it's an NDA change (its tick clears).
  const newest = new Date(Math.max(...changes.map((e) => e.createdAt.getTime())));
  return { changes: asLines(changes), tail, alertsOff, now: newest.toISOString() };
}

/**
 * (Owner, Oct 28, batch 16 section 32) Why an invite is closed, said to the tester (never "hold" or "suspended"): stopped (or the developer deleted) → "This test was
 * stopped."; Open until passed → "“<test>” closed to new testers on <date>."; cancelled, blocked or anything else → "This invite is no longer open."
 * (Owner, Dec 10 2026) A pause no longer closes invites, so a pause is never the reason given: an invite cancelled while the test is paused (Cancel invite, a block…)
 * reads its normal line. Invites a pause closed before then read "This invite is no longer open." too (they can't be told apart reliably).
 */
export async function inviteClosedLine(testId: string, now = new Date()) {
  const t = await db.test.findUnique({ where: { id: testId }, include: { developer: { select: { deletedAt: true } } } });
  if (!t) return INVITE_NOT_OPEN;
  if (t.status === "stopped" || t.developer.deletedAt) return "This test was stopped.";
  if (t.openUntil && t.openUntil.getTime() < now.getTime()) return `“${t.title}” closed to new testers on ${fmtDate(t.openUntil)}.`;
  return INVITE_NOT_OPEN;
}
export const INVITE_NOT_OPEN = "This invite is no longer open.";
/** Join or Accept on an invite that closed meanwhile: refused (no stop box) with the reason; the card goes. */
async function closedInvite(testerId: string, body: Record<string, unknown>, q: Q = db) {
  if (typeof body.inviteId !== "string" || !body.inviteId) return;
  const inv = await q.invite.findUnique({ where: { id: body.inviteId } });
  if (!inv || inv.testerId !== testerId || inv.status !== "cancelled") return;
  throw new HttpError(409, "invite_closed", asPressRefusal(await inviteClosedLine(inv.testId), "Join")); // (§363)
}

/** (Batch 34 §10) The refusal for a press on an invite a listing change replaced, when the tester has the new one: one sentence, never a dangling colon. */
export const newInviteLine = (dev: string, at: string) => `${dev} changed the listing at ${at} and sent you a new invite on it. Press Join to join on it.`;

/**
 * Accept on an invite a listing change replaced. (Batch 34 §10, owner's finding) The join page's "changed since you opened this page" stop runs FIRST (Join), so a
 * press stops once with the full list; a press that already saw it (the second, confirmed press) joins on the tester's CURRENT invite without a reload. Otherwise
 * it's refused under the button with the new invite right there (its id and `now`: the page switches to it, and the next press goes ahead).
 * (Owner, Nov 11, §377) Inside Join's one pass, in two places: `closed` (the change could NOT re-send the invite: the invite closed, with why) is one of Join's own
 * refusals (step 2); `fresh` (re-sent on the updated listing) is NOT a refusal: it belongs with the listing box (batch 34 §10), so it runs right after that box,
 * whose list already names the new invite.
 */
async function replacedInvite(testerId: string, testId: string, body: Record<string, unknown>, q: Q, which: "closed" | "fresh") {
  if (typeof body.inviteId !== "string" || !body.inviteId) return;
  const inv = await q.invite.findUnique({ where: { id: body.inviteId } });
  if (!inv || inv.testerId !== testerId || inv.status !== "replaced") return;
  const fresh = await q.invite.findFirst({ where: { testId, testerId, status: "sent" }, orderBy: { createdAt: "desc" } });
  if (which === "closed" ? !!fresh : !fresh) return;
  if (fresh && body.confirmed === true) return; // joins on the current invite (join() takes the tester's sent invite)
  const t = await q.test.findUniqueOrThrow({ where: { id: testId } });
  const dev = await q.user.findUniqueOrThrow({ where: { id: t.developerId } });
  const changedAt = fmtTime(inv.updatedAt);
  if (!fresh) throw new HttpError(409, "invite_replaced", `${displayName(dev)} changed the listing at ${changedAt}, and this invite closed.`, {});
  const newInvite = { newInviteId: fresh.id, terms: termsLine(asListing(t), true), listingVersion: t.listingVersion, now: new Date().toISOString() };
  throw new HttpError(409, "invite_replaced", newInviteLine(displayName(dev), changedAt), newInvite);
}

/**
 * (Owner's finding, Oct 29, batch 32 §2) Apply or Ask to rejoin while this tester already has one waiting (sent in another tab): refused, nothing changes (the
 * first note stays, the developer isn't told again); the page redraws to the waiting state. (Owner, Nov 11, §377) ONE wording, before and under the lock (no
 * more "You already have a request waiting for this test."): the pass checks it under the lock only.
 */
async function alreadyWaiting(testerId: string, testId: string, q: Q = db) {
  const a = await q.application.findUnique({ where: { testId_testerId: { testId, testerId } } });
  if (a?.status !== "pending") return;
  const line = a.kind === "rejoin" ? "You already asked to rejoin this test in another tab." : "You already applied to join this test in another tab.";
  throw new HttpError(409, "already_waiting", line);
}

/**
 * (Batch 34 §16, owner, Oct 30) Whether the pressing page had shown an application or an invite: the page's seen time (`seenAt`). Not a stop box's `boxAt`: neither
 * one is a line in those boxes (a new application doesn't stop that tester's Invite; a new invite redraws the join page instead), so a box never showed it. Null
 * when the press carries none (it counts as a page that hadn't shown it).
 */
export function pressSeen(body: Record<string, unknown>) {
  return seenOf(body.seenAt);
}
/**
 * (Batch 34 §16) Apply or Ask to rejoin while holding a sent invite: a page that hadn't shown the invite yet (sent after its seen time) joins at once; a page that
 * already showed it (the invite card and Join) is refused with the line, and the page redraws to Join.
 */
async function inviteBeforePress(tester: { id: string }, testId: string, body: Record<string, unknown>, devName: string, q: Q = db) {
  const inv = await q.invite.findFirst({ where: { testId, testerId: tester.id, status: "sent" }, orderBy: { createdAt: "desc" } });
  if (!inv) return null;
  const seen = pressSeen(body);
  if (seen && inv.createdAt <= seen) throw new HttpError(409, "invited", `${devName} invited you: press Join to join.`);
  return inv;
}

/**
 * (Security, §352) The join flags only the server may set: the developer's acceptance (`acceptedByDeveloper`), an accepted rejoin ask (`rejoinAccepted`), the time
 * an NDA was accepted at an earlier press (`ndaAcceptedAt`: an application's or ask's own), and the contract's `keepPrivate` (no page sets it). The internal callers
 * (decideApplication, the invite auto-join, matchInviteAndAsk, onSwitchToAnyone) pass them to joinTest themselves; a request body never carries them: a tester who
 * left or was ended early sending {rejoinAccepted: true} to Join rejoined with no acceptance.
 */
export const SERVER_ONLY_JOIN_FLAGS = ["rejoinAccepted", "acceptedByDeveloper", "ndaAcceptedAt", "keepPrivate"] as const;
/** A request body without the server-only join flags. */
export function clientJoinBody(body: Record<string, unknown>) {
  const out = { ...body };
  for (const k of SERVER_ONLY_JOIN_FLAGS) delete out[k];
  return out;
}

/*
 * (Owner, Nov 11, §377) Join, Apply to join and Ask to rejoin make ONE pass under the test's lock (onePass, as §375's Send Answers): the lock first, then every
 * check in the owner's order, then the save; what stopped the press is thrown after the commit. Nothing is checked before the lock and nothing again after it,
 * so a press's one outcome never depends on timing (a Stop, a fill, an Edit, a block or another tab's press is either fully before the pass or fully after it).
 *   1. J01: joinRefusal (stopped → joining closed → not open → paused → already joined → rated / can't join again → full → no free key → you blocked the
 *      developer → the developer blocks you → your test limit), in the press's pattern (joinPressRefusal). Apply / Ask to rejoin: an invite the page hadn't
 *      shown joins at once right here (batch 34 §16); one it showed is refused ("… invited you: press Join to join.").
 *   2. The button's own refusals. Join: the invite closed, left earlier without an invite, the invite replaced with none re-sent, an apply-only test. Apply / Ask to rejoin: already
 *      waiting (J09, one wording), the 2-per-24-hours limit; Ask to rejoin first: never in / still in, a block either way (neutral), rated.
 *   3. The profile not saved.
 *   4. The listing-changed stop-once box (J04 / T05), a re-sent invite with it (batch 34 §10). (Owner's exception, Nov 11) "This test is invite only." stays
 *      right after it.
 *   5. The profile-gap box ("Your profile is missing … Join anyway?"), then the NDA tick (red).
 *   6. The save (the join, or the application / the ask).
 */

/**
 * (§377) Step 1, J01, under the lock: the first refusal that applies, named with the press.
 */
async function j01(tx: Tx, testerId: string, testId: string, press: "Join" | "Apply" | "Ask to rejoin", opts: { rejoin?: boolean } = {}) {
  // (Owner, Nov 11, §380 H) Ask to rejoin too: "This test isn't taking new testers right now, so your Ask to rejoin didn't go through." (the developer's block),
  // "You blocked Nora Lane, so your Ask to rejoin didn't go through." (the tester's own).
  const line = await joinRefusal(testerId, testId, opts, tx);
  return line ? new HttpError(409, "refused", joinPressRefusal(line, press)) : null;
}

/** (§348) The last free key went (it can't under the lock, which J01 checked; kept as a backstop): refused with joinRefusal's reason now. */
const noKeyLine = (testerId: string, testId: string, press: string) => async (e: unknown): Promise<never> => {
  if (!(e instanceof HttpError && e.code === "no_key")) throw e;
  const line = (await joinRefusal(testerId, testId)) || NO_FREE_KEY;
  throw new HttpError(409, "refused", joinPressRefusal(line, press));
};

/**
 * (Owner, Nov 27, shared rule 4: refusals → box → field mistakes; batch 18 section 1) The updated Terms of Use tick on Join, Apply and Ask to rejoin: a red mistake
 * at the tick, so step 5 with the NDA tick (after every refusal and box; it used to come before them, on the route); agreed with the save (step 6).
 */
async function termsTick(tx: Tx, testerId: string, body: Record<string, unknown>) {
  const me = await tx.user.findUnique({ where: { id: testerId }, select: { termsVersion: true } });
  return me ? (await import("./users")).termsTickMistake(me, body) : null;
}
const agreeTerms = async (tx: Tx, testerId: string, body: Record<string, unknown>) => {
  if (body.agreeTerms === true) await (await import("./users")).agreeCurrentTerms(tx, testerId);
};

/** (§377) Step 1's invite for Apply / Ask to rejoin: one the page hadn't shown (it joins at once), a refusal (the page showed it), or none. */
async function inviteMet(tx: Tx, tester: U, testId: string, body: Record<string, unknown>, devName: string) {
  let invite: Awaited<ReturnType<typeof inviteBeforePress>> = null;
  const shown = await stopOf(async () => { invite = await inviteBeforePress(tester, testId, body, devName, tx); });
  return shown ?? invite;
}

type TestRow = Prisma.TestGetPayload<object>;

/** Step 2 (Join). (Design doc 7.3) Coming back is always an ask the developer accepts, unless they invited the tester back. (§352) An accepted ask never comes
 * through here. */
async function leftWithoutInvite(tx: Tx, testId: string, testerId: string, invited: unknown) {
  const old = await tx.contract.findUnique({ where: { testId_testerId: { testId, testerId } } });
  if (old && old.status !== "working" && !invited) return new HttpError(409, "ask", "You left this test, so you ask to rejoin and the developer accepts.");
  return null;
}

/** Step 2 (Join). An apply-only test: Join needs an invite, or an application the switch to "Anyone can join" marked changed (it joins on the new listing). */
async function applyOnlyRefusal(tx: Tx, t: TestRow, testerId: string, invited: unknown) {
  if (t.joinMode !== "apply" || invited) return null;
  const changedApplication = await tx.application.findFirst({ where: { testId: t.id, testerId, status: "pending", changedAt: { not: null } } });
  if (changedApplication) return null;
  return new HttpError(409, "apply", "This test takes applications: press Apply to join.");
}

/** Step 3. (Owner, Nov 2) A saved tester profile (devices and languages). */
async function profileOrRefusal(tx: Tx, testerId: string) {
  const profile = await tx.testerProfile.findUnique({ where: { userId: testerId } });
  const stop = profileSaved(profile) ? null : new HttpError(409, "profile_first", PROFILE_FIRST);
  return { profile, stop };
}

/** Step 5's last check: (design doc 7.3) the NDA tick (red). */
function ndaRefusal(t: TestRow, body: Record<string, unknown>, line: string) {
  return t.ndaText && body.ndaAccepted !== true ? new HttpError(400, "nda", line) : null;
}

/**
 * (§377) Join's steps 2 to 6, under the lock (step 1 passed). Apply and Ask to rejoin meeting an invite the page hadn't shown, and Apply on a test that now lets
 * anyone join, take them too; `as` keeps their own words in the gap box and the NDA tick (Apply's are Join's, as before).
 *   2a. the invite closed meanwhile → 2b. left earlier without an invite → 2c. the invite replaced by an old edit, none re-sent → 2d. an apply-only test
 *   3. the profile not saved
 *   4a. the listing-changed box → 4b. the invite re-sent with it → 4c. invite only
 *   5a. the gap box → 5b. the Terms of Use tick → 5c. the NDA tick
 *   6. the join; any waiting application or ask of theirs closes as joined.
 */
async function joinSteps(tx: Tx, tester: U, t: TestRow, body: Record<string, unknown>, as: "Join" | "Ask" = "Join"): Promise<Pass<Joined>> {
  const testId = t.id;
  const invited = await openInviteOf(tx, testId, tester.id);
  // 2a. (Batch 16 section 32) The invite closed meanwhile: refused with the reason.
  const closed = await stopOf(() => closedInvite(tester.id, body, tx));
  if (closed) return { stop: closed };
  // 2b. Left (or ended) earlier, with no invite.
  const left = await leftWithoutInvite(tx, testId, tester.id, invited);
  if (left) return { stop: left };
  // 2c. The change couldn't re-send the invite: it closed (with why).
  const replacedClosed = await stopOf(() => replacedInvite(tester.id, testId, body, tx, "closed"));
  if (replacedClosed) return { stop: replacedClosed };
  // 2d. An apply-only test.
  const applyOnly = await applyOnlyRefusal(tx, t, tester.id, invited);
  if (applyOnly) return { stop: applyOnly };
  // 3. A saved tester profile.
  const { profile, stop: noProfile } = await profileOrRefusal(tx, tester.id);
  if (noProfile) return { stop: noProfile };
  // 4a. (Batch 34 §10) The "changed since you opened this page" box (the NDA's line clears its tick; a re-sent invite is one of its lines: "here's a new invite on
  // the updated listing").
  const box = await stopOf(() => listingGate(tester.id, testId, body, "join", tx));
  if (box) return { stop: box };
  // 4b. With it, the re-sent invite: the confirmed press joins on the tester's current invite.
  const replacedFresh = await stopOf(() => replacedInvite(tester.id, testId, body, tx, "fresh"));
  if (replacedFresh) return { stop: replacedFresh };
  // 4c. (Owner's exception) Invite only, right after the box.
  if (t.joinMode === "invite" && !invited) return { stop: new HttpError(409, "invite_only", "This test is invite only.") };
  // 5a. The gap box.
  const gap = await stopOf(async () => gapStop(t, profile, body, as));
  if (gap) return { stop: gap };
  // 5b. The updated Terms of Use tick.
  const tick = await termsTick(tx, tester.id, body);
  if (tick) return { stop: tick };
  // 5c. (Design doc 7.3) The NDA tick.
  const nda = ndaRefusal(t, body, as === "Ask" ? "Accept the NDA to ask to rejoin." : "Accept the NDA to join.");
  if (nda) return { stop: nda };
  // 6. The join; any waiting application or ask of theirs closes as joined.
  const joined = await saveJoin(tx, t, tester, body);
  await agreeTerms(tx, tester.id, body);
  await tx.application.updateMany({ where: { testId, testerId: tester.id, status: "pending" }, data: { status: "joined", decidedAt: new Date() } });
  return { saved: joined };
}

const NOT_TESTER_LINE = "Turn on “test apps, games and more” in your profile to join tests.";
/** Join, Apply and Ask to rejoin, before the pass: a tester account, and a test that exists. */
async function testerAndTest(tester: U, testId: string) {
  if (!tester.isTester) throw new HttpError(403, "not_tester", NOT_TESTER_LINE);
  if (!(await db.test.count({ where: { id: testId } }))) throw new HttpError(404, "not_found", "That test doesn't exist.");
}

/**
 * JOIN (Who can join = Anyone, or an invited tester on an invite-only test). (Owner, Nov 11, §377) One pass under the test's lock, in the order above.
 *   0. a tester account; the test exists (before the lock)
 *   1. your own test → J01 (joinRefusal, in Join's words)
 *   2-6. joinSteps
 *   after the commit: afterJoin (the developer's line and bell, the tester's email). A lost key at the save: noKeyLine.
 */
export async function join(tester: U, testId: string, rawBody: Record<string, unknown>) {
  // (§352) The tester's own press: never the server-only flags (rejoining is the developer's accepted ask, or an invite).
  const body = clientJoinBody(rawBody);
  await testerAndTest(tester, testId);
  const joined = await onePass(testId, "join", body, async (tx): Promise<Pass<Joined>> => {
    const t = await tx.test.findUniqueOrThrow({ where: { id: testId } });
    // 1a. Your own test.
    if (t.developerId === tester.id) return { stop: new HttpError(409, "own", "You can't join your own test.") };
    // 1b. J01.
    const refused = await j01(tx, tester.id, testId, "Join");
    if (refused) return { stop: refused };
    return joinSteps(tx, tester, t, body);
  }).catch(noKeyLine(tester.id, testId, "Join"));
  await afterJoin(joined, tester, testId, body);
  return joined.contract;
}

export const JOIN_REQUESTS_PER_TEST_PER_DAY = 2;
const DAY_MS = 24 * 3600000;
/** (§377) Step 2's limit for an application or an ask: twice per test in 24 hours (shared), or null. */
async function requestLimit(q: Q, testerId: string, testId: string) {
  if (TESTING_NO_LIMITS) return null;
  const previous = await q.application.findUnique({ where: { testId_testerId: { testId, testerId } } });
  if (!previous) return null;
  const lastDay = { gt: new Date(Date.now() - DAY_MS) };
  const sentToday = await q.testEvent.count({ where: { testId, kind: "applied", link: `item-app-${previous.id}`, createdAt: lastDay } });
  if (sentToday >= JOIN_REQUESTS_PER_TEST_PER_DAY) {
    return new HttpError(429, "too_many_requests", "You can apply or ask to rejoin this test twice in 24 hours. Try again later.");
  }
  return null;
}
type RequestData = { note: string; listing: Prisma.InputJsonValue; kind: string; ndaAcceptedAt: Date | null };
/** (§377) Step 6 for Apply / Ask to rejoin: the application or ask, and its "applied" line, in the pass's transaction. */
async function storeJoinRequest(tx: Tx, testerId: string, testId: string, data: RequestData, text: string) {
  const application = await tx.application.upsert({
    where: { testId_testerId: { testId, testerId } },
    update: { ...data, status: "pending", changedAt: null, decidedAt: null, createdAt: new Date() },
    create: { testId, testerId, ...data },
  });
  await tx.testEvent.create({ data: { testId, kind: "applied", link: `item-app-${application.id}`, text } });
  return application;
}
/** An application or ask saved on its own under the test's lock (already waiting: J09's one wording; then the limit). The presses save in their pass. */
export async function saveJoinRequest(testerId: string, testId: string, data: RequestData, text: string, bypassLimit = false) {
  return db.$transaction(async (tx) => {
    await lockTest(tx, testId);
    await alreadyWaiting(testerId, testId, tx);
    const limit = bypassLimit ? null : await requestLimit(tx, testerId, testId);
    if (limit) throw limit;
    return storeJoinRequest(tx, testerId, testId, data, text);
  });
}

/** (§377) What an Apply or an Ask to rejoin ended with: joined (an unseen invite, or a test that now lets anyone join), or the request saved. */
type RequestDone = { joined: Joined } | { requested: { note: string } };
const asJoined = (p: Pass<Joined>): Pass<RequestDone> => ("stop" in p ? p : { saved: { joined: p.saved } });
/** The note typed with an Apply or an Ask to rejoin (trimmed, at most LIMITS.joinNote). */
const noteOf = (body: Record<string, unknown>) => (typeof body.note === "string" ? body.note.trim().slice(0, LIMITS.joinNote) : "");
/** The developer's bell and email line about a note: "Her note: “…”" (none: nothing). */
const noteLines = (tester: U, note: string) => (note ? [`${pronouns(tester.pronoun).Poss} note: “${note}”`] : []);

/**
 * APPLY TO JOIN (optional note). If the test now lets anyone join, the second press simply joins. (Owner, Nov 11, §377) One pass, in the order above.
 *   0. a tester account; the test exists (before the lock)
 *   1a. J01 (joinRefusal, in Apply's words) → 1b. an invite: one the page hadn't shown joins at once (joinSteps), one it showed is refused
 *   2a. already waiting (another tab) → 2b. the 2-per-24-hours limit (apply-only tests)
 *   3. the profile not saved
 *   4a. the listing-changed box → 4b. invite only → (anyone can join now: joinSteps)
 *   5a. the gap box → 5b. the Terms of Use tick → 5c. the NDA tick
 *   6. the application and its "applied" line; after the commit, the developer's bell and email (Applications).
 */
export async function apply(tester: U, testId: string, body: Record<string, unknown>) {
  await testerAndTest(tester, testId);
  const done = await onePass(testId, "apply", body, async (tx): Promise<Pass<RequestDone>> => {
    const t = await tx.test.findUniqueOrThrow({ where: { id: testId }, include: { developer: true } });
    // 1a. J01.
    const refused = await j01(tx, tester.id, testId, "Apply");
    if (refused) return { stop: refused };
    // 1b. (Batch 34 §16) An invite the page hadn't shown joins at once (any waiting application of theirs closes as joined), one it showed is refused.
    const invite = await inviteMet(tx, tester, testId, body, displayName(t.developer));
    if (invite instanceof HttpError) return { stop: invite };
    if (invite) return asJoined(await joinSteps(tx, tester, t, body));
    // 2a. Already waiting (J09).
    const waiting = await stopOf(() => alreadyWaiting(tester.id, testId, tx));
    if (waiting) return { stop: waiting };
    // 2b. The 2-per-24-hours limit (only a press that files an application).
    const limit = t.joinMode === "apply" ? await requestLimit(tx, tester.id, testId) : null;
    if (limit) return { stop: limit };
    // 3. (Owner, Nov 2) A saved tester profile first, like Join.
    const { profile, stop: noProfile } = await profileOrRefusal(tx, tester.id);
    if (noProfile) return { stop: noProfile };
    // 4a. The listing box.
    const box = await stopOf(() => listingGate(tester.id, testId, body, "apply", tx));
    if (box) return { stop: box };
    // 4b. (Owner's exception) Invite only.
    if (t.joinMode === "invite") return { stop: new HttpError(409, "invite_only", "This test is invite only.") };
    // A test that now lets anyone join: the press joins (Join's steps, past this box).
    if (t.joinMode === "anyone") return asJoined(await joinSteps(tx, tester, t, { ...body, confirmed: true }));
    // 5a. The gap box.
    const gap = await stopOf(async () => gapStop(t, profile, body, "Apply"));
    if (gap) return { stop: gap };
    // 5b. The updated Terms of Use tick.
    const tick = await termsTick(tx, tester.id, body);
    if (tick) return { stop: tick };
    // 5c. (7.3) The NDA tick: the NDA is accepted when applying; the developer's Accept joins them on it.
    const nda = ndaRefusal(t, body, "Accept the NDA to apply.");
    if (nda) return { stop: nda };
    // 6. The application.
    const note = noteOf(body);
    await agreeTerms(tx, tester.id, body);
    const request = { note, listing: listingSnapshot(t) as Prisma.InputJsonValue, kind: "apply", ndaAcceptedAt: t.ndaText ? new Date() : null };
    await storeJoinRequest(tx, tester.id, testId, request, `${displayName(tester)} applied to join`);
    return { saved: { requested: { note } } };
  }).catch(noKeyLine(tester.id, testId, "Apply"));
  if ("joined" in done) {
    await afterJoin(done.joined, tester, testId, body);
    return { joined: true, sessionId: done.joined.contract.id };
  }
  // (Owner, Nov 6, §308) The developer's "Applications · N", one entry a day across tests.
  const t = await db.test.findUniqueOrThrow({ where: { id: testId }, include: { developer: true } });
  const note = done.requested.note;
  const name = displayName(tester);
  const lines = [`${name} applied to join “${t.title}”.`, ...noteLines(tester, note), "Accept or decline on the test page."];
  await notify(t.developer.email, `${name} applied to join “${t.title}”`, lines, `/app/tests/${testId}#needs-you`, { testId, group: APPLICATIONS_GROUP });
  return { applied: true };
}

/**
 * WITHDRAW APPLICATION (an application or an ask to rejoin). Not under the test's lock; a still-pending row is the only one withdrawn.
 *   1. a pending one: the join page's listing box (listingGate, "withdraw")
 *   2. the withdraw
 *   3. nothing withdrawn: already over (declined, withdrawn, closed) → silent; accepted → "<Dev> accepted your application, so you're in this test."; none →
 *      "There's no pending application to withdraw."
 *   after: the developer's live line and bell (Applications withdrawn).
 */
export async function withdrawApplication(tester: { id: string }, testId: string, body: Record<string, unknown> = {}) {
  // 1. The listing box (only while there's something to withdraw).
  const pending = await db.application.count({ where: { testId, testerId: tester.id, status: "pending" } });
  if (pending) await listingGate(tester.id, testId, body, "withdraw");
  // 2. The withdraw.
  const n = await db.application.updateMany({
    where: { testId, testerId: tester.id, status: "pending" },
    data: { status: "withdrawn", decidedAt: new Date() },
  });
  // 3. Nothing was pending.
  if (!n.count) {
    // (Owner, Nov 11, §380) Already what the press wanted (declined, withdrawn, or closed: full, stopped, invite only, a block, the listing, joining closed): no
    // refusal, the page just redraws. Accepted keeps its one line ("Nora Lane accepted your application, so you're in this test.").
    if (await applicationAlreadyOver(tester.id, testId)) return { withdrawn: true, already: true };
    throw new HttpError(409, "gone", await withdrawGoneLine(tester.id, testId));
  }
  const me = await db.user.findUniqueOrThrow({ where: { id: tester.id } });
  // (Owner, Nov 7) A quiet live line, never a stop. Accept / Decline on it stays one refusal. The bell's email follows their
  // settings. (Owner, Nov 6, §308) It stacks one entry a day ACROSS tests,
  // "Applications withdrawn · 2" (group "appwithdrawn", no longer one stack per test).
  const t = await db.test.findUniqueOrThrow({ where: { id: testId }, select: { developerId: true, title: true } });
  const withdrew = `${displayName(me)} withdrew ${pronouns(me.pronoun).poss} application`;
  await logEvent(testId, "withdrew_app", withdrew);
  await bell(t.developerId, `${withdrew} to “${t.title}”`, `/app/tests/${testId}`, undefined, { side: "developer", testId, group: APP_WITHDRAWN_GROUP });
  return { withdrawn: true };
}

/** (Owner, Nov 11, §380) Withdraw on an application that's already over without them in the test (declined, withdrawn, closed for any reason): silent. */
async function applicationAlreadyOver(testerId: string, testId: string) {
  const a = await db.application.findUnique({ where: { testId_testerId: { testId, testerId } }, select: { status: true } });
  return !!a && ["declined", "withdrawn", "closed"].includes(a.status);
}

/** "There's no pending application to withdraw." (never one, or one that ended some other way). */
export const NO_PENDING_APPLICATION = "There's no pending application to withdraw.";
/**
 * (Owner, Nov 9, §354) The developer's Accept / Decline on a closed application names why it closed: the test filled up, joining closed (Open until passed),
 * the test was stopped, the test became invite only, or the listing changed (in another tab). A block's closing never says why.
 */
export function appClosedForDev(name: string, reason: string | null, at: Date, openUntil: Date | null) {
  if (reason === "full") return `${name}'s application closed when the test filled up at ${fmtTime(at)}.`;
  if (reason === "blocked") return `${name}'s application was closed.`;
  if (reason === "invite_only") return `${name}'s application closed when the test became invite only at ${fmtTime(at)}.`;
  if (reason === "joining_closed") return `${name}'s application closed when joining closed (Open until passed) on ${fmtDate(openUntil ?? at)}.`;
  if (reason === "stopped") return `${name}'s application closed when the test was stopped at ${fmtTime(at)}.`;
  return `${name}'s application closed when you changed the listing in another tab at ${fmtTime(at)}.`;
}

/**
 * (Owner, Oct 31, batch 35 §48) Withdraw on an application that's no longer pending says why: "<Dev> accepted your application, so you're in this test."
 * (§380 I: no time); never one: the plain line. (Owner, Nov 11, §380) Declined, withdrawn and closed (for any reason) are silent now (applicationAlreadyOver): their lines
 * are gone.
 */
export async function withdrawGoneLine(testerId: string, testId: string) {
  const a = await db.application.findUnique({ where: { testId_testerId: { testId, testerId } } });
  if (!a || (a.status !== "accepted" && a.status !== "joined")) return NO_PENDING_APPLICATION;
  const t = await db.test.findUnique({ where: { id: testId }, include: { developer: true } });
  // (Owner, Nov 11, §380 I) Without the time: "Nora Lane accepted your application, so you're in this test."
  return `${t ? displayName(t.developer) : "The developer"} accepted your application, so you're in this test.`;
}

type AppState = { status: string; closedReason: string | null; decidedAt: Date | null };
/** Accept / Decline: why this application can't be answered any more (also read again after a lost race: Nov 2, §119). */
function answeredOrClosed(name: string, pronoun: string, a: AppState, openUntil: Date | null) {
  // (Owner, Nov 9, §354) Each closed application names its real reason: the test filled up (before Dec 10), joining closed (Open until passed), the test
  // stopped, invite only, or the listing changed. (Batch 16 section 11) Closed by a block (either way): neutral, never says why.
  if (a.status === "closed") return new HttpError(409, "gone", appClosedForDev(name, a.closedReason, a.decidedAt ?? new Date(), openUntil));
  // (Batch 16 section 21) Answered already (in another tab): a plain refusal naming it, no stop box.
  let line = "This application was already answered.";
  if (a.status === "withdrawn") line = `${name} withdrew ${pronouns(pronoun).poss} application.`;
  else if (a.status === "declined") line = "You already declined this application.";
  else if (a.status === "accepted" || a.status === "joined") line = "You already accepted this application.";
  return new HttpError(409, "gone", line);
}

/** (§363) joinRefusal's line for the developer's Accept: in Accept's words, about the tester ("Ana Silva already joined", "Ana Silva can't join more tests…"). */
function acceptRefusalLine(refusal: string, name: string) {
  return asPressRefusal(refusal, "Accept")
    .replace("You've already joined", `${name} already joined`)
    .replace(TEST_LIMIT_LINE, `${name} can't join more tests right now.`);
}

/**
 * Accept / Decline: the stop line when the tester's rating changed since the page showed it. (Owner, Nov 9, §357) A tester's devices or languages changing (now
 * meeting a need, or no longer) never stops the press; a rating change still does. (Owner, Nov 5, §276) The rating as the application row shows it.
 */
async function ratingChangeStop(tester: { id: string; pronoun: string }, name: string, shownRating: number | null | undefined): Promise<TestEventLike | null> {
  const rating = await ratingSummary(tester.id, "tester");
  const currentRating = rating.n ? Number(rating.avg.toFixed(1)) : null;
  const ratingLine = ratingChangedLine(name, shownRating, currentRating, tester.pronoun);
  if (!ratingLine) return null;
  return { kind: "profile", text: ratingLine, createdAt: rating.at ?? new Date(), key: `needs:${tester.id}` };
}

/** What the page showed for this tester's row (Accept / Decline's `seenTesters`), or null. */
function shownRowOf(body: Record<string, unknown>, testerId: string) {
  const shownTesters = body.seenTesters && typeof body.seenTesters === "object" ? (body.seenTesters as Record<string, unknown>) : {};
  const row = shownTesters[testerId];
  return row && typeof row === "object" ? (row as Record<string, unknown>) : null;
}

/**
 * ACCEPT / DECLINE (the developer's answer to an application or an ask to rejoin). The stop-once box, plus "the tester's rating changed" and "anything about the
 * test changed since" (box under the button). Accept joins the tester on the current listing. Not one pass: the checks read the database, the box takes the
 * test's lock, and the join (joinTest) claims the still-pending application under its own lock.
 *   0. your test; the application exists
 *   1. Decline on one already withdrawn / closed / declined → silent
 *   2. Accept: you blocked the tester → "You blocked Ana Silva, so your Accept didn't go through."; the tester blocked you → "Ana Silva's application was closed."
 *   3. not pending → why (closed with its reason, withdrawn, already answered)
 *   4. Accept: joinRefusal (byDeveloper: no key check), in Accept's words
 *   5. the stop-once box (devGate): the tester's rating changed, the listing changed, other developer changes
 *   6. Decline: decline it (a lost race → silent or why) and tell the tester
 *   7. Accept: joinRefusal again (after the box) → the join (no free key → the key line; a lost race → why) → tell the tester
 */
export async function decideApplication(dev: U, testId: string, body: Record<string, unknown>) {
  // 0. Your test; the application.
  await ownTest(dev.id, testId);
  const a = await db.application.findUnique({ where: { id: String(body.applicationId ?? "") } });
  if (!a || a.testId !== testId) throw new HttpError(404, "not_found", "That application doesn't exist.");
  const tester = await db.user.findUniqueOrThrow({ where: { id: a.testerId }, include: { profile: true } });
  const name = displayName(tester);
  const openUntil = (await db.test.findUnique({ where: { id: testId }, select: { openUntil: true } }))?.openUntil ?? null;
  const accepting = body.action !== "decline";
  const gone = (state: AppState) => answeredOrClosed(name, tester.pronoun, state, openUntil);
  const goneNow = async () => gone(await db.application.findUniqueOrThrow({ where: { id: a.id } }));
  // 1. (Owner, Nov 11, §380) Decline on an application the tester withdrew, that closed, or that was already declined: already what the press wanted, no refusal
  // (the page redraws). Joined another way (accepted) keeps its refusal.
  const declinedAlready = (s: string) => body.action === "decline" && ["withdrawn", "closed", "declined"].includes(s);
  if (declinedAlready(a.status)) return { declined: true, already: true };
  // 2. (Owner, Nov 11, §380 H) Accept on an application closed by the developer's own block (or with that block on): "You blocked Ana Silva, so your Accept didn't
  // go through." The tester's block keeps the neutral line ("Ana Silva's application was closed.").
  if (accepting) await (await import("./blocks")).ownBlockStop(dev.id, tester.id, name, "Accept");
  if (accepting && a.status === "pending" && (await (await import("./blocks")).iBlocked(tester.id, dev.id))) {
    throw new HttpError(409, "gone", `${name}'s application was closed.`);
  }
  // 3. No longer pending.
  if (a.status !== "pending") throw gone(a);
  const isRejoin = a.kind === "rejoin";
  // 4. (Owner, Nov 27, shared rule 4: refusals → box → field mistakes) Accept's own refusals (stopped, joining closed, paused, full, a block, the 10-test limit…)
  // before the stop-once box, never after it. (§341) No free key: refused when it joins (joinTest), with the key line.
  if (accepting) {
    const refusal = await joinRefusal(tester.id, testId, { rejoin: isRejoin, byDeveloper: true });
    if (refusal) throw new HttpError(409, "refused", acceptRefusalLine(refusal, name));
  }
  // 5. The stop-once box.
  const extra: TestEventLike[] = [];
  const shownRow = shownRowOf(body, tester.id);
  if (shownRow) {
    const shownRating = !("rating" in shownRow) ? undefined : typeof shownRow.rating === "number" ? shownRow.rating : null;
    const ratingStop = await ratingChangeStop(tester, name, shownRating);
    if (ratingStop) extra.push(ratingStop);
  }
  extra.push(...(await listingChanges(testId, body.seenAt)));
  // (Batch 35 §79) The application's own "applied" line never stops its answer.
  const appliedTexts = [`${name} applied to join`, `${name} asks to rejoin`];
  const press = { acts: ["application"], keys: [`app:${a.id}`], answers: { item: a.id, kinds: ["applied"], texts: appliedTexts } };
  await db.$transaction((tx) => devGate(tx, testId, body, {}, extra, undefined, press));
  // 6. Decline.
  if (body.action === "decline") return declineApplication(a, tester, testId, declinedAlready, goneNow);
  // 7. Accept. (Rule 4) Read again after the box: something that changed while it showed refuses the confirmed press with the same line.
  const refusal = await joinRefusal(tester.id, testId, { rejoin: isRejoin, byDeveloper: true }); // (§341) no free key: refused below with the key line
  if (refusal) throw new HttpError(409, "refused", acceptRefusalLine(refusal, name));
  const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
  // (Nov 2, §119) The join claims the still-pending application inside its own lock (as "accepted"): a Withdraw a moment ago wins, and the refusal says so.
  const joinBody = {
    listingVersion: t.listingVersion, confirmed: true, anyway: true, acceptedByDeveloper: true, rejoinAccepted: isRejoin,
    ndaAcceptedAt: a.ndaAcceptedAt?.toISOString(), ndaAccepted: !!a.ndaAcceptedAt,
  };
  const c = await joinTest({ ...tester, isTester: true }, testId, joinBody, { applicationId: a.id, applicationStatus: "accepted" })
    .catch(async (e) => { throw e instanceof HttpError && e.code === "application_gone" ? await goneNow() : e; });
  // The tester's lines ((Owner, Nov 2026) `always`: emailed whatever the setting).
  if (isRejoin) {
    const line = `You're back in ${t.title}: your deadline is ${T(c.dueAt)}.`;
    const lines = [line, `Your session is restored on the current listing: ${termsLine(c, true)}.`];
    await notify(tester.email, line, lines, `/app/sessions/${c.id}`, { about: dev.id, group: "joined", always: true });
    return { accepted: true, sessionId: c.id, line: `${name} rejoined: ${pronouns(tester.pronoun).poss} deadline is ${fmtDateTime(c.dueAt)}.` };
  }
  const lines = [`You're in: ${t.title}. Your contract: ${termsLine(c, true)}.`];
  await notify(tester.email, `You're in: ${t.title}`, lines, `/app/sessions/${c.id}`, { group: "joined", always: true });
  return { accepted: true, sessionId: c.id };
}

/** Decline's save: only a still-pending application is declined, then the tester is told. */
async function declineApplication(
  a: { id: string; kind: string },
  tester: { email: string },
  testId: string,
  declinedAlready: (status: string) => boolean,
  goneNow: () => Promise<HttpError>,
) {
  // (Nov 2, §119) Only a still-pending application is declined: a Withdraw (or an answer in another tab) a moment ago wins, and the refusal says which.
  const declined = await db.application.updateMany({ where: { id: a.id, status: "pending" }, data: { status: "declined", decidedAt: new Date() } });
  if (declined.count !== 1) {
    const now = await db.application.findUniqueOrThrow({ where: { id: a.id } });
    if (declinedAlready(now.status)) return { declined: true, already: true }; // (§380)
    throw await goneNow();
  }
  const title = (await db.test.findUniqueOrThrow({ where: { id: testId } })).title;
  // (Batch 29 §24) In the day's "Joined" entry, across tests, linking to its own join page.
  const opts = { group: "joined", testId };
  const href = `/app/find/${testId}`;
  if (a.kind === "rejoin") {
    await notify(tester.email, `Your ask to rejoin “${title}” wasn't accepted`, ["The developer didn't accept your ask to rejoin."], href, opts);
  } else {
    await notify(tester.email, `Your application to “${title}” wasn't accepted`, ["Thanks for applying. There are other tests to find."], href, opts);
  }
  return { declined: true };
}

/**
 * SWITCH TO "ANYONE CAN JOIN" (an Edit Save that changed Who can join to Anyone; run after the Save, not under one lock). Each pending application, oldest first:
 *   1. the test is full now → stop (the rest wait)
 *   2. the listing changed since they applied (anything but Who can join and spots) → marked changed and the tester told: "join on the current listing, or
 *      withdraw your application"
 *   3. their profile misses what the test needs → skipped (it waits)
 *   4. joinRefusal (byDeveloper: no key check) → skipped (it waits)
 *   5. the join (joinTest, as the developer's acceptance) → "You're in: <title>". (§338) No free key → this one and the ones after it wait, and the Save's
 *      note names them. Full meanwhile → stop. The application gone meanwhile → skipped.
 *   after: the developer's live line ("N waiting applications were accepted …", and the no-key line).
 */
export async function onSwitchToAnyone(testId: string) {
  const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
  const pending = await db.application.findMany({ where: { testId, status: "pending" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  let accepted = 0;
  // (Owner, Nov 9, §338) No free access key: the Save stays done, like a full test; this application and the ones after it stay waiting, and the Save's note names them.
  const noKey: string[] = [];
  for (const [n, a] of pending.entries()) {
    // 1. Full.
    if (await db.contract.count({ where: { testId, status: "working" } }) >= t.spots) break;
    const tester = await db.user.findUniqueOrThrow({ where: { id: a.testerId } });
    // 2. The listing changed since they applied.
    if (!sameListingIgnoringMode(a.listing, t)) {
      await markApplicationChanged(t, a.id, tester.email);
      continue;
    }
    // 3. A profile gap.
    const profile = await db.testerProfile.findUnique({ where: { userId: tester.id } });
    if (needsGap(asListing(t), profile)) continue;
    // 4. joinRefusal. (§341) No free key: caught below (§338).
    if (await joinRefusal(tester.id, testId, { byDeveloper: true })) continue;
    // 5. The join.
    try {
      const joinBody = { listingVersion: t.listingVersion, confirmed: true, anyway: true, acceptedByDeveloper: true };
      const c = await joinTest({ ...tester, isTester: true }, testId, joinBody, { applicationId: a.id, quietJoinEvent: true });
      // (Owner, Nov 2026) `always`: emailed whatever the setting.
      await notify(tester.email, `You're in: ${t.title}`, [`You're in: ${t.title}.`], `/app/sessions/${c.id}`, { group: "joined", always: true });
      accepted++;
    } catch (error) {
      if (error instanceof HttpError && error.code === "application_gone") continue;
      if (error instanceof HttpError && error.code === "refused" && /full/i.test(error.message)) break;
      if (error instanceof HttpError && error.code === "no_key") {
        noKey.push(...(await namesStillWaiting(pending.slice(n).map((x) => x.id))));
        break;
      }
      throw error;
    }
  }
  if (accepted) {
    const were = accepted === 1 ? " was" : "s were";
    await logEvent(testId, "applied", `${accepted} waiting application${were} accepted when you switched to joins instantly`);
  }
  if (noKey.length) await logEvent(testId, "applied", noKeyWaitingLine(noKey));
  return { noKey };
}

/** onSwitchToAnyone step 2: the application is marked changed (Join then joins on the current listing) and, if it was still pending, the tester is told. */
async function markApplicationChanged(t: { title: string; id: string }, applicationId: string, email: string) {
  const changedAt = new Date();
  const line = `“${t.title}” changed since you applied: join on the current listing, or withdraw your application.`;
  const updated = await db.application.updateMany({ where: { id: applicationId, status: "pending" }, data: { changedAt } });
  if (updated.count) await notify(email, line, [line], `/app/find/${t.id}`, { group: "apps", testId: t.id });
}

/** The names of the testers whose applications (among these) still wait. */
async function namesStillWaiting(applicationIds: string[]) {
  const waiting = await db.application.findMany({ where: { id: { in: applicationIds }, status: "pending" }, select: { testerId: true } });
  const people = await db.user.findMany({ where: { id: { in: waiting.map((w) => w.testerId) } } });
  const names = new Map(people.map((u) => [u.id, displayName(u)]));
  return waiting.map((w) => names.get(w.testerId) ?? "A tester");
}

/**
 * (Owner correction, NEWEST+4) An EDIT SAVE that changed a closing field (CLOSING_FIELDS in tests.ts, not an NDA-only change), or switched to invite only, closes
 * every pending application (and ask to rejoin); no invite is sent. The applicant is told (bell + email; their join page's top box), and the developer's page
 * shows the line and stops once for it. Returns the applicants' names for the Save's note.
 */
export async function closeApplicationsAfterEdit(testId: string, why: "listing" | "invite_only" = "listing") {
  const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
  const pending = await db.application.findMany({ where: { testId, status: "pending" }, orderBy: { createdAt: "asc" } });
  const now = new Date();
  const names: string[] = [];
  // (Batch 15 section 32) The test's title quoted, like every other line.
  const line = why === "invite_only"
    ? `“${t.title}” is now invite only, so your application was closed.`
    : `“${t.title}”'s listing changed, so your application was closed. You can apply again on the current listing.`;
  for (const a of pending) {
    await db.application.update({ where: { id: a.id }, data: { status: "closed", decidedAt: now, closedReason: why } });
    const tester = await db.user.findUnique({ where: { id: a.testerId } });
    if (!tester) continue;
    names.push(displayName(tester));
    // (Batch 14 section 3) Several tests in a day stack into one entry.
    // (Batch 29 §23) In the day's "Applications and invites" entry, across tests (no longer "Applications closed").
    await notify(tester.email, line, [line], `/app/find/${testId}`, { group: "apps", testId });
  }
  return names;
}

/** The line the developer reads about a rejoin ask: what the tester gets back if accepted. */
export function rejoinAskLine(name: string, pron: { subj: string; poss: string }, c: { endedAt: Date | null; dueAt: Date }, tz?: string | null) {
  const left = c.endedAt ? c.dueAt.getTime() - c.endedAt.getTime() : 0;
  if (left <= 0) {
    const Subj = `${pron.subj[0].toUpperCase()}${pron.subj.slice(1)}`;
    return `${name} asks to rejoin. ${Subj} had no time left: ${pron.poss} deadline stays passed.`;
  }
  const getsBack = pron.subj === "they" ? "they get" : `${pron.subj} gets`;
  const had = pron.subj === "they" ? "they" : pron.subj;
  // (§154) The end of that day, as rejoinDue gives.
  const deadline = fmtDateTime(movedDue(new Date(), left, tz));
  return `${name} asks to rejoin. If you accept, ${getsBack} back the ${leftText(left)} ${had} had left (deadline ${deadline}).`;
}

/**
 * Ask to rejoin step 2: the press's own refusals, in order: never in / still in; (owner, Oct 28, batch 16 section 11) a block either way; rated or can't ask.
 * (§380 F) Under the lock. (Owner, Nov 11, §380 H) Their own block names it; the developer's reads the neutral line, both in the press pattern.
 */
async function askOwnRefusal(tx: Tx, tester: U, t: TestWithDeveloper, old: Prisma.ContractGetPayload<object> | null) {
  // 2a. Never in / still in.
  if (!old || old.status === "working") {
    return new HttpError(409, "not_again", old ? "You've already joined this test." : "You haven't been in this test.");
  }
  // 2b. A block either way.
  const blocks = await import("./blocks");
  if (await blocks.iBlocked(tester.id, t.developerId, tx)) {
    return new HttpError(409, "refused", pressRefused(ownBlockCause(displayName(t.developer)), "Ask to rejoin"));
  }
  if (await blocks.blockedEitherWay(tester.id, t.developerId, tx)) return new HttpError(409, "refused", pressRefused(NOT_TAKING_CAUSE, "Ask to rejoin"));
  // 2c. Rated, or ended in a way that can't come back (canAskToRejoin).
  const rated = (await tx.rating.count({ where: { contractId: old.id } })) > 0;
  if (!canAskToRejoin(old, rated)) {
    const line = rated || old.endKind === "rated" ? "You rated this test, so you can't join it again." : "You can't ask to rejoin this test.";
    return new HttpError(409, "not_again", line);
  }
  return null;
}

/**
 * (Design doc 7.3) ASK TO REJOIN: a tester who left, or whose work was ended (or who a suspension removed), before their deadline, asks to come back; the
 * developer accepts and the session returns on the current listing with the time they had left. Checks the 10-test limit, the NDA and the listing like Join.
 * (Owner, Nov 11, §377) One pass under the test's lock, in the order above Join, with the same order as Join and Apply after its own refusals (the gap box
 * before the NDA tick). An invite the page hadn't shown joins them at once right after J01 (batch 34 §16: the ask and the invite meet), so an ask is never
 * filed next to an open invite.
 *   0. a tester account; the test exists (before the lock)
 *   1a. J01 (joinRefusal as a rejoin, in Ask to rejoin's words) → 1b. an invite: one the page hadn't shown joins at once, one it showed is refused
 *   2a. never in / still in → 2b. a block either way → 2c. rated / can't ask → 2d. already waiting (another tab) → 2e. the 2-per-24-hours limit
 *   3. the profile not saved
 *   4. the listing-changed box
 *   5a. the gap box → 5b. the Terms of Use tick → 5c. the NDA tick
 *   6. the ask and its "applied" line; after the commit, the developer's bell and email (Applications).
 */
export async function askToRejoin(tester: U, testId: string, body: Record<string, unknown>) {
  await testerAndTest(tester, testId);
  let old: Prisma.ContractGetPayload<object> | null = null;
  const done = await onePass(testId, "rejoin-ask", body, async (tx): Promise<Pass<RequestDone>> => {
    const t = await tx.test.findUniqueOrThrow({ where: { id: testId }, include: { developer: true } });
    // 1a. J01 (a rejoin).
    const refused = await j01(tx, tester.id, testId, "Ask to rejoin", { rejoin: true });
    if (refused) return { stop: refused };
    // 1b. An invite the page hadn't shown: they're back at once; one it showed: Join, not an ask.
    const invite = await inviteMet(tx, tester, testId, body, displayName(t.developer));
    if (invite instanceof HttpError) return { stop: invite };
    if (invite) return asJoined(await joinSteps(tx, tester, t, body, "Ask"));
    // 2a-2c. Ask to rejoin's own refusals.
    old = await tx.contract.findUnique({ where: { testId_testerId: { testId, testerId: tester.id } } });
    const own = await askOwnRefusal(tx, tester, t, old);
    if (own) return { stop: own };
    // 2d. Already waiting (J09).
    const waiting = await stopOf(() => alreadyWaiting(tester.id, testId, tx));
    if (waiting) return { stop: waiting };
    // 2e. The 2-per-24-hours limit.
    const limit = await requestLimit(tx, tester.id, testId);
    if (limit) return { stop: limit };
    // 3. A saved tester profile.
    const { profile, stop: noProfile } = await profileOrRefusal(tx, tester.id);
    if (noProfile) return { stop: noProfile };
    // 4. The listing box.
    const box = await stopOf(() => listingGate(tester.id, testId, body, "ask", tx));
    if (box) return { stop: box };
    // 5a. (§377; was the NDA tick first) The gap box, then the ticks, as Join and Apply.
    const gap = await stopOf(async () => gapStop(t, profile, body, "Ask"));
    if (gap) return { stop: gap };
    // 5b. The updated Terms of Use tick.
    const tick = await termsTick(tx, tester.id, body);
    if (tick) return { stop: tick };
    // 5c. The NDA tick.
    const nda = ndaRefusal(t, body, "Accept the NDA to ask to rejoin.");
    if (nda) return { stop: nda };
    // 6. The ask.
    const note = noteOf(body);
    await agreeTerms(tx, tester.id, body);
    const request = { note, listing: listingSnapshot(t) as Prisma.InputJsonValue, kind: "rejoin", ndaAcceptedAt: t.ndaText ? new Date() : null };
    await storeJoinRequest(tx, tester.id, testId, request, `${displayName(tester)} asks to rejoin`);
    // (Owner, Oct 28) A test a suspension removed them from leaves the dashboard top once they ask (or dismiss it).
    const asked = old!;
    if (asked.endKind === "suspended" && !asked.removedDismissedAt) {
      await tx.contract.update({ where: { id: asked.id }, data: { removedDismissedAt: new Date() } });
    }
    return { saved: { requested: { note } } };
  }).catch(noKeyLine(tester.id, testId, "Ask to rejoin"));
  if ("joined" in done) {
    // (Owner, Nov 11, §379 item 2) An Ask to rejoin that met an invite the page hadn't shown, from someone who had been in the test: "Ana Silva rejoined …".
    await afterJoin(done.joined, tester, testId, body, { rejoined: done.joined.back });
    return { joined: true, sessionId: done.joined.contract.id };
  }
  // (Owner, Nov 6, §308) The developer's "Applications · N", one entry a day across tests.
  const t = await db.test.findUniqueOrThrow({ where: { id: testId }, include: { developer: true } });
  const name = displayName(tester);
  const note = done.requested.note;
  const line = rejoinAskLine(name, pronouns(tester.pronoun), old!);
  const opts = { about: tester.id, testId, group: APPLICATIONS_GROUP };
  await notify(t.developer.email, `${name} asks to rejoin “${t.title}”`, [line, ...noteLines(tester, note)], `/app/tests/${testId}#needs-you`, opts);
  return { asked: true };
}

/**
 * (Batch 34 §16) The applications and rejoin asks the developer still answers (Needs you, Needs review, the daily reminder): the pending ones, minus those whose
 * tester holds a sent invite for that test. The developer already chose them: the invite stands for the answer (they're in the Invited list), and the
 * application closes as joined when they join. (Inviting a waiting applicant normally joins them at once, design doc 6; this covers the invite that couldn't.)
 */
export async function answerable<A extends { testId: string; testerId: string }>(apps: A[]): Promise<A[]> {
  if (!apps.length) return apps;
  const pairs = apps.map((a) => ({ testId: a.testId, testerId: a.testerId }));
  const sent = await db.invite.findMany({ where: { status: "sent", OR: pairs }, select: { testId: true, testerId: true } });
  const invited = new Set(sent.map((i) => `${i.testId}|${i.testerId}`));
  return apps.filter((a) => !invited.has(`${a.testId}|${a.testerId}`));
}

/**
 * (Design doc 6) A pending application or rejoin ask plus an invite from the developer, in either order, joins the tester at once
 * (the developer chose them; no Join anyway pop-up), unless a final refusal applies. Both are told.
 * (Batch 34 §16, owner, Oct 30) When the developer's Invite is the second of the two (`byDeveloper`), it is exactly Accept on that application: joinTest as the
 * developer's acceptance (no second "joined" line from joinTest), the application marked accepted, and the tester's usual Accept lines ("You're in: …" with their
 * contract / "You're back in …"); the Invite result names it ("Ana Silva had applied: she joined.").
 *   1. no pending application or no open invite → nothing (null)
 *   2. joinRefusal (as a rejoin; the developer's Invite skips the key check) → nothing
 *   3. the NDA not accepted with the application → nothing (they accept it themselves)
 *   4. the join. The tester's own ask with the last free key gone → nothing (the ask waits); the developer's Invite → the key line (thrown)
 *   5. the application accepted (Invite) or joined; the tester and the developer told
 */
export async function matchInviteAndAsk(testId: string, testerId: string, opts: { byDeveloper?: boolean } = {}) {
  const app = await db.application.findFirst({ where: { testId, testerId, status: "pending" } });
  const inv = await db.invite.findFirst({ where: { testId, testerId, status: "sent" } });
  if (!app || !inv) return null;
  const tester = await db.user.findUniqueOrThrow({ where: { id: testerId } });
  const t = await db.test.findUniqueOrThrow({ where: { id: testId }, include: { developer: true } });
  if (await joinRefusal(testerId, testId, { rejoin: true, byDeveloper: opts.byDeveloper })) return null; // (§341) the developer's Invite: the key line, below
  if (t.ndaText && !app.ndaAcceptedAt) return null; // they still have to accept the NDA themselves
  const back = app.kind === "rejoin";
  // (§341) The tester's own ask meeting an invite, with the last free key gone meanwhile: the ask just waits (the developer's Invite: the key line, §338).
  let c;
  try {
    const joinBody = {
      listingVersion: t.listingVersion, confirmed: true, anyway: true, rejoinAccepted: true,
      ndaAccepted: !!app.ndaAcceptedAt, ndaAcceptedAt: app.ndaAcceptedAt?.toISOString(),
      ...(opts.byDeveloper ? { acceptedByDeveloper: true } : {}),
    };
    c = await joinTest(tester, testId, joinBody);
  } catch (e) {
    if (!opts.byDeveloper && e instanceof HttpError && e.code === "no_key") return null;
    throw e;
  }
  await db.application.update({ where: { id: app.id }, data: { status: opts.byDeveloper ? "accepted" : "joined", decidedAt: new Date() } });
  // (Owner, Nov 2026) `always`: emailed whatever the setting.
  const href = `/app/sessions/${c.id}`;
  if (opts.byDeveloper) {
    // As Accept (decideApplication) tells them.
    const backLine = `You're back in ${t.title}: your deadline is ${T(c.dueAt)}.`;
    const backLines = [backLine, `Your session is restored on the current listing: ${termsLine(c, true)}.`];
    const inLines = [`You're in: ${t.title}. Your contract: ${termsLine(c, true)}.`];
    if (back) await notify(tester.email, backLine, backLines, href, { about: t.developerId, group: "joined", always: true });
    else await notify(tester.email, `You're in: ${t.title}`, inLines, href, { group: "joined", always: true });
  } else {
    const subject = back ? `You're back in ${t.title}` : `You're in: ${t.title}`;
    const line = back ? `You're back in ${t.title}: your deadline is ${T(c.dueAt)}.` : `You're in: ${t.title}.`;
    await notify(tester.email, subject, [line], href, { about: t.developerId, group: "joined", always: true });
  }
  // (Owner, Nov 6, §308) The developer's: a plain per-test line, in the test's own "Harbor Run · N updates" stack.
  const name = displayName(tester);
  const p = pronouns(tester.pronoun);
  const joinedWord = back ? "rejoined" : "joined";
  const theyHad = p.subj === "they" ? "they'd" : `${p.subj} had`;
  const devLine = `${name} ${joinedWord} (you'd invited ${p.obj} and ${theyHad} asked).`;
  await notify(t.developer.email, `${name} ${joinedWord} “${t.title}”`, [devLine], `/app/tests/${testId}#tester-${c.id}`, { about: testerId, testId });
  return c;
}

/** (Batch 34 §16) The Invite result's line for a tester the invite joined: "Ana Silva had applied: she joined." / "Ben Cole had asked to rejoin: he's back in." */
export function invitedJoinedLine(name: string, pronoun: string, kind: string) {
  const subj = pronouns(pronoun).subj;
  if (kind === "rejoin") return `${name} had asked to rejoin: ${subj === "they" ? "they're" : `${subj}'s`} back in.`;
  return `${name} had applied: ${subj} joined.`;
}
