"use client";
import { useEffect, useMemo, useState } from "react";
import { ChangesBox } from "@/components/ChangesBox";
import { api } from "@/lib/client";
import { usePress } from "@/lib/usePress";
import { PressButton } from "@/components/PressButton";
import { UserPlus } from "lucide-react";
import { bringInView } from "@/lib/markJump";
import { LongList } from "@/components/LongList";
import { LiveNotices } from "@/components/LiveNotices";

type Tester = { id: string; name: string; rating?: string; devices: string[]; languages: string[]; categories: string[]; invited: boolean; inviteId: string | null; grey: string | null; section: string; gap: string; was?: string; tag?: string; detail?: string; together?: { id: string; title: string }[] };
type Sent = { id: string; name: string; status: string };


/**
 * The invite panel (test page only), the full app's fold ("Invite testers" with its icon opens and closes it). Sections:
 * Invited (Cancel invite) · People you've worked with · the filters (the devices / languages THIS test needs) · Suggested ·
 * Find testers (empty until you search). The filters narrow Suggested and Find testers. Greyed rows can't be ticked. A
 * ticked tester missing something the test needs gets an in-page confirm under Invite (Invite anyway / Cancel).
 */
export function InvitePanel(p: { testId: string; seenAt: string; testers: Tester[]; sent: Sent[]; options: { devices: string[]; languages: string[] } }) {
  const { press, changes, error, busy, setError, at, errData } = usePress(p.seenAt);
  // (NEXT-UI 12b) When the Invite anyway box last updated (its first showing, a changed list, a live update): Invite anyway
  // goes ahead only if nothing new happened since; anything newer stops it again inside the box.
  const [gapAt, setGapAt] = useState("");
  // Tick-box filters: any ticked device / any ticked language.
  const [f, setF] = useState<{ devices: string[]; languages: string[] }>({ devices: [], languages: [] });
  const [q, setQ] = useState("");
  const [ticked, setTicked] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const notInvited = useMemo(() => p.testers.filter((t) => !t.invited), [p.testers]);
  const passes = (t: Tester) => (!f.devices.length || t.devices.some((d) => f.devices.includes(d))) && (!f.languages.length || t.languages.some((l) => f.languages.includes(l)));
  const worked = notInvited.filter((t) => t.section === "worked");
  // Suggested: the top 5 invitable newcomers after the device / language ticks (already ranked: meets, score, accepted parts, matches).
  const suggested = notInvited.filter((t) => t.section === "other" && !t.grey && passes(t)).slice(0, 5);
  const found = q.trim().length >= 2 ? notInvited.filter((t) => passes(t) && t.name.toLowerCase().includes(q.trim().toLowerCase())) : [];
  // The fold: shut at first, open when the page comes back to it (#invite, e.g. after inviting).
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (window.location.hash === "#invite") setOpen(true);
  }, []);

  async function invite(anyway: boolean) {
    setMsg("");
    const r = await press<{ message: string }>(`/api/tests/${p.testId}/invite`, { testerIds: ticked, anyway, seenGaps: confirm ? confirm.filter((l) => l.endsWith("which this test needs.")) : undefined, ...(anyway && gapAt ? { confirmed: true, boxAt: gapAt } : {}) }, anyway ? "anyway" : "invite");
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
      const r = await api<{ lines: string[]; now: string }>(`/api/tests/${p.testId}/invite-check`, { testerIds: ticked }).catch(() => null);
      if (!r) return;
      if (!r.lines.length) {
        setConfirm(null);
        setMsg("Everyone you ticked now meets this test's needs. Press Invite to send.");
      } else
        setConfirm((c) => {
          if (c && JSON.stringify(r.lines) !== JSON.stringify(c.filter((l) => l.endsWith("which this test needs.")))) {
            setGapAt(r.now);
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
      <span className="min-w-0 flex-1 truncate"><a href={`/app/testers/${t.id}`} target="_blank" rel="noopener" className="text-inherit underline-offset-2 hover:underline">{t.name}</a></span>
      {t.was && !t.grey && <span className="badge max-w-full shrink-0 truncate whitespace-nowrap">{t.was}</span>}
      {t.tag && !t.grey && <span className="badge max-w-full shrink-0 truncate whitespace-nowrap border-amber-300/40 text-amber-200">{t.tag}</span>}
      <label htmlFor={`${key}-${t.id}`} className="shrink-0 cursor-pointer text-xs text-slate-500">{t.grey ?? t.detail}</label>
      {/* "In tests with you": how many, and links to them. */}
      {key === "w" && t.together && t.together.length > 0 && (
        <details className="basis-full pl-6 text-xs text-slate-400">
          <summary className="cursor-pointer">In {t.together.length} test{t.together.length === 1 ? "" : "s"} with you</summary>
          <ul className="mt-1 space-y-0.5">{t.together.map((x) => <li key={x.id}><a href={`/app/tests/${x.id}`} target="_blank" rel="noopener">{x.title}</a></li>)}</ul>
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
      <summary className="fold-chevron flex cursor-pointer items-center gap-2 font-semibold text-white"><UserPlus className="h-5 w-5 text-sky-300" /> Invite testers</summary>
      <div className="mt-3 space-y-3 text-sm">
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
      <div className="max-h-72 space-y-2 overflow-y-auto text-sm" data-invite-lists="">
        <h3>People you&apos;ve worked with</h3>
        {worked.length ? <ul className="space-y-1.5">{worked.map((t) => row(t, "w"))}</ul> : <p className="note">Nobody yet.</p>}
        {(p.options.devices.length > 0 || p.options.languages.length > 0) && (
          <div className="grid gap-3 sm:grid-cols-2">
            {ticks("devices", "Devices", p.options.devices)}
            {ticks("languages", "Languages", p.options.languages)}
          </div>
        )}
        <h3>Suggested</h3>
        {suggested.length ? <ul className="space-y-1.5">{suggested.map((t) => row(t, "s"))}</ul> : <p className="note">No suggestions right now.</p>}
        <h3>Find testers</h3>
        <input className="input max-w-xs" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find testers" />
        {found.length > 0 && <ul className="space-y-1.5">{found.map((t) => row(t, "f"))}</ul>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn" disabled={busy} onClick={() => (ticked.length ? invite(false) : setNone(true))}>Invite</button>
        <span className="text-xs text-slate-400">{ticked.length} selected</span>
      </div>
      {none && <p className="err-field">Tick at least one tester.</p>}
      {msg && <p className="info" data-invite-msg="">{msg}</p>}
      {at !== "anyway" && <ChangesBox changes={changes} error={error} />}
      {confirm && (
        <div className="info space-y-2" data-invite-anyway="">
          {confirm.map((l) => <p key={l}>{l}</p>)}
          <LiveNotices open={!!confirm} />
          <div className="flex gap-2">
            <button className="btn" disabled={busy} onClick={() => invite(true)}>Invite anyway</button>
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
