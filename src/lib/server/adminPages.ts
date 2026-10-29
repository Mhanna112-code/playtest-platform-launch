import { redirect } from "next/navigation";
import { isAdmin } from "./session";

/** (Owner, Oct 28, batch 20 section 16) The pages an admin keeps under /app: the admin views of profiles and of Find (and the join page it opens), the account, the bell list and Contact us. */
const ADMIN_PAGES = ["/app/find", "/app/developers", "/app/testers", "/app/account", "/app/notifications", "/app/help"];
export const adminKeeps = (path: string) => ADMIN_PAGES.some((p) => path === p || path.startsWith(`${p}/`));
/**
 * (Owner, Oct 28, batch 20 section 16) An admin account is only an admin: every developer or tester page (the dashboard's sides, Post a test, Edit, test and session
 * pages, Payments, the profile editor, Messages, chats and calls) moves it to the admin console. The first sign-in's setup (name not set yet) stays on /app.
 */
export function adminAway(u: Parameters<typeof isAdmin>[0] & { name: string }, path: string) {
  if (!isAdmin(u) || adminKeeps(path)) return;
  if ((path === "/app" || path === "/app/") && !u.name.trim()) return;
  redirect("/admin");
}
