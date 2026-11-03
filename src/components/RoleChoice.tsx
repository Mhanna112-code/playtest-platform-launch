"use client";
import { useEffect, useRef, useState } from "react";
import { Choices } from "@/components/Choices";
import { DEVICES, LANGUAGES } from "@/lib/options";

const ROLE = "flex cursor-pointer items-center gap-2 rounded-lg border border-slate-600 p-3 has-[:checked]:border-indigo-400";
type Role = "" | "developer" | "tester" | "both";

/**
 * Sign-up's "I am a…" (developer, tester or both), as the full app asks it: on the email form and on Google's step. (Owner, Nov 3, batch 35 §134) Required: Sign
 * up or Continue without a pick is refused with "Choose developer, tester or both.", red at this choice (data-match) until one is picked.
 * (Owner, Nov 3, batch 35 §153) Tester or Both shows the tester's Devices and Languages right under it: the profile's own lists, tick pills and red lines ("Pick
 * at least one device you play on." / "Pick at least one language you can test in."), at least one of each required and saved into the tester profile when the
 * account is made, so Join needs no visit to Profile. Developer shows neither (and sends neither). The ticks stay while the choice changes back and forth.
 */
export function RoleChoice() {
  const [role, setRole] = useState<Role>("");
  const [devices, setDevices] = useState<string[]>([]);
  const [languages, setLanguages] = useState<string[]>([]);
  const box = useRef<HTMLDivElement>(null);
  // A choice the browser kept (Back to this page) shows its fields too.
  useEffect(() => {
    const kept = box.current?.querySelector<HTMLInputElement>('input[name="role"]:checked')?.value;
    if (kept) setRole(kept as Role);
  }, []);
  const tester = role === "tester" || role === "both";
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => setRole(e.target.value as Role);
  return (
    <>
      <fieldset>
        <legend className="label req">I am a…</legend>
        <div ref={box} id="role" className="grid gap-3 rounded-lg sm:grid-cols-3" data-field-group="" data-match="developer, tester or both">
          <label className={ROLE}><input type="radio" name="role" value="developer" required onChange={pick} /> Developer or maker</label>
          <label className={ROLE}><input type="radio" name="role" value="tester" required onChange={pick} /> Tester</label>
          <label className={ROLE}><input type="radio" name="role" value="both" required onChange={pick} /> Both</label>
        </div>
        <p className="mt-1.5 text-xs text-slate-500">One account either way: with both, switch sides from the button next to your name.</p>
      </fieldset>
      {tester && (
        <div className="space-y-4" data-tester-picks="">
          {/* data-list: AuthForm sends every ticked value as a list (none ticked: an empty list). */}
          <div id="devices" data-field-group="" data-match="at least one device" data-list="devices"><Choices label="Devices you use" name="devices" required options={DEVICES} value={devices} onChange={setDevices} /></div>
          <div id="languages" data-field-group="" data-match="at least one language" data-list="languages"><Choices label="Languages you can test in" name="languages" required options={LANGUAGES} value={languages} onChange={setLanguages} /></div>
          <p className="-mt-2 text-xs text-slate-500">You can change these on your profile any time.</p>
        </div>
      )}
    </>
  );
}
