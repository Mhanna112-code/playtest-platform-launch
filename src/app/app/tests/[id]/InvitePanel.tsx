"use client";
import { useEffect, useMemo, useState } from "react";
import { ChangesBox } from "@/components/ChangesBox";
import { api } from "@/lib/client";
import { usePress } from "@/lib/usePress";
import { PressButton } from "@/components/PressButton";

type Tester = { id: string; name: string; rating?: string; devices: string[]; languages: string[]; categories: string[]; invited: boolean; inviteId: string | null; grey: string | null; section: string; gap: string };
type Sent = { id: string; name: string; status: string };


/**
 * The invite panel (test page only). Sections: Invited (Cancel invite) · People you've worked with · Suggested · Find
 * testers (empty until you search). Greyed rows can't be ticked; filters only narrow what's shown. A ticked tester missing
 * something the test needs gets an in-page confirm under Invite (Invite anyway / Cancel).
 */
export function InvitePanel(p: { testId: string; seenAt: string; testers: Tester[]; sent: Sent[]; options: { devices: string[]; languages: string[]; categories: string[] } }) {
  const { press, changes, error, busy, setError } = usePress(p.seenAt);
  const [f, setF] = useState({ device: "", language: "", category: "" });
  const [q, setQ] = useState("");
  const [ticked, setTicked] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const notInvited = useMemo(
    () => p.testers.filter((t) => !t.invited && (!f.device || t.devices.includes(f.device)) && (!f.language || t.languages.includes(f.language)) && (!f.category || t.categories.includes(f.category))),
    [p.testers, f],
  );
  const worked = notInvited.filter((t) => t.section === "worked");
  const suggested = notInvited.filter((t) => t.section === "suggested");
  const found = q.trim().length >= 2 ? notInvited.filter((t) => t.name.toLowerCase().includes(q.trim().toLowerCase())) : [];

  async function invite(anyway: boolean) {
    setMsg("");
    const r = await press<{ message: string }>(`/api/tests/${p.testId}/invite`, { testerIds: ticked, anyway, seenGaps: confirm ? confirm.filter((l) => l.endsWith("which this test needs.")) : undefined });
    if (r) {
      setConfirm(null);
      setMsg(r.message);
      setTicked([]);
      setTimeout(() => window.location.reload(), 1500);
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
    <label key={t.id} className={"block " + (t.grey ? "text-slate-400" : "")}>
      <input type="checkbox" disabled={!!t.grey} checked={!t.grey && ticked.includes(t.id)} onChange={(e) => setTicked(e.target.checked ? [...ticked, t.id] : ticked.filter((x) => x !== t.id))} /> {t.name}{" "}
      <span className="note">· {[...t.devices, ...t.languages].join(", ")}{t.rating && ` · ${t.rating}`}</span>
      {t.grey && <span className="ml-2 text-xs">{t.grey}</span>}
    </label>
  );
  const select = (k: keyof typeof f, label: string, opts: string[]) => (
    <select aria-label={label} className="input w-auto" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
      <option value="">{label}: any</option>
      {opts.map((o) => <option key={o}>{o}</option>)}
    </select>
  );

  return (
    <section className="panel" id="invite" aria-label="Invite testers">
      <h2>Invite testers</h2>
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
      <div className="flex flex-wrap gap-2">
        {select("device", "Device", p.options.devices)}
        {select("language", "Language", p.options.languages)}
        {select("category", "Likes", p.options.categories)}
      </div>
      <div className="max-h-80 space-y-2 overflow-y-auto text-sm">
        <h3>People you&apos;ve worked with</h3>
        {worked.length ? worked.map(row) : <p className="note">Nobody yet.</p>}
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
    </section>
  );
}
