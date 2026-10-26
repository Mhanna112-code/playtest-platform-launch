"use client";
import { X } from "lucide-react";

export type KeysData = {
  free: { id: string; value: string }[];
  inUse: { id: string; value: string; broken: boolean; tester: string; contractId: string }[];
  open: number;
  uses: boolean;
};

/**
 * (Design doc 5) Edit's access keys: "In use" (read only; a key reported as not working is greyed and crossed out) and "Free"
 * (add new keys, or remove free ones as long as the free keys still cover the open spots). Both follow the test live.
 */
export function KeyBoxes({ data, removed, onRemove, typed, onType, onBlur, openSpots, line, note }: {
  data: KeysData | null; removed: string[]; onRemove: (value: string, on: boolean) => void; typed: string; onType: (t: string) => void; onBlur: () => void; openSpots: number; line: string; note: React.ReactNode;
}) {
  const free = data?.free ?? [];
  const inUse = data?.inUse ?? [];
  return (
    <div className="space-y-3" id="keys">
      <p className="label !mb-0">Access keys (each joining tester gets one)</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 rounded-xl border border-white/10 p-3" data-keys-in-use="">
          <p className="text-sm font-medium text-white">In use <span className="font-normal text-slate-400">({inUse.length})</span></p>
          {inUse.length === 0 ? <p className="text-xs text-slate-500">No tester has a key yet.</p> : (
            <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
              {inUse.map((k) => (
                <li key={k.id} className={`flex flex-wrap items-center justify-between gap-2 ${k.broken ? "text-slate-500 line-through" : "text-slate-200"}`} title={k.broken ? `${k.tester} reported this key as not working` : undefined}>
                  <span className="font-mono">{k.value}</span>
                  <span className="text-xs no-underline">{k.tester}{k.broken ? " · not working" : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="space-y-1.5 rounded-xl border border-white/10 p-3" data-keys-free="">
          <p className="text-sm font-medium text-white">Free <span className="font-normal text-slate-400">({free.length}, {openSpots} open spot{openSpots === 1 ? "" : "s"})</span></p>
          {free.length === 0 ? <p className="text-xs text-slate-500">No free keys.</p> : (
            <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
              {free.map((k) => {
                const gone = removed.includes(k.value);
                return (
                  <li key={k.id} className={`flex items-center justify-between gap-2 ${gone ? "text-slate-500 line-through" : "text-slate-200"}`}>
                    <span className="font-mono">{k.value}</span>
                    <button type="button" className="btn-ghost !rounded-md !px-1.5 !py-0.5 text-xs" aria-label={gone ? `Keep ${k.value}` : `Remove ${k.value}`} onClick={() => onRemove(k.value, !gone)}>
                      {gone ? "Keep" : <X className="h-3.5 w-3.5" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <label className="label !mb-0 !mt-2 text-xs" htmlFor="keysAdd">Add keys (one per line)</label>
          <textarea id="keysAdd" rows={2} className={"input font-mono text-xs" + (line ? " field-bad" : "")} value={typed} onBlur={onBlur} onChange={(e) => onType(e.target.value)} placeholder={"KEY-3333\nKEY-4444"} />
        </div>
      </div>
      {line && <p className="err-field" role="alert">{line}</p>}
      <p className="text-xs text-slate-500">Free keys go to new testers first. Keys already used, given to a tester who left, or reported as not working can&apos;t be added again.</p>
      {note}
    </div>
  );
}
