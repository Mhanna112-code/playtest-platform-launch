import { db } from "@/lib/db";
import { BUSY_STALE_MS, HANDOVER_CAP_MS, OWN_PAGES, PAGE_MOVED_CODE, PAGE_MOVED_LINE, isScope } from "@/lib/pageClaim";
import { HttpError } from "./http";

// (Owner, Nov 11, §380) One page at a time, across devices (lib/pageClaim.ts). The claim is the holding copy's tab id.

/** May this person claim this page? The developer of the test, the tester of the session; (§380 K) a test's join page, their own pages, a profile that exists. */
async function ownsScope(userId: string, scope: string) {
  const [kind, id] = scope.split(":");
  if (kind === "test") return !!(await db.test.findFirst({ where: { id, developerId: userId }, select: { id: true } }));
  if (kind === "session") return !!(await db.contract.findFirst({ where: { id, testerId: userId }, select: { id: true } }));
  if (kind === "join") return !!(await db.test.findUnique({ where: { id }, select: { id: true } }));
  if (kind === "page") return (OWN_PAGES as readonly string[]).includes(id);
  return !!(await db.user.findUnique({ where: { id }, select: { id: true } }));
}

export type ClaimAnswer = { claimed: true } | { claimed: false; waiting: true; waitMs: number };

/**
 * Opening the page (§380 J): this tab takes it at once, unless the copy holding it has a press on its way (its "busy" mark, fresh): then this tab waits for it,
 * asking again until the old copy hands over, at most HANDOVER_CAP_MS from its first ask (an old copy closed or asleep never answers: taken over then).
 * `now`: "Open now" (no more waiting). The same tab asking again (a reload, Back) simply holds it.
 */
export async function claimPage(userId: string, scope: string, tab: string, opts: { now?: boolean } = {}): Promise<ClaimAnswer> {
  if (!isScope(scope) || !tab) throw new HttpError(400, "bad_request", "Something went wrong sending that. Reload the page and try again.");
  if (!(await ownsScope(userId, scope))) throw new HttpError(404, "not_found", "Not found.");
  const tabId = tab.slice(0, 64);
  return db.$transaction(async (tx) => {
    const now = new Date();
    const where = { userId_scope: { userId, scope } };
    const take = async (): Promise<ClaimAnswer> => {
      await tx.pageClaim.upsert({ where, create: { userId, scope, tabId, beatAt: now }, update: { tabId, claimedAt: now, beatAt: now, busy: false, wantTab: "", wantAt: null } });
      return { claimed: true };
    };
    // Two copies asking at once take turns on the claim's row.
    const rows = await tx.$queryRaw<{ tabId: string; busy: boolean; beatAt: Date | null; wantTab: string; wantAt: Date | null }[]>`SELECT "tabId", busy, "beatAt", "wantTab", "wantAt" FROM "PageClaim" WHERE "userId" = ${userId} AND scope = ${scope} FOR UPDATE`;
    const c = rows[0];
    if (!c || c.tabId === tabId || opts.now) return take();
    const busy = c.busy && !!c.beatAt && now.getTime() - c.beatAt.getTime() < BUSY_STALE_MS;
    if (!busy) return take();
    if (c.wantTab !== tabId || !c.wantAt) {
      await tx.pageClaim.update({ where, data: { wantTab: tabId, wantAt: now } });
      return { claimed: false, waiting: true, waitMs: HANDOVER_CAP_MS };
    }
    const waited = now.getTime() - c.wantAt.getTime();
    if (waited >= HANDOVER_CAP_MS) return take();
    return { claimed: false, waiting: true, waitMs: HANDOVER_CAP_MS - waited };
  });
}

/**
 * (§380 J) The copy holding the page says how its press went. `done` (its press answered and its redraw landed): no longer busy, and it learns whether a newer
 * copy is waiting (`wanted`: it then keeps its unsent drafts and hands over with `release`). `moved`: this copy no longer holds the page.
 */
export async function pageHandover(userId: string, scope: string, tab: string, what: "done" | "release"): Promise<{ moved?: true; wanted?: true }> {
  if (!isScope(scope) || !tab) throw new HttpError(400, "bad_request", "Something went wrong sending that. Reload the page and try again.");
  const tabId = tab.slice(0, 64);
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ tabId: string; wantTab: string }[]>`SELECT "tabId", "wantTab" FROM "PageClaim" WHERE "userId" = ${userId} AND scope = ${scope} FOR UPDATE`;
    const c = rows[0];
    if (!c || c.tabId !== tabId) return { moved: true as const };
    const where = { userId_scope: { userId, scope } };
    if (what === "release") {
      // To the copy waiting (it finds itself holding the page on its next ask); with nobody waiting, nothing changes but the busy mark.
      if (c.wantTab) await tx.pageClaim.update({ where, data: { tabId: c.wantTab, claimedAt: new Date(), beatAt: new Date(), busy: false, wantTab: "", wantAt: null } });
      else await tx.pageClaim.update({ where, data: { busy: false } });
      return {};
    }
    // A copy is waiting: this one stays busy until it has kept its drafts and handed over (or the waiting copy's cap runs out).
    if (c.wantTab) {
      await tx.pageClaim.update({ where, data: { beatAt: new Date() } });
      return { wanted: true as const };
    }
    await tx.pageClaim.update({ where, data: { busy: false, beatAt: new Date() } });
    return {};
  });
}

/** Does `tab` still hold this page? True when nobody claimed it yet (a page from before §380, or a claim still on its way). */
export async function holdsPage(userId: string, scope: string, tab: string) {
  const c = await db.pageClaim.findUnique({ where: { userId_scope: { userId, scope } }, select: { tabId: true } });
  return !c || c.tabId === tab.slice(0, 64);
}

/** Paths a moved page may still call: claiming the page again (Back to it, a reload), the handover, and signing out. */
const FREE_PATHS = /^\/api\/(page-claim|page-handover|auth\/)/;

/**
 * Every press from a one-at-a-time page names it (x-page, with its tab in x-tab): a press from a copy that no longer holds the claim is refused with the one line
 * (the page then goes to the dashboard). Reads (GET) are never refused here: the page learns through its poll (pulse's `moved`).
 * (§380 J) A press that locks the page (x-press) marks the holder busy: a new copy opened meanwhile waits for it (the copy says "done" when it's over).
 */
export async function checkPageClaim(req: Request, userId: string) {
  const scope = req.headers.get("x-page"), tab = req.headers.get("x-tab");
  if (!scope || !tab || !isScope(scope) || req.method === "GET" || req.method === "HEAD") return;
  if (FREE_PATHS.test(new URL(req.url, "http://x").pathname)) return;
  if (!(await holdsPage(userId, scope, tab))) throw new HttpError(409, PAGE_MOVED_CODE, PAGE_MOVED_LINE);
  if (req.headers.get("x-press") === "1") await db.pageClaim.updateMany({ where: { userId, scope, tabId: tab.slice(0, 64) }, data: { busy: true, beatAt: new Date() } });
}

/** For a poll from a one-at-a-time page (x-page, x-tab): has another copy claimed it since? */
export async function pageMoved(req: Request, userId: string) {
  const scope = req.headers.get("x-page"), tab = req.headers.get("x-tab");
  if (!scope || !tab || !isScope(scope)) return false;
  return !(await holdsPage(userId, scope, tab));
}
