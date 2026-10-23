"use client";
import { useState } from "react";
import { ChangesBox } from "@/components/ChangesBox";
import { api } from "@/lib/client";
import { usePress } from "@/lib/usePress";
import { CalendarClock, Pencil, Repeat } from "lucide-react";
import { OpenUntilFold } from "./OpenUntilFold";
import { CategoryBadges } from "@/components/Category";

type Tester = { contractId: string; name: string };

/**
 * The test page's top title panel: the developer's big buttons (Stop the test, End early, Next round).
 * Its stop-once box sits directly under this panel.
 */
export function TopPanel(p: { id: string; title: string; status: string; terms: string; spotsLine: string; seenAt: string; working: Tester[]; nextRoundId: string | null; joinMode?: string; deadlineDays?: number; categories?: string[]; openUntil?: string | null; version?: number }) {
  const { press, changes, error, busy, at } = usePress(p.seenAt);
  const box = (k: string) => (at === k ? <ChangesBox changes={changes} error={error} /> : null);
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
      {/* The full app's test header: title, badges (status; who can join, linking to Edit; deadline), then the actions. */}
      <section className="panel relative z-20 !space-y-5" aria-label="Test">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-[12rem] flex-1 space-y-2">
            <h1 className="text-3xl font-bold tracking-tight text-white">{p.title}</h1>
            <div className="flex flex-wrap gap-2">
              <span className={`badge ${p.status === "open" ? "border-emerald-400/40 text-emerald-200" : ""}`}>{STATUS[p.status]}</span>
              <CategoryBadges categories={p.categories ?? []} />
              {p.joinMode && (
                <a href={`/app/tests/${p.id}/edit`} className={`badge no-underline hover:no-underline ${p.joinMode === "apply" ? "border-sky-300/40 text-sky-200" : ""}`} title="Change who can join in Edit">
                  {p.joinMode === "apply" ? "You approve each tester" : p.joinMode === "invite" ? "Invite only" : "Anyone who matches joins instantly"}
                </a>
              )}
              {p.deadlineDays != null && <span className="badge" title="Each tester's deadline counts from when they join (change it in Edit)"><CalendarClock className="h-3.5 w-3.5" /> {p.deadlineDays} day{p.deadlineDays === 1 ? "" : "s"} per tester</span>}
            </div>
          </div>
          {/* The full app's header: the buttons at the top right (Edit, Next round, End early, Stop the test). */}
          {!stopped && (
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              {p.status === "draft" && (
                <button
                  className="btn px-3 py-1.5 text-sm"
                  onClick={() => api(`/api/tests/${p.id}/open`, {}).then(() => window.location.reload()).catch((e) => setOpenErr((e as Error).message))}
                >
                  Open the test
                </button>
              )}
              <a className="btn-secondary px-3 py-1.5 text-sm no-underline hover:no-underline" href={`/app/tests/${p.id}/edit`}><Pencil className="h-4 w-4" /> Edit</a>
              {p.nextRoundId ? (
                <a className="btn-secondary px-3 py-1.5 text-sm no-underline hover:no-underline" href={`/app/tests/${p.nextRoundId}`}><Repeat className="h-4 w-4" /> Go to the next round</a>
              ) : (
                <button className="btn-secondary px-3 py-1.5 text-sm" onClick={() => setOpen(open === "next" ? "" : "next")}><Repeat className="h-4 w-4" /> Next round</button>
              )}
              <button className="btn-secondary px-3 py-1.5 text-sm" onClick={() => setOpen(open === "end" ? "" : "end")} disabled={p.working.length === 0}>
                End early
              </button>
              <button className="btn-secondary px-3 py-1.5 text-sm text-rose-200" onClick={() => setOpen(open === "stop" ? "" : "stop")}>Stop the test</button>
            </div>
          )}
        </div>
        {/* At the bottom right: the terms line, and "Open until" (folds out to change it, until it has passed). */}
        <div className="flex flex-wrap items-start justify-end gap-x-4 gap-y-1 text-right">
          <p className="text-xs text-slate-400">{p.terms} · {p.spotsLine}</p>
          {p.openUntil && <OpenUntilFold testId={p.id} version={p.version ?? 0} seenAt={p.seenAt} openUntil={p.openUntil} passed={new Date(p.openUntil).getTime() <= Date.now() || stopped} />}
        </div>
        {openErr && <p className="err">{openErr}</p>}
        {open === "stop" && (
          <div className="space-y-2 rounded-lg border border-rose-400/40 p-3">
            <p className="text-sm">Stopping ends every tester&apos;s work now and closes the test for good. Work already sent still waits for you to pay; calls ahead are cancelled.</p>
            <button className="btn-danger" disabled={busy} onClick={() => go("stop")}>Stop the test now</button>
            {box("stop")}
          </div>
        )}
        {open === "end" && (
          <div className="space-y-2 rounded-lg border border-white/10 p-3">
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
          <div className="space-y-2 rounded-lg border border-white/10 p-3">
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
    </div>
  );
}
