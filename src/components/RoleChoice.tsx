"use client";
import { useEffect, useRef, useState } from "react";
import { BioBox, DEV_BIO_PLACEHOLDER, TESTER_BIO_PLACEHOLDER } from "@/components/BioBox";
import { Choices } from "@/components/Choices";
import { PRONOUN_OPTIONS } from "@/lib/format";
import { DEVICES, LANGUAGES } from "@/lib/options";

const ROLE = "flex cursor-pointer items-center gap-2 rounded-lg border border-slate-600 p-3 has-[:checked]:border-indigo-400";
type Role = "" | "developer" | "tester";

/**
 * Sign-up's "I am a…" (developer or tester), as the full app asks it: on the email form and on Google's step. (Owner, Nov 3, batch 35 §134) Required: Sign up or
 * Continue without a pick is refused with "Choose developer or tester.", red at this choice (data-match) until one is picked. (Owner, Nov 3, batch 35 §162;
 * replaces §134's third choice) No "Both": the other side is added later from Settings (Start testing too / Start posting tests too).
 * (Owner, Nov 3, batch 35 §153) Tester shows the tester's Devices and Languages right under it: the profile's own lists, tick pills and red lines ("Pick at least
 * one device you play on." / "Pick at least one language you can test in."), at least one of each required and saved into the tester profile when the account is
 * made, so Join needs no visit to Profile. Developer shows neither (and sends neither). The ticks stay while the choice changes back and forth.
 * (Owner, Nov 3, batch 35 §162) `children` (the page's Name box) come next, then the optional Pronoun (the profile's own choice; unset reads "they") and the
 * chosen side's optional bio, with the profile's label, limit and count: "Bio (shown to testers)" for a developer, "Bio (shown to developers)" for a tester. The
 * box follows the choice live; what's typed stays while the choice changes back and forth, and only the box shown is sent.
 */
export function RoleChoice({ children }: { children?: React.ReactNode }) {
  const [role, setRole] = useState<Role>("");
  const [devices, setDevices] = useState<string[]>([]);
  const [languages, setLanguages] = useState<string[]>([]);
  const [bios, setBios] = useState({ developer: "", tester: "" });
  const box = useRef<HTMLDivElement>(null);
  // A choice the browser kept (Back to this page) shows its fields too.
  useEffect(() => {
    const kept = box.current?.querySelector<HTMLInputElement>('input[name="role"]:checked')?.value;
    if (kept === "developer" || kept === "tester") setRole(kept);
  }, []);
  const tester = role === "tester";
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => setRole(e.target.value as Role);
  return (
    <>
      <fieldset>
        <legend className="label req">I am a…</legend>
        <div ref={box} id="role" className="grid gap-3 rounded-lg sm:grid-cols-2" data-field-group="" data-match="developer or tester">
          <label className={ROLE}><input type="radio" name="role" value="developer" required onChange={pick} /> Developer or maker</label>
          <label className={ROLE}><input type="radio" name="role" value="tester" required onChange={pick} /> Tester</label>
        </div>
        <p className="mt-1.5 text-xs text-slate-500">One account either way: you can add the other side later in Settings.</p>
      </fieldset>
      {tester && (
        <div className="space-y-4" data-tester-picks="">
          {/* data-list: AuthForm sends every ticked value as a list (none ticked: an empty list). */}
          <div id="devices" data-field-group="" data-match="at least one device" data-list="devices"><Choices label="Devices you use" name="devices" required options={DEVICES} value={devices} onChange={setDevices} /></div>
          <div id="languages" data-field-group="" data-match="at least one language" data-list="languages"><Choices label="Languages you can test in" name="languages" required options={LANGUAGES} value={languages} onChange={setLanguages} /></div>
          <p className="-mt-2 text-xs text-slate-500">You can change these on your profile any time.</p>
        </div>
      )}
      {children}
      <div>
        <label className="label" htmlFor="pronoun">Pronoun</label>
        <select id="pronoun" name="pronoun" className="input max-w-[16rem]" defaultValue="" data-match="pronoun">
          {PRONOUN_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      {role && (
        <div data-signup-bio={role}>
          <BioBox
            key={role}
            name="bio"
            shownTo={role === "developer" ? "testers" : "developers"}
            value={bios[role]}
            onChange={(bio) => setBios((b) => ({ ...b, [role]: bio }))}
            placeholder={role === "developer" ? DEV_BIO_PLACEHOLDER : TESTER_BIO_PLACEHOLDER}
          />
        </div>
      )}
    </>
  );
}
