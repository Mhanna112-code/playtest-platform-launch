"use client";
import { useEffect, useRef } from "react";
import { FIELD } from "@/lib/client";
import { ResendConfirm } from "@/components/ResendConfirm";
import { bringInView } from "@/lib/markJump";

/** Red for a form mistake (fix the field and press again); blue for a refusal. Brought into view when it appears. */
export function Err({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (text) bringInView(ref.current);
  }, [text]);
  if (!text) return null;
  const red = text.startsWith(FIELD);
  if (!red && text.startsWith("Confirm your email first.")) return <p ref={ref} className="err flex flex-wrap items-center gap-2">{text} <ResendConfirm label="Resend the email" /></p>;
  return <p ref={ref} className={red ? "err-field" : "err"}>{red ? text.slice(1) : text}</p>;
}
