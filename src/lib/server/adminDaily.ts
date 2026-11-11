import { db } from "@/lib/db";
import { displayName } from "@/lib/format";
import { T, renderTimes } from "@/lib/tz";
const fmtDateTime = (d: Date) => T(d); // (batch 15 section 11) written in each admin's own zone when the email goes
import { pauseCountdownLine, pauseClosesAt } from "@/lib/pause";
import { appUrl } from "./auth";
import { chargebackHolds } from "./chargeback";
import { adminPage } from "./adminLists";
import { labelled, reportedOver3 } from "./reports";

// (Owner, Oct 27) ONE daily email per admin (§306: now its "For the team" section) (batch 29 §34: following their own email setting), sent only when it has something in it. It goes to the admin's own account email and lists:
//   - new disputes since the last email, and hold lifts waiting for an Approve (the 4th hold onward);
//   - chargeback holds waiting for the admin's Approve, and call (no-show / late) reports not yet sent, once;
//   - the accounts THIS admin suspended that are still suspended, each with its paused tests;
//   - the tests THIS admin paused that are still paused, each with its closing date.
// A paused test drops off once it closes (7 days, or later if an admin extended it) or resumes; a suspended account drops off once none of its tests is still paused.
// It replaces the old env-list daily (new disputes and chargebacks; a chargeback now emails at once) and the 3-day digest (failed payments, holds and payouts need no
// action from the team: the admin page still shows them).
// (Owner, Oct 29, batch 29 §34) It follows each admin's OWN email setting: Daily, Weekly or Monthly (listing everything new since that admin's last one), or none with Off.
// The console and the bell show all of it anyway. "Playtest: new chargeback of $X" is unchanged: sent right away to every admin, whatever their setting.
// (Owner, Nov 6, §306) It is no longer an email of its own: these lines are the "For the team" section of the admin's ONE morning email (sendSummaries,
// notify.ts), under the admin's own updates. This file builds the section (teamSections) and records it as sent (teamSent). The email follows the admin's own
// setting exactly as the admin email did: Daily / Weekly / Monthly when that summary is due (everything since this admin's last section), none with Off.

const DAY = 86_400_000;

/** (Owner, Nov 6, §306) The admin's morning email's section holding the team's items. */
export const TEAM_HEADING = "For the team";
/**
 * (§306) One admin's "For the team" lines (a "   " line sits under the line above it), and which disputes and hold lifts they hold: those disputes' and lifts'
 * bell lines ("Disputes · N new", "Hold lifts waiting") are left out of the same email's own updates (they stay in the bell).
 */
export type TeamSection = { items: string[]; disputeIds: Set<string>; liftIds: Set<string>; noShowIds: string[] };
export const teamKey = (adminId: string) => `adminDaily:${adminId}`;

/** (§306) The "For the team" section of each of these admins (the caller asks only for admins whose email is due); empty `items` when there is nothing. */
export async function teamSections(adminIds: string[], now = new Date()) {
  const out = new Map<string, TeamSection>();
  if (!adminIds.length) return out;
  const url = (p: string) => `${appUrl()}${p}`;
  // What is the same for every admin is worked out once.
  // (Batch 29 §34) Reports and disputes since each admin's own last email (a Monthly one reaches back up to ~a month).
  const noShows = await db.call.findMany({ where: { noShowBy: { not: null }, noShowAt: { gt: new Date(now.getTime() - 32 * DAY) } }, include: { contract: { include: { test: { select: { title: true } } } } }, orderBy: { noShowAt: "asc" }, take: 200 });
  const openDisputes = await db.dispute.findMany({ where: { status: "open", createdAt: { gt: new Date(now.getTime() - 32 * DAY) } }, orderBy: { createdAt: "desc" }, take: 100 });
  const cs = new Map((await db.contract.findMany({ where: { id: { in: openDisputes.map((d) => d.contractId) } }, include: { tester: true, test: { include: { developer: true } } } })).map((c) => [c.id, c]));
  const flagged = await reportedOver3([...cs.values()].flatMap((c) => [c.testerId, c.test.developerId]));
  const disputeLine = (d: (typeof openDisputes)[number]) => {
    const c = cs.get(d.contractId);
    return `New dispute: ${c ? `${labelled(displayName(c.tester), flagged.has(c.testerId))} vs ${labelled(displayName(c.test.developer), flagged.has(c.test.developerId))} on “${c.test.title}”` : ""}: “${d.reason}” ${url(`/admin?dispute=${d.id}#dispute-${d.id}`)}`;
  };
  const shared: string[] = [];
  const lifts = (await adminPage("lifts", adminIds[0], null)) as { rows: { id: string; head: string; owed: string; paid: string }[] };
  for (const l of lifts.rows) shared.push(`Hold lift waiting for your Approve: ${l.head} · ${l.owed} · ${l.paid} ${url(`/admin#lift-${l.id}`)}`);
  for (const c of await chargebackHolds()) if (c.steps.cardVerified && c.steps.owedPaid && !c.steps.approved) shared.push(`Chargeback hold waiting for your Approve: ${c.dev.email} ${url("/admin#chargebacks")}`);
  const noShowLine = (c: (typeof noShows)[number]) => `Call report on “${c.contract.test.title}” by the ${c.noShowBy}: “${c.noShowNote}” ${url("/admin#no-shows")}`;

  // (Batch 10) The per-admin lists are read in a few queries for all admins at once (the daily job's run time no longer grows with each admin's own queries).
  const ids = adminIds;
  const states = new Map((await db.appState.findMany({ where: { key: { in: ids.map(teamKey) } } })).map((x) => [x.key, x.value]));
  // (Batch 15 section 16) The developer side is the one with paused tests.
  const suspended = await db.user.findMany({ where: { devSuspendedById: { in: ids }, devSuspendedAt: { not: null }, deletedAt: null } });
  const suspendedTests = await db.test.findMany({ where: { developerId: { in: suspended.map((u) => u.id) }, status: { in: ["open", "closed"] } }, include: { developer: true } });
  const pausedByAdmins = await db.test.findMany({ where: { adminPausedById: { in: ids }, adminPausedAt: { not: null }, status: { in: ["open", "closed"] } }, include: { developer: true } });

  for (const id of ids) {
    const state = states.get(teamKey(id));
    const since = state ? new Date(state) : new Date(now.getTime() - DAY);
    const disputes = openDisputes.filter((d) => d.createdAt > since);
    const reports = noShows.filter((c) => (c.noShowAt ?? now) > since);
    const items: string[] = [...disputes.map(disputeLine), ...shared, ...reports.map(noShowLine)];

    // The accounts THIS admin suspended that still have paused tests.
    for (const u of suspended.filter((x) => x.devSuspendedById === id)) {
      const tests = suspendedTests.filter((t) => t.developerId === u.id);
      const paused = tests.map((t) => ({ t, info: pauseClosesAt(t.developer, t) })).filter((x) => x.info);
      if (!paused.length) continue;
      items.push(`You suspended ${displayName(u)} (${u.email}) (developer side) on ${fmtDateTime(u.devSuspendedAt!)}: ${url(`/app/developers/${u.id}`)}`);
      for (const { t, info } of paused) items.push(`   paused test “${t.title}”: ${pauseCountdownLine(info!.at, info!.causes)} (${fmtDateTime(info!.at)}) ${url(`/app/find/${t.id}`)}`);
    }
    // The tests THIS admin paused that are still paused.
    for (const t of pausedByAdmins.filter((x) => x.adminPausedById === id)) {
      const info = pauseClosesAt(t.developer, t);
      if (info) items.push(`You paused “${t.title}” on ${fmtDateTime(t.adminPausedAt!)}: ${pauseCountdownLine(info.at, info.causes)} (${fmtDateTime(info.at)}) ${url(`/app/find/${t.id}`)}`);
    }
    out.set(id, { items, disputeIds: new Set(disputes.map((d) => d.id)), liftIds: new Set(lifts.rows.map((l) => l.id)), noShowIds: reports.map((c) => c.id) });
  }
  return out;
}

/** (§306) The section's lines in the email, in the admin's zone: "• line", a "   " line under the one above it. */
export const teamLines = (s: TeamSection, timeZone?: string | null) => s.items.map((i) => renderTimes(i.startsWith("   ") ? i : `• ${i}`, timeZone));
/** (§306) "N items for the team": the section's own lines (a paused test listed under its account is part of that line). */
export const teamCount = (s: TeamSection) => s.items.filter((i) => !i.startsWith("   ")).length;

/** (§306) The section was emailed (or, due with nothing in it, looked at): the next one lists what is new since now; its call reports are marked as sent. */
export async function teamSent(adminIds: string[], noShowIds: string[], now = new Date()) {
  if (adminIds.length) await db.$transaction(adminIds.map((id) => db.appState.upsert({ where: { key: teamKey(id) }, update: { value: now.toISOString() }, create: { key: teamKey(id), value: now.toISOString() } })));
  if (noShowIds.length) await db.call.updateMany({ where: { id: { in: noShowIds } }, data: { noShowDigestedAt: now } });
}
