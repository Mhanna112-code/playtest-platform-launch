import type { ReactNode } from "react";

/** About 4 rows of the dashboard's row cards; about 2 rows of the developer's test cards (one column of about 3 on phones). */
const HEIGHT = { rows: "max-h-[22rem]", lines: "max-h-56", cards: "max-h-[54rem] md:max-h-[38rem]", /** (batch 24 section 1) about 3 short rows (stacked on phones) */ three: "max-h-[21rem] sm:max-h-[13rem]" } as const;

/**
 * (Owner, Oct 28, batch 16 section 14) Every list panel on the dashboards and the developer profile's "Open tests": everything in the list (no "Show N more",
 * no pages, no cut-off), in a plain scroll box. A short list shows without a scroll bar (the box only scrolls when it overflows). The heading, filters, chips
 * and search boxes sit above it, outside the box, so they never scroll away. (Blue boxes keep LongList's "3 lines, then Show N more".)
 */
export function ScrollList({ children, className = "space-y-2", size = "rows", as: Tag = "ul", label }: { children: ReactNode; className?: string; size?: keyof typeof HEIGHT; as?: "ul" | "div"; label?: string }) {
  return (
    <Tag className={`${className} ${HEIGHT[size]} overflow-y-auto pr-1`} data-scroll-list={size} aria-label={label}>
      {children}
    </Tag>
  );
}
