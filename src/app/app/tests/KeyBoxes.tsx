"use client";
import { FREE_KEYS_RULE, parseKeys, repeatedKeys, reusedKeyLine } from "@/lib/keys";

export type KeysData = {
  free: { id: string; value: string; reused?: { from: string; broken: boolean } }[];
  /** Working testers' keys; keys of testers who left or finished come last, greyed ("(left)" / "(finished)"): those can be typed back into Free. */
  inUse: { id: string; value: string; broken: boolean; tester: string; contractId: string; gone?: "left" | "finished" }[];
  open: number;
  /** The working testers now (the open spots follow them live). */
  testersIn?: number;
  uses: boolean;
  broken?: { id: string; value: string; tester: string }[];
};

/** (Batch 15 sections 19 and 44) What the Free box's lines mean against the keys loaded: the red mistakes and the warning-only lines. */
export function freeBoxCheck(text: string, loaded: string[], data: KeysData | null) {
  const lines = parseKeys(text);
  const inUse = data?.inUse ?? [];
  const added = lines.filter((v) => !loaded.includes(v));
  const removed = loaded.filter((v) => !lines.includes(v));
  const errors: string[] = [];
  const warnings: string[] = [];
  const dup = repeatedKeys(text);
  if (dup.length) errors.push(`${dup.join(", ")} ${dup.length === 1 ? "is" : "are"} typed more than once. Each key goes in once.`);
  for (const v of added) {
    const k = inUse.find((x) => x.value === v);
    if (!k) continue;
    if (!k.gone) errors.push(`${v} is in use by ${k.tester}, so it can't be added.`);
    else warnings.push(reusedKeyLine(v, k.tester, k.broken));
  }
  // (Batch 16 section 20) A deleted line whose key a joining tester was given meanwhile is no mistake: the page shows the blue warning and drops the deletion.
  return { lines, added, removed, errors, warnings };
}

/**
 * (Owner, Oct 30, batch 15 section 19) Edit's access keys: "In use" (read only; a key reported as not working is crossed out; keys of testers who left or finished are
 * greyed with "(left)" / "(finished)") and ONE plain text box with all the current free keys, one per line: delete a line to remove a key, type a line to add one. Save
 * works out the change against the keys this page loaded, so another tab's work is never undone.
 */
export function KeyBoxes({ data, typed, onType, onBlur, openSpots, line, warnings, note }: {
  data: KeysData | null; typed: string; onType: (t: string) => void; onBlur: () => void; openSpots: number; line: string; warnings: string[]; note: React.ReactNode;
}) {
  const inUse = data?.inUse ?? [];
  const n = parseKeys(typed).length;
  return (
    <div className="space-y-3" id="keys">
      <p className="label !mb-0">Access keys (each joining tester gets one)</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 rounded-xl border border-white/10 p-3" data-keys-in-use="">
          <p className="text-sm font-medium text-white">In use <span className="font-normal text-slate-400">({inUse.filter((k) => !k.gone).length})</span></p>
          {inUse.length === 0 ? <p className="text-xs text-slate-500">No tester has a key yet.</p> : (
            <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
              {inUse.map((k) => (
                <li key={k.id} className={`flex flex-wrap items-center justify-between gap-2 ${k.gone ? "text-slate-500" : k.broken ? "text-slate-500 line-through" : "text-slate-200"}`} data-key-gone={k.gone} title={k.broken ? `${k.tester} reported this key as not working` : undefined}>
                  <span className={`font-mono ${k.broken ? "line-through" : ""}`}>{k.value}</span>
                  <span className="text-xs no-underline">{k.tester}{k.gone ? ` (${k.gone})` : ""}{k.broken ? " · not working" : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="space-y-1.5 rounded-xl border border-white/10 p-3" data-keys-free="">
          <label className="text-sm font-medium text-white" htmlFor="keysFree">Free <span className="font-normal text-slate-400" data-free-head="">({n} key{n === 1 ? "" : "s"} · {openSpots} open spot{openSpots === 1 ? "" : "s"})</span></label>
          <textarea id="keysFree" rows={Math.min(8, Math.max(3, n + 1))} className={"input font-mono text-xs" + (line ? " field-bad" : "")} data-red-msg={line || undefined} value={typed} onBlur={onBlur} onChange={(e) => onType(e.target.value)} placeholder={"KEY-3333\nKEY-4444"} />
          {/* (Owner, Oct 28, batch 17 section 13) The red line shows once, here under the Free box. */}
          {line && <p className="err-field" role="alert" data-keys-line="">{line}</p>}
          <p className="text-xs text-slate-500">One key per line. Delete a line to remove that key; type a new line to add one.</p>
        </div>
      </div>
      {/* (Batch 15 section 44) Warning only: never a mistake, never blocks Save, not counted in "Fix the N mistakes". */}
      {warnings.length > 0 && (
        <ul className="space-y-0.5 rounded-lg border border-amber-300/40 bg-amber-400/10 px-3 py-1.5 text-xs text-amber-100" data-key-warnings="">
          {warnings.map((w) => <li key={w}><span className="mr-1 rounded border border-amber-300/50 px-1 text-[10px] uppercase tracking-wide">Reused</span>{w}</li>)}
        </ul>
      )}
      <p className="text-xs text-slate-500">Free keys go to new testers first. {FREE_KEYS_RULE}</p>
      {note}
    </div>
  );
}
