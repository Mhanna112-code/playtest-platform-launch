"use client";
import { useState } from "react";
import { ChangesBox } from "@/components/ChangesBox";
import { api } from "@/lib/client";
import { usePress } from "@/lib/usePress";
import { useLiveLines } from "./InvitePanel";

type Tester = { contractId: string; name: string };

/**
 * The test page's top title panel: the developer's big buttons (Stop the test, End early, Next round).
 * Its stop-once box sits directly under this panel.
 */
export function TopPanel(p: { id: string; title: string; status: string; terms: string; spotsLine: string; seenAt: string; working: Tester[]; nextRoundId: string | null }) {
  const { press, changes, error, busy, at } = usePress(p.seenAt);
  const box = (k: string) => (at === k ? <ChangesBox changes={changes} error={error} /> : null);
  const lines = useLiveLines(p.id, p.seenAt);
  const [open, setOpen] = useState<"" | "stop" | "end" | "next">("");
  const [who, setWho] = useState(p.working[0]?.contractId ?? "");
  const [reason, setReason] = useState("");
  const [closeThis, setCloseThis] = useState(true);
  const [openErr, setOpenErr] = useState("");
  const stopped = p.status === "stopped";
  const STATUS: Record<string, string> = { open: "Open", closed: "Not taking new testers", stopped: "Stopped", draft: "Draft (testers can't see it yet)" };

  async function go(action: string, body: Record<string, unknown> = {}) {
    const r = await press<{ id?: string }>(`/api/tests/${p.id}/${action}`, body, action);
    if (!r) return;
    if (action === "next-round" && r.id) window.location.href = `/app/tests/${r.id}/edit`;
    else window.location.reload();
  }

  return (
    <div className="space-y-2">
      <section className="panel" aria-label="Test">
        <div className="flex flex-wrap items-start gap-2">
          <h1 className="mr-auto">{p.title}</h1>
          <span className="badge">{STATUS[p.status]}</span>
        </div>
        <p className="note">
          {p.terms} · {p.spotsLine}
        </p>
        {!stopped && (
          <div className="flex flex-wrap gap-2">
            {p.status === "draft" && (
              <button
                className="btn"
                onClick={() => api(`/api/tests/${p.id}/open`, {}).then(() => window.location.reload()).catch((e) => setOpenErr((e as Error).message))}
              >
                Open the test
              </button>
            )}
            <a className="btn-ghost" href={`/app/tests/${p.id}/edit`}>Edit</a>
            <a className="btn-ghost" href="#calls">Live calls</a>
            <button className="btn-ghost" onClick={() => setOpen(open === "end" ? "" : "end")} disabled={p.working.length === 0}>
              End early
            </button>
            {p.nextRoundId ? (
              <a className="btn-ghost" href={`/app/tests/${p.nextRoundId}`}>Go to the next round</a>
            ) : (
              <button className="btn-ghost" onClick={() => setOpen(open === "next" ? "" : "next")}>Next round</button>
            )}
            <button className="btn-danger" onClick={() => setOpen(open === "stop" ? "" : "stop")}>Stop the test</button>
          </div>
        )}
        {openErr && <p className="err">{openErr}</p>}
        {open === "stop" && (
          <div className="space-y-2 rounded-lg border border-rose-200 p-3">
            <p className="text-sm">Stopping ends every tester&apos;s work now and closes the test for good. Work already sent still waits for you to pay; calls ahead are cancelled.</p>
            <button className="btn-danger" disabled={busy} onClick={() => go("stop")}>Stop the test now</button>
            {box("stop")}
          </div>
        )}
        {open === "end" && (
          <div className="space-y-2 rounded-lg border border-slate-200 p-3">
            <label className="label req" htmlFor="who">Tester</label>
            <select id="who" className="input max-w-xs" value={who} onChange={(e) => setWho(e.target.value)}>
              {p.working.map((t) => (
                <option key={t.contractId} value={t.contractId}>{t.name}</option>
              ))}
            </select>
            <label className="label req" htmlFor="reason">Why? (they read it)</label>
            <textarea id="reason" rows={2} className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
            <p className="note">Their work ends now. What they already sent still waits for you to pay; calls ahead are cancelled.</p>
            <button className="btn" disabled={busy} onClick={() => go("end-early", { contractId: who, reason })}>End their work now</button>
            {box("end-early")}
          </div>
        )}
        {open === "next" && (
          <div className="space-y-2 rounded-lg border border-slate-200 p-3">
            <p className="text-sm">A copy of this test for your next build, saved as a draft so you can put in the new build&apos;s link first.</p>
            {p.status === "open" && (
              <label className="block text-sm">
                <input type="checkbox" checked={closeThis} onChange={(e) => setCloseThis(e.target.checked)} /> Stop new testers joining this round (testers already in carry on)
              </label>
            )}
            <button className="btn" disabled={busy} onClick={() => go("next-round", { closeThis })}>Start the next round</button>
            {box("next-round")}
          </div>
        )}
      </section>
      {lines.length > 0 && <ChangesBox changes={lines} tail="Refresh to see the latest." />}
    </div>
  );
}
