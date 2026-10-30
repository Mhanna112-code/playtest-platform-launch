import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { displayName, fmtDate, pronouns } from "@/lib/format";
import { andList, inviteTesterRefusal, inviteTestRefusal, MAX_ACTIVE_TESTS, termsLine, type TestEventLike } from "@/lib/rules";
import { HttpError } from "./http";
import { notify } from "./notify";
import { asListing, devGate, devGateIfSeen, needsGap, ownTest, recordEvent, stampCounting } from "./tests";
import { revealedRatingsWhere } from "./ratings";
import { doesntListItems, doesntListTag, withYouText } from "@/lib/inviteRows";
import { INVITE_ACTS } from "./live";
import { exactFirst, nameMatches } from "@/lib/nameSearch";
import { gapsOf, missingNeedLine, missingNeedText, orList, type GapItem } from "@/lib/gaps";

type U = { id: string; email: string; name: string; pronoun: string };

/** (Owner, Oct 28, batch 16 section 12) Find testers shows every match; above this many, the first ones with searchCapLine. */
export const SEARCH_LIMIT = 100;
/** "Showing 100 of 240: type more of the name" (only when a search has more than SEARCH_LIMIT matches). */
export const searchCapLine = (total: number) => `Showing ${SEARCH_LIMIT} of ${total}: type more of the name`;

/**
 * The invite list (owner rule). Greyed with a neutral reason (tick disabled): already in the test, already invited
 * ("Invited Oct 21" · Cancel invite), suspended ("Can't be invited right now"), at 10 tests ("Can't join more tests right
 * now"). Removed silently: blocked either way, deleted accounts (no longer testers); the page's filters remove the rest.
 * (Batch 16 section 12) Every tester on the platform is considered (no newest-500 cap): a lean row each for the ranking; the full rows are built
 * only for what the panel shows.
 */
async function rankedTesters(devId: string, testId: string) {
  const [blocks, inTest, invites, active, past, test, withDev, mine, myTests] = await Promise.all([
    db.block.findMany({ where: { OR: [{ blockerId: devId }, { blockedId: devId }] } }),
    db.contract.findMany({ where: { testId, status: "working" }, select: { testerId: true } }),
    db.invite.findMany({ where: { testId, status: "sent" } }),
    db.contract.groupBy({ by: ["testerId"], where: { status: "working" }, _count: { _all: true } }),
    db.contract.findMany({ where: { testId, status: { in: ["left", "ended"] } }, select: { testerId: true, status: true } }),
    db.test.findUniqueOrThrow({ where: { id: testId } }),
    db.contract.findMany({ where: { test: { developerId: devId } }, select: { testerId: true } }),
    // (The full app's rows) "you rated 5.0/5 · 1 test with you": this developer's own ratings of them, and their tests together.
    db.rating.groupBy({ by: ["rateeId"], where: { raterId: devId, side: "developer" }, _avg: { stars: true } }),
    db.contract.findMany({ where: { test: { developerId: devId } }, select: { testerId: true, joinedAt: true, status: true, endKind: true, test: { select: { id: true, title: true } } }, orderBy: { joinedAt: "desc" } }),
  ]);
  const removed = new Set(blocks.map((b) => (b.blockerId === devId ? b.blockedId : b.blockerId)));
  // Blocked either way and deleted accounts never appear.
  const testers = await db.user.findMany({
    where: { isTester: true, deletedAt: null, id: { notIn: [devId, ...removed] } },
    select: { id: true, name: true, email: true, deletedAt: true, testerSuspendedAt: true, profile: { select: { devices: true, languages: true, categories: true } } },
    orderBy: { createdAt: "desc" }, // ties keep the newest first, as before
  });
  const workedWith = new Set(withDev.map((c) => c.testerId));
  const activeOf = new Map(active.map((a) => [a.testerId, a._count._all]));
  const inviteOf = new Map(invites.map((i) => [i.testerId, i]));
  const inTestSet = new Set(inTest.map((c) => c.testerId));
  const mineOf = new Map(mine.map((m) => [m.rateeId, m._avg.stars ?? null]));
  // (Design doc 6) The algorithm. A tester MEETS the test with one required device and one required language (where any are required).
  // SCORE = (3 x the platform's average + their stars) / (3 + their ratings), so new testers start near the average.
  // INVITABLE = not in the test, not invited, under 10 tests, not suspended; blocked or deleted testers never appear.
  // Worked with: invitable first, then your rating of them, tests together, most recent. Suggested (top 5 of the others, after the
  // device / language ticks): invitable newcomers by meets, score, accepted parts, matches. Find testers: invitable first, then meets and score.
  const [allRatings, sums, accepted] = await Promise.all([
    db.rating.aggregate({ where: { side: "developer", ...revealedRatingsWhere() }, _avg: { stars: true } }),
    db.rating.groupBy({ by: ["rateeId"], where: { side: "developer", ...revealedRatingsWhere() }, _sum: { stars: true }, _count: { _all: true } }),
    db.payment.groupBy({ by: ["testerId"], where: { kind: { not: "subscription" }, status: { in: ["charged", "not_set_up"] } }, _count: { _all: true } }),
  ]);
  const platformAvg = allRatings._avg.stars ?? 3;
  const sumOf = new Map(sums.map((g) => [g.rateeId, g]));
  const acceptedBy = new Map(accepted.map((g) => [g.testerId, g._count._all]));
  const scoreOf = (id: string) => {
    const g = sumOf.get(id);
    return (3 * platformAvg + (g?._sum.stars ?? 0)) / (3 + (g?._count._all ?? 0));
  };
  const matches = (t: (typeof testers)[number]) => (t.profile?.devices ?? []).filter((d) => test.devices.includes(d)).length + (t.profile?.languages ?? []).filter((l) => test.languages.includes(l)).length;
  const lastTogether = new Map<string, number>();
  for (const c of myTests) if (!lastTogether.has(c.testerId)) lastTogether.set(c.testerId, c.joinedAt.getTime());
  const togetherCount = (id: string) => new Set(myTests.filter((c) => c.testerId === id).map((c) => c.test.id)).size;
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const lean = testers.map((t) => {
    const inv = inviteOf.get(t.id);
    const n = activeOf.get(t.id) ?? 0;
    // Greyed rows: already in, invited, or "Can't join this test" (suspended, or in 10 tests).
    const grey = inTestSet.has(t.id) ? "Already in this test" : inv ? `Invited ${fmt(inv.createdAt)}` : t.testerSuspendedAt || n >= MAX_ACTIVE_TESTS ? "Can't join this test" : null;
    const worked = workedWith.has(t.id);
    return {
      t, inv, grey, name: displayName(t), section: worked ? "worked" : "other",
      meets: !needsGap(test, t.profile), score: scoreOf(t.id), accepted: acceptedBy.get(t.id) ?? 0, matches: matches(t),
      mineAvg: mineOf.get(t.id) ?? null, together: worked ? togetherCount(t.id) : 0, last: lastTogether.get(t.id) ?? 0,
    };
  });
  type L = (typeof lean)[number];
  const byGrey = (a: L, b: L) => Number(!!a.grey) - Number(!!b.grey);
  lean.sort((a, b) =>
    byGrey(a, b) ||
    (a.section === "worked" && b.section === "worked" ? (b.mineAvg ?? -1) - (a.mineAvg ?? -1) || b.together - a.together || b.last - a.last
      : Number(b.meets) - Number(a.meets) || b.score - a.score || b.accepted - a.accepted || b.matches - a.matches));
  /** The full rows the panel shows, built only for the rows returned. */
  const full = async (xs: L[]) => {
    const ids = xs.map((x) => x.t.id);
    const grouped = ids.length ? await db.rating.groupBy({ by: ["rateeId"], where: { rateeId: { in: ids }, ...revealedRatingsWhere() }, _avg: { stars: true }, _count: { _all: true } }) : [];
    // (NEWEST+5) "4.6 ★ (12 ratings)" on each invite row.
    const ratingLine = (id: string) => {
      const g = grouped.find((x) => x.rateeId === id);
      return g ? `${(g._avg.stars ?? 0).toFixed(1)} ★ (${g._count._all} rating${g._count._all === 1 ? "" : "s"})` : "";
    };
    // (Owner, Oct 28, batch 20 section 23) Each test with how their part went (their latest session on it): in it now, left, finished (rated) or ended.
    const together = (id: string) => {
      const seen = new Map<string, { title: string; state: string }>();
      for (const c of myTests) if (c.testerId === id && !seen.has(c.test.id)) seen.set(c.test.id, { title: c.test.title, state: togetherState(c) });
      return [...seen].map(([tid, x]) => ({ id: tid, title: x.title, state: x.state }));
    };
    return xs.map((x) => ({
      id: x.t.id, name: x.name, devices: x.t.profile?.devices ?? [], languages: x.t.profile?.languages ?? [], categories: x.t.profile?.categories ?? [],
      invited: !!x.inv, inviteId: x.inv?.id ?? null, grey: x.grey, rating: ratingLine(x.t.id),
      // (NEXT-UI 14) Still tickable: a re-invite is how an ended tester can come back.
      was: ((s) => (s === "left" ? "Left this test" : s === "ended" ? "You ended their work" : ""))(past.find((c) => c.testerId === x.t.id)?.status),
      tag: doesntListTag(test, x.t.profile),
      tagItems: doesntListItems(test, x.t.profile),
      detail: withYouText(x.mineAvg, withDev.filter((c) => c.testerId === x.t.id).length),
      gap: missingNeed(test, x.t.profile),
      section: x.section,
      meets: x.meets, score: x.score, accepted: x.accepted, matches: x.matches,
      together: together(x.t.id), mineAvg: x.mineAvg, last: x.last,
    }));
  };
  return { lean, full };
}

/** (Batch 20 section 23) How a tester's part on one of this developer's tests went: "in it now", "left", "finished" (they rated) or "ended". */
// (Batch 26 section 8) A rating ends the part with status "left" and endKind "rated": that reads "finished", never "left".
export const togetherState = (c: { status: string; endKind?: string | null }) => (c.status === "working" ? "in it now" : c.endKind === "rated" ? "finished" : c.status === "left" ? "left" : "ended");
/** "Worked with you on 2 tests". */
export const workedWithLine = (n: number) => `Worked with you on ${n} test${n === 1 ? "" : "s"}`;

/** Every tester the developer could see in the invite panel for this test, ranked (all of them, with full rows). */
export async function invitable(devId: string, testId: string) {
  const { lean, full } = await rankedTesters(devId, testId);
  return full(lean);
}

export type InviteFilters = { q?: unknown; devices?: unknown; languages?: unknown };
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * (Owner, Oct 28, batch 16 section 12) The invite panel, computed over every tester on the server: People you've worked with (all of them),
 * Suggested (the top 5 after the device / language ticks) and Find testers (name search from 1 character (batch 20 section 9: 1-2 characters match the start of a word or the whole name, 3+ any part), any case; every match, the exact name first,
 * ranked invitable first, then meets and score; above SEARCH_LIMIT the first ones and searchCapLine). Testers already invited are in "Invited".
 */
export async function invitePanel(devId: string, testId: string, filters: InviteFilters = {}) {
  await ownTest(devId, testId);
  const { lean, full } = await rankedTesters(devId, testId);
  const devices = strings(filters.devices), languages = strings(filters.languages);
  const q = typeof filters.q === "string" ? filters.q.trim().toLowerCase() : "";
  const notInvited = lean.filter((x) => !x.inv);
  const passes = (x: (typeof lean)[number]) =>
    (!devices.length || (x.t.profile?.devices ?? []).some((d) => devices.includes(d))) && (!languages.length || (x.t.profile?.languages ?? []).some((l) => languages.includes(l)));
  const worked = notInvited.filter((x) => x.section === "worked");
  const suggested = notInvited.filter((x) => x.section === "other" && !x.grey && passes(x)).slice(0, 5);
  const matches = q.length >= 1 ? exactFirst(notInvited.filter((x) => passes(x) && nameMatches(x.name, q)), q, (x) => [x.name]) : [];
  const [w, s, f] = await Promise.all([full(worked), full(suggested), full(matches.slice(0, SEARCH_LIMIT))]);
  return { worked: w, suggested: s, found: f, foundTotal: matches.length, capLine: matches.length > SEARCH_LIMIT ? searchCapLine(matches.length) : "", searched: q.length >= 1 };
}
export type InvitePanelData = Awaited<ReturnType<typeof invitePanel>>;

/**
 * What the test needs that this tester's profile doesn't list, or "". (Owner, Oct 28, batch 20 section 3) Both kinds, in one: "doesn't list a language this test
 * needs (Chinese or Portuguese) or a device it needs (Windows PC or iPad)" (before, only the languages when both were missing).
 */
function missingNeed(t: { devices: string[]; languages: string[] }, p: { devices: string[]; languages: string[] } | null) {
  return missingNeedText(gapsOf(t, p));
}
/** (Batch 20 section 3) The Invite anyway box's lines (and what `seenGaps` is compared with), one per ticked tester missing something, with what's missing. */
function gapLines(t: { devices: string[]; languages: string[] }, people: { name: string; email: string; profile: { devices: string[]; languages: string[] } | null }[]) {
  const items: GapItem[] = people.filter((p) => missingNeed(t, p.profile)).map((p) => ({ name: displayName(p), ...gapsOf(t, p.profile) }));
  return { lines: items.map((i) => missingNeedLine(i.name, i)), items };
}

/** What the test needs that this tester's profile no longer has (they list none of a kind it needs): "a language this test needs (English)". */
function removedNeeds(t: { devices: string[]; languages: string[] }, p: { devices: string[]; languages: string[] } | null) {
  if (!needsGap(t, p)) return "";
  return missingNeedText(gapsOf(t, p)).replace(/^doesn't list /, "");
}

type Needs = { devices: string[]; languages: string[] };
const listOf = (xs: string[]) => (xs.length ? xs.join(", ") : "none");
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
const needsOf = (v: unknown): Needs | null => {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  const arr = (x: unknown) => (Array.isArray(x) ? x.map(String) : null);
  const devices = arr(o?.devices), languages = arr(o?.languages);
  return devices && languages ? { devices, languages } : null;
};
/** (Owner, Oct 28, batch 16 section 31) "The test's requirements changed: Devices: Windows PC → iPad · Languages: Russian, Turkish → English" ("" when the same). */
export function requirementsChangedLine(seen: Needs, now: Needs) {
  const parts = [
    ...(same(seen.devices, now.devices) ? [] : [`Devices: ${listOf(seen.devices)} → ${listOf(now.devices)}`]),
    ...(same(seen.languages, now.languages) ? [] : [`Languages: ${listOf(seen.languages)} → ${listOf(now.languages)}`]),
  ];
  return parts.length ? `The test's requirements changed: ${parts.join(" · ")}` : "";
}
/**
 * (Batch 16 section 31) A ticked tester's devices or languages changed since the panel showed them. (Owner, Oct 28, batch 20 section 4) Only what THIS test requires
 * counts (anything else added or removed never stops Invite and isn't named), as ONE line per tester: the net change since the page loaded, naming only the
 * required items. "fbbb now lists Chinese and Windows PC, which this test needs." / "fbbb no longer lists Chinese, which this test needs." / both: "fbbb now lists
 * Windows PC but no longer lists Chinese (this test needs Chinese or Portuguese)." Edits that cancel out (added, then removed again) give no line.
 */
export function testerNeedsChangedLines(name: string, seen: Needs, now: Needs, test: Needs) {
  const required = [...test.languages, ...test.devices];
  const had = new Set([...seen.languages, ...seen.devices]), has = new Set([...now.languages, ...now.devices]);
  const added = required.filter((x) => has.has(x) && !had.has(x));
  const removed = required.filter((x) => had.has(x) && !has.has(x));
  if (!added.length && !removed.length) return [];
  if (!removed.length) return [`${name} now lists ${andList(added)}, which this test needs.`];
  if (!added.length) return [`${name} no longer lists ${andList(removed)}, which this test needs.`];
  // Both: what the test needs, for each kind something was removed from.
  const needs = [
    ...(removed.some((x) => test.languages.includes(x)) ? [orList(test.languages)] : []),
    ...(removed.some((x) => test.devices.includes(x)) ? [orList(test.devices)] : []),
  ];
  return [`${name} now lists ${andList(added)} but no longer lists ${andList(removed)} (this test needs ${needs.join(", and ")}).`];
}

/**
 * Invite ticked testers. Refused for good when the test is full, stopped, past Open until or paused. Stops once for the
 * developer stop-once reasons plus: a ticked tester's profile no longer fits, a ticked tester joined, or was already
 * invited in another tab. Then invites those who can be invited and names the others with reasons.
 */
export async function inviteTesters(dev: U & { holdStartedAt?: Date | null }, testId: string, body: Record<string, unknown>) {
  await ownTest(dev.id, testId);
  // (Batch 8) Inviting testers is a subscriber perk (invites already sent stay valid when the subscription ends).
  await (await import("./subscription")).requirePerk(dev.id, "invite");
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
    // (Owner, Oct 28, batch 16 section 31) What the panel showed: the test's requirements and each ticked tester's devices and languages. A change since then always
    // stops Invite / Invite anyway once (they're Invite's own checks, not Alerts types); the page shows the updated panel with it.
    const seenNeeds = needsOf(body.seenNeeds);
    const seenTesters = body.seenTesters && typeof body.seenTesters === "object" ? (body.seenTesters as Record<string, unknown>) : null;
    if (seenNeeds) {
      const line = requirementsChangedLine(seenNeeds, t);
      if (line) {
        const ed = await tx.testEvent.findFirst({ where: { testId, kind: { in: ["edited", "info"] } }, orderBy: { createdAt: "desc" } });
        extra.push({ kind: "profile", text: line, createdAt: ed?.createdAt ?? new Date() });
      }
    }
    if (!isNaN(seenAt.getTime())) {
      for (const p of people) {
        const name = displayName(p);
        const seenP = seenTesters ? needsOf(seenTesters[p.id]) : null;
        // (Batch 20 section 4) One line per tester (`key`: a later stop's line replaces it in the box), with one time: the latest change.
        if (seenP) {
          for (const line of testerNeedsChangedLines(name, seenP, { devices: p.profile?.devices ?? [], languages: p.profile?.languages ?? [] }, t)) extra.push({ kind: "profile", text: line, createdAt: p.profile?.updatedAt ?? new Date(), key: `needs:${p.id}` });
        } else {
          const gone = removedNeeds(t, p.profile);
          if (gone && p.profile && p.profile.updatedAt > seenAt) extra.push({ kind: "profile", text: `${name} no longer lists ${gone}.`, createdAt: p.profile.updatedAt, key: `needs:${p.id}` });
        }
        const joined = contracts.find((c) => c.testerId === p.id && c.joinedAt > seenAt);
        if (joined) extra.push({ kind: "joined", text: `${name} joined this test, so ${pronouns(p.pronoun).subj}'s no longer in your invite list`.replace("they's", "they're"), createdAt: joined.joinedAt });
        // A ticked tester became greyed or removed since the page loaded.
        if (p.testerSuspendedAt && p.testerSuspendedAt > seenAt) extra.push({ kind: "joined", text: `${name} can't be invited right now`, createdAt: p.testerSuspendedAt });
        const blockedSince = await tx.block.findFirst({ where: { createdAt: { gt: seenAt }, OR: [{ blockerId: dev.id, blockedId: p.id }, { blockerId: p.id, blockedId: dev.id }] } });
        if (blockedSince) extra.push({ kind: "joined", text: `${name} is no longer in your list`, createdAt: blockedSince.createdAt });
        const lastJoin = await tx.contract.findFirst({ where: { testerId: p.id, status: "working", joinedAt: { gt: seenAt } }, orderBy: { joinedAt: "desc" } });
        if (lastJoin && lastJoin.testId !== testId && (await tx.contract.count({ where: { testerId: p.id, status: "working" } })) >= MAX_ACTIVE_TESTS) extra.push({ kind: "joined", text: `${name} can't join more tests right now`, createdAt: lastJoin.joinedAt });
      }
    }
    // (Batch 16 section 21) An invite (or a cancelled invite) for the same tester from another tab stops it once.
    await devGate(tx, testId, body, {}, extra, undefined, { acts: INVITE_ACTS, keys: ids.map((id) => `t:${id}`) });
    const { lines: gaps, items: gapItems } = gapLines(t, people.filter((p) => !contracts.some((c) => c.testerId === p.id)));
    const seenGaps = Array.isArray(body.seenGaps) ? (body.seenGaps as unknown[]).map(String) : null;
    if (body.anyway === true && !gaps.length) {
      // Everyone ticked now meets the needs: nothing is sent; the box closes and a notice shows under Invite.
      throw new HttpError(409, "needs_none", "Everyone you ticked now meets this test's needs. Press Invite to send.");
    }
    if (gaps.length && body.anyway !== true) throw new HttpError(409, "needs_confirm", "CONFIRM:" + gaps.join("\n"), { lines: gaps, items: gapItems });
    if (gaps.length && JSON.stringify(seenGaps) !== JSON.stringify(gaps)) {
      // What's missing changed since the box showed: stop once in the box with the updated list.
      throw new HttpError(409, "needs_confirm", "CONFIRM:" + ["What's missing changed since you looked. Press Invite anyway again to invite on this:", ...gaps].join("\n"), { lines: gaps, items: gapItems, changed: true });
    }
    const invited: { id: string; name: string; email: string }[] = [];
    const others: string[] = [];
    for (const p of people) {
      const name = displayName(p);
      if (contracts.some((c) => c.testerId === p.id && c.status === "working")) continue; // joined: no longer in the list
      if (invites.some((i) => i.testerId === p.id && i.status === "sent")) continue; // already invited
      const active = await tx.contract.count({ where: { testerId: p.id, status: "working" } });
      const blocked = (await tx.block.count({ where: { OR: [{ blockerId: dev.id, blockedId: p.id }, { blockerId: p.id, blockedId: dev.id }] } })) > 0;
      const why = inviteTesterRefusal(name, { suspended: !!p.testerSuspendedAt, blocked, deleted: !p.isTester, activeTests: active });
      if (why) {
        others.push(why);
        continue;
      }
      // (Correction 5) Invites never hold spots: any number can be open; the first to join gets a spot.
      await tx.invite.create({ data: { testId, testerId: p.id } });
      await stampCounting(testId, tx); // (batch 14) the 3-change count starts with the first invite
      invited.push({ id: p.id, name, email: p.email });
    }
    if (invited.length) await recordEvent(tx, testId, "invited", `You invited ${andList(invited.map((i) => i.name))}`, false);
    return { t, invited, others };
  });
  // (Design doc 6) An invite plus a pending application or rejoin ask joins the tester at once.
  const matched: string[] = [];
  for (const i of result.invited) if (await (await import("./joining")).matchInviteAndAsk(testId, i.id)) matched.push(i.id);
  for (const i of result.invited.filter((x) => !matched.includes(x.id))) {
    await notify(i.email, `${displayName(dev)} invited you to “${result.t.title}”`, [`${displayName(dev)} invited you to test “${result.t.title}”.`, `What you get: ${termsLine(asListing(result.t), true)}.`, "Open it and press Join to join on these terms."], `/app/find/${testId}`);
  }
  const msg = [result.invited.length ? `Invited ${andList(result.invited.map((i) => i.name))}.` : "", ...result.others].filter(Boolean).join(" ") || "Everyone you ticked was already invited or joined.";
  return { message: msg, invited: result.invited.map((i) => i.id), joined: matched };
}

export async function cancelInvite(dev: U, testId: string, body: Record<string, unknown>) {
  await ownTest(dev.id, testId);
  const inv = await db.invite.findUnique({ where: { id: String(body.inviteId ?? "") }, include: { test: true } });
  if (!inv || inv.testId !== testId) throw new HttpError(404, "not_found", "That invite doesn't exist.");
  // (Batch 16 section 21) Cancelled in another tab: this press stops once naming it, then it's already done.
  if (inv.status !== "sent") await devGateIfSeen(testId, body, { acts: INVITE_ACTS, keys: [`t:${inv.testerId}`] });
  if (inv.status !== "sent") throw new HttpError(409, "gone", inv.status === "joined" ? "They already joined." : inv.status === "replaced" ? "This invite is no longer valid: it was re-sent on the new listing." : "This invite was already cancelled.");
  await devGateIfSeen(testId, body, { acts: INVITE_ACTS, keys: [`t:${inv.testerId}`] });
  await db.invite.update({ where: { id: inv.id }, data: { status: "cancelled" } });
  await tellInvitesClosed([inv.id]); // (batch 30 §6)
  return { ok: true };
}

/** An invite is live while the test can still take this tester. */
/** An invite is live while the test takes testers (a full test keeps its invites open: correction 6). */
export const inviteExpired = (t: { status: string; openUntil: Date | null }, now = new Date()) => t.status !== "open" || (!!t.openUntil && t.openUntil < now);

/** For the live Invite anyway box: what each ticked tester still misses right now. */
export async function inviteGaps(devId: string, testId: string, testerIds: string[]) {
  const t = await ownTest(devId, testId);
  const people = await db.user.findMany({ where: { id: { in: testerIds } }, include: { profile: true } });
  return { now: new Date().toISOString(), ...gapLines(t, people) };
}

/**
 * (Owner, NEWEST+4) A saved listing change (anything except spots / who can join) closes every open invite and sends
 * a NEW invite on the new listing to the same testers (bell + email; the 3-day reminder clock restarts). Testers who
 * can't be invited any more are not re-invited and are named for the Save result.
 */
/** (Batch 14 section 3) "<dev> updated <test>: your invite was sent again on the new listing." */
export const reinvitedLine = (dev: string, test: string) => `${dev} updated “${test}”: your invite was sent again on the new listing.`; // (batch 15 section 32) quoted

/** (Batch 16 section 32) "Your invite to “Harbor Run” was closed." (never why). */
export const inviteClosedLine = (test: string) => `Your invite to “${test}” was closed.`;
/**
 * (Batch 30 §6, per batch 29 §23) The live box's "Your invite to “<test>” was closed." is a bell line too, in "Applications and invites" (stacked across tests), for every
 * invite closed without its own line: the developer's Cancel invite, a stop or close, a pause (any cause, never why), a block, a deleted developer. (Open until passing
 * has its own "“<test>” closed to new testers on <date>."; a re-sent invite its "…was sent again" line.) Pass the ids of the invites just closed.
 */
export async function tellInvitesClosed(inviteIds: string[]) {
  if (!inviteIds.length) return;
  const list = await db.invite.findMany({ where: { id: { in: inviteIds }, status: "cancelled" }, include: { test: { select: { title: true } } } });
  const people = new Map((await db.user.findMany({ where: { id: { in: list.map((i) => i.testerId) }, deletedAt: null }, select: { id: true, email: true } })).map((u) => [u.id, u.email]));
  for (const i of list) {
    const to = people.get(i.testerId);
    if (!to) continue;
    const line = inviteClosedLine(i.test.title);
    await notify(to, line, [line], `/app/find/${i.testId}`, { group: "apps", testId: i.testId });
  }
}
/** The open invites a closing is about to cancel (for tellInvitesClosed after it). */
export const openInviteIds = async (where: Prisma.InviteWhereInput, tx: Prisma.TransactionClient | typeof db = db) => (await tx.invite.findMany({ where: { ...where, status: "sent" }, select: { id: true } })).map((i) => i.id);

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
    if (p.testerSuspendedAt || blocked) { skipped.push(`${name} (can't be invited right now)`); continue; }
    if (active >= MAX_ACTIVE_TESTS) { skipped.push(`${name} (in ${MAX_ACTIVE_TESTS} tests)`); continue; }
    await db.invite.create({ data: { testId, testerId: p.id } });
    resent.push(name);
    // (Owner, Oct 29, batch 14 section 3) Stacked across tests, one entry per day.
    const line = reinvitedLine(displayName(t.developer), t.title);
    await notify(p.email, line, [line, `The new listing: ${termsLine(asListing(t), true)}.`, "Open it and press Join to join on these terms."], `/app/find/${testId}`, { group: "apps", testId }); // (batch 29 §23) in "Applications and invites", no longer its own stack
  }
  return { skipped, resent };
}
