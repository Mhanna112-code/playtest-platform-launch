import { otherSideHere, pagePath } from "@/lib/server/sidePage";
import type { Side } from "@/lib/sides";
import { OtherSidePage } from "./OtherSidePage";

/**
 * (Owner, Oct 30, batch 34 §5) For a page of the other side: the notice "This page is on your <side> side." with the switch button, or null on the side in
 * use. Each side page calls it first, right after signing in, and returns it: nothing of the other side is read, recorded or marked read (the layout
 * stays put while moving between pages, so the page itself shows it). `role`: a chat or a call goes by the person's role.
 */
export async function otherSideNotice(u: Parameters<typeof otherSideHere>[0], role?: Side, next?: string) {
  const side = await otherSideHere(u, role);
  if (!side) return null;
  const path = next ?? (await pagePath());
  return <OtherSidePage side={side} next={path.startsWith("/app") ? path : "/app"} />;
}
