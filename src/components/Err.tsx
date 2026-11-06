"use client";
import { withLineLinks } from "@/components/LineLinks";
import { knownLinks } from "@/lib/lineLinkRegistry";
import { useEffect, useRef } from "react";
import { FIELD } from "@/lib/client";
import { isNdaBlockLine } from "@/lib/ndaNotice";
import { ResendConfirm } from "@/components/ResendConfirm";
import { bringInView } from "@/lib/markJump";
import { isPerkRefusal } from "@/lib/subscription";
import { SubscribeLink } from "@/components/SubscribeLink";
import { ANSWER_TERMS_FIRST } from "@/lib/answerTerms";
import { useGoneOnNewVersion } from "@/lib/pageVersion";
import { refusalLine } from "@/lib/pressLabels";
import Link from "next/link";
import { ACCOUNT_CLOSED, CONTACT_US_HREF } from "@/lib/accountClosed";
import { PayOwedLink } from "@/components/PayOwedLink";

/**
 * Red for a form mistake (fix the field and press again); blue for a refusal. Brought into view when it appears.
 * (Owner, Nov 3, §156) `press`: the pressed button's label. A refusal then names it first, as every refusal does (batch 15 section 36): "Your Block didn't go
 * through: …". A red form mistake, a line that already names its press, and "Answer the new terms first: Switch or Keep." read as they are.
 */
export function Err({ text, press = "" }: { text: string; press?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    // (Batch 27 section 1) The new-terms line stays under its button while the page goes up to the Switch / Keep box.
    if (text && text !== ANSWER_TERMS_FIRST) bringInView(ref.current);
  }, [text]);
  // (Batch 35 §60) Gone once the page redraws with a new version of itself (the situation it was about changed).
  // A red form mistake (fix the field) stays until fixed.
  const gone = useGoneOnNewVersion(text.startsWith(FIELD) ? "" : text, text);
  if (!text || gone) return null;
  if (text === ANSWER_TERMS_FIRST) return <p ref={ref} className="err" data-answer-terms="">{text}</p>;
  // (Owner, Nov 5, §267) The NDA block's refusal: the blue notice (§213's look) with its link, which opens the NDA notice on the session page (recorded as seen).
  if (isNdaBlockLine(text)) {
    const at = text.lastIndexOf(": ");
    const tail = text.slice(at + 2), link = tail.startsWith("read it") ? "read it" : "see the change";
    return <p ref={ref} className="info" data-nda-refusal="">{withLineLinks(text.slice(0, at + 2), knownLinks(), { draw: (t) => t })}<a href="?nda=open#info-nda" data-nda-link="">{link}</a>{tail.slice(link.length)}</p>;
  }
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
