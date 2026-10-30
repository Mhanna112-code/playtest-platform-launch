import { notFound } from "next/navigation";
import { Brand } from "@/components/Brand";
import { requirePageUser } from "@/lib/server/page-auth";
import { ADMIN_PAUSED, adminAccount, isAdmin } from "@/lib/server/session";
import { adminPage, type Page } from "@/lib/server/adminLists";
import { PagedList } from "../PagedList";
import type { UserVM } from "@/lib/server/adminLists";

export const metadata = { title: "Developers · Admin · Playtest" };
export const dynamic = "force-dynamic";
export default async function AdminDevelopersPage() {
  const user = await requirePageUser();
  if (adminAccount(user) && !isAdmin(user)) return <main className="wrap space-y-4"><Brand /><p className="info" data-admin-paused="">{ADMIN_PAUSED} Contact the owner if you think this is a mistake.</p></main>;
  if (!isAdmin(user)) notFound();
  const initial = await adminPage("users", user.id, null, "", undefined, "developer") as Page<UserVM>;
  return <main className="wrap space-y-6"><h1 className="text-3xl font-bold text-white">Developers</h1><PagedList kind="users" initial={initial} title="Developers" sideFilter="developer" /></main>;
}
