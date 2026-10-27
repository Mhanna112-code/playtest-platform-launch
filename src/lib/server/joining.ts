import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { displayName, fmtDateTime, fmtTime, pronouns } from "@/lib/format";
import { canAskToRejoin, leftText, MAX_ACTIVE_TESTS, termsDiff, termsLine, testPaused, TEST_LIMIT_LINE, type TestEventLike } from "@/lib/rules";
import { HttpError } from "./http";
import { notify } from "./notify";
import { logEvent, ownChanges, seenOf, tabOf, withRenamed } from "./live";
import { asListing, devGate, gapStop, joinTest, ownTest } from "./tests";

// Joining (owner rule): Who can join = Anyone (Join) / Apply (Apply to join → the developer Accepts or Declines) /
// Invite only. No offers or counter-offers on the join page. Join and Apply stop once if ANYTHING about the listing
// changed since the page loaded (including who can join). Refused for good: full, stopped, past Open until, paused,
// blocked, 10 tests, already in.

type U = { id: string; email: string; name: string; pronoun: string; isTester: boolean; isDeveloper: boolean };

const listingSnapshot = (t: Parameters<typeof asListing>[0]) => {
  const l = asListing(t);
  return { ...l, joinMode: undefined } as Record<string, unknown>;
};
const sameListingIgnoringMode = (a: unknown, b: unknown) => {
  // Key order differs once stored (jsonb), so compare with sorted keys.
  const strip = (x: unknown) => {
    const o = { ...(x as Record<string, unknown>) };
    delete o.joinMode;
    delete o.spots;
    return JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
  };
  return strip(a) === strip(b);
};

/** Shared final refusals for Join, Apply to join and Accept. */
export async function joinRefusal(testerId: string, testId: string, opts: { rejoin?: boolean } = {}) {
  const t = await db.test.findUniqueOrThrow({ where: { id: testId }, include: { developer: true } });
  if (t.status === "stopped") return "This test was stopped.";
  if (t.openUntil && t.openUntil < new Date()) return "This test isn't taking new testers any more.";
  if (t.status !== "open") return "This test isn't taking new testers any more.";
  if (testPaused(t.developer, t)) return "This test is paused, so it isn't taking new testers right now.";
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

const INFO_NAMES = ["title", "description", "devices", "languages", "build link", "categories", "who can join"];

/** The join page's stop-once reasons: (D) the listing changed (spots excepted), (E) the tester's own actions in another tab. */
export async function joinPageChanges(userId: string, testId: string, seenAt: unknown, tab: string): Promise<TestEventLike[]> {
  const d = seenOf(seenAt);
  if (!d) return [];
  // An edit of only the listing's info shows once, as the (F) line ("Nora Lane changed the description").
  const edits = (await listingChanges(testId, seenAt)).filter((e) => !e.text.replace(/^The listing was edited: /, "").split(", ").every((f) => INFO_NAMES.includes(f)));
  const info = await db.testEvent.findMany({ where: { testId, kind: { in: ["info", "renamed"] }, createdAt: { gt: d } } });
  // (NEWEST+4, LIVE + GONE) Their application closed / their invite re-sent on the updated listing.
  const t = await db.test.findUniqueOrThrow({ where: { id: testId }, include: { developer: true } });
  const gone: TestEventLike[] = [];
  for (const a of await db.application.findMany({ where: { testId, testerId: userId, status: "closed", decidedAt: { gt: d } } }))
    gone.push({ kind: "applied", text: a.closedReason === "full" ? `${t.title} is full: your application was closed` : a.closedReason === "invite_only" ? `${displayName(t.developer)} made the test invite only: your application was closed` : `${displayName(t.developer)} changed the listing: your application was closed`, createdAt: a.decidedAt! });
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
    const termsEdit = edits.filter((e) => e.kind === "edited").pop();
    const diff = termsDiff({ ...left, questions: (left.questions as string[]) ?? [] }, asListing(t));
    if (termsEdit && diff) rejoin.push({ kind: "terms_plain", text: `${displayName(t.developer)} changed the terms: ${diff}`, createdAt: termsEdit.createdAt });
  }
  const all = [...edits, ...info, ...gone, ...(await ownChanges(userId, testId, d, tab)), ...rejoin];
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
  // (Owner) The second press goes ahead only if nothing new happened since the box last updated (boxAt).
  const boxAt = seenOf(body.boxAt);
  if (body.confirmed === true && !boxAt) return;
  const changes = withRenamed(await joinPageChanges(userId, testId, body.confirmed === true ? boxAt!.toISOString() : body.seenAt, tabOf(body)), body);
  if (changes.length) {
    const tail = verb === "withdraw" || verb === "decline" ? "Press again to go ahead." : `Press again to ${verb} on the current listing.`;
    throw new HttpError(409, "stop_once", tail, { changes: changes.map((e) => ({ text: e.text, at: e.createdAt })), tail });
  }
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

/** Join (Who can join = Anyone, or an invited tester on an invite-only test). */
export async function join(tester: U, testId: string, body: Record<string, unknown>) {
  if (!tester.isTester) throw new HttpError(403, "not_tester", "Turn on “test apps, games and more” in your profile to join tests.");
  const t = await db.test.findUnique({ where: { id: testId } });
  if (!t) throw new HttpError(404, "not_found", "That test doesn't exist.");
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
  const refusal = await joinRefusal(tester.id, testId);
  if (refusal) throw new HttpError(409, "refused", refusal);
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
  if (a.status === "closed") throw new HttpError(409, "gone", a.closedReason === "invite_only" ? `${name}'s application closed when the test became invite only at ${fmtTime(a.decidedAt ?? new Date())}.` : `${name}'s application closed when you changed the listing in another tab at ${fmtTime(a.decidedAt ?? new Date())}.`);
  if (a.status !== "pending") throw new HttpError(409, "gone", a.status === "withdrawn" ? `${name} withdrew their application.` : "This application was already answered.");
  const extra: TestEventLike[] = [];
  const seenAt = typeof body.seenAt === "string" ? new Date(body.seenAt) : null;
  if (seenAt && tester.profile && tester.profile.updatedAt > seenAt) extra.push({ kind: "profile", text: `${name} changed their profile`, createdAt: tester.profile.updatedAt });
  extra.push(...(await listingChanges(testId, body.seenAt)));
  await db.$transaction((tx) => devGate(tx, testId, body, {}, extra));
  if (body.action === "decline") {
    await db.application.update({ where: { id: a.id }, data: { status: "declined", decidedAt: new Date() } });
    const title = (await db.test.findUniqueOrThrow({ where: { id: testId } })).title;
    if (a.kind === "rejoin") await notify(tester.email, `Your ask to rejoin “${title}” wasn't accepted`, ["The developer didn't accept your ask to rejoin."], `/app/find/${testId}`);
    else await notify(tester.email, `Your application to “${title}” wasn't accepted`, ["Thanks for applying. There are other tests to find."], "/app/find");
    return { declined: true };
  }
  const isRejoin = a.kind === "rejoin";
  const refusal = await joinRefusal(tester.id, testId, { rejoin: isRejoin });
  if (refusal) throw new HttpError(409, "refused", refusal.replace("You've already joined", `${name} already joined`).replace(TEST_LIMIT_LINE, `${name} can't join more tests right now.`));
  const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
  const c = await joinTest({ ...tester, isTester: true }, testId, { listingVersion: t.listingVersion, confirmed: true, anyway: true, acceptedByDeveloper: true, rejoinAccepted: isRejoin, ndaAcceptedAt: a.ndaAcceptedAt?.toISOString(), ndaAccepted: !!a.ndaAcceptedAt });
  await db.application.update({ where: { id: a.id }, data: { status: "accepted", decidedAt: new Date() } });
  if (isRejoin) {
    const line = `You're back in ${t.title}: your deadline is ${fmtDateTime(c.dueAt)}.`;
    await notify(tester.email, line, [line, `Your session is restored on the current listing: ${termsLine(c, true)}.`], `/app/sessions/${c.id}`, { about: dev.id });
    return { accepted: true, sessionId: c.id, line: `${name} rejoined: ${pronouns(tester.pronoun).poss} deadline is ${fmtDateTime(c.dueAt)}.` };
  }
  await notify(tester.email, `You're in: ${t.title}`, [`You're in: ${t.title}. Your contract: ${termsLine(c, true)}.`], `/app/sessions/${c.id}`);
  return { accepted: true, sessionId: c.id };
}

/**
 * The test switched to "Anyone can join": a pending application whose listing is otherwise unchanged is joined at once
 * ("You're in: Harbor Run"); otherwise the tester is told it changed (Join on the current listing / Withdraw application).
 */
export async function onSwitchToAnyone(testId: string) {
  const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
  const pending = await db.application.findMany({ where: { testId, status: "pending" } });
  for (const a of pending) {
    const tester = await db.user.findUniqueOrThrow({ where: { id: a.testerId } });
    if (sameListingIgnoringMode(a.listing, listingSnapshot(t)) && !(await joinRefusal(tester.id, testId))) {
      const c = await joinTest(tester, testId, { listingVersion: t.listingVersion, confirmed: true, anyway: true });
      await db.application.update({ where: { id: a.id }, data: { status: "joined", decidedAt: new Date() } });
      await notify(tester.email, `You're in: ${t.title}`, [`You're in: ${t.title}.`], `/app/sessions/${c.id}`);
    } else {
      await db.application.update({ where: { id: a.id }, data: { changedAt: new Date() } });
      await notify(tester.email, `${t.title} changed since you applied`, [`${t.title} changed since you applied: join on the current listing, or withdraw your application.`], `/app/find/${testId}`);
    }
  }
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
    const line = why === "invite_only" ? `${t.title} is now invite only, so your application was closed.` : `${t.title}'s listing changed, so your application was closed. You can apply again on the current listing.`;
    await notify(tester.email, line, [line], `/app/find/${testId}`);
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
  if (!canAskToRejoin(old, rated)) throw new HttpError(409, "not_again", rated || old.endKind === "rated" ? "You rated this test, so you can't join it again." : "You can't ask to rejoin this test.");
  const refusal = await joinRefusal(tester.id, testId, { rejoin: true });
  if (refusal) throw new HttpError(409, "refused", refusal);
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
  await notify(tester.email, back ? `You're back in ${t.title}` : `You're in: ${t.title}`, [back ? `You're back in ${t.title}: your deadline is ${fmtDateTime(c.dueAt)}.` : `You're in: ${t.title}.`], `/app/sessions/${c.id}`, { about: t.developerId });
  await notify(t.developer.email, `${displayName(tester)} ${back ? "rejoined" : "joined"} “${t.title}”`, [`${displayName(tester)} ${back ? "rejoined" : "joined"} (you'd invited ${pronouns(tester.pronoun).obj} and ${pronouns(tester.pronoun).subj === "they" ? "they'd" : `${pronouns(tester.pronoun).subj} had`} asked).`], `/app/tests/${testId}#tester-${c.id}`, { about: testerId });
  return c;
}
