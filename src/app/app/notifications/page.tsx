import { Bell } from "lucide-react";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { requirePageUser } from "@/lib/server/page-auth";
import { sideLink } from "@/lib/sides";
import { AlertSettings } from "./AlertSettings";
import { BellList, type BellEntry } from "./BellList";
import { GROUP_TITLES, bellKey, dayKey } from "@/lib/bell";

export const metadata = { title: "Notifications · Playtest" };
export const dynamic = "force-dynamic";

// The full app's notifications page: the heading with the bell, one card listing them (a dot on the unread ones, the time
// on the right). The bell keeps everything, whatever the email setting. Opening this page marks them read.
export default async function Notifications() {
  const u = await requirePageUser();
  const items = await db.notification.findMany({ where: { userId: u.id }, orderBy: { createdAt: "desc" }, take: 200 });
  // (Design doc 9) Same-day lines about the same test stack into one entry, except the lines that always arrive on their own (own); opening a stack marks its lines read, the rest are read by looking.
  const titles = new Map((await db.test.findMany({ where: { id: { in: [...new Set(items.map((n) => n.testId).filter((x): x is string => !!x))] } }, select: { id: true, title: true } })).map((t) => [t.id, t.title]));
  const groups = new Map<string, typeof items>();
  for (const n of items) {
    const k = bellKey(n);
    groups.set(k, [...(groups.get(k) ?? []), n]);
  }
  const todayKey = dayKey(new Date());
  const entries: BellEntry[] = [...groups.entries()].map(([key, g]) => ({
    key,
    title: g[0].groupKey ? GROUP_TITLES[g[0].groupKey] : g[0].testId ? titles.get(g[0].testId) : undefined,
    day: dayKey(g[0].createdAt) === todayKey ? "today" : `on ${fmtDate(g[0].createdAt)}`,
    lines: g.map((n) => ({ id: n.id, text: n.text, href: n.link ? sideLink(u, n.link) : "", read: !!n.readAt, ago: timeAgo(n.createdAt) })),
  }));
  await db.notification.updateMany({ where: { userId: u.id, readAt: null, id: { in: [...groups.values()].filter((g) => g.length === 1).map((g) => g[0].id) } }, data: { readAt: new Date() } });
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <AlertSettings emailPref={u.emailPref} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-white"><Bell className="h-7 w-7 text-indigo-300" /> Notifications</h1>
      </div>
      {items.length === 0 ? (
        <p className="card py-10 text-center text-slate-400">Nothing yet. You&apos;ll hear here when testers join, send feedback, or get reviewed.</p>
      ) : (
        <BellList entries={entries} />
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
