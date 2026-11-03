"use client";
import Link from "next/link";
import { useState } from "react";
import { CategoryIcon } from "@/components/Category";
import { PICK_CHIP } from "@/components/Choices";
import { categoryChip } from "@/components/Ui";
import { DEVICES, LANGUAGES } from "@/lib/options";
import { FIND_PARTS, findHref, showFor, type FindLink, type FindPart } from "@/lib/findFilters";

/**
 * (Owner, Nov 3, batch 35 §144) The category chips tick on and off, several at once ("All" clears them); a test shows only if it has every ticked
 * category. Each chip is a link (works without JavaScript) that keeps the other filters, the sort and the search.
 */
export function CategoryTicks({ params, counts, total }: { params: FindLink; counts: Record<string, number>; total: number }) {
  const on = params.categories ?? [];
  const flip = (c: string) => findHref({ ...params, categories: on.includes(c) ? on.filter((x) => x !== c) : [...on, c] });
  return (
    <div className="flex flex-wrap gap-2" data-find-categories="">
      <Link href={findHref({ ...params, categories: [] })} aria-current={on.length ? undefined : "true"} className={categoryChip(!on.length)}>All <span className="text-slate-500">{total}</span></Link>
      {Object.entries(counts).filter(([, n]) => n > 0).map(([category, n]) => (
        <Link key={category} href={flip(category)} aria-current={on.includes(category) ? "true" : undefined} className={categoryChip(on.includes(category))} data-find-category={category}>
          <CategoryIcon category={category} className="h-3.5 w-3.5" /> {category} <span className="text-slate-500">{n}</span>
        </Link>
      ))}
    </div>
  );
}

function Ticks({ legend, name, options, labels, ticked, onFlip }: { legend: string; name: string; options: readonly string[]; labels?: Record<string, string>; ticked: string[]; onFlip?: (v: string) => void }) {
  return (
    <fieldset className="min-w-0" data-find-ticks={name}>
      <legend className="label">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          // (Batch 35 §52) The one pick-list chip.
          <label key={o} className={PICK_CHIP}>
            {onFlip
              ? <input type="checkbox" name={name} value={o} checked={ticked.includes(o)} onChange={() => onFlip(o)} />
              : <input type="checkbox" name={name} value={o} defaultChecked={ticked.includes(o)} />}
            {labels?.[o] ?? o}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * (Owner, Nov 3, batch 35 §144) Find's filters: tick boxes for devices, languages and parts, Sort by, and Show. A plain GET form (Apply), so it works
 * without JavaScript. Show and the device / language ticks follow each other: "Matching my profile" ticks exactly the profile's devices and languages,
 * "Everything" clears them, and ticking them differently from the profile turns Show to "Everything" (back to the profile's, it reads "Matching my
 * profile" again). Parts and categories are not Show's. `profile` is null for an admin (no Show).
 */
export function FindFilters({ params, profile }: { params: FindLink; profile: { devices: string[]; languages: string[] } | null }) {
  const [devices, setDevices] = useState(params.devices ?? []);
  const [languages, setLanguages] = useState(params.languages ?? []);
  const [mine, setMine] = useState<"1" | "0">(params.mine ? "1" : "0");
  const flip = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const tick = (kind: "devices" | "languages", v: string) => {
    const next = { devices: kind === "devices" ? flip(devices, v) : devices, languages: kind === "languages" ? flip(languages, v) : languages };
    setDevices(next.devices);
    setLanguages(next.languages);
    setMine(showFor(next, profile));
  };
  const show = (v: "1" | "0") => {
    setMine(v);
    setDevices(v === "1" ? [...(profile?.devices ?? [])] : []);
    setLanguages(v === "1" ? [...(profile?.languages ?? [])] : []);
  };
  return (
    <form action="/app/find" className="card space-y-4 p-4" data-find-filters="">
      {(params.categories ?? []).map((c) => <input key={c} type="hidden" name="category" value={c} />)}
      {params.q && <input type="hidden" name="q" value={params.q} />}
      {params.states && <input type="hidden" name="states" value={params.states} />}
      <div className="flex flex-wrap items-end gap-3">
        {profile && (
          <div>
            <label className="label" htmlFor="mine">Show</label>
            <select className="input w-52" id="mine" name="mine" value={mine} onChange={(e) => show(e.target.value === "1" ? "1" : "0")}>
              <option value="1">Matching my profile</option>
              <option value="0">Everything</option>
            </select>
          </div>
        )}
        <div>
          <label className="label" htmlFor="sort">Sort by</label>
          <select className="input w-52" id="sort" name="sort" defaultValue={params.sort ?? ""}>
            <option value="">Newest</option>
            <option value="pay">Highest pay</option>
            <option value="deadline">Most time to finish</option>
          </select>
        </div>
      </div>
      <Ticks legend="Devices" name="device" options={DEVICES} ticked={devices} onFlip={(v) => tick("devices", v)} />
      <Ticks legend="Languages" name="lang" options={LANGUAGES} ticked={languages} onFlip={(v) => tick("languages", v)} />
      <Ticks legend="Parts" name="part" options={Object.keys(FIND_PARTS)} labels={FIND_PARTS} ticked={(params.parts ?? []) as FindPart[]} />
      <button className="btn">Apply</button>
    </form>
  );
}
