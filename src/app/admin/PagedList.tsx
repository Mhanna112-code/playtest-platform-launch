"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api, errOf } from "@/lib/client";
import { LIVE_POLL_MS, LOADING_LINE, SEARCHABLE, SEARCH_MAX, SEARCH_PAUSE_MS, atTop, endLine, headingText, isSearchKind, mergeTop, nearEnd, newRowsAhead, newRowsPill, searchOf, shownWithFresh } from "@/lib/adminScroll";
import { AccountActions } from "./AccountActions";
import { DisputeWork } from "./DisputeWork";
import { ScrollText } from "@/components/ScrollText";
import type { ContactVM } from "@/lib/server/adminLists";
import type { ChargebackVM, DisputeVM, Kind, LiftVM, MineVM, Page, PausedVM, ReportVM, TestVM, TextVM, UserVM } from "@/lib/server/adminLists";
import { AdminButton } from "./AdminButton";
import { DisputeDecision } from "./DisputeDecision";
import { AdminRich } from "./AdminRich";
import { ChangesBox } from "@/components/ChangesBox";
import { ADMIN_STOP_HEADING, useAdminStop } from "@/lib/adminStop";
import { DraftTag, useKept } from "@/lib/useKept";
import { adminDraftKey } from "@/lib/keptText";
import { usePauseDraftGoes } from "./TestActions";

type AnyRow = ContactVM | DisputeVM | MineVM | UserVM | TestVM | TextVM | PausedVM | ChargebackVM | LiftVM | ReportVM;
/** (Owner, Oct 30, batch 34 §1) A row's page time (when the server read it): its buttons send it, so a press on a row older than another admin's change stops once. */
const since = (r: AnyRow): Record<string, string> => { const s = (r as { seen?: string }).seen; return s ? { since: s } : {}; };

/**
 * A hold lift waiting for Approve: a note box and Approve (first press wins, like Decide). (Owner, Oct 30, batch 35 §11) The note is a draft ("admin:approve-hold:<id>",
 * admins only): "Draft" after a reload, after a sign-in "Draft" with "Discard". Cleared when Approve goes through; a stopped or refused Approve keeps it.
 */
function LiftApprove({ id, seen }: { id: string; seen?: string }) {
  const [note, setNote] = useState("");
  const keep = useKept<{ note?: unknown }>(adminDraftKey("approve-hold", id), { note }, note.trim() === "", (d) => setNote(typeof d.note === "string" ? d.note : ""));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const stop = useAdminStop(); // (batch 34 §1) another admin suspended the developer since the row was read: stops once
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-sm" htmlFor={`lift-note-${id}`}>Note to the developer</label>
      <input id={`lift-note-${id}`} className="input w-72 max-w-full" value={note} onChange={(e) => setNote(e.target.value)} />
      {keep.restored && note !== "" && <DraftTag kind="discard" onUseSaved={() => setNote("")} />}
      <button
        className="btn-ghost"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          try {
            await api("/api/admin/approve-hold", { id, note, ...(seen ? { since: seen } : {}), ...stop.marks() });
            await keep.clear();
            stop.clear();
            setMsg({ ok: true, text: "Approved." });
            setTimeout(() => window.location.reload(), 600);
          } catch (e) {
            if (!stop.caught(e)) {
              stop.clear();
              setMsg({ ok: false, text: errOf(e) });
            }
          } finally {
            setBusy(false);
          }
        }}
      >
        Approve
      </button>
      {msg && <span className={msg.ok ? "ok" : "err"}>{msg.text}</span>}
      <ChangesBox changes={stop.changes} press="Approve" heading={ADMIN_STOP_HEADING} />
    </div>
  );
}

/** (Batch 22 section 5) Re-reads the list's first rows now and updates the ones shown (a refused Lift the pause turns its row back into Pause). */
const RefreshRows = createContext<() => void>(() => {});

/** Pause / Lift the pause on a test's row: a press from an old row is refused naming who lifted it, and the row refreshes. */
function PauseToggle({ t }: { t: TestVM }) {
  const refreshRows = useContext(RefreshRows);
  const [refused, setRefused] = useState("");
  const onRefused = (e: unknown) => {
    setRefused(errOf(e));
    refreshRows();
  };
  // (Batch 27 section 5) Keyed by the state: a pause lifted (or set) elsewhere swaps in a fresh button (Pause with its own empty Why box, or Lift the pause), never the
  // old one's leftovers.
  usePauseDraftGoes(t.id, t.adminPaused);
  return (
    <>
      {t.adminPaused ? <AdminButton key="lift" action="unpause-test" id={t.id} label="Lift the pause" extra={since(t)} onRefused={onRefused} /> : <AdminButton key="pause" action="pause-test" id={t.id} label="Pause" fields={[{ name: "note", label: "Why" }]} extra={since(t)} onRefused={onRefused} />}
      {refused && <span className="err" data-pause-refused="">{refused}</span>}
    </>
  );
}

function Row({ kind, row }: { kind: Kind; row: AnyRow }) {
  switch (kind) {
    case "disputes":
    case "decided": {
      const d = row as DisputeVM;
      return (
        <div id={`dispute-${d.id}`} className="scroll-mt-24 space-y-1 rounded data-[marked]:ring-2 data-[marked]:ring-sky-300 border-t border-white/[0.06] py-2 text-sm first:border-t-0" data-dispute-row={d.id}>
          {/* (Batch 33 §1, §2) The test and the part first, then the people (names open their profiles), then who wrote what. */}
          <p data-dispute-top=""><b>{d.top ? <AdminRich parts={d.top} /> : d.head}</b></p>
          {d.people && <p data-dispute-people=""><AdminRich parts={d.people} /></p>}
          <p>{d.money}</p>
          <p data-dispute-said="">{d.saidParts ? <AdminRich parts={d.saidParts} /> : d.said}</p>
          <DisputeWork work={d.work ?? null} />
          {/* (Owner, Oct 29, batch 28 §15) Their chat on this test, read-only, newest last, in a scroll box: the only place the team reads a chat. */}
          <details className="rounded-lg border border-white/10 p-2" data-dispute-chat={d.id}>
            <summary className="fold-chevron cursor-pointer font-medium text-white">Their chat on this test <span className="font-normal text-slate-400">({(d.chat ?? []).length})</span></summary>
            {(d.chat ?? []).length === 0 ? <p className="note mt-2">No messages.</p> : (
              <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto pr-1">
                {(d.chat ?? []).map((m) => <li key={m.id} className="whitespace-pre-wrap break-words"><b>{m.who}</b> <span className="text-xs text-slate-500">{m.at}</span>: {m.text}</li>)}
              </ul>
            )}
          </details>
          {d.open && d.range && <p data-dispute-range="">{d.range}</p>}
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
        <div id={`lift-${l.id}`} className="scroll-mt-24 space-y-1 rounded data-[marked]:ring-2 data-[marked]:ring-sky-300 border-t border-white/[0.06] py-2 text-sm first:border-t-0" data-lift-row={l.id}>
          <p><b>{l.headParts ? <AdminRich parts={l.headParts} /> : l.head}</b></p>
          <p>{l.owed} · {l.paid}</p>
          <LiftApprove id={l.id} seen={(l as { seen?: string }).seen} />
        </div>
      );
    }
    case "reports": {
      const r = row as ReportVM;
      return (
        <div id={`report-${r.id}`} className="scroll-mt-24 space-y-0.5 rounded border-t border-white/[0.06] py-2 text-sm first:border-t-0 data-[marked]:ring-2 data-[marked]:ring-sky-300" data-report-row={r.id}>
          {/* (Batch 33 §1) Each name opens the profile, its email after it. */}
          <p><a href={r.reporterHref}>{r.reporter}</a>{r.reporterEmail ? ` (${r.reporterEmail})` : ""} reported <a href={r.reportedHref}>{r.reported}</a>{r.reportedEmail ? ` (${r.reportedEmail})` : ""} · {r.when}</p>
          <p className="text-slate-300">“{r.note}”</p>
        </div>
      );
    }
    case "mine": {
      const m = row as MineVM;
      return (
        <p className="border-t border-white/[0.06] py-2 text-sm first:border-t-0" data-mine-row={m.testId || m.id}>
          {m.parts ? <AdminRich parts={m.parts} /> : <>{m.testId ? <a href={`/app/find/${m.testId}`}>“{m.title}”</a> : <span>{m.title}</span>} · {m.dev} · {m.why} · {m.when}</>}
        </p>
      );
    }
    case "users": {
      const u = row as UserVM;
      const [email, ...rest] = u.line.split(" · ");
      return (
        <li id={`user-${u.id}`} className="scroll-mt-24 space-y-1 py-2 text-slate-300" data-user-row={u.id}>
          <p>
            {u.parts ? <AdminRich parts={u.parts} /> : <><a href={u.href}>{email}</a> · {rest.join(" · ")}</>}
            {u.reports > 3 && <span className="badge ml-2 border-amber-300/40 text-amber-200">Reported more than 3 times</span>}
            {u.reports > 0 && u.reports <= 3 && <span className="ml-2 text-xs text-slate-500">{u.reports} report{u.reports === 1 ? "" : "s"}</span>}
          </p>
          {/* (Batch 17 §6) Suspend / Reinstate / Delete with the Preview check: the same component as a profile's admin view. */}
          <AccountActions initial={u.acct} />
        </li>
      );
    }
    case "tests": {
      const t = row as TestVM;
      const parts = t.line.split(" · ");
      return (
        <li id={`test-${t.id}`} className="scroll-mt-24 space-y-1 py-2 text-slate-300" data-test-row={t.id}>
          <p>{t.parts ? <AdminRich parts={t.parts} /> : <>{parts[0]} · <a href={t.href}>{parts[1]}</a> · {parts.slice(2).join(" · ")}</>}</p>
          {t.closedLine && <p className="text-xs text-rose-300">{t.closedLine}</p>}
          {!t.stopped && (
            <div className="flex flex-wrap items-center gap-2">
              <PauseToggle t={t} />
              <AdminButton action="stop-test" id={t.id} label="Stop (close)" danger fields={[{ name: "note", label: "Why" }]} extra={since(t)} />
              {t.critical > 0 && <AdminButton action="allow-critical-changes" id={t.id} label="Allow 3 more changes of the locked fields" extra={since(t)} />}
            </div>
          )}
        </li>
      );
    }
    case "mypaused": {
      // (Owner, Oct 30, batch 33 §6) A test this admin paused, still paused: its line and Lift the pause.
      const t = row as TestVM;
      return (
        <li id={`mypaused-${t.id}`} className="scroll-mt-24 space-y-1 py-2 text-slate-300" data-mypaused-row={t.id}>
          <p>{t.parts ? <AdminRich parts={t.parts} /> : t.line}</p>
          <div className="flex flex-wrap items-center gap-2"><PauseToggle t={t} /></div>
        </li>
      );
    }
    case "suspensions": {
      // (Owner, Oct 30, batch 33 §6) An account suspended now: the person, then each suspended side with Reinstate (the same component as the profile's admin view).
      const u = row as UserVM;
      return (
        <li id={`suspension-${u.id}`} className="scroll-mt-24 space-y-1 py-2 text-slate-300" data-suspension-row={u.id}>
          <p>{u.parts ? <AdminRich parts={u.parts} /> : u.line}</p>
          <AccountActions initial={u.acct} />
        </li>
      );
    }
    case "paused": {
      const p = row as PausedVM;
      return (
        <div className="space-y-1 border-t border-white/[0.06] py-2 text-sm first:border-t-0" data-paused-test={p.id}>
          <p>{p.parts ? <AdminRich parts={p.parts} /> : p.text}</p>
          <p data-closure-date=""><b>{p.closure}</b>{p.extended ? " · extended by the team" : ""}</p>
          <div className="flex flex-wrap items-center gap-2">
            <AdminButton action="extend-pause" id={p.id} label="Extend" fields={[{ name: "days", label: "Days to add", ph: "Days (7)" }]} extra={since(p)} />
            <AdminButton action="close-paused" id={p.id} label="Close now" danger extra={since(p)} />
          </div>
        </div>
      );
    }
    case "chargebacks": {
      const c = row as ChargebackVM;
      return (
        <div className="space-y-1 border-t border-white/[0.06] py-2 text-sm first:border-t-0" data-chargeback-hold={c.id}>
          <p>{c.who ? <AdminRich parts={c.who} /> : c.email} · on hold since {c.since}</p>
          {(c.chargebackParts ?? c.chargebacks).map((x, i) => <p key={i} className="text-slate-400">{typeof x === "string" ? x : <AdminRich parts={x} />}</p>)}
          <div data-chargeback-steps="">
            Chargeback hold: card verified <b>{c.cardVerified ? "✓" : "✗"}</b>, owed reserved <b>{c.owedPaid ? "✓" : "✗"}</b>{c.owedLine}{" "}
            {/* (Batch 23 section 6) Approve takes the reservation and lifts the hold in one step; Don't approve releases it (nothing taken; the hold stays). */}
            <AdminButton action="approve-chargeback" id={c.id} label="Approve" disabled={!c.cardVerified || !c.owedPaid} extra={since(c)} />
            {c.reservedCents > 0 && <AdminButton action="decline-chargeback" id={c.id} label="Don't approve: release the reservation" danger fields={[{ name: "note", label: "Why (optional)" }]} extra={since(c)} />}
          </div>
          {c.expired && <p className="text-amber-200" data-reserve-expired="">Reservation expired</p>}
        </div>
      );
    }
    case "contact": {
      const m = row as ContactVM;
      return (
        <div id={`contact-${m.id}`} className="space-y-1 border-t border-white/[0.06] py-2 text-sm first:border-t-0" data-contact-row={m.id}>
          <p><b>{m.fromParts ? <AdminRich parts={m.fromParts} /> : m.from}</b> · {m.topic}</p>
          {/* (Batch 15 section 21) Up to 50,000 characters: a scroll box about 8 lines tall (the email to the team has it in full). */}
          <ScrollText text={m.message} lines={8} className="text-slate-300" />
          {m.replied ? <p className="note" data-replied="">{m.replied}</p> : <AdminButton action="contact-replied" id={m.id} label="Mark replied" extra={since(m)} />}
        </div>
      );
    }
    default: {
      const t = row as TextVM;
      return <li className="py-2 text-sm text-slate-300">{t.parts ? <AdminRich parts={t.parts} /> : t.href ? <a href={t.href}>{t.text}</a> : t.text}{t.em && <i className="text-slate-200"> “{t.em}”</i>}</li>;
    }
  }
}

const LIST_KINDS = new Set<Kind>(["users", "tests", "payments", "payouts", "u-payments", "u-payouts", "u-disputes", "u-chargebacks", "u-holds", "u-tests", "u-reports", "u-parts", "u-failures", "mypaused", "suspensions", "t-timeline", "t-contracts", "t-payments"]);

type Filter = { q: string; ticks: string[] };
const NO_FILTER: Filter = { q: "", ticks: [] };
const sameFilter = (a: Filter, b: Filter) => a.q === b.q && a.ticks.join(",") === b.ticks.join(",");

/**
 * (Batch 17 §7, replacing the owner's Oct 26 pages of 25) Every admin list is a scroll box about 10 rows tall that loads the next 25 as it nears its end (the same
 * keyset cursors), with a "Loading…" row while it fetches and "That's all (N)" at the end. The heading keeps the total ("Accounts (1,204)"; with a search or ticks,
 * "Accounts: 12 match"). (Batch 17 §5) Accounts and Tests have a search box and tick boxes above the box: they apply after a short pause, reload only this list and
 * reset it to the top. Rows that arrive live while the box is scrolled down don't move it: a "3 new ↑" pill scrolls back to the top and shows them (at the top they
 * go straight in). Each row keeps its anchor (dispute-ID, user-ID, test-ID) so a bell line or a link can open the exact row. Phones: the same box, full width.
 * `fixed`: one pinned row (opened from a link): no live check and no end line.
 */
export function PagedList({ kind, initial, arg = "", title, level = 2, fixed = false, sideFilter }: { kind: Kind; initial: Page<AnyRow> | null; arg?: string; title?: string; level?: 2 | 3; fixed?: boolean; sideFilter?: "developer" | "tester" }) {
  const search = isSearchKind(kind) ? SEARCHABLE[kind] : null;
  const [rows, setRows] = useState<AnyRow[]>(initial?.rows ?? []);
  const [total, setTotal] = useState(initial?.total ?? 0);
  const [next, setNext] = useState<string | null>(initial?.next ?? null);
  const [loading, setLoading] = useState(!initial);
  const [err, setErr] = useState("");
  // What is typed and ticked, and the filter the rows shown are for (the heading and the cursor follow the applied one).
  const [typed, setTyped] = useState("");
  const [ticks, setTicks] = useState<string[]>([]);
  const [applied, setApplied] = useState<Filter>(NO_FILTER);
  // A fresh first page with rows ahead of the shown ones, held while the box is scrolled down (the pill).
  const [pending, setPending] = useState<Page<AnyRow> | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const seq = useRef(0); // bumped by each new filter: answers for an older one are dropped
  const busy = useRef(false); // the next 25 are loading
  const first = useRef(false); // a filter's first 25 are loading: no next 25 or live check meanwhile
  const rowsRef = useRef(rows);
  const appliedRef = useRef(applied);
  useEffect(() => {
    rowsRef.current = rows;
    appliedRef.current = applied;
  }, [rows, applied]);

  const url = useCallback(
    (after: string | null, f: Filter) => `/api/admin/more?kind=${kind}${sideFilter ? `&side=${sideFilter}` : ""}&after=${encodeURIComponent(after ?? "")}${arg ? `&arg=${encodeURIComponent(arg)}` : ""}${f.q ? `&q=${encodeURIComponent(f.q)}` : ""}${f.ticks.length ? `&f=${encodeURIComponent(f.ticks.join(","))}` : ""}`,
    [kind, arg, sideFilter],
  );

  /** The first 25 for a filter (or the lazy first load): replaces the rows and goes back to the top. */
  const reload = useCallback(
    async (f: Filter) => {
      const my = ++seq.current;
      first.current = true;
      setLoading(true);
      setErr("");
      try {
        const r = await api<Page<AnyRow>>(url(null, f));
        if (my !== seq.current) return;
        setRows(r.rows);
        setTotal(r.total);
        setNext(r.next);
        setApplied(f);
        appliedRef.current = f;
        setPending(null);
        if (box.current) box.current.scrollTop = 0;
      } catch (e) {
        if (my === seq.current) setErr(errOf(e));
      }
      if (my === seq.current) {
        first.current = false;
        setLoading(false);
      }
    },
    [url],
  );

  /** The next 25 after the last row shown. */
  const loadMore = useCallback(async () => {
    if (busy.current || first.current || !next) return;
    busy.current = true;
    setLoading(true);
    setErr("");
    const my = seq.current;
    try {
      const r = await api<Page<AnyRow>>(url(next, appliedRef.current));
      if (my !== seq.current) return;
      setRows((prev) => {
        const have = new Set(prev.map((x) => x.id));
        return [...prev, ...r.rows.filter((x) => !have.has(x.id))];
      });
      setNext(r.next);
      setTotal(r.total);
    } catch (e) {
      if (my === seq.current) setErr(errOf(e));
    } finally {
      busy.current = false;
      if (my === seq.current) setLoading(false);
    }
  }, [next, url]);

  /** Live rows go on top (from the pill, or straight in while the box is at its top). */
  const takeTop = useCallback((fresh: Page<AnyRow>) => {
    const m = mergeTop(fresh.rows, rowsRef.current);
    setRows(m.rows);
    if (m.replaced) setNext(fresh.next);
    setTotal(fresh.total);
    setPending(null);
  }, []);

  /** (Batch 22 section 5) Rows already shown take their fresh state (a test's pause lifted elsewhere turns its button back into Pause). */
  const updateShown = useCallback((fresh: AnyRow[]) => {
    setRows((prev) => shownWithFresh(prev, fresh));
  }, []);
  /**
   * (Owner, Oct 29, batch 29 section 20) The Tests rows shown below the first 25 (loaded by scrolling) are asked for by id, so they follow a pause set or lifted
   * elsewhere too (the first page alone covered only the top 25).
   */
  const refreshBeyond = useCallback(async (firstIds: Set<string>) => {
    if (kind !== "tests") return;
    const rest = rowsRef.current.map((x) => x.id).filter((id) => !firstIds.has(id));
    for (let i = 0; i < rest.length; i += 100) {
      const r = await api<Page<AnyRow>>(`/api/admin/more?kind=tests&ids=${encodeURIComponent(rest.slice(i, i + 100).join(","))}`).catch(() => null);
      if (r) updateShown(r.rows);
    }
  }, [kind, updateShown]);
  const refreshRows = useCallback(() => {
    void api<Page<AnyRow>>(url(null, appliedRef.current)).then((r) => {
      updateShown(r.rows);
      void refreshBeyond(new Set(r.rows.map((x) => x.id)));
    }, () => null);
  }, [url, updateShown, refreshBeyond]);

  // (Owner, Oct 30, batch 33 §7) The page redrawn by its live poll (another admin changed something) brings fresh first rows: they replace the first rows shown (a
  // row gone elsewhere goes, a new one comes), rows loaded further down by scrolling stay, and each row keeps its own state (what was typed in its boxes) by its id.
  // A searched or ticked list keeps its own rows.
  const firstIds = useRef<Set<string>>(new Set((initial?.rows ?? []).map((x) => x.id)));
  useEffect(() => {
    if (!initial || fixed) return;
    const before = firstIds.current;
    firstIds.current = new Set(initial.rows.map((x) => x.id));
    if (appliedRef.current.q || appliedRef.current.ticks.length) return;
    const fresh = new Set(initial.rows.map((x) => x.id));
    const below = rowsRef.current.filter((x) => !before.has(x.id) && !fresh.has(x.id));
    setRows([...initial.rows, ...below]);
    setTotal(initial.total);
    if (!below.length) setNext(initial.next);
    setPending(null);
  }, [initial, fixed]);

  // Opened without rows (a lazy list): fetch its first 25.
  useEffect(() => {
    if (!initial) void reload(NO_FILTER);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // (Batch 17 §5) Search and ticks apply after a short pause; clearing both brings the full list back.
  useEffect(() => {
    if (!search) return;
    const f: Filter = { q: searchOf(typed), ticks };
    if (sameFilter(f, appliedRef.current)) return;
    const t = setTimeout(() => void reload(f), SEARCH_PAUSE_MS);
    return () => clearTimeout(t);
  }, [typed, ticks, search, reload]);

  // A box whose rows don't fill it yet keeps loading until they do or nothing is left.
  useEffect(() => {
    if (next && !loading && box.current && nearEnd(box.current)) void loadMore();
  }, [rows, next, loading, loadMore]);

  // (Batch 17 §7) Live rows: while the box is on screen and the tab visible, look at the first 25 again every 20 s.
  useEffect(() => {
    if (fixed) return;
    let onScreen = true;
    const io = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; });
    if (io && wrap.current) io.observe(wrap.current);
    const tick = async () => {
      if (!onScreen || document.visibilityState !== "visible" || busy.current || first.current) return;
      const my = seq.current;
      try {
        const r = await api<Page<AnyRow>>(url(null, appliedRef.current));
        if (my !== seq.current) return;
        setTotal(r.total);
        updateShown(r.rows);
        void refreshBeyond(new Set(r.rows.map((x) => x.id)));
        if (!r.rows.length || !newRowsAhead(r.rows, rowsRef.current).length) return setPending(null);
        if (!box.current || atTop(box.current)) takeTop(r);
        else setPending(r);
      } catch {
        // offline: try again next time
      }
    };
    const t = setInterval(tick, LIVE_POLL_MS);
    // (Batch 27 section 5) Also at once when the tab comes back into view or gets focus, and on the page's live nudge: rows shown (searched or not) follow a
    // pause lifted or set elsewhere without waiting for the next 20 s.
    const now = () => void tick();
    const onVisible = () => { if (document.visibilityState === "visible") void tick(); };
    window.addEventListener("live-tick", now);
    window.addEventListener("focus", now);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      io?.disconnect();
      window.removeEventListener("live-tick", now);
      window.removeEventListener("focus", now);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fixed, url, takeTop, updateShown, refreshBeyond]);

  const filtered = applied.q !== "" || applied.ticks.length > 0;
  const fresh = pending ? newRowsAhead(pending.rows, rows).length : 0;
  const body = rows.map((r) => <Row key={r.id} kind={kind} row={r} />);
  const H = level === 2 ? "h2" : "h3";
  return (
    <RefreshRows.Provider value={refreshRows}>
    <div className="w-full min-w-0 space-y-2" data-paged={kind} ref={wrap}>
      {title && <H className={level === 2 ? "text-lg font-semibold text-white" : "font-semibold text-white"} data-list-heading={kind}>{headingText(title, total, filtered)}</H>}
      {search && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-list-filters={kind}>
          <input type="search" className="input w-full sm:w-80" aria-label={search.label} placeholder={search.placeholder} maxLength={SEARCH_MAX} value={typed} onChange={(e) => setTyped(e.target.value)} data-list-search={kind} />
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1" role="group" aria-label="Show only">
            {search.ticks.map((t) => (
              <label key={t.value} className="inline-flex items-center gap-1.5 text-sm text-slate-300">
                <input type="checkbox" checked={ticks.includes(t.value)} onChange={(e) => setTicks((now) => (e.target.checked ? [...now, t.value] : now.filter((x) => x !== t.value)))} data-list-tick={t.value} /> {t.label}
              </label>
            ))}
          </span>
        </div>
      )}
      {/* (Owner, Oct 30, batch 33 §4) An empty box shows only its heading with (0): no "None." line under it (a search with no match still says so). */}
      {rows.length === 0 && !loading ? (
        filtered && search ? <p className="note">{search.none}</p> : null
      ) : (
        <div className="relative w-full">
          {fresh > 0 && (
            <button
              type="button"
              className="absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-full border border-sky-300/50 bg-sky-500/90 px-3 py-1 text-xs font-semibold text-white shadow-lg"
              onClick={() => {
                if (pending) takeTop(pending);
                box.current?.scrollTo({ top: 0, behavior: "smooth" });
              }}
              data-new-rows={kind}
            >
              {newRowsPill(fresh)}
            </button>
          )}
          <div
            ref={box}
            className="max-h-[23rem] w-full overflow-y-auto overscroll-contain pr-1"
            onScroll={(e) => {
              const b = e.currentTarget;
              if (nearEnd(b)) void loadMore();
              if (pending && atTop(b)) takeTop(pending);
            }}
            data-scroll-box={kind}
          >
            {LIST_KINDS.has(kind) ? <ul className="divide-y divide-white/5 text-sm">{body}</ul> : body}
            {loading && <p className="py-2 text-center text-sm text-slate-400" data-loading-row={kind}>{LOADING_LINE}</p>}
            {!loading && !next && !fixed && rows.length > 0 && <p className="py-2 text-center text-xs text-slate-500" data-end-line={kind}>{endLine(total)}</p>}
          </div>
        </div>
      )}
      {err && <p className="err">{err}</p>}
    </div>
    </RefreshRows.Provider>
  );
}
