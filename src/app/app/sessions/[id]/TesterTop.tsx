"use client";
import { useEffect, useState } from "react";
import { ChangesBox, type Change } from "@/components/ChangesBox";
import { api } from "@/lib/client";
import { topStop } from "@/lib/topStop";

/** The top of the tester's session page: new terms offered (Switch / Keep) and the stop-once box for Send / Charge. */
export function TesterTop({ sessionId, seenAt, offer, devName }: { sessionId: string; seenAt: string; offer: { id: string; diff: string } | null; devName: string }) {
  const [box, setBox] = useState<{ changes: Change[]; tail: string } | null>(null);
  const [offerId, setOfferId] = useState(offer?.id ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail as { changes: Change[]; tail?: string; offerId?: string };
      setBox({ changes: d.changes, tail: d.tail ?? "Press again to go ahead." });
      if (d.offerId) setOfferId(d.offerId);
    };
    window.addEventListener("tester-top", on);
    return () => window.removeEventListener("tester-top", on);
  }, []);
  const decide = (choice: string) =>
    api(`/api/sessions/${sessionId}/terms`, { offerId, choice, seenAt, confirmed })
      .then(() => window.location.reload())
      .catch((e) => {
        if (topStop(e)) setConfirmed(true);
        else setErr((e as Error).message);
      });
  return (
    <div className="space-y-2">
      {offer && (
        <div className="info space-y-2">
          <p>
            {devName} updated the listing: {offer.diff}.
          </p>
          <p className="text-xs">Switching applies to work you send from now on; work you&apos;ve already sent keeps its price. Your deadline never moves earlier.</p>
          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={() => decide("switch")}>Switch to the new terms</button>
            <button className="btn-ghost" onClick={() => decide("keep")}>Keep my current terms</button>
          </div>
          {err && <p className="err">{err}</p>}
        </div>
      )}
      {box && <ChangesBox changes={box.changes} tail={box.tail} />}
    </div>
  );
}
