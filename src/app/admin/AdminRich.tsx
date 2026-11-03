import { Fragment, type ReactNode } from "react";
import type { Rich } from "@/lib/rich";
import { ReasonQuote } from "@/components/ScrollText";
import { Cut } from "@/components/Cut";

/** An email in an admin line's words ("Nora Lane (nora.lane.long@playtest.test)"). */
const EMAIL = /[^\s()<>,;:"“”]+@[^\s()<>,;:"“”]+\.[^\s()<>,;:"“”.]+/g;

/** (Owner, Nov 3) The words of an admin line with each email cut in the middle (the full email on hover, on a tap and when copied). */
function withEmails(s: string) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of s.matchAll(EMAIL)) {
    if (m.index! > last) out.push(s.slice(last, m.index));
    out.push(<Cut key={m.index} text={m[0]} kind="email" />);
    last = m.index! + m[0].length;
  }
  if (!out.length) return s;
  out.push(s.slice(last));
  return <>{out}</>;
}

/** (Owner, Nov 3) A link's words: a person's name, or a test's quoted title, cut at 10 characters (the full name on hover, on a tap and when copied). */
function linkWords(t: string, href: string) {
  if (/^\/app\/(developers|testers)\//.test(href)) return <Cut text={t} />;
  const q = /^“([\s\S]*)”$/.exec(t);
  if (q && /^\/app\/(find|tests)\//.test(href)) return <>“<Cut text={q[1]} kind="test" />”</>;
  return t;
}

/**
 * (Batch 33 §1) One admin line with its links: a profile or a test opens here; a Stripe Dashboard page opens in a new tab. (Batch 35 §43) A typed reason or note
 * shows in the small quoted box (a block: the line's container is a <div> or <li>, never a <p>). (Owner, Nov 3) Names, test titles and emails are cut (Cut).
 */
export function AdminRich({ parts }: { parts: Rich }) {
  return (
    <>
      {parts.map((s, i) =>
        typeof s === "string" ? (
          <Fragment key={i}>{withEmails(s)}</Fragment>
        ) : "q" in s ? (
          <ReasonQuote key={i} text={s.q} className="mt-0.5 text-sm" />
        ) : s.ext ? (
          <a key={i} href={s.href} target="_blank" rel="noopener noreferrer" data-stripe-link="">{s.t}</a>
        ) : (
          <a key={i} href={s.href}>{linkWords(s.t, s.href)}</a>
        ),
      )}
    </>
  );
}
