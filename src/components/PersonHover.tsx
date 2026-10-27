import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The full app's name with a hover / tap card (its HoverBlock / DeveloperName): their summary lines, a link to the
 * profile and, at the bottom, Block. The same card the developer's Seats avatars use.
 */
export function PersonHover(p: { name: string; href: string; summary: string[]; block?: ReactNode; chat?: ReactNode; className?: string }) {
  return (
    <span className="group relative inline-block">
      <Link href={p.href} className={`${p.className ?? "text-slate-200"} underline-offset-2 hover:underline focus:outline-none focus-visible:underline`}>{p.name}</Link>
      <span role="tooltip"
        className="invisible absolute left-0 top-full z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-white/15 bg-slate-900 p-4 text-sm opacity-0 shadow-2xl transition before:absolute before:inset-x-0 before:-top-2 before:h-2 before:content-[''] group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
        <span className="block font-semibold text-white">{p.name}</span>
        {p.summary.map((l) => <span key={l} className="block text-slate-300">{l}</span>)}
        <Link href={p.href} className="mt-1 block text-sky-300 hover:underline">See their profile</Link>
        {p.chat && <span className="mt-3 block border-t border-white/10 pt-2">{p.chat}</span>}
        {p.block && <span className="mt-3 block border-t border-white/10 pt-2">{p.block}</span>}
      </span>
    </span>
  );
}
