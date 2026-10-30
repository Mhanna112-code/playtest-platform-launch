"use client";
import { isPerkRefusal } from "@/lib/subscription";
import { SubscribeLink } from "@/components/SubscribeLink";
import { useEffect, useRef, useState } from "react";
import { ResendConfirm } from "@/components/ResendConfirm";
import { markShownInBox } from "@/lib/live";
import { bringInView, jumpTo } from "@/lib/markJump";
import { KEY_BOX_ID } from "@/lib/keys";
import { LongList } from "@/components/LongList";
import { QuickIgnore, TesterAlertsOff } from "@/components/QuickIgnore";
import { ContractLink } from "@/components/ContractLink";
import { lastPressLabel } from "@/lib/client";
import { pressVerb, refusalLine } from "@/lib/pressLabels";
import { ANSWER_TERMS_FIRST } from "@/lib/answerTerms";
import { fmtTimeIn } from "@/lib/format";
import { savedZone } from "@/components/TimeZoneSync";
import { seeItClick, useSeeItTarget } from "@/components/ListingInfo";

export type Change = { text: string; at: string; kind?: string; alert?: string; ignored?: boolean; contract?: string; link?: string; /** (Batch 16 section 19) the fields another tab changed (API names) */ fields?: string[]; /** (Batch 20 section 4) one line per thing: a newer line with the same key replaces it */ key?: string; /** (Batch 20 section 25) a live-box line that never stops a press */ quiet?: boolean; /** (Batch 30 §10) the text says its own time ("… edited the listing at 6:55 PM: …") */ timed?: boolean; /** (Batch 30 §12) the join page's NDA changed (its tick clears) */ nda?: boolean; /** (Batch 34 §14) the developer's listing change: See it jumps to the Listing panel */ listing?: boolean };

/** (Batch 28 §4) Every time in the box is in the reader's saved zone (the browser's only when none is saved), like the stop lines. */
const time = (iso: string) => fmtTimeIn(iso, savedZone());
const DEFAULT_TAILS = new Set(["Press again to go ahead.", "Press again to go ahead"]);

/**
 * The stop-once box (and any refusal): a blue notice placed directly under the button that was pressed, scrolled into view.
 * (Owner, Oct 30, batch 15 section 36) Top to bottom: "Your <button> didn't go through."; "Since you opened this page:" and the list; the Alerts lines (the tester's
 * toggle wording on the tester side); and last, in bold, "Press <button> again to go ahead.". A refusal names the press first: "Your Pay didn't go through: <reason>".
 * `press` is the button's label; without one, the label of the press that was just stopped or refused (from its API path).
 */
export function ChangesBox({ changes, error, tail = "Press again to go ahead.", link, didntGo = false, press, side = "developer", detail, seeIt, alertsWhere, heading }: { changes: Change[] | null; error?: string; tail?: string; link?: string; didntGo?: boolean; press?: string; side?: "developer" | "tester"; /** (Batch 16 section 19) more under a line (Edit: Before / What you typed) */ detail?: (c: Change) => React.ReactNode; /** (Batch 30 §10) a listing save's line ends "· See it" (where the listing is on this page) */ seeIt?: string; /** (Batch 30 §10) the join page has no test page yet: its Alerts hint says "on your dashboard" */ alertsWhere?: "join"; /** (Batch 34 §1) the admin pages' heading: "Since this page loaded:" */ heading?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // (Batch 34 §14) The developer's test page gives every box its Listing panel ("#listing").
  const pageSeeIt = useSeeItTarget();
  const seeTo = seeIt ?? pageSeeIt;
  const shown = !!(changes || error);
  const [label, setLabel] = useState(press ?? "");
  useEffect(() => {
    if (shown) setLabel(press ?? lastPressLabel());
  }, [shown, press, error]);
  useEffect(() => {
    if (changes) markShownInBox(changes); // seen: the top box lists them quietly, without its scroll
    // (Batch 27 section 1) The new-terms line stays under its button while the page goes up to the Switch / Keep box.
    if (changes || (error && error !== ANSWER_TERMS_FIRST)) bringInView(ref.current);
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
          <p className="font-medium">{heading ?? (changes.length > 0 && changes.every((c) => c.kind === "account" || c.kind === "account-at") ? "Changed in another tab or device since you opened this page:" : "Since you opened this page:")}</p>
          {/* (Design doc 2) The newest 3 lines, then "Show N more" opening a scroll box about 8 lines tall. */}
          <LongList className="my-1 list-disc pl-5" tall="max-h-52">
            {[...changes].map((c, i) => (
              <li key={`${c.at}|${c.text}|${i}`}>
                {/* (Batch 16 section 21) A line can open what it's about (e.g. the next round's draft another tab made). */}
                {/* (Batch 26 section 4) A stop line ("This test was stopped at 3:10 PM.") already says its time: shown once. */}
                {c.link?.startsWith("/") ? <><a href={c.link} data-stop-link="">{c.text}</a> · {time(c.at)}</> : c.kind === "account-at" ? `${c.text} at ${time(c.at)}` : c.kind === "yours" ? `${c.text} at ${time(c.at)}.` /* (batch 23 section 5) Edit: "Instructions: your version will replace the one saved in another tab at 3:54 PM." */ : c.kind === "account" || c.kind === "stop" || c.timed ? c.text /* (batch 30 §10) "… edited the listing at 6:55 PM: …" says its own time */ : `${c.text} · ${time(c.at)}`}
                {/* (Owner, Oct 28) "Ana switched to the new terms" / "kept their current terms": the same "See their contract" as the top box (scrolls on the test page; a new tab from Edit). */}
                {c.kind === "terms" && c.contract && <> <ContractLink contract={c.contract} /></>}
                {/* (Batch 30 §10; batch 34 §14) A listing change (a tester's "… edited the listing at 6:55 PM: …", the developer's "You saved the listing in another tab: …"). */}
                {seeTo && ((c.timed && c.kind === "info") || c.listing) && <> · <a href={seeTo} data-see-it="" onClick={(e) => seeItClick(e, seeTo, c.at)}>See it</a></>}
                {/* (Batch 34 §12) The key the developer's Save gave this tester: See it jumps to the key box. */}
                {c.kind === "keygiven" && <> · <a href={`#${KEY_BOX_ID}`} data-see-it="key" onClick={(e) => { e.preventDefault(); jumpTo(KEY_BOX_ID); }}>See it</a></>}
                {(() => { const d = detail?.(c); return d ? <div className="mt-0.5 text-xs" data-stop-detail="">{d}</div> : null; })()}
              </li>
            ))}
          </LongList>
          {side === "tester" ? <TesterAlertsOff show={changes.some((c) => c.kind !== "terms" && c.kind !== "keyfixed")} where={alertsWhere} /> : <QuickIgnore alerts={alerts} />}
          <p className="mt-1 font-semibold" data-press-again="">{action}</p>
        </>
      )}
      {!changes && didntGo && !named && <p className="font-medium" data-didnt-go="">Your press didn&apos;t go through.</p>}
      {error && (error.startsWith("Confirm your email first.") ? <p className="flex flex-wrap items-center gap-2">{refusalLine(named, error)} <ResendConfirm label="Resend the link" /></p> : isPerkRefusal(error) ? <p className="flex flex-wrap items-center gap-2" data-perk-refusal="">{refusalLine(named, error)} <SubscribeLink /></p> : link ? (
        // The refusal names something on this page (the other side's waiting request): the text links to it.
        <p><a href={`#${link}`} onClick={(e) => { e.preventDefault(); jumpTo(link); }}>{refusalLine(named, error)}</a></p>
      ) : <p data-refusal="" {...(error === ANSWER_TERMS_FIRST ? { "data-answer-terms": "" } : {})}>{refusalLine(named, error)}</p>)}
    </div>
  );
}
