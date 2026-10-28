import { KeyRound } from "lucide-react";
import { FREE_KEYS_HINT } from "@/lib/keys";

export type KeysView = { free: { id: string; value: string }[]; inUse: { id: string; value: string; broken: boolean; tester: string }[]; open: number };

/**
 * (Owner, Oct 29, batch 14 section 6) The read-only "Access keys" notice where the yellow keys box was (shown only when the test uses keys; no buttons). Two compact
 * parts, each in its own scroll box about 4 lines tall (stacked on phones): the free keys as chips with the count and open spots, and the keys given, each with its
 * tester (a key reported as not working is crossed out). The page's poll keeps it current. Nothing replaces a key on its own: the hint says what the developer can do.
 */
export function KeysNotice({ testId, keys }: { testId: string; keys: KeysView | null }) {
  if (!keys) return null;
  return (
    <section id="keys-notice" className="space-y-2 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100" aria-label="Access keys" data-keys-notice="">
      <p className="flex items-center gap-2 font-medium"><KeyRound className="h-4 w-4" /> Access keys</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium text-amber-200">Free (not given to anyone yet)</p>
          <p className="text-xs text-amber-100/80" data-free-line="">{keys.free.length} free · {keys.open} open spot{keys.open === 1 ? "" : "s"}: each new tester gets one.</p>
          <div className="flex max-h-[5.5rem] flex-wrap gap-1 overflow-y-auto pr-1" data-free-keys="">
            {keys.free.length ? keys.free.map((k) => <span key={k.id} className="max-w-[12rem] truncate rounded border border-amber-300/30 px-1.5 py-0.5 font-mono text-xs" title={k.value}>{k.value}</span>) : <span className="text-xs text-amber-100/70">None</span>}
          </div>
        </div>
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium text-amber-200">Given</p>
          <ul className="max-h-[5.5rem] space-y-0.5 overflow-y-auto pr-1 text-xs" data-given-keys="">
            {keys.inUse.length ? keys.inUse.map((k) => (
              <li key={k.id} className="truncate" title={`${k.value} · ${k.tester}${k.broken ? " (reported as not working)" : ""}`}>
                <span className={`font-mono ${k.broken ? "line-through opacity-60" : ""}`}>{k.value}</span> · {k.tester}
              </li>
            )) : <li className="text-amber-100/70">None yet</li>}
          </ul>
        </div>
      </div>
      <p className="text-xs" data-keys-hint="">{FREE_KEYS_HINT[0]}<a href={`/app/tests/${testId}/edit#keys`} target="_blank" rel="noopener" className="underline">{FREE_KEYS_HINT[1]}</a>{FREE_KEYS_HINT[2]}</p>
    </section>
  );
}
