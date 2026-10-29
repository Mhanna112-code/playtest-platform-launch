import { TERMS_CHANGED_HREF, TERMS_TICK_LABEL, TERMS_TICK_LINK, TERMS_TICK_MISSING } from "@/lib/termsOfUse";

/**
 * (Owner, Oct 28 evening, batch 18 section 1; batch 20 section 21) For an account that accepted an older Terms of Use version: one more tick ABOVE Post the test /
 * Join / Apply / Ask to rejoin, in the same style as the Charge tick: "I agree to the updated Terms of Use. Read what changed" (the link opens the Terms at their
 * "What changed" note in a new tab). Required: unticked, the server's red "Tick to agree to the updated Terms of Use." goes to this box (data-match) and the
 * mistake list under it. (Batch 20 section 5: no age here; age is confirmed at sign-up.)
 */
export function TermsAgainBox({ agreed, onAgree, red = "" }: { agreed: boolean; onAgree: (v: boolean) => void; /** a red line of its own (pages without a mistake list) */ red?: string }) {
  return (
    <div data-note-after="" data-terms-again="">
      <label className="flex max-w-xl items-start gap-2 text-sm text-ink-200">
        <input type="checkbox" id="agree-terms" className="mt-1" checked={agreed} onChange={(e) => onAgree(e.target.checked)} data-match={`^${TERMS_TICK_MISSING.replace(/\./g, "\\.")}`} data-red-msg={red && !agreed ? red : undefined} />
        <span>{TERMS_TICK_LABEL} <a href={TERMS_CHANGED_HREF} target="_blank" rel="noreferrer">{TERMS_TICK_LINK}</a></span>
      </label>
      {red && !agreed && <p className="err-field" role="alert">{red}</p>}
    </div>
  );
}
