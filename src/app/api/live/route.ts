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

/** (Owner, Oct 28, batch 16 section 32) "Your invite to “Harbor Run” was closed." for each invite of theirs closed since `since` (never why). */
async function invitesClosedSince(userId: string, since: Date, testId?: string) {
  const closed = await db.invite.findMany({ where: { testerId: userId, status: "cancelled", updatedAt: { gt: since }, ...(testId ? { testId } : {}) }, include: { test: { select: { title: true } } }, take: 20 });
  return closed.map((i) => ({ kind: "invite", text: inviteClosedLine(i.test.title), createdAt: i.updatedAt }));
}

// The live top notice (owner, NEWEST+3): every stop-once reason (A-E) on this page since it was opened, as the page's
// auto-refresh picks them up. `now` is the point up to which the page has shown everything: the page's buttons send it
// as their "seen" marker, so a press only stops for changes the page hadn't shown yet.
export async function GET(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    const q = new URL(req.url).searchParams;
    const since = new Date(q.get("since") ?? "");
    if (isNaN(since.getTime())) throw new HttpError(400, "bad_request", "This page is out of date.");
    const tab = (req.headers.get("x-tab") ?? "").slice(0, 64);
    const [kind, id] = (q.get("scope") ?? "").split(":");
    // (Owner, Nov 11, §380) A one-at-a-time page (test page with Edit, session page) asking about itself: its own actions are never its lines.
    const page = req.headers.get("x-page") === q.get("scope") ? (q.get("scope") ?? "") : "";
    // The seen marker: a few seconds back (a change whose transaction is still committing already has its time but
    // isn't visible yet: it must not be skipped), or the newest line actually shown, whichever is later.
    const now = new Date();
    const margin = new Date(now.getTime() - 5000);
    let changes;
    let ignored: ReadonlySet<string> = new Set();
    if (kind === "session") {
      const c = await db.contract.findUnique({ where: { id } });
      if (!c || c.testerId !== u.id) throw new HttpError(404, "not_found", "That session doesn't exist.");
      // The offer of new terms has its own box right below this one: the live box lists every change except the contract's.
      changes = (await testerChanges(u.id, c.id, c.testId, since, tab, since, page)).filter((x) => x.kind !== "terms");
      // The test was stopped, or this tester's work was ended: a line in the live box (a final refusal for later presses, never a stop-once reason).
      if (c.status === "ended" && c.endedAt && c.endedAt > since && (c.endKind === "stopped" || c.endKind === "closed" || c.endKind === "early")) {
        const t = await db.test.findUniqueOrThrow({ where: { id: c.testId } });
        const dev = displayName(await db.user.findUniqueOrThrow({ where: { id: t.developerId } }));
        // (Batch 26 section 3) The team's Stop never names who: "This test was stopped" (the box says when).
        changes.push({ kind: "ended", text: c.endKind === "stopped" ? (t.adminStoppedAt ? "This test was stopped" : `${dev} stopped the test`) : c.endKind === "closed" ? "This test ended" : `${dev} ended your work`, createdAt: c.endedAt });
      }
    } else if (kind === "test") {
      const own = await ownTest(u.id, id);
      changes = await devChanges(u.id, id, since, tab, db, { all: true, page });
      ignored = new Set(own.ignoredAlerts); // (batch 35 §73) this test's Alerts
      // (Batch 20 section 24) A tester's rating, in the live box with the developer's own window: "ff rated you. You can rate them until Nov 12, 2026."
      const rated = changes.filter((c) => c.kind === "rated" && (c as { contractId?: string | null }).contractId);
      if (rated.length) {
        const { devRateStates } = await import("@/lib/server/ratings");
        const cids = rated.map((c) => (c as unknown as { contractId: string }).contractId);
        const states = await devRateStates(cids);
        // (Batch 35 §162) "You can rate her …": the tester's pronoun as it is now.
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
      // (Batch 16 section 32) Their invite to this test closed: a neutral line (the page refreshes without it).
      changes.push(...(await invitesClosedSince(u.id, since, id)));
    } else if (kind === "invites") {
      // (Batch 16 section 32) The tester's dashboard: each of their invites that closed since the page loaded; (batch 30 §8) and each new or re-sent one.
      changes = [...(await invitesSentSince(u.id, since)), ...(await invitesClosedSince(u.id, since))];
    } else throw new HttpError(404, "not_found", "Nothing to watch here.");
    // (NEWEST+6) "The site was down from … Deadlines and payment dates moved … later." on every affected page.
    // (Batch 15 section 11) Their times in the viewer's own zone.
    const outages = (await outageLines(since)).map((o) => ({ ...o, text: renderTimes(o.text, u.timeZone) }));
    const shown = changes.filter((c) => c.createdAt <= now);
    const seenTo = new Date(Math.max(margin.getTime(), ...shown.map((c) => c.createdAt.getTime())));
    const lines = asLines(shown, ignored);
    // (Owner, batch 14 section 4; batch 20 section 25) The developer's quiet lines (a tester's Switch, a rating by a tester whose part had ended) are
    // live-box lines only: marked, so an open stop box under a button never takes them in (it lists only what stops a press).
    if (kind === "test") lines.forEach((l, i) => { if ((DEV_QUIET_KINDS as readonly string[]).includes(shown[i].kind)) Object.assign(l, { quiet: true }); });
    // (Owner, Nov 4, §184) The tester's own requests dropped by a booking: a quiet live-box line too.
    if (kind === "session") lines.forEach((l, i) => { if (shown[i].kind === DROP_KINDS.devQuiet) Object.assign(l, { quiet: true }); });
    // (Owner, Nov 10, §373) What an open stop box under a button needs to follow the rule it was built under (its `liveRule`, lib/live.ts boxKeeps): on the
    // tester's page, whether the line stops a press with Alerts Off whatever the press (`forced`: also the stop or end of their work) and the part it is about
    // (`part`: a payment on the part the press is about stops it too); on the developer's, what devKeeps reads (`facts`) on a line an Alerts tick could switch off.
    if (kind === "session") lines.forEach((l, i) => { const e = shown[i] as TestEventLike; Object.assign(l, { ...(stopsWithAlertsOff(e) || e.kind === "ended" ? { forced: true } : {}), ...(e.piece ? { part: e.piece } : {}) }); });
    if (kind === "test") lines.forEach((l, i) => { const e = shown[i] as TestEventLike & { contractId?: string | null }; if (alertOf(e.kind)) Object.assign(l, { facts: { kind: e.kind, ...(e.contractId ? { contractId: e.contractId } : {}), ...(e.piece ? { piece: e.piece } : {}), ...(e.item ? { item: e.item } : {}), ...(e.charge ? { charge: true } : {}) } }); });
    // (Batch 15 section 26) A tester with Alerts Off: everything but their contract's changes shows greyed (it won't stop a press).
    // (Owner, Nov 10, §374) Never a line that stops every press whatever the Alerts (`forced` above: dispute changes, the end of her work, her own other-tab
    // actions): greying it said "won't stop a press" of a line that always does. A developer payment stays greyed: it stops only a press about that same part
    // (§362), and this box is about no one press.
    if (kind === "session" && u.testerAlertsOff) lines.forEach((l, i) => { if (!ALERTS_OFF_KINDS.has(shown[i].kind) && !(l as { forced?: boolean }).forced) Object.assign(l, { ignored: true }); });
    // (Owner, Nov 5, §270) Each line's people and tests, each drawn as its own green link in the top box (and in a stop box that takes the line in).
    const pool = lines.length ? await linkPool(u.id, [id]) : null;
    const linked = pool ? lines.map((l) => ({ ...l, links: lineLinks(pool, l.text, kind === "test" ? id : null) })) : lines;
    return ok({ changes: [...linked, ...outages].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()), now: seenTo.toISOString() });
  });
}
