"use client";
import { useEffect, useState } from "react";
import { api, errOf } from "@/lib/client";
import type { ChargebackVM, DisputeVM, Kind, MineVM, Page, PausedVM, TestVM, TextVM, UserVM } from "@/lib/server/adminLists";
import { AdminButton } from "./AdminButton";
import { DisputeDecision } from "./DisputeDecision";
import { PreviewButton } from "./PreviewButton";


type AnyRow = DisputeVM | MineVM | UserVM | TestVM | TextVM | PausedVM | ChargebackVM;

function Row({ kind, row }: { kind: Kind; row: AnyRow }) {
  switch (kind) {
    case "disputes":
    case "decided": {
      const d = row as DisputeVM;
      return (
        <div id={`dispute-${d.id}`} className="scroll-mt-24 space-y-1 border-t border-white/[0.06] py-2 text-sm first:border-t-0" data-dispute-row={d.id}>
          <p><b>{d.head}</b></p>
          <p>{d.money}</p>
          <p>{d.said}</p>
          {d.open ? <DisputeDecision id={d.id} minCents={d.min} maxCents={d.max} /> : <p className="note">{d.decided}</p>}
        </div>
      );
    }
    case "mine": {
      const m = row as MineVM;
      return (
        <p className="border-t border-white/[0.06] py-2 text-sm first:border-t-0" data-mine-row={m.testId}>
          <a href={`/admin?test=${m.testId}#test-${m.testId}`}>“{m.title}”</a> · {m.dev} · {m.why} · {m.when}
        </p>
      );
    }
    case "users": {
      const u = row as UserVM;
      return (
        <li id={`user-${u.id}`} className="scroll-mt-24 space-y-1 py-2 text-slate-300" data-user-row={u.id}>
          <p>
            {u.line}
            {u.reports > 3 && <span className="badge ml-2 border-amber-300/40 text-amber-200">{u.reports} reports: look at them (a count is not proof)</span>}
            {u.reports > 0 && u.reports <= 3 && <span className="ml-2 text-xs text-slate-500">{u.reports} report{u.reports === 1 ? "" : "s"}</span>}
          </p>
          {u.state === "deleted" ? (
            <p className="text-xs text-rose-300">{u.stateLine}</p>
          ) : u.state === "suspended" ? (
            <p className="flex flex-wrap items-center gap-2"><b>{u.stateLine.split(" ")[0]}</b> {u.stateLine.slice(u.stateLine.indexOf(" ") + 1)} <AdminButton action="unsuspend" id={u.id} label="Lift the suspension" /></p>
          ) : (
            <p className="flex flex-wrap items-center gap-2">
              <PreviewButton id={u.id} />
              <AdminButton action="suspend" id={u.id} label="Suspend" danger fields={[{ name: "note", label: "Why" }]} />
              <AdminButton action="delete-account" id={u.id} label="Delete account" danger fields={[{ name: "note", label: "Why" }]} />
            </p>
          )}
        </li>
      );
    }
    case "tests": {
      const t = row as TestVM;
      return (
        <li id={`test-${t.id}`} className="scroll-mt-24 space-y-1 py-2 text-slate-300" data-test-row={t.id}>
          <p>{t.line}</p>
          {t.closedLine && <p className="text-xs text-rose-300">{t.closedLine}</p>}
          <HistoryToggle testId={t.id} />
          {!t.stopped && (
            <p className="flex flex-wrap items-center gap-2">
              {t.adminPaused ? <AdminButton action="unpause-test" id={t.id} label="Lift the pause" /> : <AdminButton action="pause-test" id={t.id} label="Pause" fields={[{ name: "note", label: "Why" }]} />}
              <AdminButton action="stop-test" id={t.id} label="Stop (close)" danger fields={[{ name: "note", label: "Why" }]} />
              {t.critical >= 3 && <AdminButton action="allow-critical-changes" id={t.id} label="Allow 3 more critical changes" />}
            </p>
          )}
        </li>
      );
    }
    case "paused": {
      const p = row as PausedVM;
      return (
        <div className="space-y-1 border-t border-white/[0.06] py-2 text-sm first:border-t-0" data-paused-test={p.id}>
          <p>{p.text}</p>
          <p data-closure-date=""><b>{p.closure}</b>{p.extended ? " · extended by the team" : ""}</p>
          <p className="flex flex-wrap items-center gap-2">
            <AdminButton action="extend-pause" id={p.id} label="Extend" fields={[{ name: "days", label: "Days to add", ph: "Days (7)" }]} />
            <AdminButton action="close-paused" id={p.id} label="Close now" danger />
          </p>
        </div>
      );
    }
    case "chargebacks": {
      const c = row as ChargebackVM;
      return (
        <div className="space-y-1 border-t border-white/[0.06] py-2 text-sm first:border-t-0" data-chargeback-hold={c.id}>
          <p>{c.email} · on hold since {c.since}</p>
          {c.chargebacks.map((x, i) => <p key={i} className="text-slate-400">{x}</p>)}
          <p data-chargeback-steps="">
            Chargeback hold: card verified <b>{c.cardVerified ? "✓" : "✗"}</b>, owed paid <b>{c.owedPaid ? "✓" : "✗"}</b>{c.owedLine}{" "}
            <AdminButton action="approve-chargeback" id={c.id} label="Approve" disabled={!c.cardVerified || !c.owedPaid} />
          </p>
        </div>
      );
    }
    default: {
      const t = row as TextVM;
      return <li className="py-2 text-sm text-slate-300">{t.text}</li>;
    }
  }
}

const LIST_KINDS = new Set<Kind>(["users", "tests", "payments", "waitlist", "history"]);

/** (Owner, Oct 26) A test's full history, newest first, opened on demand (the ?test=ID area shows it open). */
function HistoryToggle({ testId }: { testId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-history-toggle={testId}>
      <button className="btn-ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? "Hide history" : "History"}</button>
      {open && <div className="mt-2"><PagedList kind="history" arg={testId} initial={null} empty="Nothing recorded yet." /></div>}
    </div>
  );
}
const PAGE = 25; // (Owner, Oct 26) pages of 25 (the server's PAGE)

/**
 * (Owner, Oct 26) A long admin list in pages of 25 with Previous / Next under it and "1–25 of N". Pressing one fetches that page and replaces ONLY this list's
 * rows (no page reload); the pages are keyset by date. Each row keeps its anchor (dispute-ID, user-ID, test-ID) so a bell line or a link can open the exact row.
 */
export function PagedList({ kind, initial, empty = "None.", scroll = false, arg = "" }: { kind: Kind; initial: Page<AnyRow> | null; empty?: string; scroll?: boolean; arg?: string }) {
  const [rows, setRows] = useState<AnyRow[]>(initial?.rows ?? []);
  const [total, setTotal] = useState(initial?.total ?? 0);
  // The cursor that fetched each page seen so far (page 1 = none) and the page now shown: Previous goes back to an earlier cursor, Next uses the page's own.
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [idx, setIdx] = useState(0);
  const [next, setNext] = useState<string | null>(initial?.next ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const go = async (to: number, cursor: string | null, trail: (string | null)[]) => {
    setBusy(true);
    setErr("");
    try {
      const r = await api<Page<AnyRow>>(`/api/admin/more?kind=${kind}&after=${encodeURIComponent(cursor ?? "")}${arg ? `&arg=${encodeURIComponent(arg)}` : ""}`);
      setRows(r.rows);
      setTotal(r.total);
      setNext(r.next);
      setCursors(trail);
      setIdx(to);
    } catch (e) {
      setErr(errOf(e));
    }
    setBusy(false);
  };
  // Opened without rows (a lazy list): fetch its first page.
  useEffect(() => {
    if (!initial) void go(0, null, [null]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const start = idx * PAGE;
  const body = rows.map((r) => <Row key={r.id} kind={kind} row={r} />);
  return (
    <div className="space-y-2" data-paged={kind}>
      {rows.length === 0 && <p className="note">{empty}</p>}
      {rows.length > 0 && (
        <div className={`${scroll ? "max-h-[26rem] overflow-y-auto pr-1" : ""}`} data-scroll-box={scroll ? kind : undefined}>
          {LIST_KINDS.has(kind) ? <ul className="divide-y divide-white/5 text-sm">{body}</ul> : body}
        </div>
      )}
      {(idx > 0 || next) && (
        <div className="flex flex-wrap items-center gap-3" data-pager={kind}>
          <button className="btn-ghost" disabled={busy || idx === 0} onClick={() => go(idx - 1, cursors[idx - 1], cursors.slice(0, idx))} data-prev={kind}>Previous</button>
          <span className="text-sm text-slate-400" data-range={kind}>{rows.length ? `${start + 1}–${start + rows.length} of ${total}` : `0 of ${total}`}</span>
          <button className="btn-ghost" disabled={busy || !next} onClick={() => go(idx + 1, next, [...cursors.slice(0, idx + 1), next])} data-next={kind}>Next</button>
        </div>
      )}
      {err && <p className="err">{err}</p>}
    </div>
  );
}
