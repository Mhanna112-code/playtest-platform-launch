import { db } from "@/lib/db";
import { displayName, fmtDate, pronouns } from "@/lib/format";
import { andList, inviteTesterRefusal, inviteTestRefusal, MAX_ACTIVE_TESTS, termsLine, type TestEventLike } from "@/lib/rules";
import { HttpError } from "./http";
import { notify } from "./notify";
import { asListing, devGate, devGateIfSeen, needsGap, ownTest, recordEvent } from "./tests";
import { revealedRatingsWhere } from "./ratings";
import { doesntListTag, withYouText } from "@/lib/inviteRows";

type U = { id: string; email: string; name: string; pronoun: string };

/** Testers the developer can pick from (not already in this test). Filtering by devices/languages/categories is on the page. */
/**
 * The invite list (owner rule). Greyed with a neutral reason (tick disabled): already in the test, already invited
 * ("Invited Oct 21" · Cancel invite), suspended ("Can't be invited right now"), at 10 tests ("Can't join more tests right
 * now"). Removed silently: blocked either way, deleted accounts (no longer testers); the page's filters remove the rest.
 */
export async function invitable(devId: string, testId: string) {
  const [testers, inTest, invites, blocks, active, past] = await Promise.all([
    db.user.findMany({ where: { isTester: true, id: { not: devId } }, include: { profile: true }, orderBy: { createdAt: "desc" }, take: 500 }),
    db.contract.findMany({ where: { testId, status: "working" }, select: { testerId: true } }),
    db.invite.findMany({ where: { testId, status: "sent" } }),
    db.block.findMany({ where: { OR: [{ blockerId: devId }, { blockedId: devId }] } }),
    db.contract.groupBy({ by: ["testerId"], where: { status: "working" }, _count: { _all: true } }),
    db.contract.findMany({ where: { testId, status: { in: ["left", "ended"] } }, select: { testerId: true, status: true } }),
  ]);
  const removed = new Set(blocks.map((b) => (b.blockerId === devId ? b.blockedId : b.blockerId)));
  const test = await db.test.findUniqueOrThrow({ where: { id: testId } });
  const withDev = await db.contract.findMany({ where: { test: { developerId: devId } }, select: { testerId: true } });
  const workedWith = new Set(withDev.map((c) => c.testerId));
  // (The full app's rows) "you rated 5.0/5 · 1 test with you": this developer's own ratings of them, and their tests together.
  const mine = await db.rating.groupBy({ by: ["rateeId"], where: { raterId: devId, side: "developer" }, _avg: { stars: true } });
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  // (NEWEST+5) "4.6 ★ (12 ratings)" on each invite row.
  const grouped = await db.rating.groupBy({ by: ["rateeId"], where: { rateeId: { in: testers.map((t) => t.id) }, ...revealedRatingsWhere() }, _avg: { stars: true }, _count: { _all: true } });
  const ratingLine = (id: string) => {
    const g = grouped.find((x) => x.rateeId === id);
    return g ? `${(g._avg.stars ?? 0).toFixed(1)} ★ (${g._count._all} rating${g._count._all === 1 ? "" : "s"})` : "";
  };
  // (NEWEST+8) Suggested: up to 5, not people you've worked with: meeting the test's needs first, then the highest
  // rating, then the most matching devices and languages.
  const avg = (id: string) => grouped.find((x) => x.rateeId === id)?._avg.stars ?? 0;
  const matches = (t: (typeof testers)[number]) => (t.profile?.devices ?? []).filter((d) => test.devices.includes(d)).length + (t.profile?.languages ?? []).filter((l) => test.languages.includes(l)).length;
  const suggested = new Set(
    testers
      .filter((t) => !removed.has(t.id) && !workedWith.has(t.id))
      .map((t) => ({ t, meets: needsGap(test, t.profile) ? 0 : 1, r: avg(t.id), m: matches(t) }))
      .sort((a, b) => b.meets - a.meets || b.r - a.r || b.m - a.m)
      .slice(0, 5)
      .map((x) => x.t.id),
  );
  return testers
    .filter((t) => !removed.has(t.id))
    .map((t) => {
      const inv = invites.find((i) => i.testerId === t.id);
      const n = active.find((a) => a.testerId === t.id)?._count._all ?? 0;
      const grey = inTest.some((c) => c.testerId === t.id) ? "Already in this test" : inv ? `Invited ${fmt(inv.createdAt)}` : t.suspendedAt ? "Can't be invited right now" : n >= MAX_ACTIVE_TESTS ? "Can't join more tests right now" : null;
      return {
        id: t.id, name: displayName(t), devices: t.profile?.devices ?? [], languages: t.profile?.languages ?? [], categories: t.profile?.categories ?? [],
        invited: !!inv, inviteId: inv?.id ?? null, grey, rating: ratingLine(t.id),
        // (NEXT-UI 14) Still tickable: a re-invite is how an ended tester can come back.
        was: ((s) => (s === "left" ? "Left this test" : s === "ended" ? "You ended their work" : ""))(past.find((c) => c.testerId === t.id)?.status),
        tag: doesntListTag(test, t.profile),
        detail: withYouText(mine.find((m) => m.rateeId === t.id)?._avg.stars ?? null, withDev.filter((c) => c.testerId === t.id).length),
        gap: missingNeed(test, t.profile),
        section: workedWith.has(t.id) ? "worked" : suggested.has(t.id) ? "suggested" : "other",
      };
    });
}

/** What the test needs that this tester's profile doesn't list ("English"), or "". */
function missingNeed(t: { devices: string[]; languages: string[] }, p: { devices: string[]; languages: string[] } | null) {
  if (t.languages.length && !t.languages.some((l) => p?.languages.includes(l))) return t.languages.join(" or ");
  if (t.devices.length && !t.devices.some((d) => p?.devices.includes(d))) return t.devices.join(" or ");
  return "";
}

/** What the test needs that this tester's profile no longer has ("removed English"). */
function removedNeeds(t: { devices: string[]; languages: string[] }, p: { devices: string[]; languages: string[] } | null) {
  if (!needsGap(t, p)) return "";
  if (t.languages.length && !t.languages.some((l) => p?.languages.includes(l))) return t.languages.join(" or ");
  return t.devices.join(" or ");
}

/**
 * Invite ticked testers. Refused for good when the test is full, stopped, past Open until or paused. Stops once for the
 * developer stop-once reasons plus: a ticked tester's profile no longer fits, a ticked tester joined, or was already
 * invited in another tab. Then invites those who can be invited and names the others with reasons.
 */
export async function inviteTesters(dev: U & { holdStartedAt?: Date | null }, testId: string, body: Record<string, unknown>) {
  await ownTest(dev.id, testId);
  const ids = Array.isArray(body.testerIds) ? [...new Set(body.testerIds.filter((x): x is string => typeof x === "string"))] : [];
  if (!ids.length) throw new HttpError(400, "none", "Tick at least one tester.");
  const seenAt = new Date(String(body.seenAt ?? ""));
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Test" WHERE id = ${testId} FOR UPDATE`;
    const t = await tx.test.findUniqueOrThrow({ where: { id: testId } });
    const me = await tx.user.findUniqueOrThrow({ where: { id: dev.id } });
    const testersIn = await tx.contract.count({ where: { testId, status: "working" } });
    const now = new Date();
    const refusal = inviteTestRefusal({ ...t, testersIn, paused: !!me.holdStartedAt }, now, fmtDate);
    if (refusal) throw new HttpError(409, "refused", refusal, { clearTicks: true });
    const people = await tx.user.findMany({ where: { id: { in: ids } }, include: { profile: true } });
    const contracts = await tx.contract.findMany({ where: { testId, testerId: { in: ids } } });
    const invites = await tx.invite.findMany({ where: { testId, testerId: { in: ids } } });
    // Extra stop-once reasons for the ticked testers.
    const extra: TestEventLike[] = [];
    if (!isNaN(seenAt.getTime())) {
      for (const p of people) {
        const name = displayName(p);
        const gone = removedNeeds(t, p.profile);
        if (gone && p.profile && p.profile.updatedAt > seenAt) extra.push({ kind: "joined", text: `${name} removed ${gone}, which this test needs`, createdAt: p.profile.updatedAt });
        const joined = contracts.find((c) => c.testerId === p.id && c.joinedAt > seenAt);
        if (joined) extra.push({ kind: "joined", text: `${name} joined this test, so ${pronouns(p.pronoun).subj}'s no longer in your invite list`.replace("they's", "they're"), createdAt: joined.joinedAt });
        // A ticked tester became greyed or removed since the page loaded.
        if (p.suspendedAt && p.suspendedAt > seenAt) extra.push({ kind: "joined", text: `${name} can't be invited right now`, createdAt: p.suspendedAt });
        const blockedSince = await tx.block.findFirst({ where: { createdAt: { gt: seenAt }, OR: [{ blockerId: dev.id, blockedId: p.id }, { blockerId: p.id, blockedId: dev.id }] } });
        if (blockedSince) extra.push({ kind: "joined", text: `${name} is no longer in your list`, createdAt: blockedSince.createdAt });
        const lastJoin = await tx.contract.findFirst({ where: { testerId: p.id, status: "working", joinedAt: { gt: seenAt } }, orderBy: { joinedAt: "desc" } });
        if (lastJoin && lastJoin.testId !== testId && (await tx.contract.count({ where: { testerId: p.id, status: "working" } })) >= MAX_ACTIVE_TESTS) extra.push({ kind: "joined", text: `${name} can't join more tests right now`, createdAt: lastJoin.joinedAt });
      }
    }
    await devGate(tx, testId, body, {}, extra);
    const gaps = people
      .filter((p) => !contracts.some((c) => c.testerId === p.id) && missingNeed(t, p.profile))
      .map((p) => `${displayName(p)} doesn't list ${missingNeed(t, p.profile)}, which this test needs.`);
    const seenGaps = Array.isArray(body.seenGaps) ? (body.seenGaps as unknown[]).map(String) : null;
    if (body.anyway === true && !gaps.length) {
      // Everyone ticked now meets the needs: nothing is sent; the box closes and a notice shows under Invite.
      throw new HttpError(409, "needs_none", "Everyone you ticked now meets this test's needs. Press Invite to send.");
    }
    if (gaps.length && body.anyway !== true) throw new HttpError(409, "needs_confirm", "CONFIRM:" + gaps.join("\n"), { lines: gaps });
    if (gaps.length && JSON.stringify(seenGaps) !== JSON.stringify(gaps)) {
      // What's missing changed since the box showed: stop once in the box with the updated list.
      throw new HttpError(409, "needs_confirm", "CONFIRM:" + ["What's missing changed since you looked. Press Invite anyway again to invite on this:", ...gaps].join("\n"), { lines: gaps, changed: true });
    }
    const invited: { id: string; name: string; email: string }[] = [];
    const others: string[] = [];
    for (const p of people) {
      const name = displayName(p);
      if (contracts.some((c) => c.testerId === p.id && c.status === "working")) continue; // joined: no longer in the list
      if (invites.some((i) => i.testerId === p.id && i.status === "sent")) continue; // already invited
      const active = await tx.contract.count({ where: { testerId: p.id, status: "working" } });
      const blocked = (await tx.block.count({ where: { OR: [{ blockerId: dev.id, blockedId: p.id }, { blockerId: p.id, blockedId: dev.id }] } })) > 0;
      const why = inviteTesterRefusal(name, { suspended: !!p.suspendedAt, blocked, deleted: !p.isTester, activeTests: active });
      if (why) {
        others.push(why);
        continue;
      }
      // (Correction 5) Invites never hold spots: any number can be open; the first to join gets a spot.
      await tx.invite.create({ data: { testId, testerId: p.id } });
      invited.push({ id: p.id, name, email: p.email });
    }
    if (invited.length) await recordEvent(tx, testId, "invited", `You invited ${andList(invited.map((i) => i.name))}`, false);
    return { t, invited, others };
  });
  for (const i of result.invited) {
    await notify(i.email, `${displayName(dev)} invited you to “${result.t.title}”`, [`${displayName(dev)} invited you to test “${result.t.title}”.`, `What you get: ${termsLine(asListing(result.t), true)}.`, "Open it and press Join to join on these terms."], `/app/find/${testId}`);
  }
  const msg = [result.invited.length ? `Invited ${andList(result.invited.map((i) => i.name))}.` : "", ...result.others].filter(Boolean).join(" ") || "Everyone you ticked was already invited or joined.";
  return { message: msg, invited: result.invited.map((i) => i.id) };
}

export async function cancelInvite(dev: U, testId: string, body: Record<string, unknown>) {
  await ownTest(dev.id, testId);
  const inv = await db.invite.findUnique({ where: { id: String(body.inviteId ?? "") }, include: { test: true } });
  if (!inv || inv.testId !== testId) throw new HttpError(404, "not_found", "That invite doesn't exist.");
  if (inv.status !== "sent") throw new HttpError(409, "gone", inv.status === "joined" ? "They already joined." : inv.status === "replaced" ? "This invite is no longer valid: it was re-sent on the new listing." : "This invite was already cancelled.");
  await devGateIfSeen(testId, body);
  await db.invite.update({ where: { id: inv.id }, data: { status: "cancelled" } });
  return { ok: true };
}

/** An invite is live while the test can still take this tester. */
/** An invite is live while the test takes testers (a full test keeps its invites open: correction 6). */
export const inviteExpired = (t: { status: string; openUntil: Date | null }, now = new Date()) => t.status !== "open" || (!!t.openUntil && t.openUntil < now);

/** For the live Invite anyway box: what each ticked tester still misses right now. */
export async function inviteGaps(devId: string, testId: string, testerIds: string[]) {
  const t = await ownTest(devId, testId);
  const people = await db.user.findMany({ where: { id: { in: testerIds } }, include: { profile: true } });
  return { lines: people.filter((p) => missingNeed(t, p.profile)).map((p) => `${displayName(p)} doesn't list ${missingNeed(t, p.profile)}, which this test needs.`) };
}

/**
 * (Owner, NEWEST+4) A saved listing change (anything except spots / who can join) closes every open invite and sends
 * a NEW invite on the new listing to the same testers (bell + email; the 3-day reminder clock restarts). Testers who
 * can't be invited any more are not re-invited and are named for the Save result.
 */
export async function reinviteAfterEdit(testId: string) {
  const t = await db.test.findUniqueOrThrow({ where: { id: testId }, include: { developer: true } });
  const open = await db.invite.findMany({ where: { testId, status: "sent" }, orderBy: { createdAt: "asc" } });
  const skipped: string[] = [];
  const resent: string[] = [];
  for (const inv of open) {
    await db.invite.update({ where: { id: inv.id }, data: { status: "replaced" } });
    const p = await db.user.findUnique({ where: { id: inv.testerId } });
    if (!p) continue;
    const name = displayName(p);
    const active = await db.contract.count({ where: { testerId: p.id, status: "working" } });
    const blocked = (await db.block.count({ where: { OR: [{ blockerId: t.developerId, blockedId: p.id }, { blockerId: p.id, blockedId: t.developerId }] } })) > 0;
    if (!p.isTester) { skipped.push(`${name} (account closed)`); continue; }
    if (p.suspendedAt || blocked) { skipped.push(`${name} (can't be invited right now)`); continue; }
    if (active >= MAX_ACTIVE_TESTS) { skipped.push(`${name} (in ${MAX_ACTIVE_TESTS} tests)`); continue; }
    await db.invite.create({ data: { testId, testerId: p.id } });
    resent.push(name);
    const line = `${displayName(t.developer)} updated ${t.title}, so here's a new invite: ${termsLine(asListing(t), true)}.`;
    await notify(p.email, line, [line, "Open it and press Join to join on these terms."], `/app/find/${testId}`);
  }
  return { skipped, resent };
}
