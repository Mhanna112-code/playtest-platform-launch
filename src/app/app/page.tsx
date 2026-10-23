import Link from "next/link";
import { CalendarClock, Compass, Gamepad2, LayoutGrid, PlusCircle } from "lucide-react";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { termsLine } from "@/lib/rules";
import { requirePageUser } from "@/lib/server/page-auth";
import { ProfileForm } from "./profile/ProfileForm";
import { NoThanks } from "./NoThanks";
import { DeveloperTiles } from "@/components/ProfileTiles";

export const metadata = { title: "Home · Playtest" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { open: "Open", closed: "Not taking new testers", stopped: "Stopped", draft: "Draft" };

export default async function AppHome() {
  const u = await requirePageUser();
  if (!u.isDeveloper && !u.isTester)
    return (
      <>
        <h1>Welcome to Playtest</h1>
        <p className="note">Tell us who you are. You can change this later in Profile.</p>
        <ProfileForm first init={{ name: u.name, pronoun: u.pronoun, isDeveloper: false, isTester: false, devices: [], categories: [], languages: [], bio: "" }} />
      </>
    );
  const [tests, sessions] = await Promise.all([
    u.isDeveloper
      ? db.test.findMany({
          where: { developerId: u.id },
          orderBy: { createdAt: "desc" },
          include: { contracts: { select: { status: true, submissions: { select: { review: { select: { id: true } } } } } } },
        })
      : [],
    u.isTester ? db.contract.findMany({ where: { testerId: u.id }, orderBy: { joinedAt: "desc" } }) : [],
  ]);
  const invites = u.isTester ? await db.invite.findMany({ where: { testerId: u.id, status: "sent", test: { status: "open" } }, include: { test: { include: { developer: true } } } }) : [];
  // The full app's dashboard: "Welcome back," and the name; the tests / sessions as cards.
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-ink-400">Welcome back,</p>
          <h1 className="text-3xl font-bold tracking-tight text-white">{u.name || u.email}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {u.isDeveloper && <Link className="btn" href="/app/tests/new"><PlusCircle className="h-4 w-4" /> Post a test</Link>}
          {u.isTester && <Link className={u.isDeveloper ? "btn-secondary" : "btn"} href="/app/find"><Compass className="h-4 w-4" /> Find tests</Link>}
        </div>
      </div>
      {u.isDeveloper && (
        <div className="space-y-4">
          <DeveloperTiles userId={u.id} />
        </div>
      )}
      {u.isDeveloper && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white"><LayoutGrid className="h-5 w-5 text-volt-300" /> Your tests</h2>
          {tests.length === 0 && <p className="note">You haven&apos;t posted a test yet.</p>}
          <ul className="grid gap-4 sm:grid-cols-2">
            {tests.map((t) => {
              const working = t.contracts.filter((c) => c.status === "working").length;
              const toPay = t.contracts.flatMap((c) => c.submissions).filter((s) => !s.review).length;
              return (
                <li key={t.id}>
                  <Link href={`/app/tests/${t.id}`} className="card card-hover block h-full space-y-3 text-ink-100 no-underline hover:no-underline">
                    <p className="text-lg font-semibold text-white">{t.title}</p>
                    <div className="flex flex-wrap gap-2">
                      <span className={`badge ${t.status === "open" ? "border-emerald-400/40 text-emerald-200" : ""}`}>{STATUS[t.status]}</span>
                      <span className="badge"><CalendarClock className="h-3.5 w-3.5" /> {t.deadlineDays} days per tester</span>
                      {toPay > 0 && <span className="badge border-amber-300/40 text-amber-200">{toPay} to pay</span>}
                    </div>
                    <p className="text-xs uppercase tracking-wide text-ink-500">Testers · {working} of {t.spots}</p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {u.isTester && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white"><Gamepad2 className="h-5 w-5 text-volt-300" /> Your sessions</h2>
          {invites.map((i) => (
            <div key={i.id} className="info flex flex-wrap items-center gap-2">
              <Link href={`/app/find/${i.testId}`} className="mr-auto">
                {i.test.developer.name || "A developer"} invited you to “{i.test.title}”. Open it and press Join.
              </Link>
              <NoThanks inviteId={i.id} />
            </div>
          ))}
          {sessions.length === 0 && <p className="note">You haven&apos;t joined a test yet.</p>}
          <ul className="grid gap-4 sm:grid-cols-2">
            {sessions.map((c) => (
              <li key={c.id}>
                <Link href={`/app/sessions/${c.id}`} className="card card-hover block h-full space-y-2 text-ink-100 no-underline hover:no-underline">
                  <p className="text-lg font-semibold text-white">{c.title}</p>
                  <div className="flex flex-wrap gap-2">
                    <span className={`badge ${c.status === "working" ? "border-emerald-400/40 text-emerald-200" : ""}`}>{c.status === "working" ? `Due ${fmtDate(c.dueAt)}` : c.status === "left" ? "You left" : "Ended"}</span>
                  </div>
                  <p className="note">{termsLine(c, true)}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
