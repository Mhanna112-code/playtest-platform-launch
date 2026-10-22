"use client";
import { Err } from "@/components/Err";
import { useState } from "react";
import { api, errOf } from "@/lib/client";

/** Block someone (asks once in place). They are never told. */
export function BlockButton({ userId, name, effect }: { userId: string; name: string; effect: string }) {
  const [sure, setSure] = useState(false);
  const [err, setErr] = useState("");
  if (!sure) return <button className="btn-ghost text-xs" onClick={() => setSure(true)}>Block {name}</button>;
  return (
    <span className="inline-flex flex-col gap-1 text-sm">
      <span>Block {name}? {effect} They aren&apos;t told. You can unblock in Settings → Blocked people.</span>
      <span className="flex gap-2">
        <button className="btn-danger" onClick={() => api("/api/blocks", { userId }).then(() => window.location.reload()).catch((e) => setErr(errOf(e)))}>
          Yes, block {name}
        </button>
        <button className="btn-ghost" onClick={() => setSure(false)}>Cancel</button>
      </span>
      <Err text={err} />
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
