import { db } from "@/lib/db";
import { displayName } from "@/lib/format";
import { handle, HttpError, ok } from "@/lib/server/http";
import { joinPageChanges } from "@/lib/server/joining";
import { asLines, devChanges } from "@/lib/server/live";
import { requireUser } from "@/lib/server/session";
import { outageLines } from "@/lib/server/outages";
import { renderTimes } from "@/lib/tz";
import { CONTRACT_KINDS, testerChanges } from "@/lib/server/testerGate";
import { ownTest } from "@/lib/server/tests";

/** (Owner, Oct 28, batch 16 section 32) "Your invite to “Harbor Run” was closed." for each invite of theirs closed since `since` (never why). */
async function invitesClosedSince(userId: string, since: Date, testId?: string) {
  const closed = await db.invite.findMany({ where: { testerId: userId, status: "cancelled", updatedAt: { gt: since }, ...(testId ? { testId } : {}) }, include: { test: { select: { title: true } } }, take: 20 });
  return closed.map((i) => ({ kind: "invite", text: `Your invite to “${i.test.title}” was closed.`, createdAt: i.updatedAt }));
}

// The live top notice (owner, NEWEST+3): every stop-once reason (A-E) on this page since it was opened, as the page's
// auto-refresh picks them up. `now` is the point up to which the page has shown everything: the page's buttons send it
// as their "seen" marker, so a press only stops for changes the page hadn't shown yet.
export async function GET(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    const q = new URL(req.url).searchParams;
    const since = new Date(q.get("since") ?? "");
    if (isNaN(since.getTime())) throw new HttpError(400, "bad_request", "Refresh to see the latest.");
    const tab = (req.headers.get("x-tab") ?? "").slice(0, 64);
    const [kind, id] = (q.get("scope") ?? "").split(":");
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
      changes = (await testerChanges(u.id, c.id, c.testId, since, tab)).filter((x) => x.kind !== "terms");
      // The test was stopped, or this tester's work was ended: a line in the live box (a final refusal for later presses, never a stop-once reason).
      if (c.status === "ended" && c.endedAt && c.endedAt > since && (c.endKind === "stopped" || c.endKind === "closed" || c.endKind === "early")) {
        const dev = displayName((await db.user.findUniqueOrThrow({ where: { id: (await db.test.findUniqueOrThrow({ where: { id: c.testId } })).developerId } })));
        changes.push({ kind: "ended", text: c.endKind === "stopped" ? `${dev} stopped the test` : c.endKind === "closed" ? "This test ended" : `${dev} ended your work`, createdAt: c.endedAt });
      }
    } else if (kind === "test") {
      await ownTest(u.id, id);
      changes = await devChanges(u.id, id, since, tab, db, { all: true });
      ignored = new Set(u.ignoredAlerts);
    } else if (kind === "listing") {
      changes = await joinPageChanges(u.id, id, since.toISOString(), tab);
      // (Batch 16 section 32) Their invite to this test closed: a neutral line (the page refreshes without it).
      changes.push(...(await invitesClosedSince(u.id, since, id)));
    } else if (kind === "invites") {
      // (Batch 16 section 32) The tester's dashboard: each of their invites that closed since the page loaded.
      changes = await invitesClosedSince(u.id, since);
    } else throw new HttpError(404, "not_found", "Nothing to watch here.");
    // (NEWEST+6) "The site was down from … Deadlines and payment dates moved … later." on every affected page.
    // (Batch 15 section 11) Their times in the viewer's own zone.
    const outages = (await outageLines(since)).map((o) => ({ ...o, text: renderTimes(o.text, u.timeZone) }));
    const shown = changes.filter((c) => c.createdAt <= now);
    const seenTo = new Date(Math.max(margin.getTime(), ...shown.map((c) => c.createdAt.getTime())));
    const lines = asLines(shown, ignored);
    // (Batch 15 section 26) A tester with Alerts Off: everything but their contract's changes shows greyed (it won't stop a press).
    if (kind === "session" && u.testerAlertsOff) lines.forEach((l, i) => { if (!CONTRACT_KINDS.has(shown[i].kind)) Object.assign(l, { ignored: true }); });
    return ok({ changes: [...lines, ...outages].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()), now: seenTo.toISOString() });
  });
}
