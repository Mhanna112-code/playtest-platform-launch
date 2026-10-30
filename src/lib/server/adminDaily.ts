import { db } from "@/lib/db";
import { displayName } from "@/lib/format";
import { T, renderTimes } from "@/lib/tz";
const fmtDateTime = (d: Date) => T(d); // (batch 15 section 11) written in each admin's own zone when the email goes
import { pauseCountdownLine, pauseClosesAt } from "@/lib/pause";
import { appUrl } from "./auth";
import { chargebackHolds } from "./chargeback";
import { sendEmail } from "./email";
import { adminUsers } from "./notify";
import { summaryDue } from "@/lib/rules";
import { adminPage } from "./adminLists";
import { labelled, reportedOver3 } from "./reports";

// (Owner, Oct 27) ONE daily email per admin (batch 29 §34: following their own email setting), sent only when it has something in it. It goes to the admin's own account email and lists:
//   - new disputes since the last email, and hold lifts waiting for an Approve (the 4th hold onward);
//   - chargeback holds waiting for the admin's Approve, and call (no-show / late) reports not yet sent, once;
//   - the accounts THIS admin suspended that are still suspended, each with its paused tests;
//   - the tests THIS admin paused that are still paused, each with its closing date.
// A paused test drops off once it closes (7 days, or later if an admin extended it) or resumes; a suspended account drops off once none of its tests is still paused.
// It replaces the old env-list daily (new disputes and chargebacks; a chargeback now emails at once) and the 3-day digest (failed payments, holds and payouts need no
// action from the team: the admin page still shows them).
// (Owner, Oct 29, batch 29 §34) It follows each admin's OWN email setting: Daily, Weekly or Monthly (listing everything new since that admin's last one), or none with Off.
// The console and the bell show all of it anyway. "Playtest: new chargeback of $X" is unchanged: sent right away to every admin, whatever their setting.

const DAY = 86_400_000;

export async function adminDailyEmails(now = new Date()) {
  const admins = await adminUsers();
  if (!admins.length) return 0;
  let sent = 0;
  const url = (p: string) => `${appUrl()}${p}`;
  // What is the same for every admin is worked out once.
  // (Batch 29 §34) Reports and disputes since each admin's own last email (a Monthly one reaches back up to ~a month).
  const noShows = await db.call.findMany({ where: { noShowBy: { not: null }, noShowAt: { gt: new Date(now.getTime() - 32 * DAY) } }, include: { contract: true }, orderBy: { noShowAt: "asc" }, take: 200 });
  const openDisputes = await db.dispute.findMany({ where: { status: "open", createdAt: { gt: new Date(now.getTime() - 32 * DAY) } }, orderBy: { createdAt: "desc" }, take: 100 });
  const cs = new Map((await db.contract.findMany({ where: { id: { in: openDisputes.map((d) => d.contractId) } }, include: { tester: true, test: { include: { developer: true } } } })).map((c) => [c.id, c]));
  const flagged = await reportedOver3([...cs.values()].flatMap((c) => [c.testerId, c.test.developerId]));
  const disputeLine = (d: (typeof openDisputes)[number]) => {
    const c = cs.get(d.contractId);
    return `New dispute: ${c ? `${labelled(displayName(c.tester), flagged.has(c.testerId))} vs ${labelled(displayName(c.test.developer), flagged.has(c.test.developerId))} on “${c.title}”` : ""}: “${d.reason}” ${url(`/admin?dispute=${d.id}#dispute-${d.id}`)}`;
  };
  const shared: string[] = [];
  const lifts = (await adminPage("lifts", admins[0].id, null)) as { rows: { id: string; head: string; owed: string; paid: string }[] };
  for (const l of lifts.rows) shared.push(`Hold lift waiting for your Approve: ${l.head} · ${l.owed} · ${l.paid} ${url(`/admin#lift-${l.id}`)}`);
  for (const c of await chargebackHolds()) if (c.steps.cardVerified && c.steps.owedPaid && !c.steps.approved) shared.push(`Chargeback hold waiting for your Approve: ${c.dev.email} ${url("/admin#chargebacks")}`);
  const noShowLine = (c: (typeof noShows)[number]) => `Call report on “${c.contract.title}” by the ${c.noShowBy}: “${c.noShowNote}” ${url("/admin#no-shows")}`;

  // (Batch 10) The per-admin lists are read in a few queries for all admins at once (the daily job's run time no longer grows with each admin's own queries).
  const ids = admins.map((a) => a.id);
  const states = new Map((await db.appState.findMany({ where: { key: { in: ids.map((id) => `adminDaily:${id}`) } } })).map((x) => [x.key, x.value]));
  // (Batch 15 section 16) The developer side is the one with paused tests.
  const suspended = await db.user.findMany({ where: { devSuspendedById: { in: ids }, devSuspendedAt: { not: null }, deletedAt: null } });
  const suspendedTests = await db.test.findMany({ where: { developerId: { in: suspended.map((u) => u.id) }, status: { in: ["open", "closed"] } }, include: { developer: true } });
  const pausedByAdmins = await db.test.findMany({ where: { adminPausedById: { in: ids }, adminPausedAt: { not: null }, status: { in: ["open", "closed"] } }, include: { developer: true } });
  const done: string[] = [];
  const prefs = new Map((await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, emailPref: true } })).map((u) => [u.id, u.emailPref]));

  for (const a of admins) {
    const key = `adminDaily:${a.id}`;
    const state = states.get(key);
    // (Batch 29 §34) Off: no summary. Weekly / Monthly: only when due (since this admin's last one).
    const pref = prefs.get(a.id) ?? "daily";
    if (!summaryDue(pref, state ? new Date(state) : null, now)) continue;
    const since = state ? new Date(state) : new Date(now.getTime() - DAY);
    const items: string[] = [...openDisputes.filter((d) => d.createdAt > since).map(disputeLine), ...shared, ...noShows.filter((c) => (c.noShowAt ?? now) > since).map(noShowLine)];

    // The accounts THIS admin suspended that still have paused tests.
    for (const u of suspended.filter((x) => x.devSuspendedById === a.id)) {
      const tests = suspendedTests.filter((t) => t.developerId === u.id);
      const paused = tests.map((t) => ({ t, info: pauseClosesAt(t.developer, t) })).filter((x) => x.info);
      if (!paused.length) continue;
      items.push(`You suspended ${displayName(u)} (${u.email}) (developer side) on ${fmtDateTime(u.devSuspendedAt!)}: ${url(`/app/developers/${u.id}`)}`);
      for (const { t, info } of paused) items.push(`   paused test “${t.title}”: ${pauseCountdownLine(info!.at, info!.causes)} (${fmtDateTime(info!.at)}) ${url(`/app/find/${t.id}`)}`);
    }
    // The tests THIS admin paused that are still paused.
    for (const t of pausedByAdmins.filter((x) => x.adminPausedById === a.id)) {
      const info = pauseClosesAt(t.developer, t);
      if (info) items.push(`You paused “${t.title}” on ${fmtDateTime(t.adminPausedAt!)}: ${pauseCountdownLine(info.at, info.causes)} (${fmtDateTime(info.at)}) ${url(`/app/find/${t.id}`)}`);
    }
    if (items.length) {
      try {
        const tz = (await db.user.findUnique({ where: { id: a.id }, select: { timeZone: true } }))?.timeZone;
        await sendEmail({ to: a.email, subject: `Playtest admin: ${items.length} item${items.length === 1 ? "" : "s"} for the team`, text: renderTimes([...items.map((i) => (i.startsWith("   ") ? i : `• ${i}`)), "", "Playtest"].join("\n"), tz), button: { label: "Open the admin console", url: url("/admin") } });
        sent++;
      } catch (e) {
        console.error("[email] admin daily:", (e as Error).message);
      }
    }
    done.push(key);
  }
  await db.$transaction(done.map((key) => db.appState.upsert({ where: { key }, update: { value: now.toISOString() }, create: { key, value: now.toISOString() } })));
  if (noShows.length) await db.call.updateMany({ where: { id: { in: noShows.map((c) => c.id) } }, data: { noShowDigestedAt: now } });
  return sent;
}
