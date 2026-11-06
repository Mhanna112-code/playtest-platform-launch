import React from "react";

/** A test named in a payment line: the name as the line shows it (maybe cut with "…") and its page. */
export type TestLink = { name: string; href: string };

/**
 * (Owner, Nov 2) The quoted test names in a payment line (“Harbor Run”, “chargechar…”) open that test's page in a new tab; the rest of the line stays text.
 * A name not in `tests` stays plain. (Owner, Nov 5, §245) Green, as every test name link.
 */
export function withTestLinks(text: string, tests: TestLink[] | undefined): React.ReactNode {
  if (!tests?.length) return text;
  const byName = new Map(tests.map((t) => [t.name, t.href]));
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(/“([^”]+)”/g)) {
    const href = byName.get(m[1]);
    if (!href) continue;
    out.push(text.slice(last, m.index));
    out.push(<a key={`${m.index}`} href={href} target="_blank" rel="noreferrer" className="text-volt-300 underline decoration-dotted hover:text-volt-200" data-test-link="">“{m[1]}”</a>);
    last = m.index! + m[0].length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}
