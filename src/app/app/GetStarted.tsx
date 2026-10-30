import React from "react";
import Link from "next/link";

export function GetStarted({ steps }: { steps: { label: string; done: boolean }[] }) {
  if (steps.every((s) => s.done)) return <p className="mt-3 text-sm text-slate-400" data-get-started-complete="">{steps.map((s) => <span key={s.label} className="mr-3"><Link className="underline" href="/app/payments">✓ {s.label}</Link></span>)}</p>;
  return <section className="mt-3 rounded-xl border border-white/10 bg-white/[.03] p-3 text-sm" data-get-started="">
    <h2 className="mb-2 font-semibold text-white">Get started</h2>
    <ul className="space-y-1">{steps.map((s) => <li key={s.label}><Link className="underline" href="/app/payments">{s.done ? `✓ ${s.label}` : s.label}</Link></li>)}</ul>
  </section>;
}
