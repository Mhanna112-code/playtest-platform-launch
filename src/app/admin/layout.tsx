import Link from "next/link";
import { Brand } from "@/components/Brand";
import { BellLink } from "@/components/BellLink";
import { SignOut } from "@/components/SignOut";
import { requirePageUser } from "@/lib/server/page-auth";
import { isAdmin } from "@/lib/server/session";
import { unreadEntryCount } from "@/lib/server/notify";
import { AdminNav } from "./AdminNav";
import { PageLoad } from "./PageLoad";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  if (!isAdmin(user)) return children;
  return <>
    <header className="sticky top-0 z-20 border-b border-white/[0.07] bg-ink-950/75 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-2 gap-y-2 px-4 py-3">
        <Brand /><AdminNav /><PageLoad />
        <div className="ml-auto flex items-center gap-2">
          <BellLink unread={await unreadEntryCount(user.id)} />
          <Link href="/app/account" className="nav-link" title="Your account">{user.name.trim() || user.email}</Link>
          <SignOut />
        </div>
      </div>
    </header>
    {children}
  </>;
}
