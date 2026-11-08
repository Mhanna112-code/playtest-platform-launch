"use client";
import { useState, type ReactNode } from "react";
import { panelMatches } from "@/lib/panelSearch";
import { ResizeBox } from "@/components/Panel";
export type SearchPanelItem = { key: string; search: string; states?: string[]; node: ReactNode };
export function SearchPanel({ id, title, placeholder, items, filters = [] }: { id: string; title: string; placeholder: string; items: SearchPanelItem[]; filters?: string[] }) {
 const [query,setQuery]=useState(""); const [ticks,setTicks]=useState<string[]>([]);
 const shown=items.filter(i=>panelMatches(i.search,query,i.states,ticks));
 return <section className="space-y-3" id={id}><h2 className="text-lg font-semibold text-white">{title} <span className="text-sm text-slate-400">{shown.length}</span></h2>
 <input className="input w-full max-w-md" type="search" aria-label={placeholder} placeholder={placeholder} maxLength={200} value={query} onChange={e=>setQuery(e.target.value)} />
 {filters.length>0 && <div className="flex flex-wrap gap-4">{filters.map(s=><label key={s} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ticks.includes(s)} onChange={e=>setTicks(old=>e.target.checked?[...old,s]:old.filter(x=>x!==s))}/>{s}</label>)}</div>}
 <ResizeBox id={id+"-list"} label={title} defaultMax="24rem"><ul className="space-y-3">{shown.map(i=><li key={i.key} className="min-w-0">{i.node}</li>)}{!shown.length&&<li className="note">No matches.</li>}</ul></ResizeBox></section>;
}
