"use client";
import { withLineLinks } from "@/components/LineLinks";
import { Err } from "@/components/Err";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api, errOf } from "@/lib/client";
import { jumpTo } from "@/lib/markJump";
import { NDA_INFO } from "@/lib/lineAnchors";
import { NDA_ACK_BUTTON, NDA_ACK_TAIL, NDA_BLOCK_EVENT, NDA_CHANGED, NDA_NOTICE } from "@/lib/ndaNotice";

/**
 * (Owner, Nov 5, batch 35 §267; Nov 6, §302) The NDA's one notice at the top of the tester's session page until it's acknowledged: "<developer> changed the NDA.
 * Click here to acknowledge you've seen the change." (the same words whether it was added, removed or changed; `kind` is kept on data-*), the line a link to the NDA in "The listing information" (`#info-nda`: it comes
 * into view, marked; navigation only), with ONE button, "Acknowledge", which records it (an added NDA counts as accepted) and lifts the block at once. No separate
 * banner. While it blocks (`block`: every NDA change, the tester still working), a refused press brings the page up to it, marked, as an open offer brings it up
 * to Switch / Keep (a page that doesn't show it yet loads it first).
 */
export function NdaNotice({ sessionId, dev, devHref, kind, open, block }: { sessionId: string; dev: string; /** (Owner, Nov 5, §270) the developer's profile: their name is a green link (none: a deleted account) */ devHref?: string | null; kind: string; open: boolean; block: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const [busy, setBusy] = useState(false);
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
  if (!open) return null;
  const who = devHref ? [{ text: dev, href: devHref, kind: "person" as const }] : [];
  const what = `${NDA_CHANGED}. ${NDA_ACK_TAIL}`; // "changed the NDA. Click here to acknowledge you've seen the change."
  // The line links to the NDA (the developer's name stays their own green link, §270: a link can't hold another).
  const toNda = (text: string) => <a href={`#${NDA_INFO}`} data-nda-link="" onClick={(e) => { e.preventDefault(); jumpTo(NDA_INFO); }}>{text}</a>;
  const acknowledge = () => {
    setBusy(true);
    setErr("");
    api(`/api/sessions/${sessionId}/nda-seen`, {})
      .then(() => router.refresh())
      .catch((e) => { setErr(errOf(e)); setBusy(false); });
  };
  return (
    <div id={NDA_NOTICE} className="info scroll-mt-24 space-y-1 transition-shadow data-[marked]:ring-2 data-[marked]:ring-sky-300" data-nda-notice={kind} data-session={sessionId} {...(block ? { "data-nda-block": kind } : {})}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0">{devHref ? <>{withLineLinks(dev, who, { draw: (t) => t })} {toNda(what)}</> : toNda(`${dev} ${what}`)}</p>
        <button type="button" className="btn-secondary !px-2 !py-1 text-xs" disabled={busy} onClick={acknowledge} data-nda-ack="">{NDA_ACK_BUTTON}</button>
      </div>
      <Err text={err} press={NDA_ACK_BUTTON} />
    </div>
  );
}
