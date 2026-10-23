import { FIELD } from "@/lib/client";
import { ResendConfirm } from "@/components/ResendConfirm";

/** Red for a form mistake (fix the field and press again); blue for a refusal. */
export function Err({ text }: { text: string }) {
  if (!text) return null;
  const red = text.startsWith(FIELD);
  if (!red && text.startsWith("Confirm your email first.")) return <p className="err flex flex-wrap items-center gap-2">{text} <ResendConfirm label="Resend the email" /></p>;
  return <p className={red ? "err-field" : "err"}>{red ? text.slice(1) : text}</p>;
}
