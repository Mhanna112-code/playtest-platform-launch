"use client";
import { Err } from "@/components/Err";
import { useEffect, useState } from "react";
import { api, ApiError, errOf } from "@/lib/client";
import { ANSWER_TERMS_CODE } from "@/lib/answerTerms";
import { NDA_BLOCK_CODE, ndaNoticeHref } from "@/lib/ndaNotice";
import { ChangesBox } from "@/components/ChangesBox";
import { useStopOnce } from "@/lib/useStopOnce";

/**
 * Join call: opens the room, or shows why not (blue, under the button). (Owner, Oct 27) Checked live: the button disappears when the call is cancelled; checked on press: a press
 * after a cancellation shows "This call was cancelled" with the reason under Join.
 */
export function JoinCall({ callId, seenAt }: { callId: string; /** (§271) the page's load time (else the one PageLoaded noted) */ seenAt?: string }) {
  const [err, setErr] = useState("");
  // (Owner, Nov 5, §271) A pause since the page loaded, or the team's lift of it, stops Join once (its box under the button); the next press opens the room.
  const stop = useStopOnce(seenAt);
  const [gone, setGone] = useState(false);
  // (Owner, Oct 29, batch 29 section 20) Refused for open new terms away from the session page (the tester dashboard's Upcoming calls): a way to the offer
  // (a full page load, so HashJump brings the Switch / Keep box into view, highlighted).
  const [termsAt, setTermsAt] = useState("");
  // (Owner, Nov 6, §302) The NDA notice to go to, the same way (Join call away from its session page).
  const [ndaAt, setNdaAt] = useState("");
  useEffect(() => {
    let alive = true;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      const r = await fetch(`/api/calls/${callId}/status`, { cache: "no-store" }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (alive && r && (r.cancelled || r.capped)) setGone(true); // (batch 18 section 3) ended at the $500: Join goes too
    };
    const t = setInterval(check, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [callId]);
  // (Batch 15 section 38) A stale Join was refused because the call was cancelled: the refusal stays, the button leaves (the row follows with the page's live update).
  if (gone) return err ? <span className="inline-flex flex-col gap-1" data-join-call="gone"><Err text={err} press="Join call" /></span> : null;
  return (
    <span className="inline-flex flex-col gap-1" data-join-call="">
      <button
        className="btn-ghost"
        onClick={async () => {
          setErr("");
          setTermsAt("");
          setNdaAt("");
          try {
            const r = await api<{ url: string }>(`/api/calls/${callId}/join`, stop.marks());
            stop.clear();
            window.open(r.url, "_blank");
          } catch (e) {
            if (stop.stopped(e)) return;
            stop.clear();
            setErr(errOf(e));
            if (e instanceof ApiError && e.data.cancelled === true) setGone(true);
            if (e instanceof ApiError && e.code === ANSWER_TERMS_CODE && typeof e.data.sessionId === "string" && window.location.pathname !== `/app/sessions/${e.data.sessionId}`) setTermsAt(`/app/sessions/${e.data.sessionId}#terms-offer`);
            // (Owner, Nov 6, §302) An NDA change not yet acknowledged, the same way: to the NDA notice there.
            if (e instanceof ApiError && e.code === NDA_BLOCK_CODE && typeof e.data.sessionId === "string" && window.location.pathname !== `/app/sessions/${e.data.sessionId}`) setNdaAt(ndaNoticeHref(e.data.sessionId));
          }
        }}
      >
        Join call
      </button>
      <ChangesBox changes={stop.box} press="Join call" />
      <Err text={err} press="Join call" />
      {termsAt && err && <a href={termsAt} className="text-sm" data-answer-terms-link="">Answer them on the session page →</a>}
      {ndaAt && err && <a href={ndaAt} className="text-sm" data-nda-link="">Acknowledge it on the session page →</a>}
    </span>
  );
}
