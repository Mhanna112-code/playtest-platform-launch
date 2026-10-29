"use client";
import { useEffect, useRef } from "react";
import { bringInView } from "@/lib/markJump";
import { TERMS_AGREE_LABEL, TERMS_CHANGED_HREF } from "@/lib/termsOfUse";

/**
 * (Owner, Oct 28 evening, batch 18 section 1) The box under Post the test / Join / Apply / Ask to rejoin for an account that accepted an older Terms of Use version:
 * "We updated our Terms of Use. Read what changed." (the link opens the Terms at their "What changed" note) and the tick. Ticked, the next press goes through.
 */
export function TermsAgainBox({ agreed, onAgree }: { agreed: boolean; onAgree: (v: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => bringInView(ref.current), []);
  return (
    <div ref={ref} className="info space-y-2" data-terms-again="">
      <p>
        We updated our Terms of Use. <a href={TERMS_CHANGED_HREF} target="_blank" rel="noreferrer" className="underline">Read what changed.</a>
      </p>
      <label className="flex items-center gap-2 text-sm text-white">
        <input type="checkbox" id="agree-terms" checked={agreed} onChange={(e) => onAgree(e.target.checked)} /> {TERMS_AGREE_LABEL}
      </label>
    </div>
  );
}
