"use client";
import { useFinished } from "@/lib/usePress";
import { useState } from "react";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Err } from "@/components/Err";
import { api, errOf } from "@/lib/client";
import { ChangesBox } from "@/components/ChangesBox";
import { useStopOnce } from "@/lib/useStopOnce";

/**
 * Block someone, on their profile only (owner, Oct 27): the confirm dialog, then the press. The only stop is a race check: if you already blocked them in
 * another tab, the press fails with a blue notice under this button. They are never told.
 */
export function BlockButton({ userId, name, effect, plain, seenAt }: { userId: string; name: string; effect: string; plain?: boolean; /** (§271) the profile's load time */ seenAt?: string }) {
  const [err, setErr] = useState("");
  // (Owner, Nov 5, §271) A pause of a test of theirs she works on since the profile loaded (or the team's lift of it) stops Block once.
  const stop = useStopOnce(seenAt);
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
            await api("/api/blocks", { userId, ...stop.marks() });
            stop.clear();
            fin.finish();
          } catch (e) {
            if (stop.stopped(e)) return setBusy(false);
            stop.clear();
            setErr(errOf(e));
            setBusy(false);
          }
        }}>
        <span className="[overflow-wrap:anywhere]">Block {name}</span>
      </ConfirmButton>
      <ChangesBox changes={stop.box} press="Block" side="tester" />
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
      <button className="btn-secondary px-3 py-1.5 text-sm" disabled={fin.done} data-unblock="" onClick={() => api("/api/blocks", { userId, action: "unblock" }).then(() => fin.finish(say ? "Unblocked." : ""), (e) => setErr(errOf(e)))}>
        <span className="[overflow-wrap:anywhere]">{name ? `Unblock ${name}` : "Unblock"}</span>
      </button>
      {done && <span className="text-emerald-300" role="status">Unblocked.</span>}
      <Err text={err} press="Unblock" />
    </span>
  );
}
