import { db } from "@/lib/db";
import { PAGE_MOVED_CODE, PAGE_MOVED_LINE, isScope } from "@/lib/pageClaim";
import { HttpError } from "./http";

// (Owner, Nov 11, §380) One page at a time, across devices (lib/pageClaim.ts). The claim is the newest copy's tab id; nothing waits for anything.

/** May this person claim this page? The developer of the test, or the tester of the session. */
async function ownsScope(userId: string, scope: string) {
  const [kind, id] = scope.split(":");
  if (kind === "test") return !!(await db.test.findFirst({ where: { id, developerId: userId }, select: { id: true } }));
  return !!(await db.contract.findFirst({ where: { id, testerId: userId }, select: { id: true } }));
}

/** Opening the page: this tab now holds it (the newest always wins). */
export async function claimPage(userId: string, scope: string, tab: string) {
  if (!isScope(scope) || !tab) throw new HttpError(400, "bad_request", "Something went wrong sending that. Reload the page and try again.");
  if (!(await ownsScope(userId, scope))) throw new HttpError(404, "not_found", "Not found.");
  const tabId = tab.slice(0, 64);
  await db.pageClaim.upsert({ where: { userId_scope: { userId, scope } }, create: { userId, scope, tabId }, update: { tabId, claimedAt: new Date() } });
}

/** Does `tab` still hold this page? True when nobody claimed it yet (a page from before §380, or a claim still on its way). */
export async function holdsPage(userId: string, scope: string, tab: string) {
  const c = await db.pageClaim.findUnique({ where: { userId_scope: { userId, scope } }, select: { tabId: true } });
  return !c || c.tabId === tab.slice(0, 64);
}

/** Paths a moved page may still call: claiming the page again (Back to it, a reload) and signing out. */
const FREE_PATHS = /^\/api\/(page-claim|auth\/)/;

/**
 * Every press from a one-at-a-time page names it (x-page, with its tab in x-tab): a press from a copy that no longer holds the claim is refused with the one line
 * (the page then goes to the dashboard). Reads (GET) are never refused here: the page learns through its poll (pulse's `moved`).
 */
export async function checkPageClaim(req: Request, userId: string) {
  const scope = req.headers.get("x-page"), tab = req.headers.get("x-tab");
  if (!scope || !tab || !isScope(scope) || req.method === "GET" || req.method === "HEAD") return;
  if (FREE_PATHS.test(new URL(req.url, "http://x").pathname)) return;
  if (!(await holdsPage(userId, scope, tab))) throw new HttpError(409, PAGE_MOVED_CODE, PAGE_MOVED_LINE);
}

/** For a poll from a one-at-a-time page (x-page, x-tab): has another copy claimed it since? */
export async function pageMoved(req: Request, userId: string) {
  const scope = req.headers.get("x-page"), tab = req.headers.get("x-tab");
  if (!scope || !tab || !isScope(scope)) return false;
  return !(await holdsPage(userId, scope, tab));
}
