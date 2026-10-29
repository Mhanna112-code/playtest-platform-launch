"use client";
import { isPerkRefusal } from "@/lib/subscription";
import { SubscribeLink } from "@/components/SubscribeLink";
import { useEffect, useRef, useState } from "react";
import { ResendConfirm } from "@/components/ResendConfirm";
import { markShownInBox } from "@/lib/live";
import { bringInView, jumpTo } from "@/lib/markJump";
import { LongList } from "@/components/LongList";
import { QuickIgnore, TesterAlertsOff } from "@/components/QuickIgnore";
import { ContractLink } from "@/components/ContractLink";
import { lastPressLabel } from "@/lib/client";
import { pressVerb, refusalLine } from "@/lib/pressLabels";

export type Change = { text: string; at: string; kind?: string; alert?: string; ignored?: boolean; contract?: string; link?: string; /** (Batch 16 section 19) the fields another tab changed (API names) */ fields?: string[]; /** (Batch 20 section 4) one line per thing: a newer line with the same key replaces it */ key?: string; /** (Batch 20 section 25) a live-box line that never stops a press */ quiet?: boolean };

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const DEFAULT_TAILS = new Set(["Press again to go ahead.", "Press again to go ahead"]);

/**
 * The stop-once box (and any refusal): a blue notice placed directly under the button that was pressed, scrolled into view.
 * (Owner, Oct 30, batch 15 section 36) Top to bottom: "Your <button> didn't go through."; "Since you opened this page:" and the list; the Alerts lines (the tester's
 * toggle wording on the tester side); and last, in bold, "Press <button> again to go ahead.". A refusal names the press first: "Your Pay didn't go through: <reason>".
 * `press` is the button's label; without one, the label of the press that was just stopped or refused (from its API path).
 */
export function ChangesBox({ changes, error, tail = "Press again to go ahead.", link, didntGo = false, press, side = "developer", detail }: { changes: Change[] | null; error?: string; tail?: string; link?: string; didntGo?: boolean; press?: string; side?: "developer" | "tester"; /** (Batch 16 section 19) more under a line (Edit: Before / What you typed) */ detail?: (c: Change) => React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const shown = !!(changes || error);
  const [label, setLabel] = useState(press ?? "");
  useEffect(() => {
    if (shown) setLabel(press ?? lastPressLabel());
  }, [shown, press, error]);
  useEffect(() => {
    if (changes) markShownInBox(changes); // seen: the top box lists them quietly, without its scroll
    if (changes || error) bringInView(ref.current);
  }, [changes, error]);
  if (!changes && !error) return null;
  if (!changes && error && error.startsWith("\u0001")) return <p ref={ref as unknown as React.RefObject<HTMLParagraphElement>} className="err-field basis-full">{error.slice(1)}</p>;
  const name = press ?? (label || lastPressLabel());
  const named = name && name !== "press" ? name : "";
  const action = DEFAULT_TAILS.has(tail) ? (named ? `Press ${pressVerb(named)} again to go ahead.` : "Press again to go ahead.") : tail;
  const alerts = changes ? [...new Set(changes.filter((c) => !c.ignored && c.kind !== "terms").map((c) => c.alert).filter((x): x is string => !!x))] : [];
  return (
    <div ref={ref} className="info basis-full" role="status" aria-live="polite" data-stop-box="">
      {changes && (
        <>
          <p className="font-medium" data-didnt-go="">{named ? `Your ${named} didn't go through.` : "Your press didn't go through."}</p>
          {/* (Batch 16 section 27) Payments, the profile editor and Settings: what another tab or device changed on the account. */}
          <p className="font-medium">{changes.length > 0 && changes.every((c) => c.kind === "account" || c.kind === "account-at") ? "Changed in another tab or device since you opened this page:" : "Since you opened this page:"}</p>
          {/* (Design doc 2) The newest 3 lines, then "Show N more" opening a scroll box about 8 lines tall. */}
          <LongList className="my-1 list-disc pl-5" tall="max-h-52">
            {[...changes].map((c, i) => (
              <li key={`${c.at}|${c.text}|${i}`}>
                {/* (Batch 16 section 21) A line can open what it's about (e.g. the next round's draft another tab made). */}
                {c.link?.startsWith("/") ? <><a href={c.link} data-stop-link="">{c.text}</a> · {time(c.at)}</> : c.text.startsWith("You also did this in another tab") || c.kind === "account-at" ? `${c.text} at ${time(c.at)}` : c.kind === "account" ? c.text : `${c.text} · ${time(c.at)}`}
                {/* (Owner, Oct 28) "Ana switched to the new terms" / "kept their current terms": the same "See their contract" as the top box (scrolls on the test page; a new tab from Edit). */}
                {c.kind === "terms" && c.contract && <> <ContractLink contract={c.contract} /></>}
                {(() => { const d = detail?.(c); return d ? <div className="mt-0.5 text-xs" data-stop-detail="">{d}</div> : null; })()}
              </li>
            ))}
          </LongList>
          {side === "tester" ? <TesterAlertsOff show={changes.some((c) => c.kind !== "terms" && c.kind !== "keyfixed")} /> : <QuickIgnore alerts={alerts} />}
          <p className="mt-1 font-semibold" data-press-again="">{action}</p>
        </>
      )}
      {!changes && didntGo && !named && <p className="font-medium" data-didnt-go="">Your press didn&apos;t go through.</p>}
      {error && (error.startsWith("Confirm your email first.") ? <p className="flex flex-wrap items-center gap-2">{refusalLine(named, error)} <ResendConfirm label="Resend the link" /></p> : isPerkRefusal(error) ? <p className="flex flex-wrap items-center gap-2" data-perk-refusal="">{refusalLine(named, error)} <SubscribeLink /></p> : link ? (
        // The refusal names something on this page (the other side's waiting request): the text links to it.
        <p><a href={`#${link}`} onClick={(e) => { e.preventDefault(); jumpTo(link); }}>{refusalLine(named, error)}</a></p>
      ) : <p data-refusal="">{refusalLine(named, error)}</p>)}
    </div>
  );
}
