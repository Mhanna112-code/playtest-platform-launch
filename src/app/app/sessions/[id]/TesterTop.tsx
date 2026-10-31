"use client";
import { Err } from "@/components/Err";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { jumpTo } from "@/lib/markJump";
import { ANSWER_TERMS_EVENT } from "@/lib/answerTerms";
import { ChangesBox } from "@/components/ChangesBox";
import { NdaBox } from "@/components/NdaBox";
import { QuestionList } from "@/components/QuestionList";
import { FieldLabel, FieldValue } from "@/components/FieldLines";
import { api, errOf } from "@/lib/client";
import { stopBox, useStopBox, type StopBox } from "@/lib/topStop";

/** (Batch 35 §29) An offered question as the lists show it: its text, and whether it's required (a small tag). */
type OfferQuestion = { text: string; required?: boolean };

/** New terms offered (Switch / Keep). Its stop-once box and refusals show directly under these buttons. */
export function TesterTop({ sessionId, seenAt, offer, devName }: { sessionId: string; seenAt: string; offer: { id: string; diff: string; ndaText?: string; fromNdaText?: string; questions?: OfferQuestion[]; fromQuestions?: OfferQuestion[]; answers?: string[]; switchNote?: string } | null; devName: string }) {
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
    <div id="terms-offer" className="info scroll-mt-24 space-y-2 transition-shadow data-[marked]:ring-2 data-[marked]:ring-sky-300">
      <p>
        {devName} updated the listing: {offer.diff}.
      </p>
      <p className="text-xs">Switching applies to work you send from now on; work you&apos;ve already sent keeps its price. Your deadline never moves earlier.</p>
      {offer.ndaText != null && offer.ndaText !== (offer.fromNdaText ?? "") && (
        <details className="text-sm" open>
          <summary className="cursor-pointer font-medium">{offer.ndaText ? "The NDA" : "The NDA is removed"}{offer.fromNdaText ? " (changed)" : ""}: switching means you accept it</summary>
          {/* (Batch 13 section 9) "Before" and "Offered" as two scroll boxes, never in full. */}
          <div className="mt-1 space-y-2">
            {offer.fromNdaText && <NdaBox label="Before" text={offer.fromNdaText} />}
            {offer.ndaText && <NdaBox label="Offered" text={offer.ndaText} />}
          </div>
        </details>
      )}
      {offer.questions && offer.fromQuestions && JSON.stringify(offer.questions) !== JSON.stringify(offer.fromQuestions) && (
        <details className="text-sm" open>
          <summary className="cursor-pointer font-medium">The questions changed: before and after</summary>
          {/* (Owner, Oct 31, batch 35 §29) As the Listing panel (§15): each list under its own small uppercase label, numbered, Required as a small tag. */}
          <div className="mt-1 text-xs text-sky-200/80"><FieldLabel>Before</FieldLabel><FieldValue><QuestionList numbered items={offer.fromQuestions} /></FieldValue></div>
          <div className="mt-1"><FieldLabel>After</FieldLabel><FieldValue><QuestionList numbered items={offer.questions} /></FieldValue></div>
          {offer.answers && offer.answers.some(Boolean) && <p className="mt-1 whitespace-pre-wrap text-xs text-sky-200/80">Your answers so far: {offer.answers.filter(Boolean).join(" / ")}</p>}
          {offer.switchNote && <p className="mt-1" data-switch-questions="">{offer.switchNote}</p>}
        </details>
      )}
      <div className="flex flex-wrap gap-2">
        <button className="btn" onClick={() => decide("switch")}>Switch to the new terms</button>
        <button className="btn-ghost" onClick={() => decide("keep")}>Keep my current terms</button>
      </div>
      <ChangesBox side="tester" changes={box?.changes ?? null} tail={box?.tail} />
      <Err text={err} />
    </div>
  );
}
