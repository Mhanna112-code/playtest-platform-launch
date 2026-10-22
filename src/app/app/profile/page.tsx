import { db } from "@/lib/db";
import { requirePageUser } from "@/lib/server/page-auth";
import { ProfileForm } from "./ProfileForm";
import { UnblockButton } from "@/components/BlockButton";

export const metadata = { title: "Profile · Playtest" };

export default async function ProfilePage() {
  const u = await requirePageUser();
  const p = await db.testerProfile.findUnique({ where: { userId: u.id } });
  const blocks = await db.block.findMany({ where: { blockerId: u.id }, orderBy: { createdAt: "desc" } });
  const people = await db.user.findMany({ where: { id: { in: blocks.map((b) => b.blockedId) } } });
  return (
    <>
      <h1>Profile</h1>
      <ProfileForm init={{ name: u.name, pronoun: u.pronoun, isDeveloper: u.isDeveloper, isTester: u.isTester, devices: p?.devices ?? [], categories: p?.categories ?? [], languages: p?.languages ?? [], bio: p?.bio ?? "", emailPref: u.emailPref }} />
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
