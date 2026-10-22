"use client";
import { useEffect, useMemo, useState } from "react";
import { ChangesBox, type Change } from "@/components/ChangesBox";
import { api, ApiError } from "@/lib/client";
import { usePress } from "@/lib/usePress";

type Tester = { id: string; name: string; devices: string[]; languages: string[]; categories: string[]; invited: boolean };
type Sent = { id: string; name: string; status: string };

/** Live lines: what changed on the test since the page loaded (polled). Shown at the bottom of the invite panel. */
export function useLiveLines(testId: string, seenAt: string) {
  const [lines, setLines] = useState<Change[]>([]);
  useEffect(() => {
    let alive = true;
    const tick = () =>
      api<{ changes: Change[] }>(`/api/tests/${testId}/changes?since=${encodeURIComponent(seenAt)}`)
        .then((r) => alive && setLines(r.changes))
        .catch(() => null);
    const t = setInterval(tick, 20_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [testId, seenAt]);
  return lines;
}

/** The invite panel (test page only): filter testers, Select all, Invite; sent invites with Cancel invite. */
export function InvitePanel(p: { testId: string; seenAt: string; testers: Tester[]; sent: Sent[]; options: { devices: string[]; languages: string[]; categories: string[] } }) {
  const { press, changes, error, busy, setError } = usePress(p.seenAt);
  const lines = useLiveLines(p.testId, p.seenAt);
  const [f, setF] = useState({ device: "", language: "", category: "" });
  const [ticked, setTicked] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const shown = useMemo(
    () => p.testers.filter((t) => !t.invited && (!f.device || t.devices.includes(f.device)) && (!f.language || t.languages.includes(f.language)) && (!f.category || t.categories.includes(f.category))),
    [p.testers, f],
  );
  const all = shown.length > 0 && shown.every((t) => ticked.includes(t.id));

  async function invite() {
    setMsg("");
    const r = await press<{ message: string }>(`/api/tests/${p.testId}/invite`, { testerIds: ticked });
    if (r) {
      setMsg(r.message);
      setTicked([]);
      setTimeout(() => window.location.reload(), 1500);
    }
  }
  const select = (k: keyof typeof f, label: string, opts: string[]) => (
    <select aria-label={label} className="input w-auto" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
      <option value="">{label}: any</option>
      {opts.map((o) => <option key={o}>{o}</option>)}
    </select>
  );

  return (
    <section className="panel" id="invite" aria-label="Invite testers">
      <h2>Invite testers</h2>
      <div className="flex flex-wrap gap-2">
        {select("device", "Device", p.options.devices)}
        {select("language", "Language", p.options.languages)}
        {select("category", "Likes", p.options.categories)}
      </div>
      {shown.length === 0 ? <p className="note">No testers match.</p> : (
        <div className="max-h-64 space-y-1 overflow-y-auto text-sm">
          <label className="block font-medium">
            <input type="checkbox" checked={all} onChange={() => setTicked(all ? [] : shown.map((t) => t.id))} /> Select all ({shown.length})
          </label>
          {shown.map((t) => (
            <label key={t.id} className="block">
              <input type="checkbox" checked={ticked.includes(t.id)} onChange={(e) => setTicked(e.target.checked ? [...ticked, t.id] : ticked.filter((x) => x !== t.id))} /> {t.name}{" "}
              <span className="note">· {[...t.devices, ...t.languages].join(", ")}</span>
            </label>
          ))}
        </div>
      )}
      <button className="btn" disabled={busy || ticked.length === 0} onClick={invite}>Invite</button>
      <ChangesBox changes={changes} error={error} />
      {msg && <p className="info">{msg}</p>}
      {p.sent.length > 0 && (
        <>
          <h3>Sent invites</h3>
          <ul className="space-y-1 text-sm">
            {p.sent.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <span className="mr-auto">{s.name} · {s.status}</span>
                {s.status === "waiting for them to join" && (
                  <button
                    className="btn-ghost"
                    onClick={() => api(`/api/tests/${p.testId}/cancel-invite`, { inviteId: s.id }).then(() => window.location.reload()).catch((e) => setError(e instanceof ApiError ? e.message : "Try again."))}
                  >
                    Cancel invite
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {lines.length > 0 && (
        <div className="info">
          <p className="font-medium">Since you opened this page:</p>
          <ul className="list-disc pl-5">
            {lines.map((l, i) => (
              <li key={i}>{l.text} · {new Date(l.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
