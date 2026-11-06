"use client";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/client";
import { jumpTo } from "@/lib/markJump";
import { NDA_CHANGED, ndaBlockParts } from "@/lib/ndaNotice";

/** (§267) Open the notice: record it as seen, bring the NDA line (`#info-nda` in "The listing information") into view and mark it, then redraw (the block lifts). */
export async function openNdaNotice(sessionId: string, router?: { refresh(): void }) {
  await api(`/api/sessions/${sessionId}/nda-seen`, {}).catch(() => null);
  jumpTo("info-nda");
  router?.refresh();
}

/**
 * (Owner, Nov 5, batch 35 §267) The NDA's own notice at the top of the tester's session page while it hasn't been opened: "<developer> changed the NDA", its
 * "changed the NDA" a link to the NDA line. While an added or removed NDA blocks their presses, the banner reads "<developer> added an NDA to this test: read it
 * before you go on" ("removed the NDA from this test: see the change before you go on"), with the link. Opening it (here, from the bell's link, which arrives
 * with `?nda=open`, or from a refusal's link) records it as seen.
 */
export function NdaNotice({ sessionId, dev, kind, open, block }: { sessionId: string; dev: string; kind: string; open: boolean; block: boolean }) {
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    // The bell's link (and a refusal's): the page opened with ?nda=open.
    if (typeof window === "undefined" || new URLSearchParams(window.location.search).get("nda") !== "open") return;
    window.history.replaceState(null, "", `${path}#info-nda`);
    void openNdaNotice(sessionId, router);
  }, [sessionId, path, router]);
  if (!open) return null;
  const link = (text: string) => <a href="#info-nda" data-nda-link="" onClick={(e) => { e.preventDefault(); void openNdaNotice(sessionId, router); }}>{text}</a>;
  if (block) {
    const p = ndaBlockParts(dev, kind);
    return <p className="info" data-nda-block={kind}>{p.before}{link(p.link)}{p.after}</p>;
  }
  return <p className="info" data-nda-notice={kind}>{dev} {link(NDA_CHANGED)}</p>;
}
