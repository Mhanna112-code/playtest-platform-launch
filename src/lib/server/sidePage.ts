import { headers } from "next/headers";
import { otherSideOfPage, type Side } from "@/lib/sides";
import { isAdmin } from "./session";

/** This request's page address (set by the middleware), without Next's internal `_rsc` parameter. */
export async function pagePath() {
  try {
    const raw = (await headers()).get("x-path") ?? "";
    return raw.replace(/([?&])_rsc=[^&]*&?/, "$1").replace(/[?&]$/, "");
  } catch {
    return ""; // outside a request (a script or a test)
  }
}

/**
 * (Owner, Oct 30, batch 34 §5) Is this page on the account's other side? Then the app layout shows only "This page is on your <side> side." with the switch
 * button, and the page itself renders nothing (it runs alongside the layout, so it returns at once: nothing of the other side is read, marked or sent).
 * `role`: a page whose side is the person's role in one contract (a chat, a call) names it; other pages go by their address.
 */
export async function otherSideHere(u: { id: string; isDeveloper: boolean; isTester: boolean; side?: string } & Parameters<typeof isAdmin>[0], role?: Side): Promise<Side | null> {
  if (isAdmin(u)) return null;
  if (role) return u.isDeveloper && u.isTester && role !== (u.side === "tester" ? "tester" : "developer") ? role : null;
  return otherSideOfPage(u, await pagePath());
}

/** (Batch 34 §5) The contracts of the side in use (as the tester, or on your own tests); no side (an admin): both. */
export function contractsOnSide(userId: string, side: Side | null) {
  return side === "tester" ? { testerId: userId } : side === "developer" ? { test: { developerId: userId } } : { OR: [{ testerId: userId }, { test: { developerId: userId } }] };
}
