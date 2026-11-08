"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { panelMatches } from "@/lib/panelSearch";
/** Filters only this panel's own test rows; other panels and their input remain untouched. */
export function ScopedPanelSearch({label,children}: {label:string;children:ReactNode}) {
 const [query,setQuery]=useState("");const [none,setNone]=useState(false);const box=useRef<HTMLDivElement>(null);
 useEffect(()=>{let count=0;const rows=box.current?.querySelectorAll<HTMLElement>("[data-panel-search]");rows?.forEach(row=>{const show=panelMatches(row.dataset.panelSearch??"",query);row.hidden=!show;if(show)count++;});setNone(!!rows?.length&&!count);},[query,children]);
 return <div className="space-y-2"><input type="search" className="input w-full max-w-md" aria-label={`Search ${label} by developer or test`} placeholder="Search by developer or test" value={query} maxLength={200} onChange={e=>setQuery(e.target.value)}/>{none&&<p className="note">No matches.</p>}<div ref={box}>{children}</div></div>;
}
