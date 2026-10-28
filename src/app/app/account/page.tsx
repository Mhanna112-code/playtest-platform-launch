import { DELETE_ENDS_SUBSCRIPTION, subscribed } from "@/lib/subscription";
import Link from "next/link";
import { Ban, Bell, Banknote, CheckCircle2, LifeBuoy, PlusCircle, ShieldCheck, UserRound, Building2 } from "lucide-react";
import { requirePageUser } from "@/lib/server/page-auth";
import { hasSide, sideFor } from "@/lib/sides";
import { ResendConfirm } from "@/components/ResendConfirm";
import { confirmSkipped } from "@/lib/server/users";
import { SideButton } from "./SideButton";
import { DeleteAccount } from "./DeleteAccount";
import { PasswordForm } from "../profile/PasswordForm";
import { SignOutAll } from "@/components/SignOut";
import { AccountRefresh } from "@/components/AccountRefresh";
import { restrictedOn } from "@/lib/closedPages";
import { devDeleteLines, testerDeleteFacts, testerDeleteLines } from "@/lib/server/deletion";

export const metadata = { title: "Account · Playtest" };
export const dynamic = "force-dynamic";

/**
 * Your account (opened from your name in the header): who you are on the side in use, the other side offered when it's off, and your
 * settings. The full app's /account, on lean's pages.
 */
export default async function AccountPage() {
  const u = await requirePageUser();
  const dev = hasSide(u, "developer"), tester = hasSide(u, "tester");
  const side = sideFor(u, "/app/account");
  // (Owner, Oct 27) The profile editor is closed while the account is suspended or (as a developer) on hold; the other settings stay.
  const profileClosed = restrictedOn(u, side);
  // (Owner, Oct 28, batch 16 section 30) Only the side in use: no "Developer, tester, or both" cards. With the other side off, one small line offers it;
  // with both on, nothing here (the header's switch changes sides).
  const sideName = side === "developer" ? "Developer" : side === "tester" ? "Tester" : "";
  const other = side === "developer" ? (tester ? null : { side: "tester" as const, line: "Want to test other people's products too?", label: "Start testing too" })
    : side === "tester" ? (dev ? null : { side: "developer" as const, line: "Want to post tests too?", label: "Start posting tests too" }) : null;
  // (Owner, Oct 28, batch 16 section 27) This page's load time: a change in another tab or device stops the first press here once.
  const seenAt = new Date().toISOString();
  const link = (href: string, Icon: typeof Bell, label: string, note: string) => (
    <li>
      <Link href={href} className="flex items-start gap-3 rounded-xl p-3 no-underline hover:bg-white/[0.04] hover:no-underline">
        <Icon className="mt-0.5 h-5 w-5 text-sky-300" />
        <span><span className="block font-medium text-white">{label}</span><span className="text-sm text-slate-400">{note}</span></span>
      </Link>
    </li>
  );
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <AccountRefresh />
      <div className="card space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-white" data-account-heading="">{u.name || u.email}{sideName ? ` · ${sideName}` : ""}</h1>
        <p className="text-slate-300">{u.email}{u.emailVerifiedAt ? <span className="ml-2 inline-flex items-center gap-1 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4" /> confirmed</span> : <span className="ml-2 text-sm text-amber-300">not confirmed yet</span>}</p>
        {!u.emailVerifiedAt && !confirmSkipped() && <div className="flex flex-wrap items-center gap-2 pt-1 text-sm"><ResendConfirm /></div>}
      </div>

      {other && (
        <div className="flex flex-wrap items-center gap-2 px-1 text-sm text-slate-300" data-other-side="">
          <span>{other.line}</span>
          <SideButton side={other.side} add seenAt={seenAt}><PlusCircle className="h-4 w-4" /> {other.label}</SideButton>
        </div>
      )}

      <section className="card">
        <h2 className="mb-1 font-semibold text-white">Settings</h2>
        <ul className="divide-y divide-white/5">
          {/* (Batch 16 section 30) Only the profile of the side in use. */}
          {side === "tester" && tester && !profileClosed && link("/app/profile", UserRound, "Tester profile", "Devices, languages and bio, as developers see them")}
          {side === "developer" && dev && !profileClosed && link("/app/profile", Building2, "Developer profile", "Your name, as testers see it on your tests")}
          {link("/app/payments", Banknote, "Payments", "What you've paid or been paid, and how payments are set up")}
          {link("/app/notifications", Bell, "Notifications and alerts", "How you're notified by email")}
          {link("/app/account/blocked", Ban, "Blocked people", "Who you've blocked, and Unblock")}
          {link("/privacy", ShieldCheck, "Privacy", "What we keep and why")}
          {link("/app/help", LifeBuoy, "Contact us", "Questions, problems, payments")}
        </ul>
      </section>
      {/* (Batch 16 section 30) "Your excerpts" is on the tester's own profile; a suspended tester removes them from the dashboard. */}
      <section id="password" className="scroll-mt-24"><PasswordForm hasPassword={!!u.passwordHash} seenAt={seenAt} /></section>
      {/* (Batch 15 section 41, L6) */}
      <section className="card space-y-2" data-sign-out-all="">
        <h2 className="font-semibold text-white">Signed-in devices</h2>
        <p className="text-sm text-slate-300">Signs this account out everywhere, this device included.</p>
        <SignOutAll />
      </section>
      {/* (Owner, Oct 28) A tester's pop-up carries their real numbers; a developer's blockers (DEFAULT) are listed with links. */}
      <DeleteAccount testerLines={tester ? testerDeleteLines(await testerDeleteFacts(u.id)) : undefined} devLines={dev ? await devDeleteLines(u.id) : []} subscriptionLine={subscribed(u) ? DELETE_ENDS_SUBSCRIPTION : ""} />
    </div>
  );
}
