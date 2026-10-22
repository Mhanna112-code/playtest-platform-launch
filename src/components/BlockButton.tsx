"use client";
import { PressButton } from "@/components/PressButton";
import { useState } from "react";
import { api } from "@/lib/client";

/**
 * Block someone (asks once in place). They are never told. From a session page (sessionId) or a test page (testId) the
 * "Yes, block" press goes through that page's stop-once gate: the box shows right under it.
 */
export function BlockButton({ userId, name, effect, seenAt, sessionId, testId }: { userId: string; name: string; effect: string; seenAt?: string; sessionId?: string; testId?: string }) {
  const [sure, setSure] = useState(false);
  if (!sure) return <button className="btn-ghost text-xs" onClick={() => setSure(true)}>Block {name}</button>;
  return (
    <span className="inline-flex flex-col gap-1 text-sm">
      <span>Block {name}? {effect} They aren&apos;t told. You can unblock in Settings → Blocked people.</span>
      <span className="flex flex-wrap gap-2">
        <PressButton className="btn-danger" seenAt={seenAt ?? ""} path="/api/blocks" body={{ userId, sessionId, testId }}>
          Yes, block {name}
        </PressButton>
        <button className="btn-ghost" onClick={() => setSure(false)}>Cancel</button>
      </span>
    </span>
  );
}

export function UnblockButton({ userId }: { userId: string }) {
  return (
    <button className="btn-ghost text-xs" onClick={() => api("/api/blocks", { userId, action: "unblock" }).then(() => window.location.reload())}>
      Unblock
    </button>
  );
}
