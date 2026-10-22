"use client";
import { useEffect, useRef } from "react";

export type Change = { text: string; at: string; kind?: string };

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/**
 * The stop-once box (and any refusal): a blue notice placed directly under the button that was pressed, scrolled into
 * view. Lists exactly what changed since the page loaded, then "Press again to go ahead."
 */
export function ChangesBox({ changes, error, tail = "Press again to go ahead." }: { changes: Change[] | null; error?: string; tail?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if ((changes || error) && ref.current) ref.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [changes, error]);
  if (!changes && !error) return null;
  if (!changes && error && error.startsWith("\u0001")) return <p ref={ref as unknown as React.RefObject<HTMLParagraphElement>} className="err-field basis-full">{error.slice(1)}</p>;
  return (
    <div ref={ref} className="info basis-full" role="status" aria-live="polite">
      {changes && (
        <>
          <p className="font-medium">Since you opened this page:</p>
          <ul className="my-1 list-disc pl-5">
            {changes.map((c, i) => (
              <li key={i}>
                {c.text.startsWith("You also did this in another tab") ? `${c.text} at ${time(c.at)}` : `${c.text} · ${time(c.at)}`}
              </li>
            ))}
          </ul>
          <p>{tail}</p>
        </>
      )}
      {error && <p>{error}</p>}
    </div>
  );
}
