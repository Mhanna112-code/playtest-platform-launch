import { TESTING_NO_LIMITS } from "@/lib/testingLimits";
import { Prisma } from "@prisma/client";
import { T } from "@/lib/tz";
import { db } from "@/lib/db";
import { displayName, fmtDate, fmtDateTime, fmtTime, pronouns } from "@/lib/server/dateFormat";
import { PAUSED_RIGHT_NOW, closedToNewLine, canAskToRejoin, leftText, movedDue, MAX_ACTIVE_TESTS, termsLine, testPaused, TEST_LIMIT_LINE, type TestEventLike } from "@/lib/rules";
import { HttpError } from "./http";
import { NO_FREE_KEY, noKeyWaitingLine } from "@/lib/keys";
import { LIMITS } from "@/lib/limits";
import { bell, notify } from "./notify";
import { APP_WITHDRAWN_GROUP, APPLICATIONS_GROUP } from "@/lib/bell";
import { unanswered, answersIt, asLines, listingSaveLines, logEvent, ownChanges, seenOf, tabOf, withRenamed } from "./live";
import { asListing, devGate, gapStop, joinTest, needsGap, ownTest, PROFILE_FIRST, profileSaved } from "./tests";
import { ratingChangedLine } from "./invites";
import { ratingSummary } from "./ratings";

// Joining (owner rule): Who can join = Anyone (Join) / Apply (Apply to join → the developer Accepts or Declines) /
// Invite only. No offers or counter-offers on the join page. Join and Apply stop once if ANYTHING about the listing
// changed since the page loaded (including who can join). Refused for good: full, stopped, past Open until, paused,
// blocked, 10 tests, already in.

type U = { id: string; email: string; name: string; pronoun: string; isTester: boolean; isDeveloper: boolean };

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
 *   8. full: "This test is full." ("<title> is full right now." with an invite)   9. (§348) no free access key with a spot open: the key line, NO_FREE_KEY
 *   10. a block either way   11. the 10-test limit.
 * Then the press's own checks (join(): left → ask to rejoin; the listing changed → stop once; apply-only → "press Apply"; "This test is invite only."), so a test
 * that is both full and keyless, or full and invite only, reads only "This test is full.".
 * (Owner, Nov 9, §341) `byDeveloper`: the developer's own Accept / Invite / switch to "Anyone can join" skip 9; the join itself is then refused with the key line.
 */
export async function joinRefusal(testerId: string, testId: string, opts: { rejoin?: boolean; byDeveloper?: boolean } = {}) {
  const t = await db.test.findUniqueOrThrow({ where: { id: testId }, include: { developer: true } });
  if (t.status === "stopped") return "This test was stopped.";
  if (t.openUntil && t.openUntil < new Date()) return closedToNewLine(t.openUntil, (d) => fmtDate(d).replace(/, \d{4}$/, "")); // (batch 15 section 18)
  if (t.status !== "open") return "This test isn't taking new testers any more.";
  // (Owner, Oct 28 afternoon) Invites and applications wait while the test is paused; the join page says only this.
  if (testPaused(t.developer, t)) return PAUSED_RIGHT_NOW;
  const old = await db.contract.findUnique({ where: { testId_testerId: { testId, testerId } } });
  if (old?.status === "working") return "You've already joined this test.";
  if (old && (await db.rating.count({ where: { contractId: old.id } }))) return old.status === "left" && old.endKind === "rated" ? "You rated this test, so you can't join it again." : "You can't join this test again.";
  if (old?.status === "ended" && !opts.rejoin && !(await db.invite.findFirst({ where: { testId, testerId, status: "sent" } }))) return "You can't join this test again.";
  const testersIn = await db.contract.count({ where: { testId, status: "working" } });
  if (testersIn >= t.spots) return (await db.invite.findFirst({ where: { testId, testerId, status: "sent" } })) ? `${t.title} is full right now.` : "This test is full.";
  // (§341, §348) A test that uses access keys with none free (a spot open): the tester's presses read the key line, not "full"; nothing closes (applications, asks
  // and invites stay) and Find leaves it out.
  if (!opts.byDeveloper && (await (await import("./accessKeys")).noFreeKeyTests(db, [testId])).has(testId)) return NO_FREE_KEY;
  if (await db.block.count({ where: { blockerId: testerId, blockedId: t.developerId } })) return `You blocked ${displayName(t.developer)}: unblock ${pronouns(t.developer.pronoun).obj} in Account → Blocked people to join.`;
  if (await db.block.count({ where: { blockerId: t.developerId, blockedId: testerId } })) return "This test isn't taking new testers right now.";
  if ((await db.contract.count({ where: { testerId, status: "working" } })) >= MAX_ACTIVE_TESTS) return TEST_LIMIT_LINE;
  return "";
}

/** What changed on the listing since the page loaded (edits: any field, spots, Open until, who can join). */
export async function listingChanges(testId: string, seenAt: unknown): Promise<TestEventLike[]> {
  const d = typeof seenAt === "string" ? new Date(seenAt) : null;
  if (!d || isNaN(d.getTime())) return [];
  return db.testEvent.findMany({ where: { testId, kind: "edited", createdAt: { gt: d } }, orderBy: { createdAt: "asc" } });
}

/** The join page's stop-once reasons: (D) the listing changed (spots excepted), (E) the tester's own actions in another tab. */
export async function joinPageChanges(userId: string, testId: string, seenAt: unknown, tab: string): Promise<TestEventLike[]> {
  const d = seenOf(seenAt);
  if (!d) return [];
  // (Batch 30 §10, §12) ONE line per listing save, every save since the page last showed them (the NDA too: "Marc Hanna changed the NDA at 6:58 PM: read and accept it
  // again below"); a rename alone is info only.
  const edits = await listingSaveLines(testId, d, userId, "join");
  // (NEWEST+4, LIVE + GONE) Their application closed / their invite re-sent on the updated listing.
  const t = await db.test.findUniqueOrThrow({ where: { id: testId }, include: { developer: true } });
  // (Batch 16 section 11) A test a block hides from this tester shows nothing (its page reads "This test isn't available right now.").
  if (await (await import("./blocks")).hiddenByBlock(userId, t)) return [];
  const gone: TestEventLike[] = [];
  for (const a of await db.application.findMany({ where: { testId, testerId: userId, status: "closed", decidedAt: { gt: d } } }))
    gone.push({ kind: "applied", text: a.closedReason === "blocked" ? (await import("./blocks")).appClosedLine(t.title).replace(/\.$/, "") : a.closedReason === "full" ? `${t.title} is full: your application was closed` : a.closedReason === "invite_only" ? `${displayName(t.developer)} made the test invite only: your application was closed` : a.closedReason === "joining_closed" ? `Joining ${t.title} closed (Open until passed) on ${fmtDate(t.openUntil ?? a.decidedAt!)}: your application was closed` : a.closedReason === "stopped" ? `${t.title} was stopped: your application was closed` : `${displayName(t.developer)} changed the listing: your application was closed`, createdAt: a.decidedAt! }); // (§354) each its real reason
  // (Correction 6) Invited: the test filled (the invite stays open) / a spot opened.
  if (await db.invite.findFirst({ where: { testId, testerId: userId, status: "sent" } })) {
    for (const e of await db.testEvent.findMany({ where: { testId, kind: { in: ["full", "spot_open"] }, createdAt: { gt: d } } }))
      gone.push({ kind: e.kind, text: e.kind === "full" ? `${t.title} is full right now. Your invite stays open; we'll tell you when a spot opens.` : e.text, createdAt: e.createdAt });
  }
  const replaced = await db.invite.findMany({ where: { testId, testerId: userId, status: "replaced", updatedAt: { gt: d } } });
  if (replaced.length) {
    const fresh = await db.invite.findFirst({ where: { testId, testerId: userId, status: "sent" }, orderBy: { createdAt: "desc" } });
    gone.push(fresh ? { kind: "invite", text: `${displayName(t.developer)} changed the listing: here's a new invite on the updated listing`, createdAt: fresh.createdAt, item: fresh.id } : { kind: "invite", text: `${displayName(t.developer)} changed the listing: your invite closed (no spots left)`, createdAt: replaced[0].updatedAt });
  }
  // (Owner) Rejoining a test they LEFT stops once for the same reasons as their in-test buttons (A-F): paid / rejected,
  // call changes, their own other-tab actions; the listing's one line covers new terms (they rejoin on the current listing, no offer).
  const left = await db.contract.findUnique({ where: { testId_testerId: { testId, testerId: userId } } });
  const rejoin: TestEventLike[] = [];
  if (left && left.status === "left") {
    const { testerChanges } = await import("./testerGate");
    rejoin.push(...(await testerChanges(userId, left.id, testId, d, tab)).filter((e) => e.kind !== "terms"));
    // (Batch 35 §53) No "changed the terms: <fields>" line: the save's one listing line ("<Dev> edited the listing · See it") already covers it, and a tester
    // who isn't working has no offer to answer.
  }
  const all = [...edits, ...gone, ...(await ownChanges(userId, testId, d, tab)), ...rejoin];
  const seen = new Set<string>();
  return all.filter((e) => {
    const k = `${e.createdAt.getTime()}|${e.text}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/** Join / Apply / Withdraw application / No thanks stop once (box under the button) for the join page's reasons. */
export async function listingGate(userId: string, testId: string, body: Record<string, unknown>, verb: string) {
  const r = await joinStopList(userId, testId, body, verb);
  if (r) throw new HttpError(409, "stop_once", r.tail, r);
}

/**
 * The join page's stop for a press (null: it goes ahead): every change since the page last showed them, oldest first, each with its time, the tester's own in
 * another tab with the developer's (batch 30 §12 and the Oct 29 addition: one box, never one source hiding another). (Batch 30 §12) Also what the needs-covered
 * notice ("You now meet this test's needs") shows with it, before the press.
 */
export async function joinStopList(userId: string, testId: string, body: Record<string, unknown>, verb: string) {
  // (Owner) The second press goes ahead only if nothing new happened since the box last updated (boxAt).
  const boxAt = seenOf(body.boxAt);
  if (body.confirmed === true && !boxAt) return null;
  const raw0 = await joinPageChanges(userId, testId, body.confirmed === true ? boxAt!.toISOString() : body.seenAt, tabOf(body));
  // (Batch 17 section 13) The tester's box drops "Turn off alerts" when their Alerts are already Off.
  const alertsOff = !!(await db.user.findUnique({ where: { id: userId }, select: { testerAlertsOff: true } }))?.testerAlertsOff;
  // (Owner, Oct 31, batch 35 §61; replaces batch 29 section 13 here) Their own changes in another tab ("You applied to join in another tab") always stop once,
  // Alerts Off too, like the developer's own other-tab actions.
  // (Batch 35 §79) Join from the invite that just arrived: never the line about that invite itself.
  const raw = (await unanswered(userId, testId, raw0)).filter((e) => !(typeof body.inviteId === "string" && answersIt(e, { item: body.inviteId })));
  // (Batch 17 section 4) A full test keeps the invite open: No thanks just declines it (the test filling or a spot opening doesn't stop it).
  const changes = withRenamed(verb === "decline" ? raw.filter((e) => e.kind !== "full" && e.kind !== "spot_open") : raw, body);
  if (!changes.length) return null;
  const tail = verb === "withdraw" || verb === "decline" ? "Press again to go ahead." : `Press again to ${verb} on the current listing.`;
  // (Batch 30 §12) `now`: the box's newest line (the next press goes ahead unless something newer came); each line says whether it's an NDA change (its tick clears).
  return { changes: asLines(changes), tail, alertsOff, now: new Date(Math.max(...changes.map((e) => e.createdAt.getTime()))).toISOString() };
}

/**
 * (Owner, Oct 28, batch 16 section 32) Why an invite is closed, said to the tester (never "hold" or "suspended"): stopped (or the developer deleted) → "This test was
 * stopped."; Open until passed → "“<test>” closed to new testers on <date>."; a pause, hold or the developer's suspension → "“<test>” isn't taking new testers right
 * now, so this invite was closed."; cancelled, blocked or anything else → "This invite is no longer open."
 */
export async function inviteClosedLine(testId: string, now = new Date()) {
  const t = await db.test.findUnique({ where: { id: testId }, include: { developer: { select: { holdStartedAt: true, devSuspendedAt: true, deletedAt: true } } } });
  if (!t) return INVITE_NOT_OPEN;
  if (t.status === "stopped" || t.developer.deletedAt) return "This test was stopped.";
  if (t.openUntil && t.openUntil.getTime() < now.getTime()) return `“${t.title}” closed to new testers on ${fmtDate(t.openUntil)}.`;
  if (t.adminPausedAt || t.developer.holdStartedAt || t.developer.devSuspendedAt) return `“${t.title}” isn't taking new testers right now, so this invite was closed.`;
  return INVITE_NOT_OPEN;
}
export const INVITE_NOT_OPEN = "This invite is no longer open.";
/** Join or Accept on an invite that closed meanwhile: refused (no stop box) with the reason; the card goes. */
async function closedInvite(testerId: string, body: Record<string, unknown>) {
  if (typeof body.inviteId !== "string" || !body.inviteId) return;
  const inv = await db.invite.findUnique({ where: { id: body.inviteId } });
  if (!inv || inv.testerId !== testerId || inv.status !== "cancelled") return;
  throw new HttpError(409, "invite_closed", await inviteClosedLine(inv.testId));
}

/** (Batch 34 §10) The refusal for a press on an invite a listing change replaced, when the tester has the new one: one sentence, never a dangling colon. */
export const newInviteLine = (dev: string, at: string) => `${dev} changed the listing at ${at} and sent you a new invite on it. Press Join to join on it.`;

/**
 * Accept on an invite a listing change replaced. (Batch 34 §10, owner's finding) The join page's "changed since you opened this page" stop runs FIRST (Join), so a
 * press stops once with the full list; a press that already saw it (the second, confirmed press) joins on the tester's CURRENT invite without a reload. Otherwise
 * it's refused under the button with the new invite right there (its id and `now`: the page switches to it, and the next press goes ahead).
 */
async function replacedInvite(testerId: string, testId: string, body: Record<string, unknown>) {
  if (typeof body.inviteId !== "string" || !body.inviteId) return;
  const inv = await db.invite.findUnique({ where: { id: body.inviteId } });
  if (!inv || inv.testerId !== testerId || inv.status !== "replaced") return;
  const fresh = await db.invite.findFirst({ where: { testId, testerId, status: "sent" }, orderBy: { createdAt: "desc" } });
  if (fresh && body.confirmed === true) return; // joins on the current invite (join() takes the tester's sent invite)
  const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
  const dev = await db.user.findUniqueOrThrow({ where: { id: t.developerId } });
  throw new HttpError(409, "invite_replaced", fresh ? newInviteLine(displayName(dev), fmtTime(inv.updatedAt)) : `${displayName(dev)} changed the listing at ${fmtTime(inv.updatedAt)}, and this invite closed.`, fresh ? { newInviteId: fresh.id, terms: termsLine(asListing(t), true), listingVersion: t.listingVersion, now: new Date().toISOString() } : {});
}

/**
 * (Owner's finding, Oct 29, batch 32 §2) Apply or Ask to rejoin while this tester already has one waiting (sent in another tab): refused, nothing changes (the
 * first note stays, the developer isn't told again); the page redraws to the waiting state.
 */
async function alreadyWaiting(testerId: string, testId: string) {
  const a = await db.application.findUnique({ where: { testId_testerId: { testId, testerId } } });
  if (a?.status !== "pending") return;
  throw new HttpError(409, "already_waiting", a.kind === "rejoin" ? "You already asked to rejoin this test in another tab." : "You already applied to join this test in another tab.");
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
async function inviteBeforePress(tester: { id: string }, testId: string, body: Record<string, unknown>, devName: string) {
  const inv = await db.invite.findFirst({ where: { testId, testerId: tester.id, status: "sent" }, orderBy: { createdAt: "desc" } });
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

/** Join (Who can join = Anyone, or an invited tester on an invite-only test). */
export async function join(tester: U, testId: string, rawBody: Record<string, unknown>) {
  // (§352) The tester's own press: never the server-only flags (rejoining is the developer's accepted ask, or an invite).
  const body = clientJoinBody(rawBody);
  if (!tester.isTester) throw new HttpError(403, "not_tester", "Turn on “test apps, games and more” in your profile to join tests.");
  const t = await db.test.findUnique({ where: { id: testId } });
  if (!t) throw new HttpError(404, "not_found", "That test doesn't exist.");
  await closedInvite(tester.id, body); // (batch 16 section 32) the invite closed meanwhile: refused with the reason
  const refusal = await joinRefusal(tester.id, testId);
  if (refusal) throw new HttpError(409, "refused", refusal);
  // (Design doc 7.3) Coming back is always an ask the developer accepts, unless they invited the tester back. (§352) An accepted ask never comes through here.
  const gone = await db.contract.findUnique({ where: { testId_testerId: { testId, testerId: tester.id } } });
  if (gone && gone.status !== "working" && !(await db.invite.findFirst({ where: { testId, testerId: tester.id, status: "sent" } })))
    throw new HttpError(409, "ask", "You left this test, so you ask to rejoin and the developer accepts.");
  // (Batch 34 §10) The "changed since you opened this page" stop first: the press stops once with every change (the NDA's too, whose tick clears), then the invite.
  await listingGate(tester.id, testId, body, "join");
  await replacedInvite(tester.id, testId, body);
  if (t.joinMode === "apply" && !(await db.invite.findFirst({ where: { testId, testerId: tester.id, status: "sent" } })) && !(await db.application.findFirst({ where: { testId, testerId: tester.id, status: "pending", changedAt: { not: null } } }))) {
    throw new HttpError(409, "apply", "This test takes applications: press Apply to join.");
  }
  if (t.joinMode === "invite" && !(await db.invite.findFirst({ where: { testId, testerId: tester.id, status: "sent" } }))) throw new HttpError(409, "invite_only", "This test is invite only.");
  // (Owner, Nov 3, races) The check above ran before the test's lock: joinTest runs it again under the lock (an Edit saved in between stops the press once).
  const c = await joinTest(tester, testId, { ...body, listingVersion: t.listingVersion, confirmed: true, anyway: body.anyway === true, rejoinAccepted: false, acceptedByDeveloper: false }, { lockedGate: () => listingGate(tester.id, testId, body, "join") })
    // (Owner, Nov 9, §348) The last free key went meanwhile: refused with joinRefusal's reason now (the key line, or "full" if the test filled).
    .catch(async (e) => { throw e instanceof HttpError && e.code === "no_key" ? new HttpError(409, "refused", (await joinRefusal(tester.id, testId)) || NO_FREE_KEY) : e; });
  await db.application.updateMany({ where: { testId, testerId: tester.id, status: "pending" }, data: { status: "joined", decidedAt: new Date() } });
  return c;
}

export const JOIN_REQUESTS_PER_TEST_PER_DAY = 2;
export async function saveJoinRequest(testerId:string,testId:string,data:{note:string;listing:Prisma.InputJsonValue;kind:string;ndaAcceptedAt:Date|null},text:string,bypassLimit=false) {
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Test" WHERE id = ${testId} FOR UPDATE`;
  const previous=await tx.application.findUnique({where:{testId_testerId:{testId,testerId}}});
  if(previous?.status==="pending")throw new HttpError(409,"waiting","You already have a request waiting for this test.");
  if(!TESTING_NO_LIMITS&&!bypassLimit&&previous && await tx.testEvent.count({where:{testId,kind:"applied",link:`item-app-${previous.id}`,createdAt:{gt:new Date(Date.now()-24*3600000)}}})>=JOIN_REQUESTS_PER_TEST_PER_DAY)throw new HttpError(429,"too_many_requests","You can apply or ask to rejoin this test twice in 24 hours. Try again later.");
  const application=await tx.application.upsert({where:{testId_testerId:{testId,testerId}},update:{...data,status:"pending",changedAt:null,decidedAt:null,createdAt:new Date()},create:{testId,testerId,...data}});
  await tx.testEvent.create({data:{testId,kind:"applied",link:`item-app-${application.id}`,text}});
  return application;
 });
}

/** Apply to join (optional note). If the test now lets anyone join, the second press simply joins. */
export async function apply(tester: U, testId: string, body: Record<string, unknown>) {
  if (!tester.isTester) throw new HttpError(403, "not_tester", "Turn on “test apps, games and more” in your profile to join tests.");
  const t = await db.test.findUnique({ where: { id: testId }, include: { developer: true } });
  if (!t) throw new HttpError(404, "not_found", "That test doesn't exist.");
  await closedInvite(tester.id, body); // (batch 16 section 32)
  const refusal = await joinRefusal(tester.id, testId);
  if (refusal) throw new HttpError(409, "refused", refusal);
  // (Batch 34 §16, owner, Oct 30) Apply while holding a sent invite the page hadn't shown yet: it joins at once, as the invite's Join does (any waiting application
  // of theirs closes as joined), instead of filing an application next to the invite. A page that showed the invite is refused ("… invited you: press Join").
  if (await inviteBeforePress(tester, testId, body, displayName(t.developer))) return { joined: true, sessionId: (await join(tester, testId, body)).id };
  await alreadyWaiting(tester.id, testId);
  // (Owner, Nov 2) A saved tester profile first, like Join.
  if (!profileSaved(await db.testerProfile.findUnique({ where: { userId: tester.id } }))) throw new HttpError(409, "profile_first", PROFILE_FIRST);
  await listingGate(tester.id, testId, body, "apply");
  if (t.joinMode !== "anyone" && t.joinMode !== "invite") gapStop(t, await db.testerProfile.findUnique({ where: { userId: tester.id } }), body, "Apply");
  if (t.joinMode === "anyone") return { joined: true, sessionId: (await join(tester, testId, { ...body, confirmed: true })).id };
  if (t.joinMode === "invite") throw new HttpError(409, "invite_only", "This test is invite only.");
  const note = typeof body.note === "string" ? body.note.trim().slice(0, LIMITS.joinNote) : "";
  const snap = listingSnapshot(t) as Prisma.InputJsonValue;
  // (7.3) The NDA is accepted when applying; the developer's Accept joins them on it.
  if (t.ndaText && body.ndaAccepted !== true) throw new HttpError(400, "nda", "Accept the NDA to apply.");
  const ndaAcceptedAt = t.ndaText ? new Date() : null;
  await saveJoinRequest(tester.id,testId,{note,listing:snap,kind:"apply",ndaAcceptedAt},`${displayName(tester)} applied to join`);
  await notify(t.developer.email, `${displayName(tester)} applied to join “${t.title}”`, [`${displayName(tester)} applied to join “${t.title}”.`, ...(note ? [`${pronouns(tester.pronoun).Poss} note: “${note}”`] : []), "Accept or decline on the test page."], `/app/tests/${testId}#needs-you`, { testId, group: APPLICATIONS_GROUP }); // (Owner, Nov 6, §308) "Applications · N", one entry a day across tests
  return { applied: true };
}

export async function withdrawApplication(tester: { id: string }, testId: string, body: Record<string, unknown> = {}) {
  if (await db.application.count({ where: { testId, testerId: tester.id, status: "pending" } })) await listingGate(tester.id, testId, body, "withdraw");
  const n = await db.application.updateMany({ where: { testId, testerId: tester.id, status: "pending" }, data: { status: "withdrawn", decidedAt: new Date() } });
  if (!n.count) throw new HttpError(409, "gone", await withdrawGoneLine(tester.id, testId));
  const me = await db.user.findUniqueOrThrow({ where: { id: tester.id } });
  // (Owner, Nov 7) A quiet live line, never a stop. Accept / Decline on it stays one refusal. The bell's email follows their
  // settings. (Owner, Nov 6, §308) It stacks one entry a day ACROSS tests,
  // "Applications withdrawn · 2" (group "appwithdrawn", no longer one stack per test).
  const t = await db.test.findUniqueOrThrow({ where: { id: testId }, select: { developerId: true, title: true } });
  await logEvent(testId, "withdrew_app", `${displayName(me)} withdrew ${pronouns(me.pronoun).poss} application`);
  await bell(t.developerId, `${displayName(me)} withdrew ${pronouns(me.pronoun).poss} application to “${t.title}”`, `/app/tests/${testId}`, undefined, { side: "developer", testId, group: APP_WITHDRAWN_GROUP });
  return { withdrawn: true };
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
 * (Owner, Oct 31, batch 35 §48) Withdraw on an application that's no longer pending says why, with the time: "<Dev> accepted your application at 3:20 AM, so
 * you're in this test." / "<Dev> declined your application at 3:20 AM." / "You withdrew it in another tab at 3:20 AM." / "It closed when <Dev> changed the
 * listing at 3:20 AM. You can apply again."; never one (or closed another way): the plain line.
 */
export async function withdrawGoneLine(testerId: string, testId: string) {
  const a = await db.application.findUnique({ where: { testId_testerId: { testId, testerId } } });
  if (!a) return NO_PENDING_APPLICATION;
  const t = await db.test.findUnique({ where: { id: testId }, include: { developer: true } });
  const dev = t ? displayName(t.developer) : "The developer";
  const at = fmtTime(a.decidedAt ?? new Date());
  if (a.status === "accepted") return `${dev} accepted your application at ${at}, so you're in this test.`;
  if (a.status === "declined") return `${dev} declined your application at ${at}.`;
  if (a.status === "withdrawn") return `You withdrew it in another tab at ${at}.`;
  if (a.status === "closed" && a.closedReason === "listing") return `It closed when ${dev} changed the listing at ${at}. You can apply again.`;
  // (Owner, Nov 9, §354) The same reasons as the developer's line. A block's closing stays neutral (the plain line).
  if (a.status === "closed" && a.closedReason === "full") return `It closed when the test filled up at ${at}.`;
  if (a.status === "closed" && a.closedReason === "invite_only") return `It closed when ${dev} made the test invite only at ${at}.`;
  if (a.status === "closed" && a.closedReason === "joining_closed") return `It closed when joining closed (Open until passed) on ${fmtDate(t?.openUntil ?? a.decidedAt ?? new Date())}.`;
  if (a.status === "closed" && a.closedReason === "stopped") return `It closed when the test was stopped at ${at}.`;
  return NO_PENDING_APPLICATION;
}

/**
 * The developer's Accept / Decline: the developer stop-once reasons, plus "the tester changed their profile" and
 * "anything about the test changed since" (box under the button). Accept joins the tester on the current listing.
 */
export async function decideApplication(dev: U, testId: string, body: Record<string, unknown>) {
  await ownTest(dev.id, testId);
  const a = await db.application.findUnique({ where: { id: String(body.applicationId ?? "") } });
  if (!a || a.testId !== testId) throw new HttpError(404, "not_found", "That application doesn't exist.");
  const tester = await db.user.findUniqueOrThrow({ where: { id: a.testerId }, include: { profile: true } });
  const name = displayName(tester);
  const openUntil = (await db.test.findUnique({ where: { id: testId }, select: { openUntil: true } }))?.openUntil ?? null;
  /** Why this application can't be answered any more (read again after a lost race: Nov 2, §119). */
  const gone = (a: { status: string; closedReason: string | null; decidedAt: Date | null }) => {
    if (a.status === "closed" && a.closedReason === "full") return new HttpError(409, "gone", `${name}'s application closed when the test filled up at ${fmtTime(a.decidedAt ?? new Date())}.`);
    // (Batch 16 section 11) Closed by a block (either way): neutral, never says why.
    if (a.status === "closed" && a.closedReason === "blocked") return new HttpError(409, "gone", `${name}'s application was closed.`);
    // (Owner, Nov 9, §354) Each closed application names its real reason: joining closed (Open until passed), the test stopped, or the listing changed.
    if (a.status === "closed") return new HttpError(409, "gone", appClosedForDev(name, a.closedReason, a.decidedAt ?? new Date(), openUntil));
    // (Batch 16 section 21) Answered already (in another tab): a plain refusal naming it, no stop box.
    return new HttpError(409, "gone", a.status === "withdrawn" ? `${name} withdrew ${pronouns(tester.pronoun).poss} application.` : a.status === "declined" ? "You already declined this application." : a.status === "accepted" || a.status === "joined" ? "You already accepted this application." : "This application was already answered.");
  };
  const goneNow = async () => gone(await db.application.findUniqueOrThrow({ where: { id: a.id } }));
  if (a.status !== "pending") throw gone(a);
  const extra: TestEventLike[] = [];
  const shownTesters = body.seenTesters && typeof body.seenTesters === "object" ? body.seenTesters as Record<string, unknown> : {};
  const shownRaw = shownTesters[tester.id] && typeof shownTesters[tester.id] === "object" ? shownTesters[tester.id] as Record<string, unknown> : null;
  if (shownRaw) {
    // (Owner, Nov 9, §357) A tester's devices or languages changing (now meeting a need, or no longer) never stops the press; a rating change still does.
    const lines: string[] = [];
    const shownRating = !("rating" in shownRaw) ? undefined : typeof shownRaw.rating === "number" ? shownRaw.rating : null;
    const rating = await ratingSummary(tester.id, "tester"); // (Owner, Nov 5, §276) as the application row shows it
    const currentRating = rating.n ? Number(rating.avg.toFixed(1)) : null;
    const ratingLine = ratingChangedLine(name, shownRating, currentRating, tester.pronoun);
    if (ratingLine) lines.push(ratingLine);
    if (lines.length) extra.push({ kind: "profile", text: lines.join(" · "), createdAt: rating.at ?? new Date(), key: `needs:${tester.id}` });
  }
  extra.push(...(await listingChanges(testId, body.seenAt)));
  await db.$transaction((tx) => devGate(tx, testId, body, {}, extra, undefined, { acts: ["application"], keys: [`app:${a.id}`], answers: { item: a.id, kinds: ["applied"], texts: [`${name} applied to join`, `${name} asks to rejoin`] } })); // (batch 35 §79)
  if (body.action === "decline") {
    // (Nov 2, §119) Only a still-pending application is declined: a Withdraw (or an answer in another tab) a moment ago wins, and the refusal says which.
    if ((await db.application.updateMany({ where: { id: a.id, status: "pending" }, data: { status: "declined", decidedAt: new Date() } })).count !== 1) throw await goneNow();
    const title = (await db.test.findUniqueOrThrow({ where: { id: testId } })).title;
    // (Batch 29 §24) In the day's "Joined" entry, across tests.
    if (a.kind === "rejoin") await notify(tester.email, `Your ask to rejoin “${title}” wasn't accepted`, ["The developer didn't accept your ask to rejoin."], `/app/find/${testId}`, { group: "joined", testId });
    else await notify(tester.email, `Your application to “${title}” wasn't accepted`, ["Thanks for applying. There are other tests to find."], `/app/find/${testId}`, { group: "joined", testId }); // (batch 29 §24) its own join page
    return { declined: true };
  }
  const isRejoin = a.kind === "rejoin";
  const refusal = await joinRefusal(tester.id, testId, { rejoin: isRejoin, byDeveloper: true }); // (§341) no free key: refused below with the key line
  if (refusal) throw new HttpError(409, "refused", refusal.replace("You've already joined", `${name} already joined`).replace(TEST_LIMIT_LINE, `${name} can't join more tests right now.`));
  const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
  // (Nov 2, §119) The join claims the still-pending application inside its own lock (as "accepted"): a Withdraw a moment ago wins, and the refusal says so.
  const c = await joinTest({ ...tester, isTester: true }, testId, { listingVersion: t.listingVersion, confirmed: true, anyway: true, acceptedByDeveloper: true, rejoinAccepted: isRejoin, ndaAcceptedAt: a.ndaAcceptedAt?.toISOString(), ndaAccepted: !!a.ndaAcceptedAt }, { applicationId: a.id, applicationStatus: "accepted" })
    .catch(async (e) => { throw e instanceof HttpError && e.code === "application_gone" ? await goneNow() : e; });
  if (isRejoin) {
    const line = `You're back in ${t.title}: your deadline is ${T(c.dueAt)}.`;
    await notify(tester.email, line, [line, `Your session is restored on the current listing: ${termsLine(c, true)}.`], `/app/sessions/${c.id}`, { about: dev.id, group: "joined" });
    return { accepted: true, sessionId: c.id, line: `${name} rejoined: ${pronouns(tester.pronoun).poss} deadline is ${fmtDateTime(c.dueAt)}.` };
  }
  await notify(tester.email, `You're in: ${t.title}`, [`You're in: ${t.title}. Your contract: ${termsLine(c, true)}.`], `/app/sessions/${c.id}`, { group: "joined" });
  return { accepted: true, sessionId: c.id };
}

/**
 * The test switched to "Anyone can join": a pending application whose listing is otherwise unchanged is joined at once
 * ("You're in: Harbor Run"); otherwise the tester is told it changed (Join on the current listing / Withdraw application).
 */
export async function onSwitchToAnyone(testId: string) {
  const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
  const pending = await db.application.findMany({ where: { testId, status: "pending" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  let accepted = 0;
  // (Owner, Nov 9, §338) No free access key: the Save stays done, like a full test; this application and the ones after it stay waiting, and the Save's note names them.
  const noKey: string[] = [];
  for (const [n, a] of pending.entries()) {
    if (await db.contract.count({ where: { testId, status: "working" } }) >= t.spots) break;
    const tester = await db.user.findUniqueOrThrow({ where: { id: a.testerId } });
    if (!sameListingIgnoringMode(a.listing, t)) {
      const changedAt = new Date();
      const line = `“${t.title}” changed since you applied: join on the current listing, or withdraw your application.`;
      const updated = await db.application.updateMany({ where: { id: a.id, status: "pending" }, data: { changedAt } });
      if (updated.count) await notify(tester.email, line, [line], `/app/find/${testId}`, { group: "apps", testId });
      continue;
    }
    const profile = await db.testerProfile.findUnique({ where: { userId: tester.id } });
    if (needsGap(asListing(t), profile)) continue;
    if (await joinRefusal(tester.id, testId, { byDeveloper: true })) continue; // (§341) no free key: caught below (§338)
    try {
      const c = await joinTest({ ...tester, isTester: true }, testId, {
        listingVersion: t.listingVersion, confirmed: true, anyway: true, acceptedByDeveloper: true,
      }, { applicationId: a.id, quietJoinEvent: true });
      await notify(tester.email, `You're in: ${t.title}`, [`You're in: ${t.title}.`], `/app/sessions/${c.id}`, { group: "joined" });
      accepted++;
    } catch (error) {
      if (error instanceof HttpError && error.code === "application_gone") continue;
      if (error instanceof HttpError && error.code === "refused" && /full/i.test(error.message)) break;
      if (error instanceof HttpError && error.code === "no_key") {
        const waiting = await db.application.findMany({ where: { id: { in: pending.slice(n).map((x) => x.id) }, status: "pending" }, select: { testerId: true } });
        const names = new Map((await db.user.findMany({ where: { id: { in: waiting.map((w) => w.testerId) } } })).map((u) => [u.id, displayName(u)]));
        noKey.push(...waiting.map((w) => names.get(w.testerId) ?? "A tester"));
        break;
      }
      throw error;
    }
  }
  if (accepted) await logEvent(testId, "applied", `${accepted} waiting application${accepted === 1 ? " was" : "s were"} accepted when you switched to joins instantly`);
  if (noKey.length) await logEvent(testId, "applied", noKeyWaitingLine(noKey));
  return { noKey };
}

/**
 * (Owner correction, NEWEST+4) A saved listing change (anything except spots / who can join) closes every pending
 * application; no invite is sent. The applicant is told (bell + email; their join page's top box), and the developer's
 * page shows the line and stops once for it.
 */
export async function closeApplicationsAfterEdit(testId: string, why: "listing" | "invite_only" = "listing") {
  const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
  const pending = await db.application.findMany({ where: { testId, status: "pending" }, orderBy: { createdAt: "asc" } });
  const now = new Date();
  const names: string[] = [];
  for (const a of pending) {
    await db.application.update({ where: { id: a.id }, data: { status: "closed", decidedAt: now, closedReason: why } });
    const tester = await db.user.findUnique({ where: { id: a.testerId } });
    if (!tester) continue;
    names.push(displayName(tester));
    // (Batch 15 section 32) The test's title quoted, like every other line.
    const line = why === "invite_only" ? `“${t.title}” is now invite only, so your application was closed.` : `“${t.title}”'s listing changed, so your application was closed. You can apply again on the current listing.`;
    // (Batch 14 section 3) Several tests in a day stack into one entry.
    // (Batch 29 §23) In the day's "Applications and invites" entry, across tests (no longer "Applications closed").
    await notify(tester.email, line, [line], `/app/find/${testId}`, { group: "apps", testId });
  }
  return names;
}

/** The line the developer reads about a rejoin ask: what the tester gets back if accepted. */
export function rejoinAskLine(name: string, pron: { subj: string; poss: string }, c: { endedAt: Date | null; dueAt: Date }, tz?: string | null) {
  const left = c.endedAt ? c.dueAt.getTime() - c.endedAt.getTime() : 0;
  if (left <= 0) return `${name} asks to rejoin. ${pron.subj[0].toUpperCase()}${pron.subj.slice(1)} had no time left: ${pron.poss} deadline stays passed.`;
  return `${name} asks to rejoin. If you accept, ${pron.subj === "they" ? "they get" : `${pron.subj} gets`} back the ${leftText(left)} ${pron.subj === "they" ? "they" : pron.subj} had left (deadline ${fmtDateTime(movedDue(new Date(), left, tz))}).`; // (§154) the end of that day, as rejoinDue gives
}

/**
 * (Design doc 7.3) Ask to rejoin: a tester who left, or whose work was ended (or who a suspension removed), before their deadline,
 * asks to come back; the developer accepts and the session returns on the current listing with the time they had left. An invite
 * and an ask in either order join them at once, unless a final refusal applies. Checks the 10-test limit, the NDA and the
 * listing like Join.
 */
export async function askToRejoin(tester: U, testId: string, body: Record<string, unknown>) {
  if (!tester.isTester) throw new HttpError(403, "not_tester", "Turn on “test apps, games and more” in your profile to join tests.");
  const t = await db.test.findUnique({ where: { id: testId }, include: { developer: true } });
  if (!t) throw new HttpError(404, "not_found", "That test doesn't exist.");
  const old = await db.contract.findUnique({ where: { testId_testerId: { testId, testerId: tester.id } } });
  const rated = old ? (await db.rating.count({ where: { contractId: old.id } })) > 0 : false;
  if (!old || old.status === "working") throw new HttpError(409, "not_again", old ? "You've already joined this test." : "You haven't been in this test.");
  // (Owner, Oct 28, batch 16 section 11) A block either way: the ask is refused with the neutral line (never says why).
  const blocks = await import("./blocks");
  if (await blocks.blockedEitherWay(tester.id, t.developerId)) throw new HttpError(409, "refused", blocks.NOT_TAKING_LINE);
  if (!canAskToRejoin(old, rated)) throw new HttpError(409, "not_again", rated || old.endKind === "rated" ? "You rated this test, so you can't join it again." : "You can't ask to rejoin this test.");
  const refusal = await joinRefusal(tester.id, testId, { rejoin: true });
  if (refusal) throw new HttpError(409, "refused", refusal);
  // (Batch 34 §16) An invite the page already showed: Join, not an ask. One it hadn't shown: the ask meets it below and they're back at once.
  await inviteBeforePress(tester, testId, body, displayName(t.developer));
  await alreadyWaiting(tester.id, testId);
  if (!profileSaved(await db.testerProfile.findUnique({ where: { userId: tester.id } }))) throw new HttpError(409, "profile_first", PROFILE_FIRST);
  await listingGate(tester.id, testId, body, "ask");
  if (t.ndaText && body.ndaAccepted !== true) throw new HttpError(400, "nda", "Accept the NDA to ask to rejoin.");
  gapStop(t, await db.testerProfile.findUnique({ where: { userId: tester.id } }), body, "Ask");
  const note = typeof body.note === "string" ? body.note.trim().slice(0, LIMITS.joinNote) : "";
  const ndaAcceptedAt = t.ndaText ? new Date() : null;
  const snap = listingSnapshot(t) as Prisma.InputJsonValue;
  const invited = await db.invite.findFirst({ where: { testId, testerId: tester.id, status: "sent" } });
  await saveJoinRequest(tester.id,testId,{note,listing:snap,kind:"rejoin",ndaAcceptedAt},`${displayName(tester)} asks to rejoin`,!!invited);
  // (Owner, Oct 28) A test a suspension removed them from leaves the dashboard top once they ask (or dismiss it).
  if (old.endKind === "suspended" && !old.removedDismissedAt) await db.contract.update({ where: { id: old.id }, data: { removedDismissedAt: new Date() } });
  if (invited) {
    // The developer already invited them: the ask and the invite meet, and they are back at once.
    const c = await matchInviteAndAsk(testId, tester.id);
    if (c) return { joined: true, sessionId: c.id };
  }
  const name = displayName(tester);

  const line = rejoinAskLine(name, pronouns(tester.pronoun), old);
  await notify(t.developer.email, `${name} asks to rejoin “${t.title}”`, [line, ...(note ? [`${pronouns(tester.pronoun).Poss} note: “${note}”`] : [])], `/app/tests/${testId}#needs-you`, { about: tester.id, testId, group: APPLICATIONS_GROUP }); // (Owner, Nov 6, §308) "Applications · N", one entry a day across tests
  return { asked: true };
}

/**
 * (Batch 34 §16) The applications and rejoin asks the developer still answers (Needs you, Needs review, the daily reminder): the pending ones, minus those whose
 * tester holds a sent invite for that test. The developer already chose them: the invite stands for the answer (they're in the Invited list), and the
 * application closes as joined when they join. (Inviting a waiting applicant normally joins them at once, design doc 6; this covers the invite that couldn't.)
 */
export async function answerable<A extends { testId: string; testerId: string }>(apps: A[]): Promise<A[]> {
  if (!apps.length) return apps;
  const sent = await db.invite.findMany({ where: { status: "sent", OR: apps.map((a) => ({ testId: a.testId, testerId: a.testerId })) }, select: { testId: true, testerId: true } });
  const invited = new Set(sent.map((i) => `${i.testId}|${i.testerId}`));
  return apps.filter((a) => !invited.has(`${a.testId}|${a.testerId}`));
}

/**
 * (Design doc 6) A pending application or rejoin ask plus an invite from the developer, in either order, joins the tester at once
 * (the developer chose them; no Join anyway pop-up), unless a final refusal applies. Both are told.
 * (Batch 34 §16, owner, Oct 30) When the developer's Invite is the second of the two (`byDeveloper`), it is exactly Accept on that application: joinTest as the
 * developer's acceptance (no second "joined" line from joinTest), the application marked accepted, and the tester's usual Accept lines ("You're in: …" with their
 * contract / "You're back in …"); the Invite result names it ("Ana Silva had applied: she joined.").
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
    c = await joinTest(tester, testId, { listingVersion: t.listingVersion, confirmed: true, anyway: true, rejoinAccepted: true, ndaAccepted: !!app.ndaAcceptedAt, ndaAcceptedAt: app.ndaAcceptedAt?.toISOString(), ...(opts.byDeveloper ? { acceptedByDeveloper: true } : {}) });
  } catch (e) {
    if (!opts.byDeveloper && e instanceof HttpError && e.code === "no_key") return null;
    throw e;
  }
  await db.application.update({ where: { id: app.id }, data: { status: opts.byDeveloper ? "accepted" : "joined", decidedAt: new Date() } });
  if (opts.byDeveloper) {
    // As Accept (decideApplication) tells them.
    if (back) await notify(tester.email, `You're back in ${t.title}: your deadline is ${T(c.dueAt)}.`, [`You're back in ${t.title}: your deadline is ${T(c.dueAt)}.`, `Your session is restored on the current listing: ${termsLine(c, true)}.`], `/app/sessions/${c.id}`, { about: t.developerId, group: "joined" });
    else await notify(tester.email, `You're in: ${t.title}`, [`You're in: ${t.title}. Your contract: ${termsLine(c, true)}.`], `/app/sessions/${c.id}`, { group: "joined" });
  } else await notify(tester.email, back ? `You're back in ${t.title}` : `You're in: ${t.title}`, [back ? `You're back in ${t.title}: your deadline is ${T(c.dueAt)}.` : `You're in: ${t.title}.`], `/app/sessions/${c.id}`, { about: t.developerId, group: "joined" });
  await notify(t.developer.email, `${displayName(tester)} ${back ? "rejoined" : "joined"} “${t.title}”`, [`${displayName(tester)} ${back ? "rejoined" : "joined"} (you'd invited ${pronouns(tester.pronoun).obj} and ${pronouns(tester.pronoun).subj === "they" ? "they'd" : `${pronouns(tester.pronoun).subj} had`} asked).`], `/app/tests/${testId}#tester-${c.id}`, { about: testerId, testId }); // (Owner, Nov 6, §308) a plain per-test line: the test's own "Harbor Run · N updates" stack
  return c;
}

/** (Batch 34 §16) The Invite result's line for a tester the invite joined: "Ana Silva had applied: she joined." / "Ben Cole had asked to rejoin: he's back in." */
export function invitedJoinedLine(name: string, pronoun: string, kind: string) {
  const subj = pronouns(pronoun).subj;
  return kind === "rejoin" ? `${name} had asked to rejoin: ${subj === "they" ? "they're" : `${subj}'s`} back in.` : `${name} had applied: ${subj} joined.`;
}
