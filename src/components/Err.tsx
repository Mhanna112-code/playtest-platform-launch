"use client";
import { withLineLinks } from "@/components/LineLinks";
import { knownLinks } from "@/lib/lineLinkRegistry";
import { useEffect, useRef } from "react";
import { FIELD } from "@/lib/client";
import { NDA_BLOCK_FIRST } from "@/lib/ndaNotice";
import { ResendConfirm } from "@/components/ResendConfirm";
import { bringInView } from "@/lib/markJump";
import { isPerkRefusal } from "@/lib/subscription";
import { SubscribeLink } from "@/components/SubscribeLink";
import { ANSWER_TERMS_FIRST } from "@/lib/answerTerms";
import { refusalLine } from "@/lib/pressLabels";
import Link from "next/link";
import { ACCOUNT_CLOSED, CONTACT_US_HREF } from "@/lib/accountClosed";
import { PayOwedLink } from "@/components/PayOwedLink";

/**
 * Red for a form mistake (fix the field and press again); blue for a refusal. Brought into view when it appears.
 * (Owner, Nov 3, §156) `press`: the pressed button's label. A refusal then names it first, as every refusal does (batch 15 section 36): "Your Block didn't go
 * through: …". A red form mistake, a line that already names its press, ANSWER_TERMS_FIRST and (§302) NDA_BLOCK_FIRST read as they are.
 * (Owner, Dec 10 2026) Those two end "… at the top of the page." and come into view under the button like every other line (the page no longer goes up).
 * A line under a button stays until that button is pressed again or the page reloads (a redraw with a new version no longer takes it away).
 */
export function Err({ text, press = "" }: { text: string; press?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    // (Owner, Dec 10 2026; replaces batch 27 §1 and §302's exceptions) Every line comes into view under its button, the new-terms and NDA lines too: the page
    // no longer goes up to Switch / Keep or the NDA notice.
    if (text) bringInView(ref.current);
  }, [text]);
  // (Owner, Dec 10 2026; replaces batch 35 §60) No longer gone when the page redraws with a new version: a line under a button stays until that button is
  // pressed again (its owner clears it) or the page reloads. A red form mistake keeps its own rule (stays until fixed).
  if (!text) return null;
  if (text === ANSWER_TERMS_FIRST) return <p ref={ref} className="err" data-answer-terms="">{text}</p>;
  // (Owner, Nov 6, §302; replaces §267's blue notice with its link) The NDA block's line reads exactly so, like the new-terms line.
  if (text === NDA_BLOCK_FIRST) return <p ref={ref} className="err" data-nda-refusal="">{text}</p>;
  const red = text.startsWith(FIELD);
  const line = red ? text : refusalLine(press, text);
  if (!red && text.startsWith("Confirm your email first.")) return <p ref={ref} className="err flex flex-wrap items-center gap-2">{line} <ResendConfirm label="Resend the link" /></p>;
  // (Owner, Nov 1, §114) Google's sign-up step for the email of a deleted account that wasn't clean: the line exactly, with Contact us after it.
  if (!red && text === ACCOUNT_CLOSED) return <p ref={ref} className="err" data-account-closed="">{text} <Link href={CONTACT_US_HREF} className="underline" data-contact-us="">Contact us</Link></p>;
  // (Owner, Nov 5, §227) A refusal about what's owed ("Pay what you owe first.") links to Pay what you owe on Payments (it's never on the test page).
  if (!red && /pay what you owe/i.test(text)) return <p ref={ref} className="err" data-refusal-named={line !== text ? "" : undefined} data-owed-refusal="">{withLineLinks(line, knownLinks(), { draw: (t) => t })} <PayOwedLink /></p>;
  if (!red && isPerkRefusal(text)) return <p ref={ref} className="err flex flex-wrap items-center gap-2" data-perk-refusal="">{line} <SubscribeLink /></p>;
  return <p ref={ref} className={red ? "err-field" : "err"} {...(!red && line !== text ? { "data-refusal-named": "" } : {})}>{red ? text.slice(1) : withLineLinks(line, knownLinks(), { draw: (t) => t }) /* (Owner, Nov 5, §270) its names and tests, green links */}</p>;
}
