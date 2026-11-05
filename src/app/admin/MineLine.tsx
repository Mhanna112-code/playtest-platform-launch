"use client";
import { Cut } from "@/components/Cut";
import { Fragment } from "react";
import type { Rich } from "@/lib/rich";
import { ReasonQuote } from "@/components/ScrollText";
import { jumpTo } from "@/lib/markJump";
import type { MineVM } from "@/lib/server/adminLists";
import { AdminRich } from "./AdminRich";

/**
 * (Owner, Nov 2, batch 35 §118) A "Your actions" line jumps to that action's row on this console (its row in Tests you paused, or the account's row in
 * Suspensions), scrolled to and marked like the app's See it. Only when that row isn't on the page (not loaded in its list, or there is none) does it open the
 * test's or the person's page instead.
 */
export function goToMine(jump: string, away: string) {
  if (document.getElementById(jump)) jumpTo(jump);
  else window.location.assign(away);
}

export function MineLine({ m }: { m: MineVM }) {
  const parts: Rich = m.parts ?? [m.title, ` · ${m.dev} · ${m.why} · ${m.when}`];
  if (!m.jump) return m.parts ? <AdminRich parts={m.parts} /> : <>{m.testId ? <a href={`/app/find/${m.testId}`}>“<Cut text={m.title} kind="test" />”</a> : <span><Cut text={m.title} kind="test" /></span>} · <Cut text={m.dev} /> · {m.why} · {m.when}</>;
  const jump = m.jump;
  const fallback = m.href ?? (m.testId ? `/app/find/${m.testId}` : "/admin");
  return (
    <span
      className="cursor-pointer"
      data-mine-line={jump}
      onClick={(e) => {
        // (§237) A link, or the reason box's grip (dragging it ends in a click), doesn't jump.
        if ((e.target as HTMLElement).closest("a, [data-panel-grip]")) return;
        goToMine(jump, fallback);
      }}
    >
      {parts.map((s, i) =>
        typeof s === "string" ? (
          <Fragment key={i}>{s}</Fragment>
        ) : "q" in s ? (
          <ReasonQuote key={i} text={s.q} className="mt-0.5 text-sm" />
        ) : s.ext ? (
          <a key={i} href={s.href} target="_blank" rel="noopener noreferrer" data-stripe-link="">{s.t}</a>
        ) : (
          <a
            key={i}
            href={`#${jump}`}
            data-mine-jump={jump}
            data-away={s.href}
            onClick={(e) => {
              e.preventDefault();
              goToMine(jump, s.href);
            }}
          >
            {s.t}
          </a>
        ),
      )}
    </span>
  );
}
