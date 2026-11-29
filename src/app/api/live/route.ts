import { db } from "@/lib/db";
import { lineLinks, linkPool } from "@/lib/server/lineLinks";
import { displayName, fmtDate } from "@/lib/server/dateFormat";
import { DEV_QUIET_KINDS, ratedYouLiveLine, type TestEventLike } from "@/lib/rules";
import { handle, HttpError, ok } from "@/lib/server/http";
import { joinPageChanges } from "@/lib/server/joining";
import { invitesSentSince } from "@/lib/server/invites";
import { asLines, devChanges } from "@/lib/server/live";
import { requireUser } from "@/lib/server/session";
import { outageLines } from "@/lib/server/outages";
import { renderTimes } from "@/lib/tz";
import { ALERTS_OFF_KINDS, stopsWithAlertsOff, testerChanges } from "@/lib/server/testerGate";
import { alertOf } from "@/lib/alerts";
import { ownTest } from "@/lib/server/tests";
import { inviteClosedLine } from "@/lib/server/invites";
import { DROP_KINDS } from "@/lib/requestDrop";

/** "Your invite to “Harbor Run” was closed." for each invite of theirs closed since `since` (never why). */
async function invitesClosedSince(userId: string, since: Date, testId?: string) {
  const closed = await db.invite.findMany({ where: { testerId: userId, status: "cancelled", updatedAt: { gt: since }, ...(testId ? { testId } : {}) }, include: { test: { select: { title: true } } }, take: 20 });
  return closed.map((i) => ({ kind: "invite", text: inviteClosedLine(i.test.title), createdAt: i.updatedAt }));
}

/**
 * The live top notice's lines (GET /api/live?scope=…&since=…): every stop-once reason on this page since it was opened, as the page's
 * auto-refresh picks them up. Called by LiveTop's check (components/LiveTop.tsx tick) on every beat and redraw.
 * `now` in the answer is the point up to which the page has shown everything: the page's buttons send it as their "seen" marker, so a press only stops
 * for changes the page hadn't shown yet.
 *
 * Steps:
 *   1. The viewer, `since`, the tab and the one-at-a-time page asking (x-tab, x-page).
 *   2. The lines by scope:
 *      - "session:<contract>" (the tester's session page): testerChanges WITHOUT the offer lines (kind "terms": the offer has its own Switch / Keep box,
 *        which the page's own redraw brings), plus a line when the test was stopped or her work ended;
 *      - "test:<id>" (the developer's test page and Edit): devChanges, the test's Alerts, and a tester's rating with the developer's own rating window;
 *      - "listing:<id>" (the join page): joinPageChanges and her invite to it closed;
 *      - "invites:me" (the tester's dashboard): her invites sent and closed.
 *   3. The outage lines (every scope), in her own time zone.
 *   4. The seen time `now`: 5 s back, or the newest line shown, whichever is later; only change lines up to the request's own time are sent (the outage lines always).
 *   5. What each line carries for the page: `quiet` (live-box only, never in a stop box), `forced` and `part` (the tester's stop boxes' rule), `facts` (the
 *      developer's), `ignored` (greyed with Alerts Off), and its people and tests as links.
 *   6. Oldest first, with `now`.
 */
export async function GET(req: Request) {
  return handle(async () => {
    // 1. Who asks, from when, from which tab and page.
    const u = await requireUser(req);
    const q = new URL(req.url).searchParams;
    const since = new Date(q.get("since") ?? "");
    if (isNaN(since.getTime())) throw new HttpError(400, "bad_request", "This page is out of date.");
    const tab = (req.headers.get("x-tab") ?? "").slice(0, 64);
    const [kind, id] = (q.get("scope") ?? "").split(":");
    // A one-at-a-time page (test page with Edit, session page) asking about itself: its own actions are never its lines.
    const page = req.headers.get("x-page") === q.get("scope") ? (q.get("scope") ?? "") : "";
    // The seen marker: a few seconds back (a change whose transaction is still committing already has its time but
    // isn't visible yet: it must not be skipped), or the newest line actually shown, whichever is later.
    const now = new Date();
    const margin = new Date(now.getTime() - 5000);
    // 2. The lines by scope.
    let changes;
    let ignored: ReadonlySet<string> = new Set();
    if (kind === "session") {
      const c = await db.contract.findUnique({ where: { id } });
      if (!c || c.testerId !== u.id) throw new HttpError(404, "not_found", "That session doesn't exist.");
      // The offer of new terms has its own box (Switch / Keep): the live box lists every change except the contract's. So a new offer alone gives the
      // live box no new line, and the box never asks the page to redraw for it: the offer box appears with the page's own redraw (AutoRefresh's poll).
      changes = (await testerChanges(u.id, c.id, c.testId, since, tab, page)).filter((x) => x.kind !== "terms");
      // The test was stopped, or this tester's work was ended: a line in the live box (a final refusal for later presses, never a stop-once reason).
      if (c.status === "ended" && c.endedAt && c.endedAt > since && (c.endKind === "stopped" || c.endKind === "closed" || c.endKind === "early")) {
        const t = await db.test.findUniqueOrThrow({ where: { id: c.testId } });
        const dev = displayName(await db.user.findUniqueOrThrow({ where: { id: t.developerId } }));
        // The team's Stop never names who: "This test was stopped" (the box says when).
        changes.push({ kind: "ended", text: c.endKind === "stopped" ? (t.adminStoppedAt ? "This test was stopped" : `${dev} stopped the test`) : c.endKind === "closed" ? "This test ended" : `${dev} ended your work`, createdAt: c.endedAt });
      }
    } else if (kind === "test") {
      const own = await ownTest(u.id, id);
      changes = await devChanges(u.id, id, since, tab, db, { all: true, page });
      ignored = new Set(own.ignoredAlerts); // this test's Alerts
      // A tester's rating, in the live box with the developer's own window: "ff rated you. You can rate them until Nov 12, 2026."
      const rated = changes.filter((c) => c.kind === "rated" && (c as { contractId?: string | null }).contractId);
      if (rated.length) {
        const { devRateStates } = await import("@/lib/server/ratings");
        const cids = rated.map((c) => (c as unknown as { contractId: string }).contractId);
        const states = await devRateStates(cids);
        // "You can rate her …": the tester's pronoun as it is now.
        const pron = new Map((await db.contract.findMany({ where: { id: { in: cids } }, select: { id: true, tester: { select: { pronoun: true } } } })).map((x) => [x.id, x.tester.pronoun]));
        changes = changes.map((c) => {
          const cid = (c as { contractId?: string | null }).contractId;
          if (c.kind !== "rated" || !cid) return c;
          const end = states.get(cid)?.endsAt ?? null;
          return { ...c, text: ratedYouLiveLine(c.text.replace(/ rated you$/, ""), end ? fmtDate(end) : null, pron.get(cid)) };
        });
      }
    } else if (kind === "listing") {
      changes = await joinPageChanges(u.id, id, since.toISOString(), tab);
      // Their invite to this test closed: a neutral line (the page refreshes without it).
      changes.push(...(await invitesClosedSince(u.id, since, id)));
    } else if (kind === "invites") {
      // The tester's dashboard: each of their invites that closed since the page loaded, and each new or re-sent one.
      changes = [...(await invitesSentSince(u.id, since)), ...(await invitesClosedSince(u.id, since))];
    } else throw new HttpError(404, "not_found", "Nothing to watch here.");
    // 3. "The site was down from … Deadlines and payment dates moved … later." on every affected page,
    // their times in the viewer's own zone.
    const outages = (await outageLines(since)).map((o) => ({ ...o, text: renderTimes(o.text, u.timeZone) }));
    // 4. The seen time: only lines up to this request's time, and `now` no earlier than the newest of them.
    const shown = changes.filter((c) => c.createdAt <= now);
    const seenTo = new Date(Math.max(margin.getTime(), ...shown.map((c) => c.createdAt.getTime())));
    const lines = asLines(shown, ignored);
    // 5. What each line carries.
    // The developer's quiet lines (a tester's Switch, a rating by a tester whose part had ended) are
    // live-box lines only: marked, so an open stop box under a button never takes them in (it lists only what stops a press).
    if (kind === "test") lines.forEach((l, i) => { if ((DEV_QUIET_KINDS as readonly string[]).includes(shown[i].kind)) Object.assign(l, { quiet: true }); });
    // The tester's own requests dropped by a booking: a quiet live-box line too.
    if (kind === "session") lines.forEach((l, i) => { if (shown[i].kind === DROP_KINDS.devQuiet) Object.assign(l, { quiet: true }); });
    // What an open stop box under a button needs to follow the rule it was built under (its `liveRule`, lib/live.ts boxKeeps): on the
    // tester's page, whether the line stops a press with Alerts Off whatever the press (`forced`: also the stop or end of their work) and the part it is about
    // (`part`: a payment on the part the press is about stops it too); on the developer's, what devKeeps reads (`facts`) on a line an Alerts tick could switch off.
    if (kind === "session") lines.forEach((l, i) => { const e = shown[i] as TestEventLike; Object.assign(l, { ...(stopsWithAlertsOff(e) || e.kind === "ended" ? { forced: true } : {}), ...(e.piece ? { part: e.piece } : {}) }); });
    if (kind === "test") lines.forEach((l, i) => { const e = shown[i] as TestEventLike & { contractId?: string | null }; if (alertOf(e.kind)) Object.assign(l, { facts: { kind: e.kind, ...(e.contractId ? { contractId: e.contractId } : {}), ...(e.piece ? { piece: e.piece } : {}), ...(e.item ? { item: e.item } : {}), ...(e.charge ? { charge: true } : {}) } }); });
    // A tester with Alerts Off: everything but their contract's changes shows greyed (it won't stop a press).
    // Never a line that stops every press whatever the Alerts (`forced` above: dispute changes, the end of her work, her own other-tab
    // actions): greying it said "won't stop a press" of a line that always does. A developer payment stays greyed: it stops only a press about that same part
    // and this box is about no one press.
    if (kind === "session" && u.testerAlertsOff) lines.forEach((l, i) => { if (!ALERTS_OFF_KINDS.has(shown[i].kind) && !(l as { forced?: boolean }).forced) Object.assign(l, { ignored: true }); });
    // Each line's people and tests, each drawn as its own green link in the top box (and in a stop box that takes the line in).
    const pool = lines.length ? await linkPool(u.id, [id]) : null;
    const linked = pool ? lines.map((l) => ({ ...l, links: lineLinks(pool, l.text, kind === "test" ? id : null) })) : lines;
    // 6. Oldest first, the outage lines among them.
    return ok({ changes: [...linked, ...outages].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()), now: seenTo.toISOString() });
  });
}
