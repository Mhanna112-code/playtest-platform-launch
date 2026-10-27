import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { devRestricted } from "@/lib/restricted";
import { hashToken, SESSION_COOKIE, userForToken } from "./session";

/** The signed-in user for a server component, or null. */
export async function getPageUser() {
  const jar = await cookies();
  return userForToken(jar.get(SESSION_COOKIE)?.value);
}

/**
 * (Owner, Oct 28) A developer's page that is closed while the account is suspended or on a hold (test pages, Edit, Post a test): the page itself sends the developer to the dashboard before
 * it renders anything, so the redirect never depends on the layout beating the page's first bytes.
 */
export async function requireOpenDevPage() {
  const u = await requirePageUser();
  if (u.isDeveloper && devRestricted(u, "developer")) redirect("/app");
  return u;
}

export async function requirePageUser() {
  const u = await getPageUser();
  if (!u) {
    // (Design doc 2) An account that was deleted meanwhile lands on the login page with a red notice.
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    const s = token ? await db.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: { select: { deletedAt: true } } } }) : null;
    redirect(s?.user.deletedAt ? "/login?gone=1" : "/login");
  }
  return u;
}
