import React, { Fragment, type ComponentType, type ReactNode } from "react";
import { keepAmounts } from "@/components/Amounts";
import { mergeLinks, splitLinks, type LineLink } from "@/lib/lineLinks";

export type { LineLink } from "@/lib/lineLinks";

/** (Owner, Nov 5, §270) The green of every name and test link in a line (as TestName / NameLink: the app's link green), the same for people and tests. */
export const LINE_LINK_CLASS = "text-volt-300 hover:underline";

type AnchorProps = { href: string; className?: string; onClick?: () => void; children?: ReactNode; target?: string; rel?: string } & Record<`data-${string}`, string>;
export type LineLinkOptions = {
  /** (§270, part 2) The row's own place: the words that aren't a name link there, side by side with the name links (never nested). */
  rest?: string | null;
  /** the look of the rest's link (the bell's bold / read colours; a payment row's "hover:underline") */
  restClass?: string;
  /** every piece's press (the bell's mark-as-read, whichever piece is clicked) */
  onClick?: () => void;
  /** how a plain piece is drawn (amounts kept whole by default) */
  draw?: (t: string) => ReactNode;
  /** test links open in a new tab (the confirm rows, as withTestLinks did) */
  newTab?: boolean;
  /** the anchor to draw with (the bell: next/link, so mark-as-read finishes before the page changes) */
  Anchor?: ComponentType<AnchorProps> | "a";
};

/**
 * (Owner, Nov 5, §270) A line with every person and test it names as its own green link (`links`, sent by the server with the line): a person opens their profile,
 * a test opens the developer's test page or the tester's session (or the public page). A name the 50 cut ended with "…" keeps its visible start linked. With
 * `rest`, the other words link to the row's exact place, beside the name links. A deleted account and "You" are never in `links`, so they stay plain.
 */
export function withLineLinks(text: string, links: LineLink[] | undefined | null, opts: LineLinkOptions = {}): ReactNode {
  const draw = opts.draw ?? keepAmounts;
  const A = (opts.Anchor ?? "a") as ComponentType<AnchorProps>;
  const pieces = splitLinks(text, links);
  const rest = (t: string, key: number | string) =>
    opts.rest ? <A key={key} href={opts.rest} className={opts.restClass} onClick={opts.onClick} data-line-rest="">{draw(t)}</A> : <Fragment key={key}>{draw(t)}</Fragment>;
  if (pieces.length === 1 && !pieces[0].link) return opts.rest ? rest(text, 0) : draw(text);
  return (
    <>
      {pieces.map((p, i) => p.link
        ? <A key={i} href={p.link.href} className={LINE_LINK_CLASS} onClick={opts.onClick} data-line-link={p.link.kind} {...(opts.newTab && p.link.kind === "test" ? { target: "_blank", rel: "noreferrer" } : {})}>{p.t}</A>
        : rest(p.t, i))}
    </>
  );
}

/** (§270) For a `render` prop: a line's links, plus what it already drew (the confirm rows' quoted test names). */
export const lineRender = (links: LineLink[] | undefined | null, opts: LineLinkOptions = {}) => (t: string) => withLineLinks(t, links, opts);


/** (§270) A line's links with the older `tests` lists ({ name, href }: the confirm rows' quoted test names, maybe cut "…") folded in. */
export const withTests = (links: LineLink[] | undefined | null, tests?: { name: string; href: string }[] | null): LineLink[] =>
  mergeLinks(links, tests?.map((t) => ({ text: t.name, href: t.href, kind: "test" as const })));
