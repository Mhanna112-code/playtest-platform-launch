"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
import { jumpTo } from "@/lib/markJump";

/** (Owner, Nov 5, batch 35 §268) The contract box's pill while new terms wait for Switch or Keep. */
export const NEW_TERMS_PILL = "New terms";

/**
 * (Owner, Nov 5, §268) A permanent update pill on "Your agreed scope" while new terms are open: it stays across reloads and redraws until pressed (stored per
 * offer, `TermsOffer.pillPressedAt`; a newer offer brings it back). Pressing it records that and brings the new terms (`#terms-offer`) into view, marked. The
 * look of the other update pills (the "Updated" badge). Separate from the blue live pill.
 */
export function TermsPill({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [gone, setGone] = useState(false);
  if (gone) return null;
  return (
    <button type="button" className="badge cursor-pointer border-sky-300/40 text-[11px] text-sky-200" data-terms-pill=""
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setGone(true); void api(`/api/sessions/${sessionId}/terms-pill`, {}).catch(() => null).then(() => router.refresh()); jumpTo("terms-offer"); }}>
      {NEW_TERMS_PILL}
    </button>
  );
}

/** (Owner, Nov 5, §268) The Rate / Leave pop-up's notice while new terms are open: information only, never a stop. */
export const openTermsLine = (dev: string, press: "rate" | "leave") => `${dev} offered new terms you haven't answered: ${press === "rate" ? "rating" : "leaving"} closes them unanswered.`;
export function OpenTermsNotice({ dev, press }: { dev: string; press: "rate" | "leave" }) {
  return (
    <p className="info text-xs" data-open-terms-notice={press}>
      {openTermsLine(dev, press)} <a href="#terms-offer" onClick={(e) => { e.preventDefault(); jumpTo("terms-offer"); }}>See the new terms</a>
    </p>
  );
}
