"use client";
import { Err } from "@/components/Err";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { markOnly } from "@/lib/markJump";
import { ANSWER_TERMS_EVENT, NO_LONGER_ON_OFFER } from "@/lib/answerTerms";
import { ChangesBox } from "@/components/ChangesBox";
import { api, errOf } from "@/lib/client";
import { pressLabelOf } from "@/lib/pressLabels";
import { OFFER_LOAD_EVENT, stopBox, useStopBox } from "@/lib/topStop";
import { useFinished } from "@/lib/usePress";
import { PressDone } from "@/components/PressDone";


/**
 * New terms offered (Switch / Keep). Its stop-once line and refusals show directly under these buttons. (Owner, Dec 10 2026) Its own stop ("… changed the
 * terms again") is the one line under the buttons, "Your Switch to the new terms didn't go through: check the updates at the top. Press again to go ahead.", the
 * change in the top box (ChangesBox, lib/stopLine.ts). Another press's stop naming new terms (Leave, Rate) keeps its line under ITS button: nothing moves here.
 * (Batch 35 §40, §41) Switch / Keep change the terms every part of the page is built on, so the page loads again, keeping its place (a "#…" in the address is
 * dropped first); until then both buttons stay greyed with the result line.
 */
export function TesterTop({ sessionId, seenAt, offer, devName }: { sessionId: string; seenAt: string; offer: { id: string; diff: string } | null; devName: string }) {
  const [box, setBox] = useStopBox();
  const [offerId, setOfferId] = useState(offer?.id ?? "");
  // (Owner) When the box was made: the next press goes ahead only if nothing new happened since.
  const [boxAt, setBoxAt] = useState("");
  const confirmed = !!boxAt;
  const [err, setErr] = useState("");
  // (§156) Named by the button pressed: "Switch to the new terms" or "Keep my current terms".
  const [errPress, setErrPress] = useState("");
  // The offer this box's refusal, stop-once box and box time are about (the one shown, or the newest one a stop-once box moved it to).
  const aboutOffer = useRef(offer?.id ?? "");
  // Whether Switch or Keep was pressed in this box for the offer it is about.
  const pressed = useRef(false);
  // (Owner, Oct 28, batch 16 section 38A) The offer can arrive while the page is open (a refresh brings it): Switch / Keep always send the offer shown now.
  // (Owner, Dec 10 2026) A DIFFERENT offer starts clean: the last offer's refusal ("These terms are no longer on offer.") never shows under the new buttons,
  // and its box time never makes the next press a second press (which would switch to terms the page never showed, skipping "changed the terms again").
  useEffect(() => {
    if (!offer?.id) {
      // (Owner, Dec 10 2026) The offer was withdrawn (the listing is back to her terms) after she pressed: no "changed the terms" box and no "See the new
      // terms" (there are none); the one line "Your Switch to the new terms didn't go through: These terms are no longer on offer." stays until the page
      // reloads or a new offer arrives.
      if (aboutOffer.current && pressed.current) {
        setBox(null);
        setBoxAt("");
        setErr(NO_LONGER_ON_OFFER);
      }
      aboutOffer.current = "";
      return;
    }
    setOfferId(offer.id);
    if (offer.id !== aboutOffer.current) {
      setErr("");
      setErrPress("");
      setBox(null); // (Owner, Dec 10 2026) the only box here is Switch / Keep's own (another press's stays under its button)
      setBoxAt("");
      pressed.current = false;
    }
    aboutOffer.current = offer.id;
  }, [offer?.id, setBox]);
  const fin = useFinished();
  // (Owner, Oct 29, batch 27 section 1) A Send or call press while an offer is open: its line "Answer the new terms first: Switch or Keep at the top of the
  // page." under the pressed button. (Owner, Dec 10 2026; replaces "the page goes up to this box") The page stays where it is: this box is only marked a
  // moment (its ring, no scroll). A page that doesn't show the offer yet (the server refused it) loads it, and marks it once it shows.
  const router = useRouter();
  const pending = useRef(false);
  // (Owner, Dec 10 2026; replaces "another press's box shows here") Another press's stop that names new terms (Leave, Rate): its line stays under its button
  // and the change goes to the top box; a page that doesn't show the offer yet loads it at once, so Switch / Keep appears right away.
  useEffect(() => {
    const on = () => {
      if (!document.getElementById("terms-offer")) router.refresh();
    };
    window.addEventListener(OFFER_LOAD_EVENT, on);
    return () => window.removeEventListener(OFFER_LOAD_EVENT, on);
  }, [router]);
  useEffect(() => {
    const on = () => {
      if (document.getElementById("terms-offer")) {
        markOnly("terms-offer");
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
    setTimeout(() => markOnly("terms-offer"), 30);
  }, [offer?.id]);
  // No offer on the page: her withdrawn offer's one line (kept when the buttons went).
  if (!offer) return box ? <ChangesBox side="tester" changes={box.changes} tail={box.tail} press={errPress || undefined} /> : err ? <Err text={err} press={errPress} /> : null;
  const decide = (choice: string) => {
    pressed.current = true;
    setErrPress(pressLabelOf(`/api/sessions/${sessionId}/terms`, { choice }));
    setErr(""); // (Owner, Dec 10 2026) one outcome per press: an earlier refusal goes
    setBox(null); // (Owner, Dec 10 2026) and so does the stop line: clear, then the new outcome (the box's time still makes this the second press)
    return api(`/api/sessions/${sessionId}/terms`, { offerId, choice, seenAt, confirmed, boxAt })
      .then(() => { setBox(null); fin.finish(choice === "switch" ? "Switched to the new terms." : "Kept your current terms.", { reload: true }); })
      .catch((e) => {
        const sb = stopBox(e);
        if (sb) {
          setBox(sb);
          setBoxAt(sb.now);
          const next = (e as { data?: { offerId?: string } }).data?.offerId;
          if (next) { setOfferId(next); aboutOffer.current = next; } // the box is about the newest offer now: its arrival on the page keeps the box
        } else setErr(errOf(e));
      });
  };
  return (
    <div id="terms-offer" className="info scroll-mt-24 space-y-2 transition-shadow data-[marked]:ring-2 data-[marked]:ring-sky-300">
      <p>
        {devName} updated the listing: {offer.diff}.
      </p>
      <p className="text-xs"><a className="underline" href="/terms#editing-a-test" target="_blank" rel="noreferrer">How Switch or Keep affects your work and prices</a></p>
      {/* (Owner, Nov 5, §267; replaces batch 13 §9's NDA Before / Offered here) An offer never carries the NDA: it follows the listing, with its own notice. */}
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


