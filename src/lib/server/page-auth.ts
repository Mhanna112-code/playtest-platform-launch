import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, userForToken } from "./session";

/** The signed-in user for a server component, or null. */
export async function getPageUser() {
  const jar = await cookies();
  return userForToken(jar.get(SESSION_COOKIE)?.value);
}

export async function requirePageUser() {
  const u = await getPageUser();
  if (!u) redirect("/login");
  return u;
}
