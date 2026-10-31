"use client";
import { useEffect, useState } from "react";
import { ArrowLeftRight } from "lucide-react";

/**
 * (Owner, Oct 30, batch 34 §5) A page of the account's other side shows only this, instead of the page: "This page is on your tester side." with the
 * button "Switch to your tester side", a POST to /app/switch (the only thing besides the Account page's button that changes sides) that then opens the
 * page. Opening the page never changes the side. `next` is the page's address; the browser adds the #part it was opened at (the server never sees it).
 */
export function OtherSidePage({ side, next }: { side: "developer" | "tester"; next: string }) {
  const [to, setTo] = useState(next);
  useEffect(() => {
    const here = window.location.pathname + window.location.search.replace(/([?&])_rsc=[^&]*&?/, "$1").replace(/[?&]$/, "") + window.location.hash;
    if (here.startsWith("/app")) setTo(here);
  }, []);
  return (
    <section className="card mx-auto max-w-xl space-y-3 text-center" data-other-side-page={side}>
      <p className="text-slate-200">This page is on your {side} side.</p>
      <form method="post" action="/app/switch" className="flex justify-center">
        <input type="hidden" name="to" value={side} />
        <input type="hidden" name="next" value={to} />
        <button type="submit" className="btn"><ArrowLeftRight className="h-4 w-4" /> Switch to your {side} side</button>
      </form>
    </section>
  );
}
