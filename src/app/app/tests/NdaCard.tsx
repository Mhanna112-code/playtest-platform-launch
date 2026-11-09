"use client";
import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { CharacterCount } from "@/components/CharacterCount";
import { LIMITS } from "@/lib/limits";
import { NDA_TOO_LONG } from "@/lib/rules";

/**
 * (Owner, Oct 29, batch 13 section 5) The NDA in its own card, as in the full app. (Owner, Nov 9, §336) ONE component for Edit's NDA card (TestForm) and the NDA-only
 * editor (NdaOnlyForm: a paused, held, suspended or stopped test), so both look and behave the same: the heading, the three lines, the box (its placeholder, the
 * 1,000-character stop and counter, the red "Keep the NDA to 1,000 characters." through the site's field checks) and the notice slot under it.
 * `saved`: the saved NDA (an older, longer NDA loads whole, isn't red until changed, and can only be shortened). `mark`: Edit's draft tag; `note`: the blue
 * notice under the box (changed or saved in another tab or device).
 */
export function NdaCard({ value, saved, onChange, mark, note, disabled = false }: { value: string; saved: string; onChange: (v: string) => void; mark?: ReactNode; note?: ReactNode; disabled?: boolean }) {
  // (Batch 13 section 9) 1,000 characters; an older, longer NDA stays as it is until a Save changes it. (Owner, Nov 3, §140) Typing stops at 1,000 (maxLength).
  const tooLong = value.length > LIMITS.nda && value !== saved;
  return (
    <section className="space-y-3 rounded-xl border border-white/10 p-3" data-nda-card="">
      <h3 className="flex items-center gap-2 font-semibold text-white"><ShieldCheck className="h-5 w-5 text-emerald-300" /> <label htmlFor="ndaText">Keep it confidential? (NDA, optional)</label>{mark}</h3>
      <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-400">
        <li>An NDA stops testers sharing your build or what they saw. They must accept it before joining.</li>
        <li>With or without one, <strong className="text-slate-200">you can always use the feedback you receive</strong> to improve your product.</li>
        <li>Testers can never show work from a test under an NDA as excerpts on their profile; without one, they can only with your permission.</li>
      </ul>
      <textarea id="ndaText" rows={4} maxLength={LIMITS.nda} disabled={disabled} className={"input" + (tooLong ? " field-bad" : "")} data-red-msg={tooLong ? NDA_TOO_LONG : undefined} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Leave blank for no NDA. If filled, testers must accept it before joining." />
      <CharacterCount value={value} max={LIMITS.nda} data-nda-count="" />
      {note}
    </section>
  );
}
