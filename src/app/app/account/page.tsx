import Link from "next/link";
import { ArrowLeftRight, Ban, Bell, Banknote, CheckCircle2, KeyRound, LifeBuoy, PlusCircle, ShieldCheck, UserRound, Building2 } from "lucide-react";
import { requirePageUser } from "@/lib/server/page-auth";
import { hasSide, sideFor } from "@/lib/sides";
import { ResendConfirm } from "@/components/ResendConfirm";
import { confirmSkipped } from "@/lib/server/users";
import { SideButton } from "./SideButton";
import { DeleteAccount } from "./DeleteAccount";
import { PasswordForm } from "../profile/PasswordForm";
import { devRestricted } from "@/lib/restricted";
import { devDeleteBlockers, testerDeleteFacts, testerDeleteLines } from "@/lib/server/deletion";

export const metadata = { title: "Account · Playtest" };
export const dynamic = "force-dynamic";

/**
 * Your account (opened from your name in the header): who you are, which sides you have (developer, tester or both) with
 * the switch, and your settings. The full app's /account, on lean's pages.
 */
export default async function AccountPage() {
  const u = await requirePageUser();
  const dev = hasSide(u, "developer"), tester = hasSide(u, "tester");
  const side = sideFor(u, "/app/account");
  // (Owner, Oct 27) The profile editor is closed while the account is suspended or (as a developer) on hold; the other settings stay.
  const profileClosed = !!u.suspendedAt || (dev && devRestricted(u, side));
  const sides = [
    { side: "developer" as const, has: dev, title: "Developer", what: "Post tests and pay testers for feedback.", addLabel: "Start posting tests too" },
    { side: "tester" as const, has: tester, title: "Tester", what: "Test other people's products and get paid.", addLabel: "Start testing too" },
  ];
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
      <div className="card space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-white">{u.name || u.email}</h1>
        <p className="text-slate-300">{u.email}{u.emailVerifiedAt ? <span className="ml-2 inline-flex items-center gap-1 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4" /> confirmed</span> : <span className="ml-2 text-sm text-amber-300">not confirmed yet</span>}</p>
        {!u.emailVerifiedAt && !confirmSkipped() && <div className="flex flex-wrap items-center gap-2 pt-1 text-sm"><ResendConfirm /></div>}
      </div>

      <section className="card space-y-3">
        <h2 className="font-semibold text-white">Developer, tester, or both</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {sides.map((s) => (
            <li key={s.side} className={`space-y-2 rounded-xl border p-3 ${side === s.side ? "border-volt-300/40 bg-volt-300/[0.05]" : "border-white/10"}`}>
              <p className="flex items-center justify-between gap-2 font-medium text-white">{s.title}
                {side === s.side ? <span className="badge border-volt-300/40 text-volt-200">using now</span> : s.has ? <span className="badge">on</span> : <span className="badge text-slate-400">off</span>}
              </p>
              <p className="text-sm text-slate-400">{s.what}</p>
              {side !== s.side && (
                <SideButton side={s.side} add={!s.has}>
                  {s.has ? <><ArrowLeftRight className="h-4 w-4" /> Switch to {s.title.toLowerCase()}</> : <><PlusCircle className="h-4 w-4" /> {s.addLabel}</>}
                </SideButton>
              )}
            </li>
          ))}
        </ul>
        <p className="text-xs text-slate-500">Switch here between developer and tester accounts.</p>
      </section>

      <section className="card">
        <h2 className="mb-1 font-semibold text-white">Settings</h2>
        <ul className="divide-y divide-white/5">
          {tester && !profileClosed && link("/app/profile", UserRound, "Tester profile", "Devices, languages and bio, as developers see them")}
          {dev && !profileClosed && link("/app/profile", Building2, "Developer profile", "Your name, as testers see it on your tests")}
          {link("/app/payments", Banknote, "Payments", "What you've paid or been paid, and how payments are set up")}
          {link("/app/notifications", Bell, "Notifications and alerts", "How you're notified by email")}
          {link("/app/account/blocked", Ban, "Blocked people", "Who you've blocked, and Unblock")}
          {link("#password", KeyRound, "Change password", "Your other devices are signed out")}
          {link("/privacy", ShieldCheck, "Privacy", "What we keep and why")}
          {link("/app/help", LifeBuoy, "Contact us", "Questions, problems, payments")}
        </ul>
      </section>
      <section id="password" className="scroll-mt-24"><PasswordForm hasPassword={!!u.passwordHash} /></section>
      {/* (Owner, Oct 28) A tester's pop-up carries their real numbers; a developer's blockers (DEFAULT) are listed with links. */}
      <DeleteAccount testerLines={tester ? testerDeleteLines(await testerDeleteFacts(u.id)) : undefined} blockers={dev ? await devDeleteBlockers(u.id) : []} />
    </div>
  );
}
