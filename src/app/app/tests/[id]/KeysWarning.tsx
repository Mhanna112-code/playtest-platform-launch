"use client";
import { useState } from "react";
import { api, errOf } from "@/lib/client";

export type BrokenKey = { id: string; value: string; tester: string };

/** "Ben Okafor's key doesn't work (HR-2222)" / "2 testers' keys don't work: Ben Okafor (HR-2222), Cam Lee (HR-3333)". */
export const brokenKeysLine = (rows: BrokenKey[]) =>
  rows.length === 1 ? `${rows[0].tester}'s key doesn't work (${rows[0].value})` : `${rows.length} testers' keys don't work: ${rows.map((r) => `${r.tester} (${r.value})`).join(", ")}`;

/**
 * (Owner, Oct 30, batch 15 section 45) The amber warning at the top of the Access keys notice: current working testers whose key is marked not working. Each row has a
 * select tick and a "Works now" tick; "Select all (N)"; one "Dismiss selected" ("Dismiss 2"). Dismiss hides the selected rows (per key report: a new report shows again);
 * with "Works now" it also clears the key's broken mark, and the tester's next press stops once with "The developer marked your key as working".
 */
export function KeysWarning({ testId, rows }: { testId: string; rows: BrokenKey[] }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [works, setWorks] = useState<string[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const shown = rows.filter((r) => !hidden.includes(r.id));
  if (!shown.length) return null;
  const all = shown.every((r) => picked.includes(r.id));
  async function dismiss() {
    setBusy(true);
    setErr("");
    try {
      await api(`/api/tests/${testId}/keys-dismiss`, { keyIds: picked, worksNow: works.filter((x) => picked.includes(x)) });
      setHidden((h) => [...h, ...picked]);
      setPicked([]);
    } catch (e) {
      setErr(errOf(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-1.5 rounded-lg border border-amber-300/40 bg-amber-400/10 p-2 text-xs" data-keys-warning="">
      <p className="font-medium text-amber-100">{brokenKeysLine(shown)}</p>
      {shown.length > 1 && (
        <label className="flex items-center gap-2"><input type="checkbox" checked={all} onChange={(e) => setPicked(e.target.checked ? shown.map((r) => r.id) : [])} /> Select all ({shown.length})</label>
      )}
      <ul className="space-y-1">
        {shown.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2"><input type="checkbox" checked={picked.includes(r.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, r.id] : p.filter((x) => x !== r.id)))} /> {r.tester} · <span className="font-mono">{r.value}</span></label>
            <label className="flex items-center gap-1 text-amber-100/80"><input type="checkbox" checked={works.includes(r.id)} onChange={(e) => setWorks((w) => (e.target.checked ? [...w, r.id] : w.filter((x) => x !== r.id)))} /> Works now</label>
          </li>
        ))}
      </ul>
      <button type="button" className="btn-secondary !px-2 !py-1 text-xs" disabled={busy || picked.length === 0} onClick={() => void dismiss()}>{picked.length > 1 ? `Dismiss ${picked.length}` : "Dismiss selected"}</button>
      {err && <p className="text-rose-300">{err}</p>}
    </div>
  );
}
