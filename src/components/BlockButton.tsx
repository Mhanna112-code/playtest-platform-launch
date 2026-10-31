"use client";
import { useFinished } from "@/lib/usePress";
import { useState } from "react";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Err } from "@/components/Err";
import { api, errOf } from "@/lib/client";

/**
 * Block someone, on their profile only (owner, Oct 27): the confirm dialog, then the press. The only stop is a race check: if you already blocked them in
 * another tab, the press fails with a blue notice under this button. They are never told.
 */
export function BlockButton({ userId, name, effect, plain }: { userId: string; name: string; effect: string; plain?: boolean }) {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  // (Batch 35 §40, §41) Blocked: the page redraws in place; the button stays greyed until it has.
  const fin = useFinished(() => setBusy(false));
  return (
    <div className="space-y-2">
      <ConfirmButton className={plain ? "hover:text-rose-200" : "btn-secondary px-3 py-1.5 text-xs"} disabled={busy} title={`Block ${name}?`} confirmLabel={`Block ${name}`}
        body={<p>{effect} They aren&apos;t told. You can unblock in Account → Blocked people.</p>}
        onConfirm={async () => {
          setBusy(true);
          setErr("");
          try {
            await api("/api/blocks", { userId });
            fin.finish();
          } catch (e) {
            setErr(errOf(e));
            setBusy(false);
          }
        }}>
        Block {name}
      </ConfirmButton>
      <Err text={err} />
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
      <button className="btn-secondary px-3 py-1.5 text-sm" disabled={fin.done} data-unblock="" onClick={() => api("/api/blocks", { userId, action: "unblock" }).then(() => fin.finish(say ? "Unblocked." : ""), (e) => setErr(errOf(e)))}>
        {name ? `Unblock ${name}` : "Unblock"}
      </button>
      {done && <span className="text-emerald-300" role="status">Unblocked.</span>}
      <Err text={err} />
    </span>
  );
}
