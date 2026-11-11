import { db } from "@/lib/db";
import { HttpError, handle, ok } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

// A small fingerprint of what an open page shows (events, payments, holds, disputes): pages poll it every ~20 s and
// refresh themselves when it changes (paid/rejected, paused/resumed, stop-once live lines, dispute status).
export async function GET(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    await (await import("@/lib/server/workWindow")).closeWorkAfterDeadlines(new Date(), u.id);
    await (await import("@/lib/server/calls")).sweepNobodyJoined(); // (NEWEST+8) minute-accurate while a page is open
    const q = new URL(req.url).searchParams;
    const fresh = q.get("fresh");
    if (fresh) {
      const pv = await import("@/lib/server/pageFreshness");
      const { statesFrom } = await import("@/lib/findSearch");
      const v = fresh === "discovery" ? await pv.discoveryV(u, q.get("q") ?? "", statesFrom(q.get("states") ?? ""))
        : fresh === "publicProfile" ? await pv.publicProfileV(u, q.get("person") ?? "")
        : fresh === "dashboard" ? await pv.dashboardV(u)
        : fresh === "messages" ? await pv.messagesV(u)
        : fresh === "payments" ? await pv.paymentsV(u)
        : fresh === "notifications" ? await pv.notificationsV(u)
        : fresh === "blocked" ? await pv.blockedV(u) : null;
      if (v === null) throw new HttpError(400, "bad_request", "Unknown page.");
      return ok({ v, restricted: false });
    }
    if (q.has("direct") || q.has("messages")) {
      const dm = await import("@/lib/server/directMessages");
      return ok({ v: q.has("direct") ? await dm.directV(u.id, q.get("direct") ?? "") : await dm.messagesListV(u), restricted: dm.directRestricted(u) });
    }
    // (Owner, Oct 29, batch 10) Payments: "Pay what you owe" updates live (a declined payment, a chargeback, a tester's Charge during the hold, or a payment from another tab).
    // (Batch 30 §8) The fingerprint comes from pulseV, which the page also renders with (AutoRefresh's baseline).
    if (q.get("owed")) {
      // Payments stays open during a hold or suspension, so it always refreshes.
      return ok({ v: await (await import("@/lib/server/pulseV")).owedV(u.id), restricted: false });
    }
    // (Owner, Oct 30, batch 33 §7) Admin pages follow other admins' changes: a profile's admin box (that account's state) and the console (its lists' newest rows).
    const adminPerson = q.get("adminPerson");
    if (adminPerson || q.get("adminConsole")) {
      const { isAdmin } = await import("@/lib/server/session");
      if (!isAdmin(u)) throw new HttpError(403, "not_admin", "Only admins can do that.");
      const pv = await import("@/lib/server/pulseV");
      return ok({ v: adminPerson ? await pv.adminPersonV(adminPerson) : await pv.adminConsoleV(), restricted: false });
    }
    // (Owner, Oct 28, batch 16 section 32) The tester's invitations (dashboard and join page): any invite of theirs created (batch 30 §8), closing, re-sent or its
    // test filling refreshes the page.
    if (q.get("invites")) {
      return ok({ v: await (await import("@/lib/server/pulseV")).invitesV(u.id), restricted: false });
    }
    // (Owner's repro, Oct 29, batch 30 §8) The join page follows the tester's application or ask to rejoin: once they're in, the line and their session.
    const joinTest = q.get("join");
    if (joinTest) {
      const { joinPageV, joinedFromPage } = await import("@/lib/server/pulseV");
      const back = await joinedFromPage(u.id, joinTest);
      const { renderTimes } = await import("@/lib/tz");
      return ok({ v: await joinPageV(u.id, joinTest), back: back ? { ...back, line: renderTimes(back.line, u.timeZone) } : null, restricted: false });
    }
    // (Owner, Oct 29, batch 24 section 1) The developer dashboard's "Your bank wants you to confirm": a charge arriving, confirmed (here, another tab, the test page),
    // past its date (counted as declined), cancelled, or turning red under 24 hours refreshes it. It shows during a hold or suspension too, so it always refreshes.
    // (Batch 25 section 4) Only a developer has the box: anyone else gets the plain pulse.
    if (q.get("bank") && u.isDeveloper) {
      const { bankToConfirm } = await import("@/lib/server/confirm");
      const { bankTopV } = await import("@/lib/bankTop");
      return ok({ v: bankTopV(await bankToConfirm(u.id)), restricted: false });
    }
    // (Batch 17 section 17) "Ratings to give" on a dashboard: a row appearing or going (a dispute opening, a rating given, a window ending) refreshes it.
    const rates = q.get("rates");
    if (rates === "tester" || rates === "developer") {
      const { ratingsToGive } = await import("@/lib/server/ratings");
      return ok({ v: (await ratingsToGive(u, rates)).map((r) => `${r.id}:${r.text}`).join(","), restricted: false });
    }
    // (Batch 17 §18) The tester dashboard's "Tests visited": a listed test's state changing (filling, pausing, stopping, an invite or application of theirs…), a card
    // removed in another tab or a test joined refreshes it.
    if (q.get("visited")) {
      const { visitedTestsV } = await import("@/lib/server/testVisits");
      return ok({ v: await visitedTestsV(u.id), restricted: false });
    }
    // (Owner, Oct 28, batch 17 section 9) A developer's profile seen by someone else: its "Open tests" as this viewer may see them (a test filling up, pausing,
    // stopping, passing Open until, turning invite only for them or their invite closing leaves the list; a newly open test appears).
    const profileId = q.get("profile");
    if (profileId) {
      const { profileOpenTestsV } = await import("@/lib/server/profileOpenTests");
      const { isAdmin } = await import("@/lib/server/session");
      return ok({ v: await profileOpenTestsV(profileId, u, isAdmin(u)), restricted: false });
    }
    // (Batch 26 section 7) The developer's invite panel follows the test live both ways: full, paused or joining closed (Invite disabled, with its line) and a spot
    // opening (enabled), without waiting for the page's own refresh.
    const inviteTest = q.get("inviteState");
    if (inviteTest) {
      const t = await db.test.findUnique({ where: { id: inviteTest } });
      if (!t || t.developerId !== u.id) throw new HttpError(404, "not_found", "Not found.");
      const { inviteBlocked } = await import("@/lib/rules");
      const { fmtDate } = await import("@/lib/server/dateFormat");
      const testersIn = await db.contract.count({ where: { testId: t.id, status: "working" } });
      const ids = (q.get("testers") ?? "").split(",").filter((id) => /^[a-zA-Z0-9_-]{1,80}$/.test(id));
      const rowVersions = await import("@/lib/server/inviteAvailability");
      const [availability, details] = q.has("testers") ? await Promise.all([rowVersions.inviteAvailability(u.id, t.id, ids), rowVersions.inviteDetailsRows(u.id, ids)]) : [{}, []];
      const detailsV = (await import("@/lib/inviteAvailability")).inviteAvailabilityV(details);
      return ok({ ...availability, detailsV, details, blocked: inviteBlocked({ ...t, testersIn, paused: !!u.holdStartedAt, chargeback: u.holdReason === "chargeback" }, new Date(), fmtDate), restricted: false });
    }
    // (Batch 26 section 10) The Call requests panel: each shown request that is no longer waiting, with the line its row then shows ("Closed: the tester finished
    // their part"). Only requests on this person's own sessions or tests.
    const reqIds = (q.get("requests") ?? "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 100);
    if (q.has("requests")) {
      const { requestGoneLine, TIME_PASSED_REASON } = await import("@/lib/server/requests");
      // (Owner, Nov 5, §228 fix) A waiting request whose time passed leaves the page's list at once (it lists only times ahead) though nothing has closed it yet:
      // it reads as closed then ("Closed: its time passed"), so its row says so for its 6 seconds like any other.
      const passedAt = new Date();
      const rows = (reqIds.length ? await db.callRequest.findMany({ where: { id: { in: reqIds } }, select: { id: true, status: true, closedReason: true, contractId: true, callId: true, startsAt: true } }) : [])
        .map((r) => (r.status === "pending" && r.startsAt <= passedAt ? { ...r, status: "closed", closedReason: TIME_PASSED_REASON } : r));
      // (Owner, Nov 4, §187) A "one of" request shows one row per time: once booked, the booked time's row reads "Booked" and its other times' rows "Another time
      // of this request was booked" (the page compares each row's time with `bookedAt`).
      const bookedIds = rows.flatMap((r) => (r.status === "booked" && r.callId ? [r.callId] : []));
      const bookedAt = new Map((bookedIds.length ? await db.call.findMany({ where: { id: { in: bookedIds } }, select: { id: true, startsAt: true } }) : []).map((x) => [x.id, x.startsAt.toISOString()]));
      // (Batch 35 §162) With the tester's pronoun ("Closed: the tester finished her part").
      // (Owner, Nov 4, §184) And the reader's side with the request's other person: a request dropped when a call was booked reads "Closed: fbbb is no longer free at
      // that time" (or the reader's own "Closed: you have another call at that time").
      const { displayName } = await import("@/lib/server/dateFormat");
      const person = { name: true, email: true, deletedAt: true } as const;
      const cons = await db.contract.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.contractId))] }, OR: [{ testerId: u.id }, { test: { developerId: u.id } }] }, select: { id: true, testerId: true, tester: { select: { pronoun: true, ...person } }, test: { select: { developer: { select: person } } } } });
      const mine = new Map(cons.map((c) => [c.id, c]));
      return ok({ gone: rows.filter((r) => mine.has(r.contractId) && r.status !== "pending").map((r) => {
        const c = mine.get(r.contractId)!;
        const side = c.testerId === u.id ? ("tester" as const) : ("developer" as const);
        return { id: r.id, line: requestGoneLine(r, c.tester.pronoun, { side, other: displayName(side === "tester" ? c.test.developer : c.tester) }), ...(r.callId && bookedAt.has(r.callId) ? { bookedAt: bookedAt.get(r.callId) } : {}) };
      }), restricted: false });
    }
    let testId = q.get("test") ?? "";
    const sessionId = q.get("session") ?? "";
    let sessionActive: boolean | undefined;
    if (sessionId) {
      const c = await db.contract.findUnique({ where: { id: sessionId } });
      if (!c || c.testerId !== u.id) throw new HttpError(404, "not_found", "Not found.");
      testId = c.testId;
      sessionActive = c.status === "working";
    }
    const t = await db.test.findUnique({ where: { id: testId }, include: { developer: { select: { holdStartedAt: true, devSuspendedAt: true } } } });
    if (!t || (!sessionId && t.developerId !== u.id)) throw new HttpError(404, "not_found", "Not found.");
    // (Batch 30 §8) The fingerprint itself is pulseV's testV, which the test page and the session page also render with (AutoRefresh's baseline).
    const v = await (await import("@/lib/server/pulseV")).testV(u.id, testId, sessionId);
    // (Owner, Oct 28) Whether the team stopped the test: an open test page or Edit moves to the top of the test page at once.
    // (Batch 10) A tester's session page isn't restricted by the developer's hold (only the developer's own pages are): it keeps refreshing, so the paused banner shows live.
    // (Batch 15 section 16) Each side's own suspension: the tester side on a session page, the developer side on a test page.
    // (Batch 20 section 8) The viewer's own Alerts setting (the developer's ignored types, the tester's Off): an Alerts menu, toggle or stop box chip open in another
    // tab or browser follows a change made elsewhere on this poll (no refresh needed).
    // (Owner, Nov 4, §169) With the list's version (`v`): an answer read before a save that lands after it is older than that save, and the tab ignores it.
    const alerts = sessionId ? { testerOff: u.testerAlertsOff } : { ignored: t.ignoredAlerts, v: t.alertsV } /* batch 35 §73: this test's */;
    // (Owner, Nov 11, §380) This copy of the page was opened somewhere else since (another tab, browser or device claimed it): it goes to the dashboard.
    const moved = await (await import("@/lib/server/pageClaim")).pageMoved(req, u.id);
    return ok({ v, sessionActive, adminStopped: !!t.adminStoppedAt, restricted: !sessionId && !!(u.devSuspendedAt || t.developer.holdStartedAt), alerts, ...(moved ? { moved: true } : {}) });
  });
}
