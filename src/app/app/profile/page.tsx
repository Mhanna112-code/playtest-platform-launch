import Link from "next/link";
import { db } from "@/lib/db";
import { requirePageUser } from "@/lib/server/page-auth";
import { ProfileForm } from "./ProfileForm";
import { PasswordForm } from "./PasswordForm";
import { ratingSummary } from "@/lib/server/ratings";
import { CapacityCard } from "@/components/ProfileTiles";
import { sideFor } from "@/lib/sides";
import { SuspendedBox } from "@/components/SuspendedBox";

export const metadata = { title: "Profile · Playtest" };
export const dynamic = "force-dynamic";

/**
 * Your profile, for the side in use (the full app's /profile for testers and /dev/profile for developers): the form,
 * then your ratings; the agreed "Change your password" section stays here, styled like the other cards.
 */
export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ failed?: string }> }) {
  const u = await requirePageUser();
  const { failed } = await searchParams;
  const side = sideFor(u, "/app/profile");
  const p = await db.testerProfile.findUnique({ where: { userId: u.id } });
  const rating = await ratingSummary(u.id);
  return (
    <div className="mx-auto max-w-2xl">
      {u.suspendedAt && <div className="mb-4"><SuspendedBox failed={failed} developer={u.isDeveloper} tester={u.isTester} /></div>}
      {side === "developer" ? (
        <>
          <h1 className="mb-2 text-2xl font-semibold">Your developer profile</h1>
          <p className="mb-6 text-slate-400">
            Testers see your name when they hover or open it on your tests, with how you review and your ratings. <Link href={`/app/developers/${u.id}`} className="text-sky-300 hover:underline">See it as testers do</Link>
          </p>
        </>
      ) : (
        <>
          <h1 className="mb-2 text-2xl font-semibold">Your tester profile</h1>
          <p className="mb-2 text-slate-400">Developers see your bio, languages and ratings when they hover your name. Your devices and languages decide which tests fit you.</p>
          <p className="mb-6 text-sm"><Link href={`/app/testers/${u.id}`} className="text-sky-300 hover:underline">How developers see you</Link> <span className="text-slate-500">(your profile and figures as they see them)</span></p>
        </>
      )}
      <ProfileForm side={side ?? "tester"} init={{ name: u.name, pronoun: u.pronoun, isDeveloper: u.isDeveloper, isTester: u.isTester, devices: p?.devices ?? [], categories: p?.categories ?? [], languages: p?.languages ?? [], bio: p?.bio ?? "" }} />
      <div className="mt-6 space-y-6">
        {side === "developer" && u.isDeveloper && <CapacityCard userId={u.id} />}
        <section className="card space-y-2" aria-label="Your ratings">
          <h2 className="font-semibold text-white">Your ratings</h2>
          {rating.line ? <p className="text-slate-200">{rating.line}</p> : <p className="text-sm text-slate-400">No ratings yet.</p>}
          {rating.comments.length > 0 && <ul className="list-disc pl-5 text-sm text-slate-300">{rating.comments.map((c, i) => <li key={i}>“{c}”</li>)}</ul>}
        </section>
        <div id="password" className="scroll-mt-24"><PasswordForm hasPassword={!!u.passwordHash} /></div>
      </div>
    </div>
  );
}
