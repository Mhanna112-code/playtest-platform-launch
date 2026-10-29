"use client";
import { PlusMore } from "@/components/PlusMore";
import { TAG_NAMES } from "@/lib/inviteRows";
import { SubscribersTag } from "@/components/SubscribeLink";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChangesBox } from "@/components/ChangesBox";
import { MistakeList } from "@/components/FieldChecks";
import { api } from "@/lib/client";
import { usePress } from "@/lib/usePress";
import { PressButton } from "@/components/PressButton";
import { UserPlus } from "lucide-react";
import { bringInView } from "@/lib/markJump";
import { LongList } from "@/components/LongList";
import { MissingNeedWords } from "@/components/MissingNeeds";
import { isMissingNeedLine, missingNeedLine, type GapItem } from "@/lib/gaps";
import { LiveNotices } from "@/components/LiveNotices";

type Tester = { id: string; name: string; rating?: string; devices: string[]; languages: string[]; categories: string[]; invited: boolean; inviteId: string | null; grey: string | null; section: string; gap: string; was?: string; tag?: string; tagItems?: string[]; detail?: string; together?: { id: string; title: string; state?: string }[] };
type Sent = { id: string; name: string; status: string };
/** (Batch 16 section 12) What the server works out over every tester: worked with, Suggested after the ticks, and the name search. */
type PanelData = { worked: Tester[]; suggested: Tester[]; found: Tester[]; foundTotal: number; capLine: string; searched: boolean };


/**
 * The invite panel (test page only), the full app's fold ("Invite testers" with its icon opens and closes it). Sections:
 * Invited (Cancel invite) · the filters (the devices / languages THIS test needs) · Search by name with Find testers right under it
 * (batch 16 section 29: hidden until you search) · People you've worked with · Suggested. The filters narrow Suggested and Find testers. Greyed rows can't be ticked. A
 * ticked tester missing something the test needs gets an in-page confirm under Invite (Invite anyway / Cancel).
 * (Owner, Oct 28, batch 16 section 12) The lists come from the server over EVERY tester: the name search (from 1 character since batch 20 section 9, after a short pause in
 * typing) and the ticks ask it again; every match shows in a scroll box, and above 100 the first 100 with "Showing 100 of N: type more of the name".
 */
export function InvitePanel(p: { testId: string; seenAt: string; initial: PanelData; sent: Sent[]; options: { devices: string[]; languages: string[] }; /** (Batch 8) false on the free plan: the "Subscribers" tag */ perks?: boolean;
  /** (Batch 20 section 10) Nobody can be invited right now (full, paused, joining closed): Invite is disabled with this line; ticks stay. */ blocked?: { line: string; full: boolean } | null;
  /** Open until, while it's ahead: at that moment Invite disables with this line. */ closes?: { at: string; line: string } }) {
  const router = useRouter();
  // (Batch 16 section 21) An invite from another tab for a ticked tester stops Invite once; the panel shows it at once (the row greys, "Invited <date>").
  const { press, changes, error, busy, setError, at, errData } = usePress(p.seenAt, () => router.refresh());
  // (NEXT-UI 12b) When the Invite anyway box last updated (its first showing, a changed list, a live update): Invite anyway
  // goes ahead only if nothing new happened since; anything newer stops it again inside the box.
  const [gapAt, setGapAt] = useState("");
  // Tick-box filters: any ticked device / any ticked language.
  const [f, setF] = useState<{ devices: string[]; languages: string[] }>({ devices: [], languages: [] });
  const [q, setQ] = useState("");
  const [ticked, setTicked] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  // (Batch 20 section 10) Open until passing while the page is open.
  const [closedNow, setClosedNow] = useState(false);
  useEffect(() => {
    if (!p.closes) return;
    const ms = new Date(p.closes.at).getTime() - Date.now();
    if (ms <= 0) return setClosedNow(true);
    const t = setTimeout(() => setClosedNow(true), Math.min(ms + 500, 2_147_000_000));
    return () => clearTimeout(t);
  }, [p.closes]);
  // (Owner, Oct 29, batch 26 section 7) Invite follows the test live both ways: the panel asks the server every few seconds (and on the page's poll) whether anyone can
  // be invited now (full → disabled with its line; a spot opens → enabled), so it never waits on the page's own refresh. A fresh page render resets it.
  const [liveBlocked, setLiveBlocked] = useState<{ line: string; full: boolean } | null | undefined>(undefined);
  useEffect(() => setLiveBlocked(undefined), [p.blocked]);
  useEffect(() => {
    let alive = true;
    const check = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const r = await fetch(`/api/pulse?inviteState=${encodeURIComponent(p.testId)}`, { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { blocked?: { line: string; full: boolean } | null };
        if (alive && j.blocked !== undefined) setLiveBlocked(j.blocked);
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
  }, [p.testId]);
  const blocked = (liveBlocked !== undefined ? liveBlocked : p.blocked) ?? (closedNow && p.closes?.line ? { line: p.closes.line, full: false } : null);
  const [confirm, setConfirm] = useState<string[] | null>(null);
  // (Batch 20 section 3) What each gap line is missing (both kinds), so a long device or language list is cut to 3 with "+N more".
  const [gapItems, setGapItems] = useState<GapItem[]>([]);
  // (Batch 16 section 12) The server's lists; the ticks and the name search (from 1 character) ask it again after a short pause in typing.
  const [data, setData] = useState<PanelData>(p.initial);
  const [searching, setSearching] = useState(false);
  const term = q.trim().length >= 1 ? q.trim() : "";
  const asked = useRef(0);
  const first = useRef(true);
  // (Batch 16 section 21) When the page refreshes (an invite from another tab, the poll), the lists follow: the server's lists again, or the search asked again.
  const [again, setAgain] = useState(0);
  const lastInitial = useRef(p.initial);
  useEffect(() => {
    if (lastInitial.current === p.initial) return;
    lastInitial.current = p.initial;
    if (!term && !f.devices.length && !f.languages.length) setData(p.initial);
    else setAgain((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.initial]);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const n = ++asked.current;
    setSearching(true);
    const t = setTimeout(() => {
      void api<PanelData>(`/api/tests/${p.testId}/invite-search`, { q: term, devices: f.devices, languages: f.languages })
        .then((r) => { if (n === asked.current) setData(r); })
        .catch(() => null)
        .finally(() => { if (n === asked.current) setSearching(false); });
    }, 300);
    return () => clearTimeout(t);
  }, [term, f, p.testId, again]);
  const worked = data.worked;
  // Suggested: the top 5 invitable newcomers after the device / language ticks (ranked on the server: meets, score, accepted parts, matches).
  const suggested = data.suggested;
  const found = term && data.searched ? data.found : [];
  // (Owner, Oct 28, batch 16 section 31) What this panel last showed for each tester (their devices and languages): Invite sends it, with the test's requirements
  // as shown, so the server stops once when either changed since. A ticked tester who is now greyed is unticked when the panel refreshes.
  const shown = useRef(new Map<string, { devices: string[]; languages: string[] }>());
  useEffect(() => {
    // (Batch 20 section 4) As the page loaded (the first time each tester was shown): Invite stops for the net change since then, one line per tester.
    for (const t of [...data.worked, ...data.suggested, ...data.found]) if (!shown.current.has(t.id)) shown.current.set(t.id, { devices: t.devices, languages: t.languages });
    const grey = new Set([...data.worked, ...data.suggested, ...data.found].filter((t) => t.grey).map((t) => t.id));
    if (grey.size) setTicked((tk) => (tk.some((id) => grey.has(id)) ? tk.filter((id) => !grey.has(id)) : tk));
  }, [data]);
  // The fold: shut at first, open when the page comes back to it (#invite, e.g. after inviting).
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (window.location.hash === "#invite") setOpen(true);
  }, []);

  async function invite(anyway: boolean) {
    setMsg("");
    const r = await press<{ message: string }>(`/api/tests/${p.testId}/invite`, { testerIds: ticked, anyway, seenGaps: confirm ? confirm.filter(isMissingNeedLine) : undefined, ...(anyway && gapAt ? { confirmed: true, boxAt: gapAt } : {}), seenNeeds: p.options, seenTesters: Object.fromEntries(ticked.flatMap((id) => (shown.current.has(id) ? [[id, shown.current.get(id)!]] : []))) }, anyway ? "anyway" : "invite");
    if (r) {
      setConfirm(null);
      setMsg(r.message);
      setTicked([]);
      setTimeout(() => {
        window.location.hash = "invite";
        window.location.reload();
      }, 1500);
    }
  }
  // The server answers a missing need with "CONFIRM:<lines>": show it as the in-page confirm under Invite.
  useEffect(() => {
    if (error.startsWith("CONFIRM:")) {
      setConfirm(error.slice(8).split("\n"));
      if (Array.isArray(errData.items)) setGapItems(errData.items as GapItem[]);
      if (typeof errData.now === "string") setGapAt(errData.now);
      setError("");
    } else if (at === "anyway" && error && !changes) {
      // (Owner, Oct 27) Any other failure of Invite anyway closes the box and shows the blue notice under the original Invite button.
      setConfirm(null);
      setMsg(`Your press didn't go through. ${error}`);
      setError("");
    } else if (error.startsWith("Everyone you ticked now meets")) {
      // Nothing sent: the box closes; the notice goes under the original Invite button.
      setConfirm(null);
      setMsg(error);
      setError("");
    }
  }, [error, setError, errData]);
  // The box stays up while anyone ticked misses a need, updating live; when everyone fits it closes with a notice.
  const boxOpen = confirm != null;
  // After a press: the Invite anyway box (or the notice under Invite) comes into view with the least scrolling.
  useEffect(() => {
    if (boxOpen) bringInView(document.querySelector<HTMLElement>("[data-invite-anyway]"));
  }, [boxOpen]);
  useEffect(() => {
    if (msg) bringInView(document.querySelector<HTMLElement>("[data-invite-msg]"));
  }, [msg]);
  useEffect(() => {
    if (!boxOpen) return;
    // At once when the ticks change, then every 15 s as profiles change.
    const check = async () => {
      const r = await api<{ lines: string[]; items?: GapItem[]; now: string }>(`/api/tests/${p.testId}/invite-check`, { testerIds: ticked }).catch(() => null);
      if (!r) return;
      if (!r.lines.length) {
        setConfirm(null);
        setMsg("Everyone you ticked now meets this test's needs. Press Invite to send.");
      } else
        setConfirm((c) => {
          if (c && JSON.stringify(r.lines) !== JSON.stringify(c.filter(isMissingNeedLine))) {
            setGapAt(r.now);
            if (r.items) setGapItems(r.items);
            return r.lines;
          }
          return c;
        });
    };
    void check();
    const t = setInterval(check, 15_000);
    return () => clearInterval(t);
  }, [boxOpen, ticked, p.testId]);

  // The full app's rows, the same in every section: tick, name (their profile), the amber "Doesn't list …" pill, and on
  // the right in grey "you rated 5.0/5 · 1 test with you" (or, greyed, why it can't be ticked). Ticks only by hand.
  const row = (t: Tester, key: string) => (
    <li key={key + t.id} data-invite-row={t.id} className={`flex flex-wrap items-center gap-2 ${t.grey ? "text-slate-500" : "text-slate-300"}`}>
      <input type="checkbox" id={`${key}-${t.id}`} aria-label={t.name} disabled={!!t.grey} checked={!t.grey && ticked.includes(t.id)} onChange={(e) => { setNone(false); setTicked(e.target.checked ? [...ticked, t.id] : ticked.filter((x) => x !== t.id)); }} />
      <span className="min-w-[8rem] flex-1 truncate" title={t.name}><a href={`/app/testers/${t.id}`} target="_blank" rel="noopener" className="text-inherit underline-offset-2 hover:underline">{t.name}</a></span>
      {t.was && !t.grey && <span className="badge max-w-[14rem] shrink truncate whitespace-nowrap" title={t.was}>{t.was}</span>}
      {/* (Batch 15 section 35) 3 items, then "+N more" which opens the rest in place. */}
      {t.tag && !t.grey && (t.tagItems && t.tagItems.length > TAG_NAMES
        ? <span className="badge shrink border-amber-300/40 text-amber-200" data-tag-more="">Doesn&apos;t list <PlusMore items={t.tagItems} shown={TAG_NAMES} /></span>
        : <span className="badge max-w-[14rem] shrink truncate whitespace-nowrap border-amber-300/40 text-amber-200" title={t.tag}>{t.tag}</span>)}
      <label htmlFor={`${key}-${t.id}`} className="shrink-0 cursor-pointer text-xs text-slate-500">{t.grey ?? t.detail}</label>
      {/* "In tests with you": how many, and links to them. */}
      {key === "w" && t.together && t.together.length > 0 && (
        <details className="basis-full pl-6 text-xs text-slate-400">
          {/* (Owner, Oct 28, batch 20 section 23) Not "in" them: how each one went ("jj · ended", "Harbor Run · in it now"). */}
          <summary className="cursor-pointer">Worked with you on {t.together.length} test{t.together.length === 1 ? "" : "s"}</summary>
          <ul className="mt-1 space-y-0.5">{t.together.map((x) => <li key={x.id} data-together-state={x.state ?? ""}><a href={`/app/tests/${x.id}`} target="_blank" rel="noopener">{x.title}</a>{x.state ? ` · ${x.state}` : ""}</li>)}</ul>
        </details>
      )}
    </li>
  );
  const [none, setNone] = useState(false);
  const ticks = (k: keyof typeof f, label: string, opts: string[]) => opts.length > 0 && (
    <fieldset className="space-y-1">
      <legend className="label">{label}</legend>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
        {opts.map((o) => (
          <label key={o} className="inline-flex items-center gap-1.5">
            <input type="checkbox" checked={f[k].includes(o)} onChange={(e) => setF({ ...f, [k]: e.target.checked ? [...f[k], o] : f[k].filter((x) => x !== o) })} /> {o}
          </label>
        ))}
      </div>
    </fieldset>
  );

  return (
    <details id="invite" className="card scroll-mt-24" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)} aria-label="Invite testers">
      <summary className="fold-chevron flex cursor-pointer items-center gap-2 font-semibold text-white"><UserPlus className="h-5 w-5 text-sky-300" /> Invite testers{p.perks === false && <SubscribersTag />}</summary>
      <div className="mt-3 space-y-3 text-sm" data-mistakes-root="">
      {p.sent.length > 0 && (
        <>
          <h3>Invited</h3>
          {/* Only invites still waiting (joined ones are in Testers joined): 3 lines, then Show N more in a scroll box. */}
          <LongList shown={3} tall="max-h-48" className="space-y-1 text-sm">
            {p.sent.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <span className="mr-auto">{s.name} · {s.status}</span>
                {s.status === "waiting for them to join" && (
                  <PressButton seenAt={p.seenAt} path={`/api/tests/${p.testId}/cancel-invite`} body={{ inviteId: s.id }}>Cancel invite</PressButton>
                )}
              </li>
            ))}
          </LongList>
        </>
      )}
      {/* (Owner, Oct 27) The filters and the search stay outside the scroll box, so they never scroll away. */}
      {(p.options.devices.length > 0 || p.options.languages.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2" data-invite-filters="">
          {ticks("devices", "Devices", p.options.devices)}
          {ticks("languages", "Languages", p.options.languages)}
        </div>
      )}
      <input className="input max-w-xs" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find testers" />
      {/* (Owner, Oct 28, batch 16 section 29) The search's results right under the box, in their own scroll box (every match, about 8 rows tall; above 100, the
          first 100 and the line saying so), so a search never needs scrolling down the lists. With the box empty, the heading and results are hidden. */}
      {term && (
        <div className="space-y-1.5" data-invite-find="">
          <h3>Find testers</h3>
          {data.capLine && <p className="note" data-invite-cap="">{data.capLine}</p>}
          {found.length > 0 && <ul className="max-h-64 space-y-1.5 overflow-y-auto" data-invite-found="">{found.map((t) => row(t, "f"))}</ul>}
          {data.searched && !searching && found.length === 0 && <p className="note" data-invite-none="">No testers match “{term}”.</p>}
        </div>
      )}
      {/* (Batch 16 section 10) Nothing ticked: the lists are the field, red with their line under them, and listed under Invite. */}
      <div id="invite-lists" className={`max-h-72 space-y-2 overflow-y-auto text-sm ${none ? "rounded-xl p-2 ring-1 ring-rose-400" : ""}`} data-invite-lists="" data-red-msg={none ? "Tick at least one tester." : undefined}>
        <h3>People you&apos;ve worked with</h3>
        {worked.length ? <ul className="space-y-1.5">{worked.map((t) => row(t, "w"))}</ul> : <p className="note">Nobody yet.</p>}
        <h3>Suggested</h3>
        {suggested.length ? <ul className="space-y-1.5">{suggested.map((t) => row(t, "s"))}</ul> : <p className="note">No suggestions right now.</p>}
      </div>
      {none && <p className="err-field">Tick at least one tester.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn" disabled={busy || !!blocked} title={blocked?.line} onClick={() => (ticked.length ? invite(false) : setNone(true))}>Invite</button>
        <span className="text-xs text-slate-400">{ticked.length} selected</span>
      </div>
      {blocked && (
        <p className="note" data-invite-blocked={blocked.full ? "full" : "closed"}>
          {blocked.full ? <>This test is full. Add spots <a href={`/app/tests/${p.testId}/edit#spots`}>in Edit</a> to invite more people.</> : blocked.line}
        </p>
      )}
      <MistakeList press="Invite" shown={none} />
      {msg && <p className="info" data-invite-msg="">{msg}</p>}
      {at !== "anyway" && <ChangesBox changes={changes} error={error} />}
      {confirm && (
        <div className="info space-y-2" data-invite-anyway="">
          {/* (Owner, Oct 28, batch 20 section 3) One line per ticked tester naming everything they're missing (a long list: its first 3, then "+N more"); more
              than 3 testers: their lines in a scroll box about 3 lines tall, with Invite anyway / Cancel below it. */}
          {confirm.filter((l) => !isMissingNeedLine(l)).map((l) => <p key={l}>{l}</p>)}
          <GapLinesBox lines={confirm.filter(isMissingNeedLine)} items={gapItems} />
          <LiveNotices open={!!confirm} />
          <div className="flex gap-2">
            <button className="btn" disabled={busy || !!blocked} onClick={() => invite(true)}>Invite anyway</button>
            <button className="btn-ghost" onClick={() => setConfirm(null)}>Cancel</button>
          </div>
          {/* A stop for Invite anyway (what's missing changed, or any Invite reason) shows inside the box. */}
          {at === "anyway" && <ChangesBox changes={changes} error={error} didntGo />}
        </div>
      )}
      </div>
    </details>
  );
}

/** (Batch 20 section 3) The Invite anyway box's lines: each in the server's words, its lists cut to 3 with "+N more"; more than 3 in a scroll box about 3 lines tall. */
export function GapLinesBox({ lines, items }: { lines: string[]; items: GapItem[] }) {
  const line = (l: string) => {
    const it = items.find((i) => missingNeedLine(i.name, i) === l);
    return <p key={l} data-gap-line="">{it ? <>{it.name} <MissingNeedWords g={it} />.</> : l}</p>;
  };
  if (lines.length <= 3) return <div className="space-y-1">{lines.map(line)}</div>;
  return <div className="max-h-24 space-y-1 overflow-y-auto pr-1" data-gap-scroll={lines.length} tabIndex={0} role="region" aria-label="What each tester is missing">{lines.map(line)}</div>;
}
