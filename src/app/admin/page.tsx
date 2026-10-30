import { notFound } from "next/navigation";
import { Brand } from "@/components/Brand";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { requirePageUser } from "@/lib/server/page-auth";
import { ADMIN_PAUSED, adminAccount, isAdmin } from "@/lib/server/session";
import { AdminButton } from "./AdminButton";
import { PagedList } from "./PagedList";
import { configProblems, seesConfigBox } from "@/lib/server/config";
import { adminOutages, gapLine, lengthText, outageLine } from "@/lib/server/outages";
import { T, renderTimes } from "@/lib/tz";
import { emailHealth, emailsDownLine } from "@/lib/server/email";
import { storageAlerts } from "@/lib/server/storageAlerts";
import { adminPage, disputeRow, type DisputeVM, type Page } from "@/lib/server/adminLists";
import { person, whoById } from "@/lib/server/adminLinks";
import { adminConsoleV } from "@/lib/server/pulseV";
import { AdminRich } from "./AdminRich";
import { AutoRefresh } from "@/components/AutoRefresh";
import { HashJump } from "@/components/HashJump";

export const metadata = { title: "Admin · Playtest" };
export const dynamic = "force-dynamic";

const rows = <T,>(p: Page<unknown>) => p as unknown as Page<T>;

/**
 * (Owner, Oct 30, batch 33 §6) The admin console shows ONLY these, in this order: Chargeback holds, Your actions, Tests you paused, Suspensions, Outages, Open disputes,
 * Payment holds, Reports, Lifts, No-show reports, Contact us, and Settings (the settings to fix, emails not sending and storage, only when there is something to show).
 * (Batch 33 §7) It follows other admins' changes live (the lists' newest rows and every admin's latest action), redrawing without losing what was typed.
 */
export default async function AdminPage({ searchParams }: { searchParams: Promise<{ dispute?: string; user?: string }> }) {
  const u = await requirePageUser();
  // (Batch 15 section 35) A suspended admin keeps no admin access: the console says why.
  if (adminAccount(u) && !isAdmin(u)) return <main className="wrap space-y-4"><Brand /><p className="info" data-admin-paused="">{ADMIN_PAUSED} Contact the owner if you think this is a mistake.</p></main>;
  if (!isAdmin(u)) notFound();
  const q = await searchParams;
  // (Batch 33 §7) The fingerprint as of BEFORE the lists are read (AutoRefresh's baseline): a change right after this render is caught.
  const liveV = await adminConsoleV();
  const [chargebacks, mine, myPaused, suspensions, disputes, reportsP, liftsP, noShows, contactP] = await Promise.all(
    (["chargebacks", "mine", "mypaused", "suspensions", "disputes", "reports", "lifts", "noshows", "contact"] as const).map((k) => adminPage(k, u.id, null)),
  );
  const held = await db.user.findMany({ where: { holdStartedAt: { not: null }, holdReason: { not: "chargeback" } }, orderBy: { holdStartedAt: "asc" }, take: 100 });
  const heldWho = await whoById(held.map((x) => x.id));

  // A link or a bell line can open one exact row: ?dispute=ID or ?user=ID shows it first (only when opened from such a link).
  const focusDispute: DisputeVM | null = q.dispute ? await db.dispute.findUnique({ where: { id: q.dispute } }).then((d) => (d ? disputeRow(d) : null)) : null;
  const focusUser = q.user ? await db.user.findUnique({ where: { id: q.user } }) : null;
  const outages = await adminOutages();
  const mail = await emailHealth();
  const storage = await storageAlerts();
  // (Batch 23 section 2) Times on the admin's own clock: the time alone within a day, else the day too.
  const clock = (d: Date) => renderTimes(T(d, Date.now() - d.getTime() < 20 * 3_600_000 ? "time" : "dayTime"), u.timeZone);
  const problems = seesConfigBox(u) ? configProblems() : [];
  const mailBox = mail.waiting > 0 || mail.failedCount > 0;
  const settings = problems.length > 0 || mailBox || storage.lines.length > 0;
  const outageCount = outages.gaps.length + outages.rows.length + (outages.downSince ? 1 : 0);
  return (
    <main className="wrap space-y-8">
      {/* (Batch 29 §29) A bell line opens its own row (a dispute, a report, a hold lift), marked. */}
      <HashJump />
      <AutoRefresh query="adminConsole=1" v={liveV} />
      <h1 className="text-3xl font-bold tracking-tight text-white">Admin</h1>

      {(focusDispute || focusUser) && (
        <section className="card space-y-2" id="focus" data-focus="">
          <h2 className="text-lg font-semibold text-white">Opened from a link</h2>
          {focusDispute && <PagedList kind="disputes" initial={{ rows: [focusDispute], next: null, total: 1 }} fixed />}
          {focusUser && (
            <p className="scroll-mt-24 text-sm" id={`user-${focusUser.id}`}>
              <AdminRich parts={person(focusUser)} /> · {[focusUser.isDeveloper && "developer", focusUser.isTester && "tester"].filter(Boolean).join(" + ") || "no role"}
              {focusUser.devSuspendedAt ? ` · suspended (developer side) ${fmtDateTime(focusUser.devSuspendedAt)}` : ""}
              {focusUser.testerSuspendedAt ? ` · suspended (tester side) ${fmtDateTime(focusUser.testerSuspendedAt)}` : ""}
              {focusUser.deletedAt ? ` · deleted ${fmtDateTime(focusUser.deletedAt)}` : ""}
            </p>
          )}
        </section>
      )}

      {/* 1. Chargeback holds, at the very top. */}
      <section className="card scroll-mt-24 space-y-3" id="chargebacks" data-console-section="chargebacks">
        <p className="note">After a chargeback the developer verifies a card with 3D Secure and pays what they owe; paying alone never lifts the hold. Approve once both are done.</p>
        <PagedList kind="chargebacks" title="Chargeback holds" initial={rows(chargebacks)} />
      </section>

      {/* 2. Your actions. */}
      <section className="card scroll-mt-24 space-y-3" id="mine" data-console-section="mine">
        <p className="note">Tests you paused or stopped, or whose developer you suspended. Newest first.</p>
        <PagedList kind="mine" title="Your actions" initial={rows(mine)} />
      </section>

      {/* 3. (Batch 33 §6) The tests THIS admin paused that are still paused, each with Lift the pause. */}
      <section className="card scroll-mt-24 space-y-3" id="tests-you-paused" data-console-section="mypaused">
        <PagedList kind="mypaused" title="Tests you paused" initial={rows(myPaused)} />
      </section>

      {/* 4. (Batch 33 §6) Accounts suspended now (either side), each side with Reinstate. */}
      <section className="card scroll-mt-24 space-y-3" id="suspensions" data-console-section="suspensions">
        <PagedList kind="suspensions" title="Suspensions" initial={rows(suspensions)} />
      </section>

      {/* 5. (Batch 15 section 10) Outages, from the uptime service's own down/up alerts, in a scroll box like the other lists. */}
      <section className="card scroll-mt-24 space-y-2" id="outages" data-outages data-console-section="outages">
        <h2 className="text-lg font-semibold text-white">Outages ({outageCount})</h2>
        {outageCount > 0 && (
          <div className="max-h-[23rem] w-full overflow-y-auto overscroll-contain pr-1" data-scroll-box="outages">
            {/* (Owner, Oct 29, batch 28 §1) A heartbeat gap alone never moves anything: listed here for an admin to decide. */}
            {outages.gaps.length > 0 && (
              <ul className="space-y-1 text-sm" data-outage-gaps>
                {outages.gaps.map((g) => (
                  <li key={g.id} className="text-amber-200" data-outage-gap>
                    {renderTimes(gapLine(g, u.timeZone), u.timeZone)} <AdminButton action="approve-gap" id={g.id} label="Approve: move every timer" /> <AdminButton action="dismiss-gap" id={g.id} label="Dismiss" />
                  </li>
                ))}
              </ul>
            )}
            {outages.downSince && <p className="text-sm text-amber-200">The uptime service says the site has been down since {fmtDateTime(outages.downSince)}. The outage is recorded when it says the site is up again (if it lasted 15 minutes or more).</p>}
            <ul className="space-y-1 text-sm">
              {outages.rows.map((o) => (
                <li key={o.id} data-outage-line>
                  {o.needsApproval && !o.approvedAt ? (
                    <span className="text-amber-200">Over 24 hours: the uptime service says the site was down from {fmtDateTime(o.startAt)} to {fmtDateTime(o.endAt)} ({lengthText(o.ms)}). Nothing has moved yet. <AdminButton action="approve-outage" id={o.id} label="Approve: move every timer" /></span>
                  ) : (
                    <>{renderTimes(outageLine(o.startAt, o.endAt, o.ms), u.timeZone)} <span className="text-slate-400">({lengthText(o.ms)}, recorded {fmtDateTime(o.recordedAt)}{o.approvedAt ? ", approved" : ""})</span></>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* 6. Open disputes. */}
      <section className="card scroll-mt-24 space-y-3" id="disputes" data-console-section="disputes">
        <p className="note">Newest first. A decision can only raise the pay, up to the piece&apos;s cap (the same as for Pay more), less what the piece was already paid. The extra is charged to the developer. Stripe card disputes are handled by hand in the Stripe dashboard.</p>
        <PagedList kind="disputes" title="Open disputes" initial={rows(disputes)} />
      </section>

      {/* 7. Payment holds. (Batch 33 §1, §4) Each developer opens their profile; an empty box is its heading with (0) alone. */}
      <section className="card space-y-3" data-console-section="holds">
        <h2 id="holds" className="scroll-mt-24 text-lg font-semibold text-white">Payment holds ({held.length})</h2>
        {held.map((x) => (
          <p key={x.id} className="text-sm" data-hold-row={x.id}>
            <AdminRich parts={person(heldWho.get(x.id))} /> {x.holdCount > 3 && <span className="badge border-amber-300/40 text-amber-200">More than 3 holds</span>} · on hold since {fmtDateTime(x.holdStartedAt!)} ({x.holdReason}){x.holdCount > 3 ? " · its lift needs an Approve (see Lifts)" : ""}. Their tests close after 7 days paused.
          </p>
        ))}
      </section>

      {/* 8. Reports. */}
      <section className="card scroll-mt-24 space-y-3" id="reports" data-console-section="reports">
        <p className="note">What people reported about each other from a profile (once per pair). The reported person is not told.</p>
        <PagedList kind="reports" title="Reports" initial={rows(reportsP)} />
      </section>

      {/* 9. Lifts. */}
      <section className="card scroll-mt-24 space-y-3" id="lifts" data-console-section="lifts">
        <p className="note">A payment hold from the 4th onward needs an Approve to lift, even after the developer paid what they owe. Newest first. The first press wins.</p>
        <PagedList kind="lifts" title="Lifts" initial={rows(liftsP)} />
      </section>

      {/* 10. No-show reports. */}
      <section className="card scroll-mt-24 space-y-3" id="no-shows" data-console-section="noshows">
        <PagedList kind="noshows" title="No-show reports" initial={rows(noShows)} />
      </section>

      {/* 11. (Batch 15 section 21) Contact us: newest first, each message in a scroll box; who replied. */}
      <section className="card scroll-mt-24 space-y-3" id="contact" data-console-section="contact">
        <PagedList kind="contact" title="Contact us" initial={rows(contactP)} />
      </section>

      {/* 12. (Batch 33 §6) Settings: the settings to fix (batch 15 section 12: the owner, OWNER_EMAIL, or every admin when it's unset), emails not sending (batch 23
          section 2) and storage at 80% or more (batch 30 §35), only when there is something to show. */}
      {settings && (
        <section className="card scroll-mt-24 space-y-3" id="settings" data-console-section="settings">
          <h2 className="text-lg font-semibold text-white">Settings</h2>
          {problems.length > 0 && (
            <div className="rounded-xl border border-rose-500/60 bg-rose-950/40 p-4" data-config-problems>
              <h3 className="font-semibold text-rose-200">Settings to fix</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-rose-100">
                {problems.map((p) => (
                  <li key={p.message}>{p.message}</li>
                ))}
              </ul>
            </div>
          )}
          {mailBox && (
            <div className="scroll-mt-24 space-y-2 rounded-xl border border-rose-500/60 bg-rose-950/40 p-4 text-sm text-rose-100" id="emails" data-emails-box="">
              {mail.waiting > 0 && mail.since && <p className="font-semibold text-rose-200" data-emails-waiting="">{emailsDownLine(mail.waiting, clock(mail.since), mail.error, mail.cap)}</p>}
              {mail.waiting > 0 && <p className="text-xs text-rose-200/80">Each is tried again after 5, 15 and 30 minutes, then every hour, for 48 hours. The uptime monitor&apos;s keyword alert tells you outside the app too.</p>}
              {mail.failedCount > 0 && (
                <div className="space-y-1" data-emails-failed="">
                  <p className="font-semibold text-rose-200">{mail.failedCount} email{mail.failedCount === 1 ? "" : "s"} failed for good (tried for 48 hours, kept):</p>
                  <ul className="max-h-52 list-disc space-y-0.5 overflow-y-auto pl-5">
                    {mail.failed.map((m) => <li key={m.id}>To {m.to} · “{m.subject}” · written {clock(m.createdAt)} · {m.lastError}</li>)}
                  </ul>
                  <AdminButton action="emails-clear" id="all" label="Clear this list (the emails are kept)" />
                </div>
              )}
            </div>
          )}
          {storage.lines.length > 0 && (
            <div className="scroll-mt-24 space-y-2 rounded-xl border border-rose-500/60 bg-rose-950/40 p-4 text-sm text-rose-100" id="storage" data-storage-box="">
              {storage.lines.map((s) => <p key={s.kind} className="font-semibold text-rose-200" data-storage-line={s.kind}>{s.line}</p>)}
              {storage.at && <p className="text-xs text-rose-200/80">Measured once a day (last {clock(storage.at)}). The uptime monitor&apos;s keyword alert tells you outside the app too.</p>}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
