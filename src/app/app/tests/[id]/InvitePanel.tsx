"use client";
import { useEffect, useMemo, useState } from "react";
import { ChangesBox } from "@/components/ChangesBox";
import { api } from "@/lib/client";
import { usePress } from "@/lib/usePress";
import { PressButton } from "@/components/PressButton";
import { UserPlus } from "lucide-react";

type Tester = { id: string; name: string; rating?: string; devices: string[]; languages: string[]; categories: string[]; invited: boolean; inviteId: string | null; grey: string | null; section: string; gap: string };
type Sent = { id: string; name: string; status: string };


/**
 * The invite panel (test page only), the full app's fold ("Invite testers" with its icon opens and closes it). Sections:
 * Invited (Cancel invite) · People you've worked with · the filters (the devices / languages THIS test needs) · Suggested ·
 * Find testers (empty until you search). The filters narrow Suggested and Find testers. Greyed rows can't be ticked. A
 * ticked tester missing something the test needs gets an in-page confirm under Invite (Invite anyway / Cancel).
 */
export function InvitePanel(p: { testId: string; seenAt: string; testers: Tester[]; sent: Sent[]; options: { devices: string[]; languages: string[] } }) {
  const { press, changes, error, busy, setError } = usePress(p.seenAt);
  // Tick-box filters: any ticked device / any ticked language.
  const [f, setF] = useState<{ devices: string[]; languages: string[] }>({ devices: [], languages: [] });
  const [q, setQ] = useState("");
  const [ticked, setTicked] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const notInvited = useMemo(() => p.testers.filter((t) => !t.invited), [p.testers]);
  const passes = (t: Tester) => (!f.devices.length || t.devices.some((d) => f.devices.includes(d))) && (!f.languages.length || t.languages.some((l) => f.languages.includes(l)));
  const worked = notInvited.filter((t) => t.section === "worked");
  const suggested = notInvited.filter((t) => t.section === "suggested" && passes(t));
  const found = q.trim().length >= 2 ? notInvited.filter((t) => passes(t) && t.name.toLowerCase().includes(q.trim().toLowerCase())) : [];
  // The fold: shut at first, open when the page comes back to it (#invite, e.g. after inviting).
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (window.location.hash === "#invite") setOpen(true);
  }, []);

  async function invite(anyway: boolean) {
    setMsg("");
    const r = await press<{ message: string }>(`/api/tests/${p.testId}/invite`, { testerIds: ticked, anyway, seenGaps: confirm ? confirm.filter((l) => l.endsWith("which this test needs.")) : undefined });
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
      setError("");
    } else if (error.startsWith("Everyone you ticked now meets")) setConfirm(null);
  }, [error, setError]);
  // The box stays up while anyone ticked misses a need, updating live; when everyone fits it closes with a notice.
  useEffect(() => {
    if (!confirm) return;
    const t = setInterval(async () => {
      const r = await api<{ lines: string[] }>(`/api/tests/${p.testId}/invite-check`, { testerIds: ticked }).catch(() => null);
      if (!r) return;
      if (!r.lines.length) {
        setConfirm(null);
        setMsg("Everyone you ticked now meets this test's needs. Press Invite to send.");
      } else if (JSON.stringify(r.lines) !== JSON.stringify(confirm.filter((l) => l.endsWith("which this test needs.")))) setConfirm(r.lines);
    }, 15_000);
    return () => clearInterval(t);
  }, [confirm, ticked, p.testId]);

  const row = (t: Tester) => (
    <label key={t.id} className={"block " + (t.grey ? "text-ink-500" : "")}>
      <input type="checkbox" disabled={!!t.grey} checked={!t.grey && ticked.includes(t.id)} onChange={(e) => setTicked(e.target.checked ? [...ticked, t.id] : ticked.filter((x) => x !== t.id))} /> {t.name}{" "}
      <span className="note">· {[...t.devices, ...t.languages].join(", ")}{t.rating && ` · ${t.rating}`}</span>
      {t.grey && <span className="ml-2 text-xs">{t.grey}</span>}
    </label>
  );
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
          <ul className="space-y-1 text-sm">
            {p.sent.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <span className="mr-auto">{s.name} · {s.status}</span>
                {s.status === "waiting for them to join" && (
                  <PressButton seenAt={p.seenAt} path={`/api/tests/${p.testId}/cancel-invite`} body={{ inviteId: s.id }}>Cancel invite</PressButton>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="max-h-80 space-y-2 overflow-y-auto text-sm">
        <h3>People you&apos;ve worked with</h3>
        {worked.length ? worked.map(row) : <p className="note">Nobody yet.</p>}
        {(p.options.devices.length > 0 || p.options.languages.length > 0) && (
          <div className="grid gap-3 sm:grid-cols-2">
            {ticks("devices", "Devices", p.options.devices)}
            {ticks("languages", "Languages", p.options.languages)}
          </div>
        )}
        <h3>Suggested</h3>
        {suggested.length ? suggested.map(row) : <p className="note">No suggestions right now.</p>}
        <h3>Find testers</h3>
        <input className="input max-w-xs" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find testers" />
        {found.map(row)}
      </div>
      <button className="btn" disabled={busy || ticked.length === 0} onClick={() => invite(false)}>Invite</button>
      <ChangesBox changes={changes} error={error} />
      {confirm && (
        <div className="info space-y-2">
          {confirm.map((l) => <p key={l}>{l}</p>)}
          <div className="flex gap-2">
            <button className="btn" disabled={busy} onClick={() => invite(true)}>Invite anyway</button>
            <button className="btn-ghost" onClick={() => setConfirm(null)}>Cancel</button>
          </div>
        </div>
      )}
      {msg && <p className="info">{msg}</p>}
      </div>
    </details>
  );
}
