"use client";
import { NameLink } from "@/components/Cut";
import { MARKABLE } from "@/lib/markJump";
import { ChangesBox } from "@/components/ChangesBox";
import { PressDone } from "@/components/PressDone";
import { usePress } from "@/lib/usePress";
import { ReasonQuote } from "@/components/ScrollText";
import { Fold, ResizeBox } from "@/components/Panel";
import { useRef } from "react";
import { useRouter } from "next/navigation";
import { useTesterChanges } from "@/lib/useTesterChanges";
import type { Needs } from "@/lib/testerState";

type App = { id: string; userId: string; name: string; note: string; tag: string; detail: string; changedAt: string; seen: { devices: string[]; languages: string[]; rating: number | null }; kind?: string; line?: string };

export function Applications({ testId, seenAt, apps, needs, embedded = false }: { needs: Needs; testId: string; seenAt: string; apps: App[]; /** (Owner, Nov 4, §181) inside its person's Needs you drop-down: the list only (the drop-down names the person; a sub-heading says what it is) */ embedded?: boolean }) {
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
  const list = (
      <ul className="space-y-3 text-sm" aria-label={embedded ? "Applications" : undefined}>
        {apps.map((a) => (
          <li key={a.id} id={`item-app-${a.id}`} className={`space-y-1 ${MARKABLE}`}>
            {a.line ? <p><b><NameLink text={a.name} href={`/app/testers/${a.userId}`} /></b> {a.line.replace(a.name, "").trim()}</p> : <p><b><NameLink text={a.name} href={`/app/testers/${a.userId}`} /></b></p>}
            {/* (Owner, Nov 3, batch 35 §140) The request's details in its own fold (open at first), in a panel; Accept / Decline stay under it. */}
            <Fold id={`needs-app-${a.id}`} summary="Details">
              <ResizeBox id={`app-${a.id}`} label="Their application">
                {a.tag && <span className="badge border-amber-300/40 text-amber-200">{a.tag}</span>}
                <p className="text-xs text-slate-500">{a.detail}</p>
                {/* (Owner, Nov 5, §237) The note in its own reason box (drags taller; no Show more). */}
                {a.note && <ReasonQuote id={`app-note-${a.id}`} label="Their note" text={a.note} />}
              </ResizeBox>
            </Fold>
            <div className="flex flex-wrap gap-2">
              <button className="btn" disabled={busy} onClick={() => go(a, "accept")}>Accept</button>
              <button className="btn-ghost" disabled={busy} onClick={() => go(a, "decline")}>Decline</button>
            </div>
            {(at === `accept-${a.id}` || at === `decline-${a.id}`) && <ChangesBox changes={changes} error={error} />}
            {(at === `accept-${a.id}` || at === `decline-${a.id}`) && <PressDone line={doneLine} />}
          </li>
        ))}
      </ul>
  );
  if (embedded) return list;
  return (
    <section className="panel" aria-label="Applications">
      <h2>{apps.every((a) => a.kind === "rejoin") ? "Asks to rejoin" : apps.some((a) => a.kind === "rejoin") ? "Applications and asks to rejoin" : "Applications"}</h2>
      {list}
    </section>
  );
}
