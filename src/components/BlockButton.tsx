"use client";
import { ChangesBox } from "@/components/ChangesBox";
import { ConfirmButton } from "@/components/ConfirmButton";
import { api } from "@/lib/client";
import { usePress } from "@/lib/usePress";

/**
 * Block someone: the full app's confirm dialog, then the press (through the page's stop-once gate: the box shows right
 * under the button). They are never told.
 */
export function BlockButton({ userId, name, effect, seenAt, sessionId, testId }: { userId: string; name: string; effect: string; seenAt?: string; sessionId?: string; testId?: string }) {
  const { press, changes, error, busy } = usePress(seenAt ?? "");
  return (
    <div className="space-y-2">
      <ConfirmButton className="btn-secondary px-3 py-1.5 text-xs" disabled={busy} title={`Block ${name}?`} confirmLabel={`Block ${name}`}
        body={<p>{effect} They aren&apos;t told. You can unblock in Settings → Blocked people.</p>}
        onConfirm={async () => {
          const r = await press("/api/blocks", { userId, sessionId, testId });
          if (r) window.location.reload();
        }}>
        Block {name}
      </ConfirmButton>
      <ChangesBox changes={changes} error={error} />
    </div>
  );
}

export function UnblockButton({ userId }: { userId: string }) {
  return (
    <button className="btn-ghost text-xs" onClick={() => api("/api/blocks", { userId, action: "unblock" }).then(() => window.location.reload())}>
      Unblock
    </button>
  );
}
