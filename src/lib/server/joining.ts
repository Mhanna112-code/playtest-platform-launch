import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { displayName, pronouns } from "@/lib/format";
import { MAX_ACTIVE_TESTS, termsLine, type TestEventLike } from "@/lib/rules";
import { HttpError } from "./http";
import { notify } from "./notify";
import { logEvent, ownChanges, seenOf, tabOf } from "./live";
import { asListing, devGate, joinTest, ownTest } from "./tests";

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
export async function joinRefusal(testerId: string, testId: string) {
  const t = await db.test.findUniqueOrThrow({ where: { id: testId }, include: { developer: true } });
  if (t.status === "stopped") return "This test was stopped.";
  if (t.openUntil && t.openUntil < new Date()) return "This test isn't taking new testers any more.";
  if (t.status !== "open") return "This test isn't taking new testers any more.";
  if (t.developer.holdStartedAt) return "This test is paused, so it isn't taking new testers right now.";
  const old = await db.contract.findUnique({ where: { testId_testerId: { testId, testerId } } });
  if (old?.status === "working") return "You've already joined this test.";
  if (old?.status === "ended" && !(await db.invite.findFirst({ where: { testId, testerId, status: "sent" } }))) return "You can't join this test again.";
  const testersIn = await db.contract.count({ where: { testId, status: "working" } });
  if (testersIn >= t.spots) return "This test is full.";
  if (await db.block.count({ where: { blockerId: testerId, blockedId: t.developerId } })) return `You blocked ${displayName(t.developer)}: unblock them in Settings → Blocked people to join.`;
  if (await db.block.count({ where: { blockerId: t.developerId, blockedId: testerId } })) return "This test isn't taking new testers right now.";
  if ((await db.contract.count({ where: { testerId, status: "working" } })) >= MAX_ACTIVE_TESTS) return "You can't join more tests right now.";
  return "";
}

/** What changed on the listing since the page loaded (edits: any field, spots, Open until, who can join). */
export async function listingChanges(testId: string, seenAt: unknown): Promise<TestEventLike[]> {
  const d = typeof seenAt === "string" ? new Date(seenAt) : null;
  if (!d || isNaN(d.getTime())) return [];
  return db.testEvent.findMany({ where: { testId, kind: "edited", createdAt: { gt: d } }, orderBy: { createdAt: "asc" } });
}

const INFO_NAMES = ["title", "description", "devices", "languages"];

/** The join page's stop-once reasons: (D) the listing changed (spots excepted), (E) the tester's own actions in another tab. */
export async function joinPageChanges(userId: string, testId: string, seenAt: unknown, tab: string): Promise<TestEventLike[]> {
  const d = seenOf(seenAt);
  if (!d) return [];
  // An edit of only the listing's info shows once, as the (F) line ("Nora Lane changed the description").
  const edits = (await listingChanges(testId, seenAt)).filter((e) => !e.text.replace(/^The listing was edited: /, "").split(", ").every((f) => INFO_NAMES.includes(f)));
  const info = await db.testEvent.findMany({ where: { testId, kind: "info", createdAt: { gt: d } } });
  return [...edits, ...info, ...(await ownChanges(userId, testId, d, tab))].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/** Join / Apply / Withdraw application / No thanks stop once (box under the button) for the join page's reasons. */
export async function listingGate(userId: string, testId: string, body: Record<string, unknown>, verb: string) {
  if (body.confirmed === true) return;
  const changes = await joinPageChanges(userId, testId, body.seenAt, tabOf(body));
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
  throw new HttpError(409, "invite_replaced", "This invite was replaced by a new one with the current listing.", fresh ? { newInviteId: fresh.id, terms: termsLine(asListing(t), true), listingVersion: t.listingVersion } : {});
}

/** Join (Who can join = Anyone, or an invited tester on an invite-only test). */
export async function join(tester: U, testId: string, body: Record<string, unknown>) {
  if (!tester.isTester) throw new HttpError(403, "not_tester", "Turn on “test games” in your profile to join tests.");
  const t = await db.test.findUnique({ where: { id: testId } });
  if (!t) throw new HttpError(404, "not_found", "That test doesn't exist.");
  const refusal = await joinRefusal(tester.id, testId);
  if (refusal) throw new HttpError(409, "refused", refusal);
  await replacedInvite(tester.id, testId, body);
  await listingGate(tester.id, testId, body, "join");
  if (t.joinMode === "apply" && !(await db.application.findFirst({ where: { testId, testerId: tester.id, status: "pending", changedAt: { not: null } } }))) {
    throw new HttpError(409, "apply", "This test takes applications: press Apply to join.");
  }
  if (t.joinMode === "invite" && !(await db.invite.findFirst({ where: { testId, testerId: tester.id, status: "sent" } }))) throw new HttpError(409, "invite_only", "This test is invite only.");
  const c = await joinTest(tester, testId, { ...body, listingVersion: t.listingVersion, confirmed: true, anyway: body.anyway === true });
  await db.application.updateMany({ where: { testId, testerId: tester.id, status: "pending" }, data: { status: "joined", decidedAt: new Date() } });
  return c;
}

/** Apply to join (optional note). If the test now lets anyone join, the second press simply joins. */
export async function apply(tester: U, testId: string, body: Record<string, unknown>) {
  if (!tester.isTester) throw new HttpError(403, "not_tester", "Turn on “test games” in your profile to join tests.");
  const t = await db.test.findUnique({ where: { id: testId }, include: { developer: true } });
  if (!t) throw new HttpError(404, "not_found", "That test doesn't exist.");
  const refusal = await joinRefusal(tester.id, testId);
  if (refusal) throw new HttpError(409, "refused", refusal);
  await listingGate(tester.id, testId, body, "apply");
  if (t.joinMode === "anyone") return { joined: true, sessionId: (await join(tester, testId, { ...body, confirmed: true })).id };
  if (t.joinMode === "invite") throw new HttpError(409, "invite_only", "This test is invite only.");
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "";
  const snap = listingSnapshot(t) as Prisma.InputJsonValue;
  await db.application.upsert({
    where: { testId_testerId: { testId, testerId: tester.id } },
    update: { note, listing: snap, status: "pending", changedAt: null, decidedAt: null },
    create: { testId, testerId: tester.id, note, listing: snap },
  });
  await db.$transaction((tx) => tx.testEvent.create({ data: { testId, kind: "applied", text: `${displayName(tester)} applied to join` } }));
  await notify(t.developer.email, `${displayName(tester)} applied to join “${t.title}”`, [`${displayName(tester)} applied to join “${t.title}”.`, ...(note ? [`Their note: “${note}”`] : []), "Accept or decline on the test page."], `/app/tests/${testId}`);
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
  if (a.status !== "pending") throw new HttpError(409, "gone", a.status === "withdrawn" ? `${name} withdrew their application.` : "This application was already answered.");
  const extra: TestEventLike[] = [];
  const seenAt = typeof body.seenAt === "string" ? new Date(body.seenAt) : null;
  if (seenAt && tester.profile && tester.profile.updatedAt > seenAt) extra.push({ kind: "profile", text: `${name} changed their profile`, createdAt: tester.profile.updatedAt });
  extra.push(...(await listingChanges(testId, body.seenAt)));
  await db.$transaction((tx) => devGate(tx, testId, body, {}, extra));
  // (NEWEST+4) The listing changed since they applied: Accept asks them to join on the current listing instead.
  const tNow = await db.test.findUniqueOrThrow({ where: { id: testId } });
  if (body.action !== "decline" && a.listing && !sameListingIgnoringMode(a.listing, listingSnapshot(tNow))) {
    if (!a.changedAt) {
      await db.application.update({ where: { id: a.id }, data: { changedAt: new Date() } });
      await notify(tester.email, `${tNow.title} changed since you applied`, [`${tNow.title} changed since you applied: join on the current listing, or withdraw your application.`], `/app/find/${testId}`);
    }
    return { asked: true, message: `${name} applied before your changes, so ${pronouns(tester.pronoun).subj}'ll be asked to join on the current listing.` };
  }
  if (body.action === "decline") {
    await db.application.update({ where: { id: a.id }, data: { status: "declined", decidedAt: new Date() } });
    await notify(tester.email, `Your application to “${(await db.test.findUniqueOrThrow({ where: { id: testId } })).title}” wasn't accepted`, ["Thanks for applying. There are other tests to find."], "/app/find");
    return { declined: true };
  }
  const refusal = await joinRefusal(tester.id, testId);
  if (refusal) throw new HttpError(409, "refused", refusal.replace("You've already joined", `${name} already joined`).replace("You can't join more tests right now.", `${name} can't join more tests right now.`));
  const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
  const c = await joinTest({ ...tester, isTester: true }, testId, { listingVersion: t.listingVersion, confirmed: true, anyway: true });
  await db.application.update({ where: { id: a.id }, data: { status: "accepted", decidedAt: new Date() } });
  await notify(tester.email, `You're in: ${t.title}`, [`You're in: ${t.title}. Your contract: ${termsLine(c, true)}.`], `/app/sessions/${c.id}`, { always: false });
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
