import Link from "next/link";
import { Bell } from "lucide-react";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { requirePageUser } from "@/lib/server/page-auth";
import { sideLink } from "@/lib/sides";

export const metadata = { title: "Notifications · Playtest" };
export const dynamic = "force-dynamic";

// The full app's notifications page: the heading with the bell, one card listing them (a dot on the unread ones, the time
// on the right). The bell keeps everything, whatever the email setting. Opening this page marks them read.
export default async function Notifications() {
  const u = await requirePageUser();
  const items = await db.notification.findMany({ where: { userId: u.id }, orderBy: { createdAt: "desc" }, take: 200 });
  await db.notification.updateMany({ where: { userId: u.id, readAt: null }, data: { readAt: new Date() } });
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-white"><Bell className="h-7 w-7 text-indigo-300" /> Notifications</h1>
        <p className="text-sm text-slate-400">Emails follow your setting in <Link href="/app/profile">Profile</Link>; everything is kept here.</p>
      </div>
      {items.length === 0 ? (
        <p className="card py-10 text-center text-slate-400">Nothing yet. You&apos;ll hear here when testers join, send work, or get paid.</p>
      ) : (
        <ul className="card divide-y divide-white/5 p-0">
          {items.map((n) => (
            <li key={n.id} className="px-4 py-3 hover:bg-white/[0.03]">
              <div className="flex items-start gap-3">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-indigo-400"}`} />
                {n.link ? (
                  <Link href={sideLink(u, n.link)} className={`flex-1 no-underline hover:underline ${n.readAt ? "text-slate-400" : "text-slate-100"}`}>{n.text}</Link>
                ) : (
                  <span className={`flex-1 ${n.readAt ? "text-slate-400" : "text-slate-100"}`}>{n.text}</span>
                )}
                <span className="shrink-0 text-xs text-slate-500">{timeAgo(n.createdAt)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function timeAgo(d: Date) {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return fmtDate(d);
}
