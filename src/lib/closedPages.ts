// (Design doc 2) Pages a suspended account may not open. A suspended developer: test pages, Post a test and Messages. A suspended
// tester: Find tests, editing the profile and Messages. Everything else stays (the dashboard, Payments, Settings and Contact us).
export function closedForSuspended(path: string, u: { isDeveloper: boolean; isTester: boolean }) {
  const p = path.split(/[?#]/)[0].replace(/\/$/, "");
  if (p === "/app/messages" || p.startsWith("/app/chat/")) return true;
  if (u.isDeveloper && (p === "/app/tests" || p.startsWith("/app/tests/"))) return true;
  if (u.isTester && (p === "/app/find" || p.startsWith("/app/find/") || p === "/app/profile")) return true;
  return false;
}
