import { requirePageUser } from "@/lib/server/page-auth";
import { ProfileForm } from "./profile/ProfileForm";

export const metadata = { title: "Home · Playtest" };
export const dynamic = "force-dynamic";

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
  return <h1>Home</h1>;
}
