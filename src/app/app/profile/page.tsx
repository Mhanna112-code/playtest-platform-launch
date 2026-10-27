import Link from "next/link";
import { db } from "@/lib/db";
import { requirePageUser } from "@/lib/server/page-auth";
import { ProfileForm } from "./ProfileForm";
import { ratingSummary } from "@/lib/server/ratings";
import { CapacityCard } from "@/components/ProfileTiles";
import { sideFor } from "@/lib/sides";
import { ClampText } from "@/components/ClampText";
import { LongList } from "@/components/LongList";

export const metadata = { title: "Profile · Playtest" };
export const dynamic = "force-dynamic";

/**
 * Your profile, for the side in use (the full app's /profile for testers and /dev/profile for developers): the form,
 * then your ratings. (Owner, Oct 27: "Change your password" moved to Account, which stays open to a suspended or held account.)
 */
export default async function ProfilePage() {
  const u = await requirePageUser();
  const side = sideFor(u, "/app/profile");
  const p = await db.testerProfile.findUnique({ where: { userId: u.id } });
  const rating = await ratingSummary(u.id);
  return (
    <div className="mx-auto max-w-2xl">
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
          {rating.comments.length > 0 && <LongList shown={3} tall="max-h-52" className="list-disc pl-5 text-sm text-slate-300">{rating.comments.map((c, i) => <li key={i}><ClampText text={`“${c}”`} /></li>)}</LongList>}
        </section>
      </div>
    </div>
  );
}
