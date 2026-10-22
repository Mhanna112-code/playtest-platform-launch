"use client";
import { Err } from "@/components/Err";
import { useEffect, useState } from "react";
import { ChangesBox } from "@/components/ChangesBox";
import { api, errOf } from "@/lib/client";
import { stopBox, useStopBox, type StopBox } from "@/lib/topStop";

/** New terms offered (Switch / Keep). Its stop-once box and refusals show directly under these buttons. */
export function TesterTop({ sessionId, seenAt, offer, devName }: { sessionId: string; seenAt: string; offer: { id: string; diff: string } | null; devName: string }) {
  const [box, setBox] = useStopBox();
  const [offerId, setOfferId] = useState(offer?.id ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    const on = (e: Event) => setBox((e as CustomEvent).detail as StopBox);
    window.addEventListener("tester-top", on);
    return () => window.removeEventListener("tester-top", on);
  }, []);
  if (!offer)
    return box ? (
      <div className="space-y-2">
        <ChangesBox changes={box.changes} tail={box.tail} />
        <button className="btn-ghost" onClick={() => window.location.reload()}>See the new terms</button>
      </div>
    ) : null;
  const decide = (choice: string) =>
    api(`/api/sessions/${sessionId}/terms`, { offerId, choice, seenAt, confirmed })
      .then(() => window.location.reload())
      .catch((e) => {
        const sb = stopBox(e);
        if (sb) {
          setBox(sb);
          setConfirmed(true);
          const next = (e as { data?: { offerId?: string } }).data?.offerId;
          if (next) setOfferId(next);
        } else setErr(errOf(e));
      });
  return (
    <div className="info space-y-2">
      <p>
        {devName} updated the listing: {offer.diff}.
      </p>
      <p className="text-xs">Switching applies to work you send from now on; work you&apos;ve already sent keeps its price. Your deadline never moves earlier.</p>
      <div className="flex flex-wrap gap-2">
        <button className="btn" onClick={() => decide("switch")}>Switch to the new terms</button>
        <button className="btn-ghost" onClick={() => decide("keep")}>Keep my current terms</button>
      </div>
      <ChangesBox changes={box?.changes ?? null} tail={box?.tail} />
      <Err text={err} />
    </div>
  );
}
