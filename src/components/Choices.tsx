"use client";
import type { ReactNode } from "react";

/** A row of tick boxes for picking several options. */
export function Choices({ options, value, onChange, label, required, aside }: { options: string[]; value: string[]; onChange: (v: string[]) => void; label: string; required?: boolean; /** Shown next to the label (e.g. Edit's "Changes left: 2 of 3"). */ aside?: ReactNode }) {
  return (
    <fieldset>
      <legend className={"label" + (required ? " req" : "")}>{label}{aside}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = value.includes(o);
          return (
            <label key={o} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-600 px-3 py-1.5 text-sm has-[:checked]:border-indigo-400 has-[:checked]:bg-indigo-500/10">
              <input type="checkbox" checked={on} onChange={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])} /> {o}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
