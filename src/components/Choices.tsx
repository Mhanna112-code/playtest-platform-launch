"use client";
import type { ReactNode } from "react";

/**
 * (Owner, Oct 31, batch 35 §52) The one pick-list chip: a round pill, green outline and fill when ticked (Post / Edit's Categories, Language and Technology
 * requirements, the profile's devices and languages, Find's state ticks, Invite's filter ticks).
 */
export const PICK_CHIP = "flex cursor-pointer items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm text-slate-300 has-[:checked]:border-indigo-400/60 has-[:checked]:bg-indigo-500/15 has-[:checked]:text-white";

/** A row of tick boxes for picking several options. */
export function Choices({ options, value, onChange, label, required, aside }: { options: string[]; value: string[]; onChange: (v: string[]) => void; label: string; required?: boolean; /** Shown next to the label (e.g. Edit's "Changes left: 2 of 3"). */ aside?: ReactNode }) {
  return (
    <fieldset>
      <legend className={"label" + (required ? " req" : "")}>{label}{aside}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = value.includes(o);
          return (
            <label key={o} className={PICK_CHIP}>
              <input type="checkbox" checked={on} onChange={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])} /> {o}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
