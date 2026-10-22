"use client";
import { ChangesBox } from "@/components/ChangesBox";
import { usePress } from "@/lib/usePress";

/**
 * One button that goes through the page's stop-once gate: the first press may stop (the box shows right under it and
 * stays live); the second goes ahead. A refusal shows in the same place.
 */
export function PressButton(p: { seenAt: string; path: string; body: Record<string, unknown>; children: React.ReactNode; className?: string; onDone?: (r: unknown) => void }) {
  const { press, changes, error, busy } = usePress(p.seenAt);
  return (
    <>
      <button
        className={p.className ?? "btn-ghost"}
        disabled={busy}
        onClick={async () => {
          const r = await press(p.path, p.body);
          if (r) (p.onDone ?? (() => window.location.reload()))(r);
        }}
      >
        {p.children}
      </button>
      <ChangesBox changes={changes} error={error} />
    </>
  );
}
