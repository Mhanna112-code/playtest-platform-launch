"use client";
import { useEffect, useRef } from "react";
import { ResendConfirm } from "@/components/ResendConfirm";
import { markShownInBox } from "@/lib/live";
import { bringInView, jumpTo } from "@/lib/markJump";
import { LongList } from "@/components/LongList";
import { QuickIgnore } from "@/components/QuickIgnore";

export type Change = { text: string; at: string; kind?: string; alert?: string; ignored?: boolean; contract?: string };

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/**
 * The stop-once box (and any refusal): a blue notice placed directly under the button that was pressed, scrolled into
 * view. Lists exactly what changed since the page loaded, then "Press again to go ahead."
 */
export function ChangesBox({ changes, error, tail = "Press again to go ahead.", link, didntGo = false }: { changes: Change[] | null; error?: string; tail?: string; link?: string; didntGo?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (changes) markShownInBox(changes); // seen: the top box lists them quietly, without its scroll
    if (changes || error) bringInView(ref.current);
  }, [changes, error]);
  if (!changes && !error) return null;
  if (!changes && error && error.startsWith("\u0001")) return <p ref={ref as unknown as React.RefObject<HTMLParagraphElement>} className="err-field basis-full">{error.slice(1)}</p>;
  return (
    <div ref={ref} className="info basis-full" role="status" aria-live="polite">
      {/* (Owner, Oct 27) A confirm dialog closes when its press fails; this notice sits under the button that opened it and says so. */}
      {didntGo && <p className="font-medium" data-didnt-go="">Your press didn&apos;t go through.</p>}
      {changes && (
        <>
          <p className="font-medium">Since you opened this page:</p>
          {/* (Design doc 2) The newest 3 lines, then "Show N more" opening a scroll box about 8 lines tall. */}
          <LongList className="my-1 list-disc pl-5" tall="max-h-52">
            {[...changes].map((c, i) => (
              <li key={`${c.at}|${c.text}|${i}`}>
                {c.text.startsWith("You also did this in another tab") ? `${c.text} at ${time(c.at)}` : `${c.text} · ${time(c.at)}`}
              </li>
            ))}
          </LongList>
          <p>{tail}</p>
          <QuickIgnore alerts={[...new Set(changes.map((c) => c.alert).filter((x): x is string => !!x))]} />
        </>
      )}
      {error && (error.startsWith("Confirm your email first.") ? <p className="flex flex-wrap items-center gap-2">{error} <ResendConfirm label="Resend the link" /></p> : link ? (
        // The refusal names something on this page (the other side's waiting request): the text links to it.
        <p><a href={`#${link}`} onClick={(e) => { e.preventDefault(); jumpTo(link); }}>{error}</a></p>
      ) : <p>{error}</p>)}
    </div>
  );
}
