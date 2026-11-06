import { NameLink } from "@/components/Cut";
import { KeyRound } from "lucide-react";
import { FREE_KEYS_HINT } from "@/lib/keys";

export type KeysView = { free: { id: string; value: string; reused?: { from: string } }[]; inUse: { id: string; value: string; tester: string; /** (Owner, Nov 3, §166) their profile: the name is the green link */ testerHref?: string | null; gone?: "left" | "finished" }[]; open: number };

/**
 * (Owner, Oct 29, batch 14 section 6) The read-only "Access keys" notice where the yellow keys box was (shown only when the test uses keys; no buttons). Two compact
 * parts, each in its own scroll box about 4 lines tall (stacked on phones): the free keys as chips with the count and open spots, and the keys given, each with its
 * tester. The page's poll keeps it current. Nothing replaces a key on its own: the hint says what the developer can do. (Owner, Nov 6, §304) No "keys that don't
 * work" box and nothing crossed out: a tester whose key fails says so in chat, and the developer sends a free key in a message.
 */
export function KeysNotice({ testId, keys, canEdit = true }: { testId: string; keys: KeysView | null; /** (Owner, Nov 3, batch 35 §168) false on a stopped or closed test: no "in Edit" hint */ canEdit?: boolean }) {
  if (!keys) return null;
  return (
    <section id="keys-notice" className="space-y-2 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100" aria-label="Access keys" data-keys-notice="">
      <p className="flex items-center gap-2 font-medium"><KeyRound className="h-4 w-4" /> Access keys</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium text-amber-200">Free (not given to anyone yet)</p>
          <p className="text-xs text-amber-100/80" data-free-line="">{keys.free.length} free · {keys.open} open spot{keys.open === 1 ? "" : "s"}: each new tester gets one.</p>
          <div className="flex max-h-[5.5rem] flex-wrap gap-1 overflow-y-auto pr-1" data-free-keys="">
            {/* (Batch 15 section 44) A key typed back from a tester who left or finished: "HR-3333 · reused (Ben Okafor)" ((Owner, Nov 6, §304) always plain "reused"). */}
            {keys.free.length ? keys.free.map((k) => {
              const chip = k.reused ? `${k.value} · reused (${k.reused.from})` : k.value;
              return <span key={k.id} className="max-w-[16rem] truncate rounded border border-amber-300/30 px-1.5 py-0.5 font-mono text-xs" title={chip} data-key-chip={k.reused ? "reused" : undefined}>{chip}</span>;
            }) : <span className="text-xs text-amber-100/70">None</span>}
          </div>
        </div>
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium text-amber-200">Given</p>
          <ul className="max-h-[5.5rem] space-y-0.5 overflow-y-auto pr-1 text-xs" data-given-keys="">
            {keys.inUse.filter((k) => !k.gone).length ? keys.inUse.filter((k) => !k.gone).map((k) => (
              <li key={k.id} className="truncate" title={`${k.value} · ${k.tester}`}>
                <span className="font-mono">{k.value}</span> · <NameLink text={k.tester} href={k.testerHref} />
              </li>
            )) : <li className="text-amber-100/70">None yet</li>}
          </ul>
        </div>
      </div>
      {canEdit && <p className="text-xs" data-keys-hint="">{FREE_KEYS_HINT[0]}<a href={`/app/tests/${testId}/edit#keys`} target="_blank" rel="noopener" className="underline">{FREE_KEYS_HINT[1]}</a>{FREE_KEYS_HINT[2]}</p>}
    </section>
  );
}
