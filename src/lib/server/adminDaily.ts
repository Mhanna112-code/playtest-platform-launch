import { db } from "@/lib/db";
import { displayName, fmtDateTime } from "@/lib/format";
import { pauseCountdownLine, pauseClosesAt } from "@/lib/pause";
import { appUrl } from "./auth";
import { chargebackHolds } from "./chargeback";
import { sendEmail } from "./email";
import { adminUsers } from "./notify";
import { adminPage } from "./adminLists";
import { labelled, reportedOver3 } from "./reports";

// (Owner, Oct 27) ONE daily email per admin that can't be turned off, sent only when it has something in it. It goes to the admin's own account email and lists:
//   - new disputes since the last email, and hold lifts waiting for an Approve (the 4th hold onward);
//   - chargeback holds waiting for the admin's Approve, and call (no-show / late) reports not yet sent, once;
//   - the accounts THIS admin suspended that are still suspended, each with its paused tests;
//   - the tests THIS admin paused that are still paused, each with its closing date.
// A paused test drops off once it closes (7 days, or later if an admin extended it) or resumes; a suspended account drops off once none of its tests is still paused.
// It replaces the old env-list daily (new disputes and chargebacks; a chargeback now emails at once) and the 3-day digest (failed payments, holds and payouts need no
// action from the team: the admin page still shows them).

const DAY = 86_400_000;

export async function adminDailyEmails(now = new Date()) {
  const admins = await adminUsers();
  if (!admins.length) return 0;
  let sent = 0;
  const url = (p: string) => `${appUrl()}${p}`;
  // What is the same for every admin is worked out once.
  const noShows = await db.call.findMany({ where: { noShowBy: { not: null }, noShowDigestedAt: null }, include: { contract: true }, take: 200 });
  const openDisputes = await db.dispute.findMany({ where: { status: "open", createdAt: { gt: new Date(now.getTime() - 2 * DAY) } }, orderBy: { createdAt: "desc" }, take: 100 });
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
  for (const c of noShows) shared.push(`Call report on “${c.contract.title}” by the ${c.noShowBy}: “${c.noShowNote}” ${url("/admin#no-shows")}`);

  for (const a of admins) {
    const key = `adminDaily:${a.id}`;
    const state = await db.appState.findUnique({ where: { key } });
    const since = state ? new Date(state.value) : new Date(now.getTime() - DAY);
    const items: string[] = [...openDisputes.filter((d) => d.createdAt > since).map(disputeLine), ...shared];

    // The accounts THIS admin suspended that still have paused tests.
    for (const u of await db.user.findMany({ where: { suspendedById: a.id, suspendedAt: { not: null }, deletedAt: null } })) {
      const tests = await db.test.findMany({ where: { developerId: u.id, status: { in: ["open", "closed"] } }, include: { developer: true } });
      const paused = tests.map((t) => ({ t, info: pauseClosesAt(t.developer, t) })).filter((x) => x.info);
      if (!paused.length) continue;
      items.push(`You suspended ${displayName(u)} (${u.email}) on ${fmtDateTime(u.suspendedAt!)}: ${url(`/app/${u.isDeveloper ? "developers" : "testers"}/${u.id}`)}`);
      for (const { t, info } of paused) items.push(`   paused test “${t.title}”: ${pauseCountdownLine(info!.at, info!.causes)} (${fmtDateTime(info!.at)}) ${url(`/app/find/${t.id}`)}`);
    }
    // The tests THIS admin paused that are still paused.
    for (const t of await db.test.findMany({ where: { adminPausedById: a.id, adminPausedAt: { not: null }, status: { in: ["open", "closed"] } }, include: { developer: true } })) {
      const info = pauseClosesAt(t.developer, t);
      if (info) items.push(`You paused “${t.title}” on ${fmtDateTime(t.adminPausedAt!)}: ${pauseCountdownLine(info.at, info.causes)} (${fmtDateTime(info.at)}) ${url(`/app/find/${t.id}`)}`);
    }
    if (items.length) {
      try {
        await sendEmail({ to: a.email, subject: `Playtest admin: ${items.length} item${items.length === 1 ? "" : "s"} for the team`, text: [...items.map((i) => (i.startsWith("   ") ? i : `• ${i}`)), "", "Playtest"].join("\n") });
        sent++;
      } catch (e) {
        console.error("[email] admin daily:", (e as Error).message);
      }
    }
    await db.appState.upsert({ where: { key }, update: { value: now.toISOString() }, create: { key, value: now.toISOString() } });
  }
  if (noShows.length) await db.call.updateMany({ where: { id: { in: noShows.map((c) => c.id) } }, data: { noShowDigestedAt: now } });
  return sent;
}
