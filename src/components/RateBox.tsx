"use client";
import { useState } from "react";
import { ChangesBox } from "@/components/ChangesBox";
import { FIELD } from "@/lib/client";
import { usePress } from "@/lib/usePress";

/**
 * (NEWEST+5) Rate: 1-5 stars + an optional comment (500 max), behind an in-page warning of what rating ends. Same
 * button rules as every other: stop once (box under the button), refusals blue, form mistakes red at the field.
 */
export function RateBox(p: { path: string; seenAt: string; name: string; body?: Record<string, unknown>; headline: string; lines: string[]; working: boolean }) {
  const [open, setOpen] = useState(false);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const { press, changes, error, busy } = usePress(p.seenAt);
  const starsErr = error.startsWith(FIELD) && error.includes("stars");
  if (!open) return <button id="rate" className="btn-ghost" onClick={() => setOpen(true)}>Rate {p.name}</button>;
  return (
    <div className="info space-y-2" id="rate">
      <p>{p.headline}</p>
      {p.lines.map((l) => <p key={l}>{l}</p>)}
      <fieldset>
        <legend className="label req">Your rating of {p.name}</legend>
        <div className="flex gap-3">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="inline-flex items-center gap-1">
              <input type="radio" name="stars" checked={stars === n} onChange={() => setStars(n)} /> {n} ★
            </label>
          ))}
        </div>
        {starsErr && <p className="err-field">{error.slice(1)}</p>}
      </fieldset>
      <div>
        <label className="label" htmlFor="rate-comment">A comment (optional, shown without your name)</label>
        <textarea id="rate-comment" rows={2} className="input" maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn" disabled={busy} onClick={async () => {
          const r = await press(p.path, { ...(p.body ?? {}), stars: stars || null, comment });
          if (r) window.location.reload();
        }}>{p.working ? "Rate and finish" : "Rate"}</button>
        <button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      <ChangesBox changes={changes} error={starsErr ? "" : error} />
    </div>
  );
}
