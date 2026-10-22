"use client";

/** A row of tick boxes for picking several options. */
export function Choices({ options, value, onChange, label, required }: { options: string[]; value: string[]; onChange: (v: string[]) => void; label: string; required?: boolean }) {
  return (
    <fieldset>
      <legend className={"label" + (required ? " req" : "")}>{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = value.includes(o);
          return (
            <label key={o} className={"cursor-pointer rounded-full border px-3 py-1 text-sm " + (on ? "border-indigo-600 bg-indigo-50 text-indigo-800" : "border-slate-300 bg-white")}>
              <input type="checkbox" className="sr-only" checked={on} onChange={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])} />
              {o}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
