import React from "react";
import Link from "next/link";

export function GetStarted({ steps }: { steps: { label: string; done: boolean }[] }) {
  // (Batch 34 §6) The box goes once every step is done.
  if (steps.every((s) => s.done)) return null;
  return <section className="mt-3 rounded-xl border border-white/10 bg-white/[.03] p-3 text-sm" data-get-started="">
    <h2 className="mb-2 font-semibold text-white">Get started</h2>
    <ul className="space-y-1">{steps.map((s) => <li key={s.label}><Link className="underline" href="/app/payments">{s.done ? `✓ ${s.label}` : s.label}</Link></li>)}</ul>
  </section>;
}
