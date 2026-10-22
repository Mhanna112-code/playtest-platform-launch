import { db } from "@/lib/db";
import { displayName, fmtDate, pronouns } from "@/lib/format";
import { andList, inviteTesterRefusal, inviteTestRefusal, termsLine, type TestEventLike } from "@/lib/rules";
import { HttpError } from "./http";
import { notify } from "./notify";
import { asListing, devGate, needsGap, ownTest, recordEvent } from "./tests";

type U = { id: string; email: string; name: string; pronoun: string };

/** Testers the developer can pick from (not already in this test). Filtering by devices/languages/categories is on the page. */
export async function invitable(devId: string, testId: string) {
  const [testers, inTest, invites] = await Promise.all([
    db.user.findMany({ where: { isTester: true, id: { not: devId } }, include: { profile: true }, orderBy: { name: "asc" }, take: 300 }),
    db.contract.findMany({ where: { testId }, select: { testerId: true } }),
    db.invite.findMany({ where: { testId } }),
  ]);
  const blocks = await db.block.findMany({ where: { OR: [{ blockerId: devId }, { blockedId: devId }] } });
  const taken = new Set([...inTest.map((c) => c.testerId), ...blocks.map((b) => (b.blockerId === devId ? b.blockedId : b.blockerId))]);
  return testers
    .filter((t) => !taken.has(t.id))
    .map((t) => ({
      id: t.id, name: displayName(t), devices: t.profile?.devices ?? [], languages: t.profile?.languages ?? [], categories: t.profile?.categories ?? [],
      invited: invites.some((i) => i.testerId === t.id && i.status === "sent"),
    }));
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
        const inv = invites.find((i) => i.testerId === p.id && i.status === "sent" && i.updatedAt > seenAt);
        if (inv) extra.push({ kind: "joined", text: `You also did this in another tab: invited ${name}`, createdAt: inv.updatedAt });
      }
    }
    await devGate(tx, testId, body.seenAt, body.confirmed === true, {}, extra);
    const invited: { id: string; name: string; email: string }[] = [];
    const others: string[] = [];
    let spotsLeft = t.spots - testersIn;
    for (const p of people) {
      const name = displayName(p);
      if (contracts.some((c) => c.testerId === p.id)) continue; // joined: no longer in the list
      if (invites.some((i) => i.testerId === p.id && i.status === "sent")) continue; // already invited
      const active = await tx.contract.count({ where: { testerId: p.id, status: "working" } });
      const blocked = (await tx.block.count({ where: { OR: [{ blockerId: dev.id, blockedId: p.id }, { blockerId: p.id, blockedId: dev.id }] } })) > 0;
      const why = inviteTesterRefusal(name, { suspended: !!p.suspendedAt, blocked, deleted: !p.isTester, activeTests: active });
      if (why) {
        others.push(why);
        continue;
      }
      if (spotsLeft <= 0) {
        others.push(`${name} can't be invited: the test is full.`);
        continue;
      }
      await tx.invite.upsert({ where: { testId_testerId: { testId, testerId: p.id } }, update: { status: "sent" }, create: { testId, testerId: p.id } });
      invited.push({ id: p.id, name, email: p.email });
      spotsLeft--;
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
  if (inv.status !== "sent") throw new HttpError(409, "gone", inv.status === "joined" ? "They already joined." : "This invite was already cancelled.");
  await db.invite.update({ where: { id: inv.id }, data: { status: "cancelled" } });
  return { ok: true };
}

/** An invite is live while the test can still take this tester. */
export const inviteExpired = (t: { status: string; spots: number; openUntil: Date | null }, testersIn: number, now = new Date()) =>
  t.status !== "open" || testersIn >= t.spots || (!!t.openUntil && t.openUntil < now);
