import Link from "next/link";
import { FieldChecks } from "@/components/FieldChecks";
import { ArrowLeftRight, Bell, Compass, CreditCard, LayoutDashboard, MailCheck, MessagesSquare, PlusCircle, ShieldCheck, UserRound } from "lucide-react";
import { headers } from "next/headers";
import { after } from "next/server";
import { hasBoth, sideFor, sideForPath } from "@/lib/sides";
import { unreadCount } from "@/lib/server/messages";
import { Brand } from "@/components/Brand";
import { db } from "@/lib/db";
import { SignOut } from "@/components/SignOut";
import { ResendConfirm } from "@/components/ResendConfirm";
import { confirmSkipped } from "@/lib/server/users";
import { requirePageUser } from "@/lib/server/page-auth";
import { isAdmin } from "@/lib/server/session";
import { redirect } from "next/navigation";
import { closedForSuspended, restrictedOn } from "@/lib/closedPages";
import { restrictionKey } from "@/lib/restricted";
import { SessionWatch } from "@/components/SessionWatch";

// The full Playtest Platform's header (NEWEST+8): logo, the side's links with their icons, the bell, the account pill
// and the log-out icon; the confirm-email strip under it; a wide main column.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const u = await requirePageUser();
  // (NEXT-UI 6) The side this tab shows: the page's own side (developer pages, tester pages), else the side used last.
  const path = (await headers()).get("x-path") ?? "";
  const side = sideFor(u, path);
  // (Design doc 2; owner, Oct 27) A suspended or held account is routed from the pages that are closed to it to the dashboard, which explains.
  // (Owner, Oct 28) Decided BEFORE any other query: the page below renders in parallel with this layout, and a redirect thrown late can reach the browser after the page's first bytes (a blank page with only the footer).
  if (closedForSuspended(path, u, side)) redirect("/app");
  const unread = await db.notification.count({ where: { userId: u.id, readAt: null } });
  const name = u.name.trim() || u.email;
  // (Owner, Oct 28) Restricted on this side: a suspended account (both sides), or a developer on a payment or chargeback hold on their developer side.
  const off = restrictedOn(u, side);
  // Following a link to a page of the other side remembers it as the side used last (what shared pages then show).
  const pageSide = hasBoth(u) ? sideForPath(path) : null;
  if (pageSide && pageSide !== u.side) after(() => db.user.update({ where: { id: u.id }, data: { side: pageSide } }).catch(() => null));
  const contracts = await db.contract.findMany({ where: { OR: [{ testerId: u.id }, { test: { developerId: u.id } }] }, select: { testId: true, testerId: true } });
  const unreadChats = (await Promise.all(contracts.map((c) => unreadCount(u.id, c.testId, c.testerId)))).reduce((a, b) => a + b, 0);
  // (Owner, Oct 28) A restricted account keeps only the links to pages it can open: Dashboard, Payments, the bell and the account (Settings). Post a test, Find tests,
  // Profile and Messages are hidden.
  const messagesLink = off ? null : (
    <Link className="nav-link relative" href="/app/messages"><MessagesSquare className="h-4 w-4" /> Messages
      {unreadChats > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-fuchsia-400 px-1.5 text-[10px] font-bold text-ink-950">{unreadChats > 9 ? "9+" : unreadChats}</span>}
    </Link>
  );
  return (
    <>
      <header data-app-shell className="sticky top-0 z-20 border-b border-white/[0.07] bg-ink-950/75 backdrop-blur-xl">
        <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-2 gap-y-2 px-4 py-3">
          <Brand />
          <div className="ml-4 flex flex-wrap items-center gap-1">
            {isAdmin(u) && <Link href="/admin" className="nav-link text-punch-200"><ShieldCheck className="h-4 w-4" /> Admin</Link>}
            {/* Each side has its own links: developer: Dashboard, Post a test, Profile, Payments, Messages; tester: Dashboard, Find tests, Profile, Payments, Messages. */}
            <Link className="nav-link" href="/app"><LayoutDashboard className="h-4 w-4" /> Dashboard</Link>
            {side === "developer" && !off && <Link className="nav-link" href="/app/tests/new"><PlusCircle className="h-4 w-4" /> Post a test</Link>}
            {side === "tester" && !off && <Link className="nav-link" href="/app/find"><Compass className="h-4 w-4" /> Find tests</Link>}
            {!off && <Link className="nav-link" href="/app/profile"><UserRound className="h-4 w-4" /> Profile</Link>}
            <Link className="nav-link" href="/app/payments"><CreditCard className="h-4 w-4" /> Payments</Link>
            {messagesLink}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Link className="nav-link relative" href="/app/notifications" aria-label={`Notifications, ${unread} unread`}>
              <Bell className="h-4 w-4" />
              {unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-punch-500 px-1.5 text-[10px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>}
            </Link>
            <Link href="/app/account" title="Your account" className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] py-1 pl-1 pr-1 text-sm text-ink-300 no-underline transition hover:border-white/25 hover:text-white hover:no-underline sm:pr-3">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-volt-300 to-sky-300 text-xs font-semibold text-ink-950">{name.charAt(0).toUpperCase()}</span>
              <span className="hidden max-w-[12rem] truncate sm:inline" title={u.email}>{name}</span>
              {side && <span className="hidden shrink-0 text-ink-500 sm:inline">· {side === "developer" ? "Developer" : "Tester"}</span>}
            </Link>
            {hasBoth(u) && side && (
              // Goes to the other side's dashboard (and remembers it as the side used last).
              <Link href={`/app/switch?to=${side === "developer" ? "tester" : "developer"}&next=/app`} className="nav-link border border-white/10"
                title={`Go to your ${side === "developer" ? "tester" : "developer"} side`} aria-label={`Switch to ${side === "developer" ? "tester" : "developer"}`}>
                <ArrowLeftRight className="h-4 w-4" /> <span className="hidden 2xl:inline">{side === "developer" ? "Tester" : "Developer"}</span>
              </Link>
            )}
            <SignOut />
          </div>
        </nav>
      </header>
      {/* (Owner, Oct 27) The strip "Email confirmation is off for testing." is back while SKIP_EMAIL_CONFIRM=1 (never in production). Email confirmation is needed only for Post a test, Join, Apply and accepting an invite: a blocked press says so under the button. */}
      {confirmSkipped() && (
        <div className="flex flex-wrap items-center justify-center gap-2 border-b border-sky-300/20 bg-sky-300/10 px-4 py-2 text-sm text-sky-100" data-confirm-off="">
          <MailCheck className="h-4 w-4 text-sky-300" />
          <span>Email confirmation is off for testing.</span>
        </div>
      )}
      {!u.emailVerifiedAt && !confirmSkipped() && (
        <div className="flex flex-wrap items-center justify-center gap-2 border-b border-sky-300/20 bg-sky-300/10 px-4 py-2 text-sm text-sky-100">
          <MailCheck className="h-4 w-4 text-sky-300" />
          <span>Confirm your email: we sent a link to <strong>{u.email}</strong>. You can still look around, but posting and joining tests require you to confirm.</span>
          <ResendConfirm />
        </div>
      )}
      {/* A restricted account's blue box is at the top of the dashboard; other open pages (Payments, Settings) carry this one line. */}
      {off && !/^\/app\/?(\?.*)?$/.test(path) && (
        <p className="mx-auto mt-4 max-w-6xl px-4" data-suspended-strip="">
          <span className="info block">
            {/* (Batch 15 section 16) The side in use names its own suspension. */}
            {(side === "tester" ? u.testerSuspendedAt : u.devSuspendedAt) ? <>Your {u.isDeveloper && u.isTester ? `${side === "tester" ? "tester" : "developer"} account` : "account"} is {side === "tester" ? "paused" : "suspended"}. To appeal, use <Link href="/app/help" className="underline">Contact us</Link> in Settings.</> : u.holdReason === "chargeback" ? <>Your tests are paused after a chargeback. <Link href="/app/payments#chargeback-steps" className="underline">Follow the steps in Payments</Link>.</> : <>Your tests are paused until you pay what you owe. <Link href="/app/payments#owed" className="underline">Pay what you owe</Link>.</>}
          </span>
        </p>
      )}
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">{children}</main>
      <FieldChecks />
      <SessionWatch userId={u.id} name={name} restriction={restrictionKey(u, side)} />
    </>
  );
}
