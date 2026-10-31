import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { closedForSuspended } from "@/lib/closedPages";
import { sideFor } from "@/lib/sides";
import { hashToken, SESSION_COOKIE, userForToken } from "./session";
import { adminAway } from "./adminPages";
import { otherSideHere } from "./sidePage";
export { adminAway, adminKeeps } from "./adminPages";

/** The signed-in user for a server component, or null. */
export async function getPageUser() {
  const jar = await cookies();
  return userForToken(jar.get(SESSION_COOKIE)?.value);
}

/**
 * (Owner, Oct 28) A page that is closed while the account is restricted (a suspended tester; a developer under a suspension, a payment hold or a chargeback hold on their developer
 * side): every signed-in page except the dashboard, Payments, Settings and the bell list. The page itself sends them to the dashboard top before it renders anything, so the
 * redirect never depends on the layout beating the page's first bytes. `path` is the page's address.
 */
export async function requireOpenPage(path: string) {
  const u = await requirePageUser();
  adminAway(u, path);
  // (Batch 34 §5) A page of the other side shows the switch notice instead (the page returns at once: otherSideHere); its side's restriction applies once switched.
  if (!(await otherSideHere(u)) && closedForSuspended(path, u, sideFor(u, path))) redirect("/app");
  return u;
}


/** The same for a page whose side is the person's role in one contract (a chat, a call): checked once the page knows the role. */
export function leaveIfClosed(u: { isDeveloper: boolean; isTester: boolean; side?: string; devSuspendedAt?: Date | null; testerSuspendedAt?: Date | null; holdStartedAt?: Date | null; holdReason?: string | null }, path: string, role: "developer" | "tester") {
  if (closedForSuspended(path, u, sideFor(u, path), role)) redirect("/app");
}

/** Test pages, Edit and Post a test. */
export const requireOpenDevPage = () => requireOpenPage("/app/tests");

export async function requirePageUser() {
  // (Batch 28 §1) Every page load is a heartbeat (at most one check a minute; only with OUTAGE_CHECKS=1).
  void import("./outages").then((m) => m.touchHeartbeat()).catch(() => null);
  const u = await getPageUser();
  if (!u) {
    // (Design doc 2) An account that was deleted meanwhile lands on the login page with a red notice.
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    const s = token ? await db.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: { select: { deletedAt: true } } } }) : null;
    redirect(s?.user.deletedAt ? "/login?gone=1" : "/login");
  }
  return u;
}
