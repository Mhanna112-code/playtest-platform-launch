import Link from "next/link";
import { Compass, LayoutDashboard, ShieldCheck, Users } from "lucide-react";

/** Primary navigation for the team console. */
export function AdminNav() {
  return <nav aria-label="Admin" className="flex flex-wrap items-center gap-2" data-admin-nav="">
    <Link className="nav-link" href="/admin"><LayoutDashboard className="h-4 w-4" /> Dashboard</Link>
    <Link className="nav-link" href="/admin/developers"><ShieldCheck className="h-4 w-4" /> Developers</Link>
    <Link className="nav-link" href="/admin/testers"><Users className="h-4 w-4" /> Testers</Link>
    <Link className="nav-link" href="/app/find" data-admin-find=""><Compass className="h-4 w-4" /> Tests</Link>
  </nav>;
}
