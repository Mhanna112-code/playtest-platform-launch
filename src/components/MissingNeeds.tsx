"use client";
import { useState } from "react";
import { orList, type Gaps } from "@/lib/gaps";
import { TAG_NAMES } from "@/lib/inviteRows";

/**
 * (Owner, Oct 28, batch 20 section 3) A device or language list in a missing-needs line: up to 3 in full ("Chinese or Portuguese"); a longer one is cut to its
 * first 3 with "+N more", which opens the rest in place (like the row tags' "+7 more" / "fewer").
 */
export function OrList({ items }: { items: string[] }) {
  const [all, setAll] = useState(false);
  if (items.length <= TAG_NAMES) return <>{orList(items)}</>;
  return (
    <span data-plus-more={all ? "open" : "closed"}>
      {all ? orList(items) : items.slice(0, TAG_NAMES).join(", ")}
      <button type="button" className="btn-ghost ml-1 !px-1.5 !py-0 text-xs" aria-expanded={all} onClick={() => setAll(!all)}>{all ? "fewer" : `+${items.length - TAG_NAMES} more`}</button>
    </span>
  );
}

/** "doesn't list a language this test needs (Chinese or Portuguese) or a device it needs (Windows PC, Switch, VR headset +5 more)" (the words of missingNeedText). */
export function MissingNeedWords({ g }: { g: Gaps }) {
  if (g.languages.length && g.devices.length) return <>doesn&apos;t list a language this test needs (<OrList items={g.languages} />) or a device it needs (<OrList items={g.devices} />)</>;
  if (g.languages.length) return <>doesn&apos;t list a language this test needs (<OrList items={g.languages} />)</>;
  if (g.devices.length) return <>doesn&apos;t list a device this test needs (<OrList items={g.devices} />)</>;
  return null;
}
