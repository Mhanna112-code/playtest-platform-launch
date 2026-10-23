import { db } from "@/lib/db";
import { handle, HttpError, ok } from "@/lib/server/http";
import { joinPageChanges } from "@/lib/server/joining";
import { asLines, devChanges } from "@/lib/server/live";
import { requireUser } from "@/lib/server/session";
import { outageLines } from "@/lib/server/outages";
import { testerChanges } from "@/lib/server/testerGate";
import { ownTest } from "@/lib/server/tests";

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
    if (kind === "session") {
      const c = await db.contract.findUnique({ where: { id } });
      if (!c || c.testerId !== u.id) throw new HttpError(404, "not_found", "That session doesn't exist.");
      changes = await testerChanges(u.id, c.id, c.testId, since, tab);
    } else if (kind === "test") {
      await ownTest(u.id, id);
      changes = await devChanges(u.id, id, since, tab);
    } else if (kind === "listing") {
      changes = await joinPageChanges(u.id, id, since.toISOString(), tab);
    } else throw new HttpError(404, "not_found", "Nothing to watch here.");
    // (NEWEST+6) "The site was down from … Deadlines and payment dates moved … later." on every affected page.
    const outages = await outageLines(since);
    const shown = changes.filter((c) => c.createdAt <= now);
    const seenTo = new Date(Math.max(margin.getTime(), ...shown.map((c) => c.createdAt.getTime())));
    return ok({ changes: [...asLines(shown), ...outages].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()), now: seenTo.toISOString() });
  });
}
