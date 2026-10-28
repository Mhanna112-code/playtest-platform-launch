"use client";
import { MARKABLE } from "@/lib/markJump";
import { ChangesBox } from "@/components/ChangesBox";
import { usePress } from "@/lib/usePress";
import { ClampText } from "@/components/ClampText";
import { PlusMore } from "@/components/PlusMore";

type App = { id: string; userId: string; name: string; note: string; profile: string; kind?: string; line?: string };

export function Applications({ testId, seenAt, apps }: { testId: string; seenAt: string; apps: App[] }) {
  const { press, changes, error, busy, at } = usePress(seenAt);
  if (!apps.length) return null;
  const go = async (a: App, action: "accept" | "decline") => {
    const r = await press(`/api/tests/${testId}/application`, { applicationId: a.id, action }, `${action}-${a.id}`);
    if (r) window.location.reload();
  };
  return (
    <section className="panel" aria-label="Applications">
      <h2>{apps.every((a) => a.kind === "rejoin") ? "Asks to rejoin" : apps.some((a) => a.kind === "rejoin") ? "Applications and asks to rejoin" : "Applications"}</h2>
      <ul className="space-y-3 text-sm">
        {apps.map((a) => (
          <li key={a.id} id={`item-app-${a.id}`} className={`space-y-1 ${MARKABLE}`}>
            {a.line ? <p><a href={`/app/testers/${a.userId}`}><b>{a.name}</b></a> {a.line.replace(a.name, "").trim()}</p> : <p><a href={`/app/testers/${a.userId}`}><b>{a.name}</b></a> · <PlusMore items={a.profile ? a.profile.split(", ") : []} /></p>}
            {a.note && <ClampText text={`“${a.note}”`} />}
            <div className="flex flex-wrap gap-2">
              <button className="btn" disabled={busy} onClick={() => go(a, "accept")}>Accept</button>
              <button className="btn-ghost" disabled={busy} onClick={() => go(a, "decline")}>Decline</button>
            </div>
            {(at === `accept-${a.id}` || at === `decline-${a.id}`) && <ChangesBox changes={changes} error={error} />}
          </li>
        ))}
      </ul>
    </section>
  );
}
