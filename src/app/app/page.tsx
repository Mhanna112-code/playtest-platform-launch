import Link from "next/link";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { termsLine } from "@/lib/rules";
import { requirePageUser } from "@/lib/server/page-auth";
import { ProfileForm } from "./profile/ProfileForm";

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
  return (
    <>
      {u.isDeveloper && (
        <section className="space-y-3">
          <div className="flex items-center gap-3">
            <h1 className="mr-auto">Your tests</h1>
            <Link className="btn" href="/app/tests/new">Post a test</Link>
          </div>
          {tests.length === 0 && <p className="note">You haven&apos;t posted a test yet.</p>}
          {tests.map((t) => {
            const working = t.contracts.filter((c) => c.status === "working").length;
            const toPay = t.contracts.flatMap((c) => c.submissions).filter((s) => !s.review).length;
            return (
              <Link key={t.id} href={`/app/tests/${t.id}`} className="panel block text-slate-900 no-underline hover:no-underline">
                <div className="flex flex-wrap items-baseline gap-2">
                  <h3 className="mr-auto">{t.title}</h3>
                  <span className="badge">{STATUS[t.status]}</span>
                </div>
                <p className="note">
                  {working} of {t.spots} testers working{toPay ? ` · ${toPay} sent piece${toPay === 1 ? "" : "s"} to pay` : ""}
                </p>
              </Link>
            );
          })}
        </section>
      )}
      {u.isTester && (
        <section className="space-y-3">
          <div className="flex items-center gap-3">
            <h1 className="mr-auto">Your sessions</h1>
            <Link className="btn" href="/app/find">Find tests</Link>
          </div>
          {sessions.length === 0 && <p className="note">You haven&apos;t joined a test yet.</p>}
          {sessions.map((c) => (
            <Link key={c.id} href={`/app/sessions/${c.id}`} className="panel block text-slate-900 no-underline hover:no-underline">
              <h3>{c.title}</h3>
              <p className="note">
                {c.status === "working" ? `Due ${fmtDate(c.dueAt)}` : c.status === "left" ? "You left" : "Ended"} · {termsLine(c, true)}
              </p>
            </Link>
          ))}
        </section>
      )}
    </>
  );
}
