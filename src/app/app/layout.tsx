import Link from "next/link";
import { Brand } from "@/components/Brand";
import { db } from "@/lib/db";
import { SignOut } from "@/components/SignOut";
import { requirePageUser } from "@/lib/server/page-auth";
import { isAdmin } from "@/lib/server/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const u = await requirePageUser();
  const unread = await db.notification.count({ where: { userId: u.id, readAt: null } });
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-ink-950/80 backdrop-blur">
        <nav className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-1 gap-y-2 px-4 py-3">
          <span className="mr-3"><Brand /></span>
          <Link className="nav-link" href="/app">Home</Link>
          {u.isDeveloper && <Link className="nav-link" href="/app/tests/new">Post a test</Link>}
          {u.isTester && <Link className="nav-link" href="/app/find">Find tests</Link>}
          <Link className="nav-link" href="/app/payments">Payments</Link>
          <Link className="nav-link" href="/app/notifications" aria-label={`Notifications, ${unread} unread`}>🔔{unread > 0 && <span className="ml-1 rounded-full bg-punch-500 px-1.5 text-xs font-semibold text-white">{unread}</span>}</Link>
          <Link className="nav-link" href="/app/profile">Profile</Link>
          {isAdmin(u) && <Link className="nav-link" href="/admin">Admin</Link>}
          <span className="ml-auto" />
          <span className="text-xs text-ink-400">{u.email}</span>
          <SignOut />
        </nav>
      </header>
      {u.suspendedAt && (
        <p className="mx-auto mt-4 max-w-4xl px-4">
          <span className="info block">Your account is paused. You can look around, but actions are switched off. Contact support if you think this is a mistake.</span>
        </p>
      )}
      <main className="wrap space-y-6">{children}</main>
    </>
  );
}
