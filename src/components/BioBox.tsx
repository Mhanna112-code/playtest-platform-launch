"use client";
import { CharacterCount } from "@/components/CharacterCount";
import { LIMITS } from "@/lib/limits";
import { lockText } from "@/lib/sendLock";

export const DEV_BIO_PLACEHOLDER = "e.g. A two-person studio making co-op puzzle games for PC; we read every answer.";
export const TESTER_BIO_PLACEHOLDER = "e.g. Gameplay-experience QA for 5 years; Castilian Spanish LQA; I play a lot of roguelikes on PC.";

/**
 * (Owner, Nov 3, batch 35 §134) A side's own bio, optional, with its count (x / 2,000): the developer's is shown to testers, the tester's to developers. The same box
 * on the profile and (§162) at sign-up, where `name` sends it with the form and a server line about it ("Keep your bio to …") is red here (data-match).
 */
export function BioBox({ shownTo, value, onChange, placeholder, name, locked = false }: { shownTo: "developers" | "testers"; value: string; onChange: (v: string) => void; placeholder: string; name?: string; /** (Owner, Nov 5, §261) its Save is going through: read-only */ locked?: boolean }) {
  return (
    <div>
      <label className="label" htmlFor="bio">{`Bio (shown to ${shownTo})`}</label>
      <textarea id="bio" name={name} className="input min-h-24" maxLength={LIMITS.bio} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} data-match="bio" {...lockText(locked)} />
      <CharacterCount value={value} max={LIMITS.bio} />
    </div>
  );
}
