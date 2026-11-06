"use client";
import { Err } from "@/components/Err";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api, errOf } from "@/lib/client";
import { jumpTo } from "@/lib/markJump";
import { NDA_INFO } from "@/lib/lineAnchors";
import { NDA_ACK_PRESS, NDA_BLOCK_EVENT, NDA_NOTICE, ndaNoticeLine } from "@/lib/ndaNotice";

/**
 * (Owner, Nov 5, batch 35 §267; Nov 6, §302) The NDA's one notice at the top of the tester's session page until it's acknowledged: "<developer> changed the NDA.
 * Click here to acknowledge you've seen the change." (the same words whether it was added, removed or changed; `kind` is kept on data-*), the line a link to the NDA in "The listing information" (`#info-nda`: it comes
 * into view, marked; navigation only), with ONE button, "Acknowledge", which records it (an added NDA counts as accepted) and lifts the block at once. No separate
 * banner. While it blocks (`block`: every NDA change, the tester still working), a refused press brings the page up to it, marked, as an open offer brings it up
 * to Switch / Keep (a page that doesn't show it yet loads it first).
 * (Owner, Nov 6, §314) No Acknowledge button and no separate link: the notice is ONE clickable line, "<dev> changed the NDA. Click here to acknowledge you've seen
 * the change." (a real link, keyboard and screen-reader reachable: Enter or Space). Pressing anywhere on it acknowledges (lifts the block), the line goes from the page
 * at once (recorded: a reload doesn't bring it back) and the page goes to the NDA in the agreed scope. Pending while it's sent (a second press does nothing); a failed
 * press shows its line under it. A later NDA change brings a new notice (the page keys it by the change's time), only ever one, for the latest change.
 */
export function NdaNotice({ sessionId, dev, kind, open, block }: { sessionId: string; dev: string; kind: string; open: boolean; block: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const [busy, setBusy] = useState(false);
  const sending = useRef(false); // (§314) a double press sends once
  const [gone, setGone] = useState(false); // (§314) acknowledged here: the notice leaves the page at once
  const [err, setErr] = useState("");
  // (§302) An older link that still carries `?nda=open` (§267's bells): navigation only now, to the notice (the NDA line once acknowledged).
  useEffect(() => {
    if (typeof window === "undefined" || new URLSearchParams(window.location.search).get("nda") !== "open") return;
    window.history.replaceState(null, "", `${path}#${NDA_NOTICE}`);
    setTimeout(() => jumpTo(document.getElementById(NDA_NOTICE) ? NDA_NOTICE : NDA_INFO), 30);
  }, [path]);
  // (§302) A press refused for the NDA (here, or by the server): up to the notice, marked, every time.
  const pending = useRef(false);
  useEffect(() => {
    const on = () => {
      if (document.getElementById(NDA_NOTICE)) {
        setTimeout(() => jumpTo(NDA_NOTICE), 30);
        return;
      }
      pending.current = true;
      router.refresh();
    };
    window.addEventListener(NDA_BLOCK_EVENT, on);
    return () => window.removeEventListener(NDA_BLOCK_EVENT, on);
  }, [router]);
  useEffect(() => {
    if (!open || !pending.current) return;
    pending.current = false;
    setTimeout(() => jumpTo(NDA_NOTICE), 30);
  }, [open]);
  // A newer NDA change after one acknowledged here: its notice shows again.
  useEffect(() => {
    if (!open) {
      setGone(false);
      sending.current = false;
      setBusy(false);
    }
  }, [open]);
  if (!open || gone) return null;
  const acknowledge = () => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setErr("");
    api(`/api/sessions/${sessionId}/nda-seen`, {})
      .then(() => {
        setGone(true);
        router.refresh();
        setTimeout(() => jumpTo(NDA_INFO), 60);
      })
      .catch((x) => { setErr(errOf(x)); sending.current = false; setBusy(false); });
  };
  return (
    <div id={NDA_NOTICE} className="info scroll-mt-24 space-y-1 transition-shadow data-[marked]:ring-2 data-[marked]:ring-sky-300" data-nda-notice={kind} data-session={sessionId} {...(block ? { "data-nda-block": kind } : {})}>
      <p className="min-w-0">
        <a href={`#${NDA_INFO}`} role="button" data-nda-ack="" {...(busy ? { "aria-disabled": true, "aria-busy": true, "data-pending": "" } : {})}
          onClick={(e) => { e.preventDefault(); acknowledge(); }}
          onKeyDown={(e) => { if (e.key === " ") { e.preventDefault(); acknowledge(); } }}>{ndaNoticeLine(dev)}</a>
      </p>
      <Err text={err} press={NDA_ACK_PRESS} />
    </div>
  );
}
