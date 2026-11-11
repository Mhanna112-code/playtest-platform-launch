import { withDateZone } from "@/lib/server/dateZone";
import { AutoRefresh } from "@/components/AutoRefresh";
import { OnePage } from "@/components/OnePage";
import { ownPageScope } from "@/lib/pageClaim";
import { notificationsV } from "@/lib/server/pageFreshness";
import { notificationScopeFor, testTitlesOf } from "@/lib/server/notify";
import { isAdmin } from "@/lib/server/session";
import { Bell } from "lucide-react";
import { db } from "@/lib/db";
import { fmtDateIn } from "@/lib/format";
import { requirePageUser } from "@/lib/server/page-auth";
import { sideFor, sideForPath, sideLink } from "@/lib/sides";
import { closedForSuspended } from "@/lib/closedPages";
import { AlertSettings } from "./AlertSettings";
import { BellList, type BellEntry } from "./BellList";
import { bellStacks, dayKey } from "@/lib/bell";
import { lineLinks, linkPool } from "@/lib/server/lineLinks";
import { adminBellLinks } from "@/lib/server/adminLinks";
import type { LineLink } from "@/lib/lineLinks";

export const metadata = { title: "Notifications · Playtest" };
export const dynamic = "force-dynamic";

// The full app's notifications page: the heading with the bell, one card listing them (a dot on the unread ones, the time
// on the right). The bell keeps everything, whatever the email setting. (Batch 29 §28) Opening this page marks nothing read: a line is read when
// it's clicked, a stack when it's expanded or one of its lines is clicked. No "mark all as read".
export default async function Notifications() {
  const u = await requirePageUser();
  return withDateZone(u.timeZone, async () => {

  const fmtDate = (d: Date | string) => fmtDateIn(d, u.timeZone);
  // (Owner, Oct 30, batch 34 §5) The side in use's lines plus the account's; the settings' help names only this side's payment kinds.
  const side = isAdmin(u) ? null : sideFor(u);
  const freshV = await notificationsV(u);
  const items = await db.notification.findMany({ where: { userId: u.id, ...await notificationScopeFor(u.id) }, orderBy: { createdAt: "desc" }, take: 200 });
  // (Design doc 9) Same-day lines about the same test stack into one entry, except the lines that always arrive on their own (own); opening a stack marks its lines read, a single line is read when clicked (batch 29 §28).
  const titles = await testTitlesOf(items);
  // (Owner, Nov 5, §270) Every person and test a line names is its own green link: the reader's link pool, matched against each line (its own test's people first).
  const pool = await linkPool(u.id, items.map((n) => n.testId));
  // (Owner, Nov 5, §277) An admin's team lines (they open the admin console) take their links from the line's own data instead: the bell's test, the row it opens
  // and the people involved, each opening their place for the team (a profile with its admin box, a test's page with its admin box).
  const team = isAdmin(u) ? await adminBellLinks(items) : new Map<string, LineLink[]>();
  const testHrefOf = (testId: string | null) => (testId ? pool.byTest.get(testId)?.find((l) => l.kind === "test" && l.text === titles.get(testId))?.href : undefined);
  const todayKey = dayKey(new Date(), u.timeZone);
  // (Owner, Oct 28) A restricted account: a line whose page is closed to it lands on the dashboard top.
  // (Batch 34 §5) Straight to the page (one of the other side shows the switch notice; the line's own side decides what's closed).
  const hrefFor = (link: string) => (closedForSuspended(link, u, sideForPath(link, u.id) ?? sideFor(u)) ? "/app" : sideLink(u, link));
  // (Owner, Nov 6, §298) The stacks and their titles come from bellStacks, the same grouping the summary emails use.
  const entries: BellEntry[] = bellStacks(items, u.timeZone, (id) => titles.get(id)).map(({ key, lines: g, title, counted, test }) => ({
    key,
    title,
    counted,
    test,
    ...(!g[0].groupKey && testHrefOf(g[0].testId) ? { testHref: testHrefOf(g[0].testId) } : {}),
    day: dayKey(g[0].createdAt, u.timeZone) === todayKey ? "today" : `on ${fmtDate(g[0].createdAt)}`,
    lines: g.map((n) => ({ id: n.id, text: n.text, href: n.link ? hrefFor(n.link) : "", read: !!n.readAt, ago: timeAgo(n.createdAt, u.timeZone), ...(n.testId && titles.get(n.testId) ? { test: titles.get(n.testId) } : {}), links: team.get(n.id) ?? lineLinks(pool, n.text, n.testId) })),
  }));
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <AutoRefresh query="fresh=notifications" v={freshV} />
      {/* (Owner, Nov 11, §380 K) Notifications and alerts (a settings page): one page at a time, across devices. */}
      <OnePage scope={ownPageScope("notifications")} />
      <AlertSettings emailPref={u.emailPref} side={side} seenAt={new Date().toISOString()} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-white"><Bell className="h-7 w-7 text-indigo-300" /> Notifications</h1>
      </div>
      {items.length === 0 ? (
        <p className="card py-10 text-center text-slate-400">{side === "developer" ? "Nothing yet. You'll hear here when testers join, send work, or ask for a call." : side === "tester" ? "Nothing yet. You'll hear here when you're invited, accepted, reviewed or paid." : "Nothing yet."}</p>
      ) : (
        <BellList entries={entries} />
      )}
    </div>
  );

  });
}

function timeAgo(d: Date, timeZone?: string | null) {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return fmtDateIn(d, timeZone);
}
