import { Fragment } from "react";
import type { Rich } from "@/lib/rich";
import { ReasonQuote } from "@/components/ScrollText";

/**
 * (Batch 33 §1) One admin line with its links: a profile or a test opens here; a Stripe Dashboard page opens in a new tab. (Batch 35 §43) A typed reason or note
 * shows in the small quoted box (a block: the line's container is a <div> or <li>, never a <p>).
 */
export function AdminRich({ parts }: { parts: Rich }) {
  return (
    <>
      {parts.map((s, i) =>
        typeof s === "string" ? (
          <Fragment key={i}>{s}</Fragment>
        ) : "q" in s ? (
          <ReasonQuote key={i} text={s.q} className="mt-0.5 text-sm" />
        ) : s.ext ? (
          <a key={i} href={s.href} target="_blank" rel="noopener noreferrer" data-stripe-link="">{s.t}</a>
        ) : (
          <a key={i} href={s.href}>{s.t}</a>
        ),
      )}
    </>
  );
}
