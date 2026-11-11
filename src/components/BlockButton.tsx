"use client";
import { useFinished } from "@/lib/usePress";
import { useState } from "react";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Err } from "@/components/Err";
import { api, errOf } from "@/lib/client";
import { lockPage, unlockPage } from "@/lib/pageLock";
import { announceBlocks } from "@/components/SessionWatch";

/**
 * Block someone, on their profile only (owner, Oct 27): the confirm dialog, then the press. The only stop is a race check: if you already blocked them in
 * another tab, the press fails with a blue notice under this button. They are never told. (Owner, Nov 11, §378; replaces §271 here) It never stops once (a pause
 * since the profile loaded doesn't stop it).
 */
export function BlockButton({ userId, name, effect, plain }: { userId: string; name: string; effect: string; plain?: boolean }) {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  // (Batch 35 §40, §41) Blocked: the page redraws in place; the button stays greyed until it has. (Owner, Nov 11, §380 A) Every button on the page stays
  // disabled until then.
  const fin = useFinished(() => {
    setBusy(false);
    unlockPage();
  });
  return (
    <div className="space-y-2">
      <ConfirmButton className={plain ? "hover:text-rose-200" : "btn-secondary px-3 py-1.5 text-xs"} disabled={busy} title={`Block ${name}?`} confirmLabel={`Block ${name}`}
        body={<p>{effect} They aren&apos;t told. You can unblock in Account → Blocked people.</p>}
        onConfirm={async () => {
          setBusy(true);
          setErr("");
          lockPage(); // (§380 A) the whole page waits for the Block and its redraw
          try {
            const r = await api<{ blocks?: string }>("/api/blocks", { userId });
            // (Owner, Nov 11, §380) Every other open page of this account (other tabs at once, other browsers and devices on their next check) disables its
            // buttons and reloads, so nothing stale about this person can be pressed; this page redraws itself.
            announceBlocks(r?.blocks);
            fin.finish();
          } catch (e) {
            setErr(errOf(e));
            setBusy(false);
            unlockPage();
          }
        }}>
        <span className="[overflow-wrap:anywhere]">Block {name}</span>
      </ConfirmButton>
      <Err text={err} press="Block" />
    </div>
  );
}

export function UnblockButton({ userId, say = false, name = "" }: { userId: string; /** (Batch 20 section 17) on a profile: "Unblocked." shows, then the page comes back in full */ say?: boolean; name?: string }) {
  const [err, setErr] = useState("");
  // (Batch 35 §40, §41) Unblocked: the page redraws in place (on a profile, "Unblocked." shows meanwhile); the button stays greyed until it has.
  const fin = useFinished();
  const done = fin.done && !!fin.line;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button className="btn-secondary px-3 py-1.5 text-sm" disabled={fin.done} data-unblock="" onClick={() => api<{ blocks?: string }>("/api/blocks", { userId, action: "unblock" }).then((r) => { announceBlocks(r?.blocks); /* (§380) the other pages reload too */ fin.finish(say ? "Unblocked." : ""); }, (e) => setErr(errOf(e)))}>
        <span className="[overflow-wrap:anywhere]">{name ? `Unblock ${name}` : "Unblock"}</span>
      </button>
      {done && <span className="text-emerald-300" role="status">Unblocked.</span>}
      <Err text={err} press="Unblock" />
    </span>
  );
}
