import { devRestricted, type Restrictable } from "@/lib/restricted";

type Who = Restrictable & { isDeveloper: boolean; isTester: boolean; side?: string };

// (Design doc 2; owner, Oct 27) Pages a restricted account may not open.
//  - A developer under an admin suspension, a payment hold or a chargeback hold: test pages and Edit, Post a test, Messages and chats, and the profile editor.
//    Payments (Pay what you owe, receipts, the card), Settings / Account and Contact us stay open.
//  - A suspended tester: Find tests, the profile editor and Messages.
export function closedForSuspended(path: string, u: Who, side?: string | null) {
  const p = path.split(/[?#]/)[0].replace(/\/$/, "");
  const dev = u.isDeveloper && devRestricted(u, side);
  if (dev && (p === "/app/tests" || p.startsWith("/app/tests/"))) return true;
  if (dev && (p === "/app/messages" || p.startsWith("/app/chat/") || p === "/app/profile")) return true;
  if (u.suspendedAt && (p === "/app/messages" || p.startsWith("/app/chat/") || p === "/app/profile")) return true;
  if (u.suspendedAt && u.isTester && (p === "/app/find" || p.startsWith("/app/find/"))) return true;
  return false;
}
