"use client";
import { useEffect, useRef } from "react";
import { FIELD } from "@/lib/client";
import { ResendConfirm } from "@/components/ResendConfirm";
import { bringInView } from "@/lib/markJump";
import { isPerkRefusal } from "@/lib/subscription";
import { SubscribeLink } from "@/components/SubscribeLink";
import { ANSWER_TERMS_FIRST } from "@/lib/answerTerms";

/** Red for a form mistake (fix the field and press again); blue for a refusal. Brought into view when it appears. */
export function Err({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    // (Batch 27 section 1) The new-terms line stays under its button while the page goes up to the Switch / Keep box.
    if (text && text !== ANSWER_TERMS_FIRST) bringInView(ref.current);
  }, [text]);
  if (!text) return null;
  if (text === ANSWER_TERMS_FIRST) return <p ref={ref} className="err" data-answer-terms="">{text}</p>;
  const red = text.startsWith(FIELD);
  if (!red && text.startsWith("Confirm your email first.")) return <p ref={ref} className="err flex flex-wrap items-center gap-2">{text} <ResendConfirm label="Resend the link" /></p>;
  if (!red && isPerkRefusal(text)) return <p ref={ref} className="err flex flex-wrap items-center gap-2" data-perk-refusal="">{text} <SubscribeLink /></p>;
  return <p ref={ref} className={red ? "err-field" : "err"}>{red ? text.slice(1) : text}</p>;
}
