import { NameLink } from "@/components/Cut";
import type { ReactNode } from "react";

/**
 * The full app's name with a hover / tap card (its HoverBlock / DeveloperName): their summary lines and, at the bottom, Block. The same card the developer's Seats
 * avatars use. (Owner, Nov 3, §166) The name, here and on the card, is the green link to the profile (NameLink); no "See her profile" line.
 */
export function PersonHover(p: { name: string; href: string; summary: string[]; block?: ReactNode; chat?: ReactNode; className?: string }) {
  return (
    <span className="group relative inline-block">
      <NameLink text={p.name} href={p.href} className={`${p.className ?? ""} focus:outline-none focus-visible:underline`} />
      <span role="tooltip"
        className="invisible absolute left-0 top-full z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-white/15 bg-slate-900 p-4 text-sm opacity-0 shadow-2xl transition before:absolute before:inset-x-0 before:-top-2 before:h-2 before:content-[''] group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
        <span className="block font-semibold text-white" data-card-name=""><NameLink text={p.name} href={p.href} whole /></span>
        {p.summary.map((l) => <span key={l} className="block text-slate-300">{l}</span>)}
        {p.chat && <span className="mt-3 block border-t border-white/10 pt-2">{p.chat}</span>}
        {p.block && <span className="mt-3 block border-t border-white/10 pt-2">{p.block}</span>}
      </span>
    </span>
  );
}
