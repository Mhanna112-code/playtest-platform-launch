"use client";
import { Err } from "@/components/Err";
import { useEffect, useState } from "react";
import { ChangesBox } from "@/components/ChangesBox";
import { api, errOf } from "@/lib/client";
import { stopBox, useStopBox, type StopBox } from "@/lib/topStop";

/** New terms offered (Switch / Keep). Its stop-once box and refusals show directly under these buttons. */
export function TesterTop({ sessionId, seenAt, offer, devName }: { sessionId: string; seenAt: string; offer: { id: string; diff: string; ndaText?: string; fromNdaText?: string; questions?: string[]; fromQuestions?: string[]; answers?: string[] } | null; devName: string }) {
  const [box, setBox] = useStopBox();
  const [offerId, setOfferId] = useState(offer?.id ?? "");
  // (Owner) When the box was made: the next press goes ahead only if nothing new happened since.
  const [boxAt, setBoxAt] = useState("");
  const confirmed = !!boxAt;
  const [err, setErr] = useState("");
  useEffect(() => {
    const on = (e: Event) => setBox((e as CustomEvent).detail as StopBox);
    window.addEventListener("tester-top", on);
    return () => window.removeEventListener("tester-top", on);
  }, [setBox]);
  if (!offer)
    return box ? (
      <div className="space-y-2">
        <ChangesBox changes={box.changes} tail={box.tail} />
        <button className="btn-ghost" onClick={() => window.location.reload()}>See the new terms</button>
      </div>
    ) : null;
  const decide = (choice: string) =>
    api(`/api/sessions/${sessionId}/terms`, { offerId, choice, seenAt, confirmed, boxAt })
      .then(() => window.location.reload())
      .catch((e) => {
        const sb = stopBox(e);
        if (sb) {
          setBox(sb);
          setBoxAt(sb.now);
          const next = (e as { data?: { offerId?: string } }).data?.offerId;
          if (next) setOfferId(next);
        } else setErr(errOf(e));
      });
  return (
    <div id="terms-offer" className="info scroll-mt-24 space-y-2">
      <p>
        {devName} updated the listing: {offer.diff}.
      </p>
      <p className="text-xs">Switching applies to work you send from now on; work you&apos;ve already sent keeps its price. Your deadline never moves earlier.</p>
      {offer.ndaText != null && offer.ndaText !== (offer.fromNdaText ?? "") && (
        <details className="text-sm" open>
          <summary className="cursor-pointer font-medium">{offer.ndaText ? "The NDA" : "The NDA is removed"}{offer.fromNdaText ? " (changed)" : ""}: switching means you accept it</summary>
          {offer.fromNdaText && <p className="mt-1 whitespace-pre-wrap text-xs text-sky-200/80">Before: {offer.fromNdaText}</p>}
          {offer.ndaText && <p className="mt-1 whitespace-pre-wrap">{offer.ndaText}</p>}
        </details>
      )}
      {offer.questions && offer.fromQuestions && JSON.stringify(offer.questions) !== JSON.stringify(offer.fromQuestions) && (
        <details className="text-sm" open>
          <summary className="cursor-pointer font-medium">The questions changed: before and after</summary>
          <p className="mt-1 text-xs text-sky-200/80">Before: {offer.fromQuestions.join(" · ") || "none"}</p>
          <p className="mt-1">After: {offer.questions.join(" · ") || "none"}</p>
          {offer.answers && offer.answers.some(Boolean) && <p className="mt-1 whitespace-pre-wrap text-xs text-sky-200/80">Your answers so far: {offer.answers.filter(Boolean).join(" / ")}</p>}
        </details>
      )}
      <div className="flex flex-wrap gap-2">
        <button className="btn" onClick={() => decide("switch")}>Switch to the new terms</button>
        <button className="btn-ghost" onClick={() => decide("keep")}>Keep my current terms</button>
      </div>
      <ChangesBox changes={box?.changes ?? null} tail={box?.tail} />
      <Err text={err} />
    </div>
  );
}
