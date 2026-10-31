"use client";
import { useEffect, useState } from "react";
import { ChangesBox } from "@/components/ChangesBox";
import { usePress } from "@/lib/usePress";
import { MARKABLE } from "@/lib/markJump";
import type { RowJson } from "@/lib/callRows";
import { acceptChoices, describeRows } from "@/components/RequestRows";

/** One waiting call request: `tester` (whose test session it is), `asker` (who asked: "you" when it's yours). */
export type PanelReq = { id: string; contractId: string; tester: string; asker: string; rows: RowJson[]; minutes: number; mine: boolean; rate: string; warning?: string };

/**
 * (Owner, Oct 28, batch 16 sections 33 and 35) The one "Call requests" panel: every waiting request on this test in both directions, soonest first: the tester, the
 * time(s) (Once / Daily / Weekly, N calls or Forever), the length, who asked, and Accept / Decline (theirs) or Withdraw (yours). A plain scroll box about 5 rows
 * tall that follows the page live. Needs you's call-request rows open this panel at their request (#req-<id>, highlighted); Accept / Decline happen only here,
 * so they follow every rule of the panel (the stop-once box, the clash refusals, the paused / stopped / restricted refusals).
 */
/** (Batch 26 section 10) The pressed button's name for its stop box or refusal ("Your Withdraw didn't go through"), from the press key. */
export const requestPressName = (at: string) => (at.startsWith("w-") ? "Withdraw" : at.startsWith("d-") ? "Decline" : "Accept");

export function CallRequestsPanel({ side, seenAt, requests, path }: { side: "developer" | "tester"; seenAt: string; requests: PanelReq[]; /** where answer-request goes for a request */ path: (r: PanelReq) => string }) {
  const { press, changes, error, busy, at, finish } = usePress(seenAt);
  // (Owner, Oct 29, batch 26 section 10) A shown request that closed meanwhile (the tester finished their part, left, a block, a stop…) or was answered elsewhere says
  // so in its row at once ("Closed: the tester finished their part") and its buttons go, without waiting for the page to refresh.
  const [gone, setGone] = useState<Record<string, string>>({});
  const ids = requests.map((r) => r.id).join(",");
  useEffect(() => {
    if (!ids) return;
    let alive = true;
    const check = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const r = await fetch(`/api/pulse?requests=${encodeURIComponent(ids)}`, { cache: "no-store" });
        if (!r.ok) return;
        const { gone: rows } = (await r.json()) as { gone?: { id: string; line: string }[] };
        if (alive && rows) setGone(Object.fromEntries(rows.map((x) => [x.id, x.line])));
      } catch {
        // offline: next time
      }
    };
    const t = setInterval(check, 8_000);
    window.addEventListener("live-tick", check);
    window.addEventListener("focus", check);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("live-tick", check);
      window.removeEventListener("focus", check);
    };
  }, [ids]);
  const go = async (r: PanelReq, body: Record<string, unknown>, key: string) => {
    if (await press(`${path(r)}/answer-request`, { requestId: r.id, contractId: r.contractId, ...body }, key)) finish(); // (batch 35 §40, §41) the page redraws in place; the buttons stay greyed until it has
  };
  const first = (r: PanelReq) => Math.min(...r.rows.map((x) => new Date(x.startsAt).getTime()));
  const sorted = [...requests].sort((a, b) => first(a) - first(b));
  return (
    <section className="space-y-1.5" aria-label="Call requests" data-call-requests="" id="call-requests">
      <h3 className="text-sm font-semibold text-white">Call requests</h3>
      {sorted.length === 0 ? (
        <p className="note">No call requests waiting.</p>
      ) : (
        <ul className="max-h-80 space-y-2 overflow-y-auto pr-1 text-sm" data-scroll-list="rows">
          {sorted.map((r) => (
            <li key={r.id} id={`req-${r.id}`} className={`flex flex-wrap items-center gap-2 rounded-lg border border-white/10 p-2 ${MARKABLE}`} data-request-row={r.mine ? "mine" : "theirs"}>
              <span className="mr-auto text-slate-300">
                {side === "developer" && <><b className="text-white">{r.tester}</b> · </>}
                {describeRows(r.rows)} · {r.minutes} min · {r.rate} · asked by {r.mine ? "you" : r.asker}
              </span>
              {gone[r.id] ? (
                <span className="text-xs font-medium text-amber-200" data-request-gone="">{gone[r.id]}</span>
              ) : r.mine ? (
                <button className="btn-ghost" disabled={busy} onClick={() => go(r, { action: "withdraw" }, "w-" + r.id)}>Withdraw</button>
              ) : (
                <>
                  {acceptChoices(r.rows).map((x) => (
                    <button key={x.label} className="btn" disabled={busy} onClick={() => go(r, { action: "accept", ...(x.time ? { time: x.time } : {}) }, "a-" + r.id)}>{x.label}</button>
                  ))}
                  <button className="btn-ghost" disabled={busy} onClick={() => go(r, { action: "decline" }, "d-" + r.id)}>Decline</button>
                </>
              )}
              {r.warning && <span className="basis-full text-xs text-amber-200" data-calls-warning="">{r.warning}</span>}
              {(at === "a-" + r.id || at === "d-" + r.id || at === "w-" + r.id) && <div className="basis-full"><ChangesBox side={side} changes={changes} error={error} press={requestPressName(at)} /></div>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
