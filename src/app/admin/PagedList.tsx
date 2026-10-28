"use client";
import { useEffect, useState } from "react";
import { api, errOf } from "@/lib/client";
import type { ChargebackVM, DisputeVM, Kind, LiftVM, MineVM, Page, PausedVM, ReportVM, TestVM, TextVM, UserVM } from "@/lib/server/adminLists";
import { AdminButton } from "./AdminButton";
import { DisputeDecision } from "./DisputeDecision";
import { PreviewButton } from "./PreviewButton";

type AnyRow = DisputeVM | MineVM | UserVM | TestVM | TextVM | PausedVM | ChargebackVM | LiftVM | ReportVM;

/** A hold lift waiting for Approve: a note box and Approve (first press wins, like Decide). */
function LiftApprove({ id }: { id: string }) {
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-sm" htmlFor={`lift-note-${id}`}>Note to the developer</label>
      <input id={`lift-note-${id}`} className="input w-72 max-w-full" value={note} onChange={(e) => setNote(e.target.value)} />
      <button
        className="btn-ghost"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          try {
            await api("/api/admin/approve-hold", { id, note });
            setMsg({ ok: true, text: "Approved." });
            setTimeout(() => window.location.reload(), 600);
          } catch (e) {
            setMsg({ ok: false, text: errOf(e) });
          } finally {
            setBusy(false);
          }
        }}
      >
        Approve
      </button>
      {msg && <span className={msg.ok ? "ok" : "err"}>{msg.text}</span>}
    </div>
  );
}

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
          {d.open ? <DisputeDecision id={d.id} minCents={d.min} maxCents={d.max} side={d.devSide ?? ""} sideAt={d.devSideAt ?? null} dev={d.dev ?? "The developer"} /> : <>
            {d.devSide && <p>Developer&apos;s side: “{d.devSide}”</p>}
            <p className="note">{d.decided}</p>
          </>}
        </div>
      );
    }
    case "lifts": {
      const l = row as LiftVM;
      return (
        <div id={`lift-${l.id}`} className="scroll-mt-24 space-y-1 border-t border-white/[0.06] py-2 text-sm first:border-t-0" data-lift-row={l.id}>
          <p><b>{l.head}</b></p>
          <p>{l.owed} · {l.paid}</p>
          <LiftApprove id={l.id} />
        </div>
      );
    }
    case "reports": {
      const r = row as ReportVM;
      return (
        <div className="space-y-0.5 border-t border-white/[0.06] py-2 text-sm first:border-t-0" data-report-row={r.id}>
          <p><a href={r.reporterHref}>{r.reporter}</a> reported <a href={r.reportedHref}>{r.reported}</a> · {r.when}</p>
          <p className="text-slate-300">“{r.note}”</p>
        </div>
      );
    }
    case "mine": {
      const m = row as MineVM;
      return (
        <p className="border-t border-white/[0.06] py-2 text-sm first:border-t-0" data-mine-row={m.testId || m.id}>
          {m.testId ? <a href={`/app/find/${m.testId}`}>“{m.title}”</a> : <span>{m.title}</span>} · {m.dev} · {m.why} · {m.when}
        </p>
      );
    }
    case "users": {
      const u = row as UserVM;
      const [email, ...rest] = u.line.split(" · ");
      return (
        <li id={`user-${u.id}`} className="scroll-mt-24 space-y-1 py-2 text-slate-300" data-user-row={u.id}>
          <p>
            <a href={u.href}>{email}</a> · {rest.join(" · ")}
            {u.reports > 3 && <span className="badge ml-2 border-amber-300/40 text-amber-200">Reported more than 3 times</span>}
            {u.reports > 0 && u.reports <= 3 && <span className="ml-2 text-xs text-slate-500">{u.reports} report{u.reports === 1 ? "" : "s"}</span>}
          </p>
          {u.state === "deleted" ? (
            <p className="text-xs text-rose-300">{u.stateLine}</p>
          ) : (
            <>
              {/* (Owner, Oct 30, batch 15 section 16) Each suspended side has its own line and Reinstate. */}
              {(["developer", "tester"] as const).filter((s) => (s === "developer" ? u.devSuspended : u.testerSuspended)).map((s) => {
                const line = u.stateLine.split(" · Suspended").map((x, i) => (i ? `Suspended${x}` : x)).find((x) => x.startsWith(`Suspended (${s} side)`)) ?? "";
                return (
                  <p key={s} className="flex flex-wrap items-center gap-2" data-suspended-side={s}>
                    <b>Suspended ({s} side)</b> <span className="line-clamp-2 max-w-full break-words" title={line}>{line.replace(`Suspended (${s} side) `, "")}</span>
                    <AdminButton action="unsuspend" id={u.id} label="Reinstate" extra={{ side: s }} />
                  </p>
                );
              })}
              {(() => {
                const open = (["developer", "tester"] as const).filter((s) => (s === "developer" ? u.isDeveloper && !u.devSuspended : u.isTester && !u.testerSuspended));
                const roles = (u.isDeveloper ? 1 : 0) + (u.isTester ? 1 : 0);
                return (
                  <p className="flex flex-wrap items-center gap-2">
                    {(open.length > 0 || roles === 0) && <PreviewButton id={u.id} />}
                    {/* A one-role account just shows Suspend; an account with both roles chooses the side. */}
                    {open.length > 0 && (roles === 2 && open.length === 2 ? (
                      <AdminButton action="suspend" id={u.id} label="Suspend" danger choice={{ name: "side", label: "Side to suspend", options: [{ value: "developer", label: "Developer side" }, { value: "tester", label: "Tester side" }] }} fields={[{ name: "note", label: "Why" }]} />
                    ) : (
                      <AdminButton action="suspend" id={u.id} label={roles === 2 ? `Suspend the ${open[0]} side` : "Suspend"} danger extra={{ side: open[0] }} fields={[{ name: "note", label: "Why" }]} />
                    ))}
                    {roles === 0 && <AdminButton action="suspend" id={u.id} label="Suspend" danger fields={[{ name: "note", label: "Why" }]} />}
                    <AdminButton action="delete-account" id={u.id} label="Delete account" danger fields={[{ name: "note", label: "Why" }]} />
                  </p>
                );
              })()}
            </>
          )}
        </li>
      );
    }
    case "tests": {
      const t = row as TestVM;
      const parts = t.line.split(" · ");
      return (
        <li id={`test-${t.id}`} className="scroll-mt-24 space-y-1 py-2 text-slate-300" data-test-row={t.id}>
          <p>{parts[0]} · <a href={t.href}>{parts[1]}</a> · {parts.slice(2).join(" · ")}</p>
          {t.closedLine && <p className="text-xs text-rose-300">{t.closedLine}</p>}
          {!t.stopped && (
            <p className="flex flex-wrap items-center gap-2">
              {t.adminPaused ? <AdminButton action="unpause-test" id={t.id} label="Lift the pause" /> : <AdminButton action="pause-test" id={t.id} label="Pause" fields={[{ name: "note", label: "Why" }]} />}
              <AdminButton action="stop-test" id={t.id} label="Stop (close)" danger fields={[{ name: "note", label: "Why" }]} />
              {t.critical > 0 && <AdminButton action="allow-critical-changes" id={t.id} label="Allow 3 more changes of the locked fields" />}
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
      return <li className="py-2 text-sm text-slate-300">{t.href ? <a href={t.href}>{t.text}</a> : t.text}</li>;
    }
  }
}

const LIST_KINDS = new Set<Kind>(["users", "tests", "payments", "waitlist", "u-payments", "u-payouts", "u-disputes", "u-chargebacks", "u-holds", "u-tests", "u-reports", "u-parts", "t-timeline", "t-contracts", "t-payments"]);
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
