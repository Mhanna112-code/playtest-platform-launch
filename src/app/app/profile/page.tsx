import { CheckCircle2 } from "lucide-react";
import { db } from "@/lib/db";
import { requirePageUser } from "@/lib/server/page-auth";
import { ProfileForm } from "./ProfileForm";
import { PasswordForm } from "./PasswordForm";
import { UnblockButton } from "@/components/BlockButton";
import { ratingSummary } from "@/lib/server/ratings";
import { CapacityCard } from "@/components/ProfileTiles";

export const metadata = { title: "Profile · Playtest" };

export default async function ProfilePage() {
  const u = await requirePageUser();
  const p = await db.testerProfile.findUnique({ where: { userId: u.id } });
  const blocks = await db.block.findMany({ where: { blockerId: u.id }, orderBy: { createdAt: "desc" } });
  const people = await db.user.findMany({ where: { id: { in: blocks.map((b) => b.blockedId) } } });
  const rating = await ratingSummary(u.id);
  // The full app's account page: the name and email card first, then one card per setting.
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="card space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-white">{u.name || "Profile"}</h1>
        <p className="text-slate-300">{u.email}{u.emailVerifiedAt ? <span className="ml-2 inline-flex items-center gap-1 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4" /> confirmed</span> : <span className="ml-2 text-sm text-amber-300">not confirmed yet</span>}</p>
        {(u.isDeveloper || u.isTester) && (
          <p className="flex flex-wrap gap-x-4 pt-1 text-sm">
            {u.isDeveloper && <a href={`/app/developers/${u.id}`} className="text-sky-300 hover:underline">See it as testers do</a>}
            {u.isTester && <a href={`/app/testers/${u.id}`} className="text-sky-300 hover:underline">See it as developers do</a>}
          </p>
        )}
      </div>
      {u.isDeveloper && <CapacityCard userId={u.id} />}
      <section className="card space-y-2" aria-label="Your ratings">
        <h2 className="font-semibold text-white">Your ratings</h2>
        {rating.line ? <p className="text-slate-200">{rating.line}</p> : <p className="text-sm text-slate-400">No ratings yet.</p>}
        {rating.comments.length > 0 && <ul className="list-disc pl-5 text-sm text-slate-300">{rating.comments.map((c, i) => <li key={i}>“{c}”</li>)}</ul>}
      </section>
      <ProfileForm init={{ name: u.name, pronoun: u.pronoun, isDeveloper: u.isDeveloper, isTester: u.isTester, devices: p?.devices ?? [], categories: p?.categories ?? [], languages: p?.languages ?? [], bio: p?.bio ?? "", emailPref: u.emailPref }} />
      <PasswordForm hasPassword={!!u.passwordHash} />
      <section className="card space-y-3" id="blocked">
        <h2 className="font-semibold text-white">Blocked people</h2>
        {blocks.length === 0 ? <p className="text-sm text-slate-400">You haven&apos;t blocked anyone.</p> : (
          <ul className="divide-y divide-white/5 text-sm">
            {people.map((x) => (
              <li key={x.id} className="flex items-center gap-2 py-2">
                <span className="mr-auto text-slate-200">{x.name || x.email}</span>
                <UnblockButton userId={x.id} />
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-slate-500">Unblocking doesn&apos;t reopen anything that ended.</p>
      </section>
    </div>
  );
}
