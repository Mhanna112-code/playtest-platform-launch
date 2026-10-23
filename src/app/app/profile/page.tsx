import { db } from "@/lib/db";
import { requirePageUser } from "@/lib/server/page-auth";
import { ProfileForm } from "./ProfileForm";
import { PasswordForm } from "./PasswordForm";
import { UnblockButton } from "@/components/BlockButton";
import { ratingSummary } from "@/lib/server/ratings";

export const metadata = { title: "Profile · Playtest" };

export default async function ProfilePage() {
  const u = await requirePageUser();
  const p = await db.testerProfile.findUnique({ where: { userId: u.id } });
  const blocks = await db.block.findMany({ where: { blockerId: u.id }, orderBy: { createdAt: "desc" } });
  const people = await db.user.findMany({ where: { id: { in: blocks.map((b) => b.blockedId) } } });
  const rating = await ratingSummary(u.id);
  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight text-white">Profile</h1>
      {(u.isDeveloper || u.isTester) && (
        <p className="flex flex-wrap gap-x-4 text-sm">
          {u.isDeveloper && <a href={`/app/developers/${u.id}`}>How testers see your profile</a>}
          {u.isTester && <a href={`/app/testers/${u.id}`}>How developers see your profile</a>}
        </p>
      )}
      <section className="panel" aria-label="Your ratings">
        <h2>Your ratings</h2>
        {rating.line ? <p>{rating.line}</p> : <p className="note">No ratings yet.</p>}
        {rating.comments.length > 0 && <ul className="list-disc pl-5 text-sm">{rating.comments.map((c, i) => <li key={i}>“{c}”</li>)}</ul>}
      </section>
      <ProfileForm init={{ name: u.name, pronoun: u.pronoun, isDeveloper: u.isDeveloper, isTester: u.isTester, devices: p?.devices ?? [], categories: p?.categories ?? [], languages: p?.languages ?? [], bio: p?.bio ?? "", emailPref: u.emailPref }} />
      <PasswordForm hasPassword={!!u.passwordHash} />
      <section className="panel" id="blocked">
        <h2>Blocked people</h2>
        {blocks.length === 0 ? <p className="note">You haven&apos;t blocked anyone.</p> : (
          <ul className="space-y-1 text-sm">
            {people.map((x) => (
              <li key={x.id} className="flex items-center gap-2">
                <span className="mr-auto">{x.name || x.email}</span>
                <UnblockButton userId={x.id} />
              </li>
            ))}
          </ul>
        )}
        <p className="note">Unblocking doesn&apos;t reopen anything that ended.</p>
      </section>
    </>
  );
}
