import Link from "next/link";
import { Bell, Compass, CreditCard, LayoutDashboard, MailCheck, PlusCircle, ShieldCheck, UserRound } from "lucide-react";
import { Brand } from "@/components/Brand";
import { db } from "@/lib/db";
import { SignOut } from "@/components/SignOut";
import { ResendConfirm } from "@/components/ResendConfirm";
import { confirmSkipped } from "@/lib/server/users";
import { requirePageUser } from "@/lib/server/page-auth";
import { isAdmin } from "@/lib/server/session";

// The full Playtest Platform's header (NEWEST+8): logo, the side's links with their icons, the bell, the account pill
// and the log-out icon; the confirm-email strip under it; a wide main column.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const u = await requirePageUser();
  const unread = await db.notification.count({ where: { userId: u.id, readAt: null } });
  const name = u.name.trim() || u.email;
  const side = u.isDeveloper && u.isTester ? "Developer · Tester" : u.isDeveloper ? "Developer" : u.isTester ? "Tester" : "";
  return (
    <>
      <header className="sticky top-0 z-20 border-b border-white/[0.07] bg-ink-950/75 backdrop-blur-xl">
        <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-2 gap-y-2 px-4 py-3">
          <Brand />
          <div className="ml-4 flex flex-wrap items-center gap-1">
            {isAdmin(u) && <Link href="/admin" className="nav-link text-punch-200"><ShieldCheck className="h-4 w-4" /> Admin</Link>}
            <Link className="nav-link" href="/app"><LayoutDashboard className="h-4 w-4" /> Dashboard</Link>
            {u.isDeveloper && <Link className="nav-link" href="/app/tests/new"><PlusCircle className="h-4 w-4" /> Post a test</Link>}
            {u.isTester && <Link className="nav-link" href="/app/find"><Compass className="h-4 w-4" /> Find tests</Link>}
            <Link className="nav-link" href="/app/profile"><UserRound className="h-4 w-4" /> Profile</Link>
            <Link className="nav-link" href="/app/payments"><CreditCard className="h-4 w-4" /> Payments</Link>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Link className="nav-link relative" href="/app/notifications" aria-label={`Notifications, ${unread} unread`}>
              <Bell className="h-4 w-4" />
              {unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-punch-500 px-1.5 text-[10px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>}
            </Link>
            <Link href="/app/profile" title="Your account" className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] py-1 pl-1 pr-1 text-sm text-ink-300 no-underline transition hover:border-white/25 hover:text-white hover:no-underline sm:pr-3">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-volt-300 to-sky-300 text-xs font-semibold text-ink-950">{name.charAt(0).toUpperCase()}</span>
              <span className="hidden max-w-[12rem] truncate sm:inline" title={u.email}>{name}</span>
              {side && <span className="hidden shrink-0 text-ink-500 sm:inline">· {side}</span>}
            </Link>
            <SignOut />
          </div>
        </nav>
      </header>
      {!u.emailVerifiedAt && (
        <div className="flex flex-wrap items-center justify-center gap-2 border-b border-sky-300/20 bg-sky-300/10 px-4 py-2 text-sm text-sky-100">
          <MailCheck className="h-4 w-4 text-sky-300" />
          {confirmSkipped() ? (
            <span>Email confirmation is off for testing.</span>
          ) : (
            <>
              <span>Confirm your email: we sent a link to <strong>{u.email}</strong>. You can still look around, but posting and joining tests require you to confirm.</span>
              <ResendConfirm />
            </>
          )}
        </div>
      )}
      {u.suspendedAt && (
        <p className="mx-auto mt-4 max-w-6xl px-4">
          <span className="info block">Your account is paused. You can look around, but actions are switched off. Contact support if you think this is a mistake.</span>
        </p>
      )}
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">{children}</main>
    </>
  );
}
