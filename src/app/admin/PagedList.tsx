"use client";
import { useState } from "react";
import { api, errOf } from "@/lib/client";
import type { ChargebackVM, DisputeVM, Kind, MineVM, Page, PausedVM, TestVM, TextVM, UserVM } from "@/lib/server/adminLists";
import { AdminButton } from "./AdminButton";
import { DisputeDecision } from "./DisputeDecision";
import { PreviewButton } from "./PreviewButton";

// (Owner, Oct 26) A long admin list: the first 20, then a "Load more" button that fetches the next 20 (keyset by date). Each row keeps its
// anchor (dispute-ID, user-ID, test-ID) so a bell line or a link can open the exact row.

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

const LIST_KINDS = new Set<Kind>(["users", "tests", "payments", "waitlist"]);

export function PagedList({ kind, initial, empty = "None.", scroll = false }: { kind: Kind; initial: Page<AnyRow>; empty?: string; scroll?: boolean }) {
  const [rows, setRows] = useState<AnyRow[]>(initial.rows);
  const [next, setNext] = useState<string | null>(initial.next);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const more = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await api<Page<AnyRow>>(`/api/admin/more?kind=${kind}&after=${encodeURIComponent(next ?? "")}`);
      setRows((x) => [...x, ...r.rows.filter((n) => !x.some((o) => o.id === n.id))]);
      setNext(r.next);
    } catch (e) {
      setErr(errOf(e));
    }
    setBusy(false);
  };
  const body = rows.map((r) => <Row key={r.id} kind={kind} row={r} />);
  return (
    <div className="space-y-2" data-paged={kind}>
      {rows.length === 0 && <p className="note">{empty}</p>}
      {rows.length > 0 && (
        <div className={`${scroll ? "max-h-[26rem] overflow-y-auto pr-1" : ""}`} data-scroll-box={scroll ? kind : undefined}>
          {LIST_KINDS.has(kind) ? <ul className="divide-y divide-white/5 text-sm">{body}</ul> : body}
        </div>
      )}
      {next && <button className="btn-ghost" disabled={busy} onClick={more} data-load-more={kind}>{busy ? "Loading…" : "Load more"}</button>}
      {err && <p className="err">{err}</p>}
    </div>
  );
}
