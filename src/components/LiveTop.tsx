"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { Change } from "@/components/ChangesBox";
import { announce, clearShown, setShown } from "@/lib/live";

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const key = (c: Change) => `${c.at}|${c.text}`;

/**
 * The live top notice (owner, NEWEST+3): one box at the top of the page listing every change since the page was opened
 * (new terms, payments, call changes, listing edits, your own actions in another tab), newest first, as the page's
 * 20-second refresh picks them up. Shown changes count as seen: the page's buttons then send a later "seen" marker.
 */
export function LiveTop({ scope, seenAt, every = 20_000, seeIt }: { scope: string; seenAt: string; every?: number; seeIt?: string }) {
  const [lines, setLines] = useState<Change[]>([]);
  const [hiddenUpTo, setHiddenUpTo] = useState("");
  const known = useRef(new Set<string>());
  const since = useRef(seenAt); // the page-open time: the list always covers everything since then
  const box = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);

  // Scroll once per page load, the first time the box gets an update. While someone is typing in a field, wait until
  // it loses focus (nothing typed or the cursor is ever lost).
  function scrollUp() {
    const go = () => setTimeout(() => box.current?.scrollIntoView({ block: "start", behavior: "smooth" }), 50);
    const el = document.activeElement;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.addEventListener("blur", go, { once: true });
    else go();
  }

  // A note from a press that went ahead just before the page reloaded ("Done. Also: the test was renamed ...").
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem("press-note");
      if (!raw) return;
      window.sessionStorage.removeItem("press-note");
      const n = JSON.parse(raw) as { text: string; at: string; path: string };
      if (Date.now() - new Date(n.at).getTime() < 60_000) setLines((old) => [...old, { text: n.text, at: n.at }]);
    } catch {
      // nothing to show
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const r = await api<{ changes: Change[]; now: string }>(`/api/live?scope=${encodeURIComponent(scope)}&since=${encodeURIComponent(since.current)}`).catch(() => null);
      if (!r || !alive) return;
      const added = r.changes.filter((c) => !known.current.has(key(c)));
      added.forEach((c) => known.current.add(key(c)));
      if (added.length) setLines((old) => [...old, ...added]);
      if (added.length && !scrolled.current) {
        scrolled.current = true;
        scrollUp();
      }
      setShown(scope, r.now);
      announce(added);
    };
    const t = setInterval(tick, every);
    const onTick = () => tick();
    window.addEventListener("live-tick", onTick);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("live-tick", onTick);
      clearShown(scope);
    };
  }, [scope, every]);

  const show = lines.filter((l) => !hiddenUpTo || new Date(l.at).toISOString() > hiddenUpTo).sort((a, b) => (a.at < b.at ? 1 : -1));
  if (!show.length) return null;
  return (
    <div ref={box} className="info flex items-start gap-3" role="status" aria-live="polite" data-live-top>
      <ul className="mr-auto space-y-0.5">
        {show.map((l) => (
          <li key={key(l)}>
            <b>Updated · {time(l.at)}:</b> {l.text}
            {l.kind === "info" && seeIt && (
              <>
                {" "}
                <a href={seeIt} onClick={() => setTimeout(() => (document.querySelector(seeIt) as HTMLDetailsElement | null)?.setAttribute("open", ""), 0)}>See it</a>
              </>
            )}
          </li>
        ))}
      </ul>
      <button className="btn-ghost text-xs" onClick={() => setHiddenUpTo(new Date(show[0].at).toISOString())}>Dismiss</button>
    </div>
  );
}
