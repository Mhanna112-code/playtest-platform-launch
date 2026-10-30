import { Prisma } from "@prisma/client";
import { T } from "@/lib/tz";
import { db } from "@/lib/db";
import { displayName, fmtDate, fmtDateTime, fmtTime, pronouns } from "@/lib/format";
import { PAUSED_RIGHT_NOW, closedToNewLine, canAskToRejoin, leftText, MAX_ACTIVE_TESTS, termsDiff, termsLine, testPaused, TEST_LIMIT_LINE, type TestEventLike } from "@/lib/rules";
import { HttpError } from "./http";
import { notify } from "./notify";
import { asLines, listingSaveLines, logEvent, ownChanges, seenOf, tabOf, withRenamed } from "./live";
import { asListing, devGate, gapStop, joinTest, needsGap, ownTest, stampCounting } from "./tests";

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
/** Shared final refusals for Join, Apply to join and Accept. */
export async function joinRefusal(testerId: string, testId: string, opts: { rejoin?: boolean } = {}) {
  const t = await db.test.findUniqueOrThrow({ where: { id: testId }, include: { developer: true } });
  if (t.status === "stopped") return "This test was stopped.";
  if (t.openUntil && t.openUntil < new Date()) return closedToNewLine(t.openUntil, (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })); // (batch 15 section 18)
  if (t.status !== "open") return "This test isn't taking new testers any more.";
  // (Owner, Oct 28 afternoon) Invites and applications wait while the test is paused; the join page says only this.
  if (testPaused(t.developer, t)) return PAUSED_RIGHT_NOW;
  const old = await db.contract.findUnique({ where: { testId_testerId: { testId, testerId } } });
  if (old?.status === "working") return "You've already joined this test.";
  if (old && (await db.rating.count({ where: { contractId: old.id } }))) return old.status === "left" && old.endKind === "rated" ? "You rated this test, so you can't join it again." : "You can't join this test again.";
  if (old?.status === "ended" && !opts.rejoin && !(await db.invite.findFirst({ where: { testId, testerId, status: "sent" } }))) return "You can't join this test again.";
  const testersIn = await db.contract.count({ where: { testId, status: "working" } });
  if (testersIn >= t.spots) return (await db.invite.findFirst({ where: { testId, testerId, status: "sent" } })) ? `${t.title} is full right now.` : "This test is full.";
  if (await db.block.count({ where: { blockerId: testerId, blockedId: t.developerId } })) return `You blocked ${displayName(t.developer)}: unblock them in Account → Blocked people to join.`;
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
    gone.push({ kind: "applied", text: a.closedReason === "blocked" ? (await import("./blocks")).appClosedLine(t.title).replace(/\.$/, "") : a.closedReason === "full" ? `${t.title} is full: your application was closed` : a.closedReason === "invite_only" ? `${displayName(t.developer)} made the test invite only: your application was closed` : `${displayName(t.developer)} changed the listing: your application was closed`, createdAt: a.decidedAt! });
  // (Correction 6) Invited: the test filled (the invite stays open) / a spot opened.
  if (await db.invite.findFirst({ where: { testId, testerId: userId, status: "sent" } })) {
    for (const e of await db.testEvent.findMany({ where: { testId, kind: { in: ["full", "spot_open"] }, createdAt: { gt: d } } }))
      gone.push({ kind: e.kind, text: e.kind === "full" ? `${t.title} is full right now. Your invite stays open; we'll tell you when a spot opens.` : e.text, createdAt: e.createdAt });
  }
  const replaced = await db.invite.findMany({ where: { testId, testerId: userId, status: "replaced", updatedAt: { gt: d } } });
  if (replaced.length) {
    const fresh = await db.invite.findFirst({ where: { testId, testerId: userId, status: "sent" }, orderBy: { createdAt: "desc" } });
    gone.push(fresh ? { kind: "invite", text: `${displayName(t.developer)} changed the listing: here's a new invite on the updated listing`, createdAt: fresh.createdAt } : { kind: "invite", text: `${displayName(t.developer)} changed the listing: your invite closed (no spots left)`, createdAt: replaced[0].updatedAt });
  }
  // (Owner) Rejoining a test they LEFT stops once for the same reasons as their in-test buttons (A-F): paid / rejected,
  // call changes, their own other-tab actions; new terms as a plain line (they rejoin on the current listing, no offer).
  const left = await db.contract.findUnique({ where: { testId_testerId: { testId, testerId: userId } } });
  const rejoin: TestEventLike[] = [];
  if (left && left.status === "left") {
    const { testerChanges } = await import("./testerGate");
    rejoin.push(...(await testerChanges(userId, left.id, testId, d, tab)).filter((e) => e.kind !== "terms"));
    const termsEdit = edits.filter((e) => e.kind !== "renamed").pop();
    const diff = termsDiff({ ...left, questions: (left.questions as string[]) ?? [] }, asListing(t));
    if (termsEdit && diff) rejoin.push({ kind: "terms_plain", text: `${displayName(t.developer)} changed the terms: ${diff}`, createdAt: termsEdit.createdAt });
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
  // (Owner, Oct 29, batch 29 section 13) Their own changes in another tab ("You applied to join in another tab") follow Alerts like the other tabs' lines: Off, they
  // don't stop (the same press made there is a plain refusal).
  const raw = alertsOff ? raw0.filter((e) => e.kind !== "own") : raw0;
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

/** Accept on an invite a listing change replaced: refused under the button, with the new invite right there. */
async function replacedInvite(testerId: string, testId: string, body: Record<string, unknown>) {
  if (typeof body.inviteId !== "string" || !body.inviteId) return;
  const inv = await db.invite.findUnique({ where: { id: body.inviteId } });
  if (!inv || inv.testerId !== testerId || inv.status !== "replaced") return;
  const fresh = await db.invite.findFirst({ where: { testId, testerId, status: "sent" }, orderBy: { createdAt: "desc" } });
  const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
  const dev = await db.user.findUniqueOrThrow({ where: { id: t.developerId } });
  throw new HttpError(409, "invite_replaced", fresh ? `${displayName(dev)} changed the listing at ${fmtTime(inv.updatedAt)} and sent you a new invite:` : `${displayName(dev)} changed the listing at ${fmtTime(inv.updatedAt)}, and this invite closed.`, fresh ? { newInviteId: fresh.id, terms: termsLine(asListing(t), true), listingVersion: t.listingVersion } : {});
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

/** Join (Who can join = Anyone, or an invited tester on an invite-only test). */
export async function join(tester: U, testId: string, body: Record<string, unknown>) {
  if (!tester.isTester) throw new HttpError(403, "not_tester", "Turn on “test apps, games and more” in your profile to join tests.");
  const t = await db.test.findUnique({ where: { id: testId } });
  if (!t) throw new HttpError(404, "not_found", "That test doesn't exist.");
  await closedInvite(tester.id, body); // (batch 16 section 32) the invite closed meanwhile: refused with the reason
  const refusal = await joinRefusal(tester.id, testId, { rejoin: body.rejoinAccepted === true });
  if (refusal) throw new HttpError(409, "refused", refusal);
  // (Design doc 7.3) Coming back is always an ask the developer accepts, unless they invited the tester back (or this is the accepted ask).
  const gone = await db.contract.findUnique({ where: { testId_testerId: { testId, testerId: tester.id } } });
  if (gone && gone.status !== "working" && body.rejoinAccepted !== true && !(await db.invite.findFirst({ where: { testId, testerId: tester.id, status: "sent" } })))
    throw new HttpError(409, "ask", "You left this test, so you ask to rejoin and the developer accepts.");
  await replacedInvite(tester.id, testId, body);
  await listingGate(tester.id, testId, body, "join");
  if (t.joinMode === "apply" && !(await db.invite.findFirst({ where: { testId, testerId: tester.id, status: "sent" } })) && !(await db.application.findFirst({ where: { testId, testerId: tester.id, status: "pending", changedAt: { not: null } } }))) {
    throw new HttpError(409, "apply", "This test takes applications: press Apply to join.");
  }
  if (t.joinMode === "invite" && !(await db.invite.findFirst({ where: { testId, testerId: tester.id, status: "sent" } }))) throw new HttpError(409, "invite_only", "This test is invite only.");
  const c = await joinTest(tester, testId, { ...body, listingVersion: t.listingVersion, confirmed: true, anyway: body.anyway === true });
  await db.application.updateMany({ where: { testId, testerId: tester.id, status: "pending" }, data: { status: "joined", decidedAt: new Date() } });
  return c;
}

/** Apply to join (optional note). If the test now lets anyone join, the second press simply joins. */
export async function apply(tester: U, testId: string, body: Record<string, unknown>) {
  if (!tester.isTester) throw new HttpError(403, "not_tester", "Turn on “test apps, games and more” in your profile to join tests.");
  const t = await db.test.findUnique({ where: { id: testId }, include: { developer: true } });
  if (!t) throw new HttpError(404, "not_found", "That test doesn't exist.");
  await closedInvite(tester.id, body); // (batch 16 section 32)
  const refusal = await joinRefusal(tester.id, testId);
  if (refusal) throw new HttpError(409, "refused", refusal);
  await alreadyWaiting(tester.id, testId);
  await listingGate(tester.id, testId, body, "apply");
  if (t.joinMode !== "anyone" && t.joinMode !== "invite") gapStop(t, await db.testerProfile.findUnique({ where: { userId: tester.id } }), body, "Apply");
  if (t.joinMode === "anyone") return { joined: true, sessionId: (await join(tester, testId, { ...body, confirmed: true })).id };
  if (t.joinMode === "invite") throw new HttpError(409, "invite_only", "This test is invite only.");
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "";
  const snap = listingSnapshot(t) as Prisma.InputJsonValue;
  // (7.3) The NDA is accepted when applying; the developer's Accept joins them on it.
  if (t.ndaText && body.ndaAccepted !== true) throw new HttpError(400, "nda", "Accept the NDA to apply.");
  const ndaAcceptedAt = t.ndaText ? new Date() : null;
  await db.application.upsert({
    where: { testId_testerId: { testId, testerId: tester.id } },
    update: { note, listing: snap, status: "pending", changedAt: null, decidedAt: null, kind: "apply", ndaAcceptedAt },
    create: { testId, testerId: tester.id, note, listing: snap, ndaAcceptedAt },
  });
  await stampCounting(testId); // (batch 14) the 3-change count starts with the first application
  await db.$transaction((tx) => tx.testEvent.create({ data: { testId, kind: "applied", text: `${displayName(tester)} applied to join` } }));
  await notify(t.developer.email, `${displayName(tester)} applied to join “${t.title}”`, [`${displayName(tester)} applied to join “${t.title}”.`, ...(note ? [`Their note: “${note}”`] : []), "Accept or decline on the test page."], `/app/tests/${testId}#needs-you`);
  return { applied: true };
}

export async function withdrawApplication(tester: { id: string }, testId: string, body: Record<string, unknown> = {}) {
  if (await db.application.count({ where: { testId, testerId: tester.id, status: "pending" } })) await listingGate(tester.id, testId, body, "withdraw");
  const n = await db.application.updateMany({ where: { testId, testerId: tester.id, status: "pending" }, data: { status: "withdrawn", decidedAt: new Date() } });
  if (!n.count) throw new HttpError(409, "gone", "There's no pending application to withdraw.");
  await logEvent(testId, "applied", `${displayName(await db.user.findUniqueOrThrow({ where: { id: tester.id } }))} withdrew their application`);
  return { withdrawn: true };
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
  if (a.status === "closed" && a.closedReason === "full") throw new HttpError(409, "gone", `${name}'s application closed when the test filled up at ${fmtTime(a.decidedAt ?? new Date())}.`);
  // (Batch 16 section 11) Closed by a block (either way): neutral, never says why.
  if (a.status === "closed" && a.closedReason === "blocked") throw new HttpError(409, "gone", `${name}'s application was closed.`);
  if (a.status === "closed") throw new HttpError(409, "gone", a.closedReason === "invite_only" ? `${name}'s application closed when the test became invite only at ${fmtTime(a.decidedAt ?? new Date())}.` : `${name}'s application closed when you changed the listing in another tab at ${fmtTime(a.decidedAt ?? new Date())}.`);
  // (Batch 16 section 21) Answered already (in another tab): a plain refusal naming it, no stop box.
  if (a.status !== "pending") throw new HttpError(409, "gone", a.status === "withdrawn" ? `${name} withdrew their application.` : a.status === "declined" ? "You already declined this application." : a.status === "accepted" || a.status === "joined" ? "You already accepted this application." : "This application was already answered.");
  const extra: TestEventLike[] = [];
  const seenAt = typeof body.seenAt === "string" ? new Date(body.seenAt) : null;
  if (seenAt && tester.profile && tester.profile.updatedAt > seenAt) extra.push({ kind: "profile", text: `${name} changed their profile`, createdAt: tester.profile.updatedAt });
  extra.push(...(await listingChanges(testId, body.seenAt)));
  await db.$transaction((tx) => devGate(tx, testId, body, {}, extra, undefined, { acts: ["application"], keys: [`app:${a.id}`] }));
  if (body.action === "decline") {
    await db.application.update({ where: { id: a.id }, data: { status: "declined", decidedAt: new Date() } });
    const title = (await db.test.findUniqueOrThrow({ where: { id: testId } })).title;
    // (Batch 29 §24) In the day's "Joined" entry, across tests.
    if (a.kind === "rejoin") await notify(tester.email, `Your ask to rejoin “${title}” wasn't accepted`, ["The developer didn't accept your ask to rejoin."], `/app/find/${testId}`, { group: "joined", testId });
    else await notify(tester.email, `Your application to “${title}” wasn't accepted`, ["Thanks for applying. There are other tests to find."], `/app/find/${testId}`, { group: "joined", testId }); // (batch 29 §24) its own join page
    return { declined: true };
  }
  const isRejoin = a.kind === "rejoin";
  const refusal = await joinRefusal(tester.id, testId, { rejoin: isRejoin });
  if (refusal) throw new HttpError(409, "refused", refusal.replace("You've already joined", `${name} already joined`).replace(TEST_LIMIT_LINE, `${name} can't join more tests right now.`));
  const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
  const c = await joinTest({ ...tester, isTester: true }, testId, { listingVersion: t.listingVersion, confirmed: true, anyway: true, acceptedByDeveloper: true, rejoinAccepted: isRejoin, ndaAcceptedAt: a.ndaAcceptedAt?.toISOString(), ndaAccepted: !!a.ndaAcceptedAt });
  await db.application.update({ where: { id: a.id }, data: { status: "accepted", decidedAt: new Date() } });
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
  for (const a of pending) {
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
    if (await joinRefusal(tester.id, testId)) continue;
    try {
      const c = await joinTest({ ...tester, isTester: true }, testId, {
        listingVersion: t.listingVersion, confirmed: true, anyway: true, acceptedByDeveloper: true,
      }, { applicationId: a.id, quietJoinEvent: true });
      await notify(tester.email, `You're in: ${t.title}`, [`You're in: ${t.title}.`], `/app/sessions/${c.id}`, { group: "joined" });
      accepted++;
    } catch (error) {
      if (error instanceof HttpError && error.code === "application_gone") continue;
      if (error instanceof HttpError && error.code === "refused" && /full/i.test(error.message)) break;
      throw error;
    }
  }
  if (accepted) await logEvent(testId, "applied", `${accepted} waiting application${accepted === 1 ? " was" : "s were"} accepted when you switched to joins instantly`);
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
export function rejoinAskLine(name: string, pron: { subj: string; poss: string }, c: { endedAt: Date | null; dueAt: Date }) {
  const left = c.endedAt ? c.dueAt.getTime() - c.endedAt.getTime() : 0;
  if (left <= 0) return `${name} asks to rejoin. ${pron.subj[0].toUpperCase()}${pron.subj.slice(1)} had no time left: ${pron.poss} deadline stays passed.`;
  return `${name} asks to rejoin. If you accept, ${pron.subj === "they" ? "they get" : `${pron.subj} gets`} back the ${leftText(left)} ${pron.subj === "they" ? "they" : pron.subj} had left (deadline ${fmtDateTime(new Date(Date.now() + left))}).`;
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
  await alreadyWaiting(tester.id, testId);
  await listingGate(tester.id, testId, body, "ask");
  if (t.ndaText && body.ndaAccepted !== true) throw new HttpError(400, "nda", "Accept the NDA to ask to rejoin.");
  gapStop(t, await db.testerProfile.findUnique({ where: { userId: tester.id } }), body, "Ask");
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "";
  const ndaAcceptedAt = t.ndaText ? new Date() : null;
  const snap = listingSnapshot(t) as Prisma.InputJsonValue;
  const invited = await db.invite.findFirst({ where: { testId, testerId: tester.id, status: "sent" } });
  await db.application.upsert({
    where: { testId_testerId: { testId, testerId: tester.id } },
    update: { note, listing: snap, status: "pending", changedAt: null, decidedAt: null, kind: "rejoin", ndaAcceptedAt },
    create: { testId, testerId: tester.id, note, listing: snap, kind: "rejoin", ndaAcceptedAt },
  });
  // (Owner, Oct 28) A test a suspension removed them from leaves the dashboard top once they ask (or dismiss it).
  if (old.endKind === "suspended" && !old.removedDismissedAt) await db.contract.update({ where: { id: old.id }, data: { removedDismissedAt: new Date() } });
  if (invited) {
    // The developer already invited them: the ask and the invite meet, and they are back at once.
    const c = await matchInviteAndAsk(testId, tester.id);
    if (c) return { joined: true, sessionId: c.id };
  }
  const name = displayName(tester);
  await db.$transaction((tx) => tx.testEvent.create({ data: { testId, kind: "applied", text: `${name} asks to rejoin` } }));
  const line = rejoinAskLine(name, pronouns(tester.pronoun), old);
  await notify(t.developer.email, `${name} asks to rejoin “${t.title}”`, [line, ...(note ? [`Their note: “${note}”`] : [])], `/app/tests/${testId}#needs-you`, { about: tester.id });
  return { asked: true };
}

/**
 * (Design doc 6) A pending application or rejoin ask plus an invite from the developer, in either order, joins the tester at once
 * (the developer chose them; no Join anyway pop-up), unless a final refusal applies. Both are told.
 */
export async function matchInviteAndAsk(testId: string, testerId: string) {
  const app = await db.application.findFirst({ where: { testId, testerId, status: "pending" } });
  const inv = await db.invite.findFirst({ where: { testId, testerId, status: "sent" } });
  if (!app || !inv) return null;
  const tester = await db.user.findUniqueOrThrow({ where: { id: testerId } });
  const t = await db.test.findUniqueOrThrow({ where: { id: testId }, include: { developer: true } });
  if (await joinRefusal(testerId, testId, { rejoin: true })) return null;
  if (t.ndaText && !app.ndaAcceptedAt) return null; // they still have to accept the NDA themselves
  const c = await joinTest(tester, testId, { listingVersion: t.listingVersion, confirmed: true, anyway: true, rejoinAccepted: true, ndaAccepted: !!app.ndaAcceptedAt, ndaAcceptedAt: app.ndaAcceptedAt?.toISOString() });
  await db.application.update({ where: { id: app.id }, data: { status: "joined", decidedAt: new Date() } });
  const back = app.kind === "rejoin";
  await notify(tester.email, back ? `You're back in ${t.title}` : `You're in: ${t.title}`, [back ? `You're back in ${t.title}: your deadline is ${T(c.dueAt)}.` : `You're in: ${t.title}.`], `/app/sessions/${c.id}`, { about: t.developerId, group: "joined" });
  await notify(t.developer.email, `${displayName(tester)} ${back ? "rejoined" : "joined"} “${t.title}”`, [`${displayName(tester)} ${back ? "rejoined" : "joined"} (you'd invited ${pronouns(tester.pronoun).obj} and ${pronouns(tester.pronoun).subj === "they" ? "they'd" : `${pronouns(tester.pronoun).subj} had`} asked).`], `/app/tests/${testId}#tester-${c.id}`, { about: testerId });
  return c;
}
