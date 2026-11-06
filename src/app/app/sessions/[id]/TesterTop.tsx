"use client";
import { Err } from "@/components/Err";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { jumpTo } from "@/lib/markJump";
import { ANSWER_TERMS_EVENT } from "@/lib/answerTerms";
import { ChangesBox } from "@/components/ChangesBox";
import { NdaBox } from "@/components/NdaBox";
import { api, errOf } from "@/lib/client";
import { pressLabelOf } from "@/lib/pressLabels";
import { stopBox, useStopBox, type StopBox } from "@/lib/topStop";
import { useFinished } from "@/lib/usePress";
import { reloadKeepingPlace } from "@/lib/keepPlace";
import { PressDone } from "@/components/PressDone";


/**
 * New terms offered (Switch / Keep). Its stop-once box and refusals show directly under these buttons.
 * (Batch 35 §40, §41) Switch / Keep change the terms every part of the page is built on, so the page loads again, keeping its place (a "#…" in the address is
 * dropped first); until then both buttons stay greyed with the result line.
 */
export function TesterTop({ sessionId, seenAt, offer, devName }: { sessionId: string; seenAt: string; offer: { id: string; diff: string; ndaText?: string; fromNdaText?: string; } | null; devName: string }) {
  const [box, setBox] = useStopBox();
  const [offerId, setOfferId] = useState(offer?.id ?? "");
  // (Owner, Oct 28, batch 16 section 38A) The offer can arrive while the page is open (a refresh brings it): Switch / Keep always send the offer shown now.
  useEffect(() => {
    if (offer?.id) setOfferId(offer.id);
  }, [offer?.id]);
  // (Owner) When the box was made: the next press goes ahead only if nothing new happened since.
  const [boxAt, setBoxAt] = useState("");
  const confirmed = !!boxAt;
  const [err, setErr] = useState("");
  // (§156) Named by the button pressed: "Switch to the new terms" or "Keep my current terms".
  const [errPress, setErrPress] = useState("");
  const fin = useFinished();
  useEffect(() => {
    const on = (e: Event) => setBox((e as CustomEvent).detail as StopBox);
    window.addEventListener("tester-top", on);
    return () => window.removeEventListener("tester-top", on);
  }, [setBox]);
  // (Owner, Oct 29, batch 27 section 1) A Send or call press while an offer is open: the page goes up to this box, highlighted for a few seconds (jumpTo's ring),
  // every time. A page that doesn't show the offer yet (the server refused it) loads it first, then goes to it.
  const router = useRouter();
  const pending = useRef(false);
  useEffect(() => {
    const on = () => {
      if (document.getElementById("terms-offer")) {
        setTimeout(() => jumpTo("terms-offer"), 30);
        return;
      }
      pending.current = true;
      router.refresh();
    };
    window.addEventListener(ANSWER_TERMS_EVENT, on);
    return () => window.removeEventListener(ANSWER_TERMS_EVENT, on);
  }, [router]);
  useEffect(() => {
    if (!offer?.id || !pending.current) return;
    pending.current = false;
    setTimeout(() => jumpTo("terms-offer"), 30);
  }, [offer?.id]);
  if (!offer)
    return box ? (
      <div className="space-y-2">
        <ChangesBox side="tester" changes={box.changes} tail={box.tail} />
        <button className="btn-ghost" onClick={() => reloadKeepingPlace()}>See the new terms</button>
      </div>
    ) : null;
  const decide = (choice: string) => {
    setErrPress(pressLabelOf(`/api/sessions/${sessionId}/terms`, { choice }));
    return api(`/api/sessions/${sessionId}/terms`, { offerId, choice, seenAt, confirmed, boxAt })
      .then(() => { setBox(null); fin.finish(choice === "switch" ? "Switched to the new terms." : "Kept your current terms.", { reload: true }); })
      .catch((e) => {
        const sb = stopBox(e);
        if (sb) {
          setBox(sb);
          setBoxAt(sb.now);
          const next = (e as { data?: { offerId?: string } }).data?.offerId;
          if (next) setOfferId(next);
        } else setErr(errOf(e));
      });
  };
  return (
    <div id="terms-offer" className="info scroll-mt-24 space-y-2 transition-shadow data-[marked]:ring-2 data-[marked]:ring-sky-300">
      <p>
        {devName} updated the listing: {offer.diff}.
      </p>
      <p className="text-xs">Switching applies to work you send from now on; work you&apos;ve already sent keeps its price. Your deadline never moves earlier.</p>
      {offer.ndaText != null && offer.ndaText !== (offer.fromNdaText ?? "") && (
        <details className="text-sm" open>
          <summary className="cursor-pointer font-medium">{offer.ndaText ? "The NDA" : "The NDA is removed"}{offer.fromNdaText ? " (changed)" : ""}: switching means you accept it</summary>
          {/* (Batch 13 section 9) "Before" and "Offered" as two scroll boxes, never in full. (§231) The shared box for contract texts, like the questions below. */}
          <div className="mt-1 space-y-2">
            {offer.fromNdaText && <NdaBox id={`offer-${offer.id}-nda-before`} label="Before" text={offer.fromNdaText} />}
            {offer.ndaText && <NdaBox id={`offer-${offer.id}-nda-offered`} label="Offered" text={offer.ndaText} />}
          </div>
        </details>
      )}
      {/* (Owner, Nov 5, §265; replaces §221 / §233 / §242's questions-changed block, before and after) An offer never carries questions: they follow the
          listing (each change is a "Questions changed" entry in Terms history). */}
      <div className="flex flex-wrap gap-2">
        <button className="btn" disabled={fin.done} onClick={() => decide("switch")}>Switch to the new terms</button>
        <button className="btn-ghost" disabled={fin.done} onClick={() => decide("keep")}>Keep my current terms</button>
      </div>
      <PressDone line={fin.line} />
      <ChangesBox side="tester" changes={box?.changes ?? null} tail={box?.tail} press={errPress || undefined} />
      <Err text={err} press={errPress} />
    </div>
  );
}


