import { db } from "@/lib/db";
import { requirePageUser } from "@/lib/server/page-auth";
import { ProfileForm } from "./ProfileForm";

export const metadata = { title: "Profile · Playtest" };

export default async function ProfilePage() {
  const u = await requirePageUser();
  const p = await db.testerProfile.findUnique({ where: { userId: u.id } });
  return (
    <>
      <h1>Profile</h1>
      <ProfileForm init={{ name: u.name, pronoun: u.pronoun, isDeveloper: u.isDeveloper, isTester: u.isTester, devices: p?.devices ?? [], categories: p?.categories ?? [], languages: p?.languages ?? [], bio: p?.bio ?? "" }} />
    </>
  );
}
