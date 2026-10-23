import Link from "next/link";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { requirePageUser } from "@/lib/server/page-auth";

export const metadata = { title: "Notifications · Playtest" };
export const dynamic = "force-dynamic";

// The bell keeps everything, whatever the email setting. Opening this page marks them read.
export default async function Notifications() {
  const u = await requirePageUser();
  const items = await db.notification.findMany({ where: { userId: u.id }, orderBy: { createdAt: "desc" }, take: 200 });
  await db.notification.updateMany({ where: { userId: u.id, readAt: null }, data: { readAt: new Date() } });
  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight text-white">Notifications</h1>
      <p className="note">Emails follow your setting in <Link href="/app/profile">Profile</Link>; everything is kept here.</p>
      {items.length === 0 && <p className="note">Nothing yet.</p>}
      <ul className="space-y-2">
        {items.map((n) => (
          <li key={n.id} className={"panel !space-y-1 " + (n.readAt ? "" : "border-volt-300/40")}>
            <p className="note">{fmtDateTime(n.createdAt)}</p>
            {n.link ? <Link href={n.link}>{n.text}</Link> : <p>{n.text}</p>}
          </li>
        ))}
      </ul>
    </>
  );
}
