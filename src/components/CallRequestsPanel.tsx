"use client";
import { NameLink } from "@/components/Cut";
import { useEffect, useRef, useState } from "react";
import { ChangesBox } from "@/components/ChangesBox";
import { usePress } from "@/lib/usePress";
import { MARKABLE } from "@/lib/markJump";
import type { RowJson } from "@/lib/callRows";
import { acceptChoices, describeRows } from "@/components/RequestRows";
import { bookableNow, tooSoonNote } from "@/lib/callWindow";
import { ResizeBox } from "@/components/Panel";
import { LIST_PANEL } from "@/components/ScrollList";
import { HoldFold, useHoldOpen } from "@/components/HoldFold";

/** One waiting call request: `tester` (whose test session it is), `asker` (who asked: "you" when it's yours). */
export type PanelReq = { id: string; contractId: string; tester: string; /** (Owner, Nov 3, §166) their profile: the name is the green link */ testerHref?: string | null; asker: string; rows: RowJson[]; minutes: number; mine: boolean; rate: string; warning?: string;
  /** (Owner, Nov 4, §181) when it was sent (ISO): the developer's box lists each person's requests oldest first */ at?: string };

/**
 * (Owner, Oct 28, batch 16 sections 33 and 35) The one "Call requests" panel: every waiting request on this test in both directions, soonest first: the tester, the
 * time(s) (Once / Daily / Weekly, N calls or Forever), the length, who asked, and Accept / Decline (theirs) or Withdraw (yours). A plain scroll box about 5 rows
 * tall that follows the page live. Needs you's call-request rows open this panel at their request (#req-<id>, highlighted); Accept / Decline happen only here,
 * so they follow every rule of the panel (the stop-once box, the clash refusals, the paused / stopped / restricted refusals).
 */
/** (Batch 26 section 10) The pressed button's name for its stop box or refusal ("Your Withdraw didn't go through"), from the press key. */
/** (Owner, Nov 4, §181) A person's drop-down in the developer's Call requests box (Needs you's "2 call requests ↓" jumps to it). */
export const callRequestsAnchor = (contractId: string) => `call-requests-person-${contractId}`;
/** (Owner, Nov 4, §185) A person's drop-down in the developer's "Your requests" box (their own waiting requests to that tester). */
export const yourRequestsAnchor = (contractId: string) => `your-requests-person-${contractId}`;
/** (§185) The box's name search: as you type, case-insensitive, anywhere in the name as shown. An empty search matches everyone. */
export const matchesName = (name: string, query: string) => name.toLowerCase().includes(query.trim().toLowerCase());
/** (§185) What the box says when nobody matches: "No one matches “ana”". */
export const noMatchLine = (query: string) => `No one matches “${query.trim()}”`;
export const requestPressName = (at: string) => (at.startsWith("w-") ? "Withdraw" : at.startsWith("d-") ? "Decline" : "Accept");

export function CallRequestsPanel({ side, seenAt, requests, path, leadMinutes = 0, panelId, byPerson = false, title = "Call requests", sectionId = "call-requests", anchor = callRequestsAnchor, search, showCount = false }: { side: "developer" | "tester"; seenAt: string; requests: PanelReq[]; /** where answer-request goes for a request */ path: (r: PanelReq) => string;
  /** (Owner, Nov 2, batch 35 §132) The server's call lead: a time less than it away can't be booked any more. */
  leadMinutes?: number;
  /** (Owner, Nov 3, batch 35 §152) The list's panel id ("call-requests-<test or session id>"): its dragged height is kept by it. */
  panelId: string;
  /** (Owner, Nov 4, §181) The developer's Call requests box: one drop-down per person */ byPerson?: boolean;
  /** (Owner, Nov 4, §185) The list's name (its heading, when not by person, and its label): "Requests to you" / "Your requests" */ title?: string;
  /** (§185) the section's anchor: "call-requests" (requests to you) / "your-requests" */ sectionId?: string;
  /** (§185) a person's drop-down id (Needs you's "N call requests ↓" points at callRequestsAnchor, the "Requests to you" box) */ anchor?: (contractId: string) => string;
  /** (§185) the name search above the people ("to-you" / "yours": its data-request-search) */ search?: string;
  /** (§185) the heading says how many: "Requests to you (2)" (the tester's split lists) */ showCount?: boolean }) {
  const { press, changes, error, busy, at, finish } = usePress(seenAt);
  // (Owner, Nov 4, §185) The name search: filters this box's people as you type (on this page only, nothing sent).
  const [query, setQuery] = useState("");
  const people$ = useRef<HTMLDivElement>(null);
  // A link (Needs you's "2 call requests ↓", a request's #req-<id>) to someone the search hides: the search clears and they show at once, before the jump scrolls.
  useEffect(() => {
    if (!search) return;
    const reveal = (href: string | null) => {
      const id = href?.startsWith("#") ? decodeURIComponent(href.slice(1)) : "";
      const el = id ? document.getElementById(id) : null;
      const box = people$.current;
      if (!el || !box || !box.contains(el)) return;
      for (let n: Element | null = el; n && n !== box; n = n.parentElement) n.removeAttribute("hidden");
      box.querySelector("[data-request-search-empty]")?.setAttribute("hidden", "");
      setQuery("");
    };
    const click = (e: MouseEvent) => reveal((e.target as Element | null)?.closest?.("a[href^='#']")?.getAttribute("href") ?? null);
    const hash = () => reveal(window.location.hash);
    document.addEventListener("click", click, true);
    window.addEventListener("hashchange", hash);
    return () => {
      document.removeEventListener("click", click, true);
      window.removeEventListener("hashchange", hash);
    };
  }, [search]);
  // (Batch 35 §132) A time less than the lead away (24 hours on the live site) can't be booked any more: its Accept goes and the row says why. The clock moves on
  // while the page is open (checked every half minute).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const bookable = (r: PanelReq) => acceptChoices(r.rows).filter((x) => bookableNow(x.time ?? r.rows[0].startsAt, leadMinutes, now));
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
  const pressed = (r: PanelReq) => at === "a-" + r.id || at === "d-" + r.id || at === "w-" + r.id;
  const row = (r: PanelReq) => (
    <li key={r.id} id={`req-${r.id}`} className={`flex flex-wrap items-center gap-2 rounded-lg border border-white/10 p-2 ${MARKABLE}`} data-request-row={r.mine ? "mine" : "theirs"}>
      <span className="mr-auto text-slate-300">
        {/* (§181) In a person's drop-down the name is on the drop-down, once. */}
        {side === "developer" && !byPerson && <><b className="text-white"><NameLink text={r.tester} href={r.testerHref} /></b> · </>}
        {describeRows(r.rows)} · {r.minutes} min · {r.rate} · asked by {r.mine ? "you" : r.asker}
      </span>
      {gone[r.id] ? (
        <span className="text-xs font-medium text-amber-200" data-request-gone="">{gone[r.id]}</span>
      ) : r.mine ? (
        <button className="btn-ghost" disabled={busy} onClick={() => go(r, { action: "withdraw" }, "w-" + r.id)}>Withdraw</button>
      ) : (
        <>
          {bookable(r).map((x) => (
            <button key={x.label} className="btn" disabled={busy} onClick={() => go(r, { action: "accept", ...(x.time ? { time: x.time } : {}) }, "a-" + r.id)}>{x.label}</button>
          ))}
          <button className="btn-ghost" disabled={busy} onClick={() => go(r, { action: "decline" }, "d-" + r.id)}>Decline</button>
        </>
      )}
      {!gone[r.id] && bookable(r).length === 0 && <span className="basis-full text-xs text-amber-200" data-too-soon="">{tooSoonNote(leadMinutes)}</span>}
      {r.warning && <span className="basis-full text-xs text-amber-200" data-calls-warning="">{r.warning}</span>}
      {pressed(r) && <div className="basis-full"><ChangesBox side={side} changes={changes} error={error} press={requestPressName(at)} /></div>}
    </li>
  );
  // (Owner, Nov 4, §181) The developer's box: one drop-down per person (closed; the green name, then "· N requests"), in the order of each person's oldest request;
  // inside, all their requests oldest first, both kinds together (theirs to answer with Accept / Decline, and yours with Withdraw), in a panel of its own.
  const sent = (r: PanelReq) => (r.at ? Date.parse(r.at) : first(r));
  const people: { id: string; name: string; href?: string | null; reqs: PanelReq[] }[] = [];
  if (byPerson) {
    for (const r of [...requests].sort((a, b) => sent(a) - sent(b))) {
      const p = people.find((x) => x.id === r.contractId);
      if (p) p.reqs.push(r);
      else people.push({ id: r.contractId, name: r.tester, href: r.testerHref, reqs: [r] });
    }
  }
  // (Owner, Nov 4, §185) The name search keeps a person whose request has a press under way, its stop box or refusal showing (never hidden mid-press).
  const held = (p: { reqs: PanelReq[] }) => p.reqs.some(pressed) && (busy || changes != null || !!error);
  const shown = (p: { name: string; reqs: PanelReq[] }) => !search || matchesName(p.name, query) || held(p);
  const none = !!search && query.trim() !== "" && people.length > 0 && !people.some(shown);
  return (
    <section className="space-y-1.5" aria-label={title} data-call-requests="" id={sectionId}>
      {!byPerson && <h3 className="text-sm font-semibold text-white">{title}{showCount && <span className="font-normal text-slate-400"> ({sorted.length})</span>}</h3>}
      {sorted.length === 0 ? (
        <p className="note">No call requests waiting.</p>
      ) : (
        <div className="space-y-2" ref={people$}>
        {/* (Owner, Nov 4, §185) The name search above the list: as you type, only the people whose name matches (case-insensitive). */}
        {byPerson && search && (
          <input type="search" className="input w-full max-w-xs" placeholder="Search by name" aria-label={`Search ${title.toLowerCase()} by name`} data-request-search={search}
            value={query} onChange={(e) => setQuery(e.target.value)} />
        )}
        {none && <p className="note" data-request-search-empty="">{noMatchLine(query)}</p>}
        {/* (Owner, Nov 3, batch 35 §152) In the draggable panel (§139): it scrolls inside, and the grip drags it shorter or taller. */}
        <ResizeBox id={panelId} label={title} defaultMax={LIST_PANEL.requests}>
        {byPerson ? (
          <div className="space-y-2" data-call-requests-people="">
            {people.map((p) => (
              // (§185) Hidden, not removed, while the search leaves them out: a drop-down keeps whether it was open.
              <div key={p.id} hidden={!shown(p) || undefined}>
              <HoldFold data={{ id: anchor(p.id), "data-call-requests-person": p.id }} toggleData={{ "data-call-requests-person-toggle": "" }}
                summary={<span className="min-w-0 [overflow-wrap:anywhere]"><NameLink text={p.name} href={p.href} />{" "}<span className="whitespace-nowrap font-normal text-slate-400">· {p.reqs.length} request{p.reqs.length === 1 ? "" : "s"}</span></span>}>
                {/* A press on one of their requests (under way, its stop box or refusal) keeps their drop-down open. */}
                <HoldWhile on={held(p)} />
                <ResizeBox id={`${panelId}-${p.id}`} label={`Call requests with ${p.name}`} defaultMax={LIST_PANEL.requests}>
                  <ul className="space-y-2 text-sm" data-call-requests-list="">{p.reqs.map(row)}</ul>
                </ResizeBox>
              </HoldFold>
              </div>
            ))}
          </div>
        ) : (
        <ul className="space-y-2 text-sm" data-call-requests-list="">
          {sorted.map(row)}
        </ul>
        )}
        </ResizeBox>
        </div>
      )}
    </section>
  );
}

/** (§181) Holds the drop-down it sits in open while `on`. */
function HoldWhile({ on }: { on: boolean }) {
  useHoldOpen(on);
  return null;
}
