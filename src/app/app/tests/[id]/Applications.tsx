"use client";
import { ChangesBox } from "@/components/ChangesBox";
import { usePress } from "@/lib/usePress";

type App = { id: string; name: string; note: string; profile: string };

export function Applications({ testId, seenAt, apps }: { testId: string; seenAt: string; apps: App[] }) {
  const { press, changes, error, busy, at } = usePress(seenAt);
  if (!apps.length) return null;
  const go = async (a: App, action: "accept" | "decline") => {
    const r = await press(`/api/tests/${testId}/application`, { applicationId: a.id, action }, `${action}-${a.id}`);
    if (r) window.location.reload();
  };
  return (
    <section className="panel" aria-label="Applications">
      <h2>Applications</h2>
      <ul className="space-y-3 text-sm">
        {apps.map((a) => (
          <li key={a.id} className="space-y-1">
            <p><b>{a.name}</b> · {a.profile}</p>
            {a.note && <p>“{a.note}”</p>}
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
