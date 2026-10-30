import { Fragment } from "react";
import type { Rich } from "@/lib/rich";

/** (Batch 33 §1) One admin line with its links: a profile or a test opens here; a Stripe Dashboard page opens in a new tab. */
export function AdminRich({ parts }: { parts: Rich }) {
  return (
    <>
      {parts.map((s, i) =>
        typeof s === "string" ? (
          <Fragment key={i}>{s}</Fragment>
        ) : s.ext ? (
          <a key={i} href={s.href} target="_blank" rel="noopener noreferrer" data-stripe-link="">{s.t}</a>
        ) : (
          <a key={i} href={s.href}>{s.t}</a>
        ),
      )}
    </>
  );
}
