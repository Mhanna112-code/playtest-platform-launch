"use client";
import { MARKABLE } from "@/lib/markJump";
import { ChangesBox } from "@/components/ChangesBox";
import { PressDone } from "@/components/PressDone";
import { usePress } from "@/lib/usePress";
import { ClampText } from "@/components/ClampText";
import { useRef } from "react";
import { useRouter } from "next/navigation";
import { useTesterChanges } from "@/lib/useTesterChanges";
import type { Needs } from "@/lib/testerState";

type App = { id: string; userId: string; name: string; note: string; tag: string; detail: string; changedAt: string; seen: { devices: string[]; languages: string[]; rating: number | null }; kind?: string; line?: string };

export function Applications({ testId, seenAt, apps, needs }: { needs: Needs; testId: string; seenAt: string; apps: App[] }) {
  const router = useRouter();
  const before = useRef(new Map<string, Needs>());
  const { press, changes, setChanges, error, busy, at, doneLine, finish } = usePress(seenAt, () => router.refresh());
  useTesterChanges(setChanges, before, apps.map((a) => ({ id: a.userId, name: a.name, seen: a.seen, changedAt: a.changedAt })), needs);
  if (!apps.length) return null;
  const go = async (a: App, action: "accept" | "decline") => {
    before.current.set(a.userId, a.seen);
    const r = await press(`/api/tests/${testId}/application`, { applicationId: a.id, action, seenTesters: { [a.userId]: a.seen } }, `${action}-${a.id}`);
    // (Batch 35 §40, §41) The page redraws in place; until it has, Accept / Decline stay greyed with the result line under them.
    if (r) finish(action === "accept" ? `Accepted ${a.name}.` : `Declined ${a.name}.`);
  };
  return (
    <section className="panel" aria-label="Applications">
      <h2>{apps.every((a) => a.kind === "rejoin") ? "Asks to rejoin" : apps.some((a) => a.kind === "rejoin") ? "Applications and asks to rejoin" : "Applications"}</h2>
      <ul className="space-y-3 text-sm">
        {apps.map((a) => (
          <li key={a.id} id={`item-app-${a.id}`} className={`space-y-1 ${MARKABLE}`}>
            {a.line ? <p><a href={`/app/testers/${a.userId}`}><b>{a.name}</b></a> {a.line.replace(a.name, "").trim()}</p> : <p><a href={`/app/testers/${a.userId}`}><b>{a.name}</b></a></p>}
            {a.tag && <span className="badge border-amber-300/40 text-amber-200">{a.tag}</span>}
            <p className="text-xs text-slate-500">{a.detail}</p>
            {a.note && <ClampText text={`“${a.note}”`} />}
            <div className="flex flex-wrap gap-2">
              <button className="btn" disabled={busy} onClick={() => go(a, "accept")}>Accept</button>
              <button className="btn-ghost" disabled={busy} onClick={() => go(a, "decline")}>Decline</button>
            </div>
            {(at === `accept-${a.id}` || at === `decline-${a.id}`) && <ChangesBox changes={changes} error={error} />}
            {(at === `accept-${a.id}` || at === `decline-${a.id}`) && <PressDone line={doneLine} />}
          </li>
        ))}
      </ul>
    </section>
  );
}
